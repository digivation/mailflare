import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const directory = mkdtempSync(join(root, "node_modules", "self-hosted-team-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export { SqliteDatabase } from "./server/runtime/sqlite-database.ts";
			export { applyMigrations } from "./server/runtime/migrate.ts";
			export { getDb } from "./src/db/index.ts";
			export { getMailboxAccessLevel, listAccessibleMailboxes } from "./src/lib/mailboxes/access.ts";
			export { getMailboxNotificationUserIds, notifyUsersOfNewMessage } from "./src/lib/realtime/utils.ts";
		`,
		resolveDir: root,
		sourcefile: "self-hosted-team-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	alias: { "cloudflare:workers": "./server/runtime/cloudflare-workers.ts" },
	logLevel: "silent",
});
const api = await import(pathToFileURL(join(directory, "entry.mjs")).href);

test("commercial licensing pages, routes, services and imports are absent", () => {
	for (const path of [
		"src/app/(admin)/licenses/page.tsx",
		"src/app/(admin)/licenses/license-activation.tsx",
		"src/app/(admin)/licenses/utils.ts",
		"src/app/(admin)/licenses/types.d.ts",
		"src/app/api/licenses/route.ts",
		"src/app/api/licenses/activate/route.ts",
		"src/app/api/licenses/validate/route.ts",
		"src/app/api/licenses/deactivate/route.ts",
		"src/app/api/licenses/utils.ts",
		"src/app/api/licenses/types.d.ts",
		"src/lib/licenses/constants.ts",
		"src/lib/licenses/paymug.ts",
		"src/lib/licenses/service.ts",
		"src/lib/licenses/types.d.ts",
		"src/lib/licenses/utils.ts",
		"src/components/license-indicator.tsx",
		"src/components/license-indicator-utils.ts",
		"src/components/license-indicator-types.d.ts",
		"src/components/license-required-overlay.tsx",
		"src/components/license-required-overlay-types.d.ts",
	]) assert.equal(existsSync(join(root, path)), false, path);
	const { stdout, status } = spawnSync("git", ["grep", "-n", "-E", "@/lib/licenses|@/components/license-indicator|/api/licenses", "--", "src"], { cwd: root, encoding: "utf8" });
	assert.equal(status, 1, stdout);
});

async function fixture(t) {
	const database = new api.SqliteDatabase(":memory:");
	const statements = [];
	t.after(() => database.db.close());
	await api.applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`
		INSERT INTO users (id, email, password_hash, name, role, disabled, deleted_at, created_at) VALUES
			('owner', 'owner@example.test', 'hash', 'Owner', 'admin', 0, NULL, 1),
			('domain-owner', 'domain-owner@example.test', 'hash', 'Domain owner', 'admin', 0, NULL, 1),
			('member', 'member@example.test', 'hash', 'Member', 'user', 0, NULL, 1),
			('unassigned', 'unassigned@example.test', 'hash', 'Unassigned', 'user', 0, NULL, 1),
			('disabled', 'disabled@example.test', 'hash', 'Disabled', 'user', 1, NULL, 1),
			('deleted', 'deleted@example.test', 'hash', 'Deleted', 'user', 0, 1, 1);
		INSERT INTO domains (id, user_id, hostname, zone_id, status, created_at)
			VALUES ('domain', 'domain-owner', 'example.test', 'zone', 'active', 1);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, disabled, created_at) VALUES
			('shared', 'owner', 'domain', 'shared', 'shared', 0, 1),
			('personal', 'owner', 'domain', 'personal', 'personal', 0, 1),
			('disabled-mailbox', 'owner', 'domain', 'disabled', 'shared', 1, 1);
		INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_by_user_id, created_at) VALUES
			('member-grant', 'shared', 'member', 'read_only', 'owner', 1),
			('disabled-grant', 'shared', 'disabled', 'full_access', 'owner', 1),
			('deleted-grant', 'shared', 'deleted', 'full_access', 'owner', 1);
	`);
	const prepare = database.prepare.bind(database);
	database.prepare = (sql) => {
		statements.push(sql);
		assert.doesNotMatch(sql, /license_settings/i, "mailbox access must not query licensing state");
		return prepare(sql);
	};
	const env = { DB: database };
	return { database, db: api.getDb(env), env, statements };
}

test("shared mailbox grants retain all four permission levels and revoke immediately", async (t) => {
	const f = await fixture(t);
	const member = { id: "member", email: "member@example.test", role: "user" };
	const expected = [
		["read_only", false, false, false],
		["send_on_behalf", false, true, false],
		["send_as", true, true, false],
		["full_access", true, true, true],
	];
	for (const [permission, canSendAs, canSendOnBehalf, canManage] of expected) {
		f.database.db.prepare("UPDATE mailbox_access SET permission = ? WHERE id = 'member-grant'").run(permission);
		const access = await api.getMailboxAccessLevel(f.db, member, "shared");
		assert.equal(access?.canRead, true);
		assert.equal(access?.canSendAs, canSendAs);
		assert.equal(access?.canSendOnBehalf, canSendOnBehalf);
		assert.equal(access?.canManage, canManage);
		assert.equal((await api.listAccessibleMailboxes(f.db, member))[0]?.permission, permission);
	}
	f.database.db.prepare("DELETE FROM mailbox_access WHERE id = 'member-grant'").run();
	assert.equal(await api.getMailboxAccessLevel(f.db, member, "shared"), null);
	assert.deepEqual(await api.listAccessibleMailboxes(f.db, member), []);
});

test("personal, unassigned and disabled mailboxes remain inaccessible", async (t) => {
	const f = await fixture(t);
	const member = { id: "member", email: "member@example.test", role: "user" };
	assert.equal(await api.getMailboxAccessLevel(f.db, { ...member, id: "unassigned" }, "shared"), null);
	assert.equal(await api.getMailboxAccessLevel(f.db, { ...member, id: "member" }, "personal"), null);
	assert.equal(await api.getMailboxAccessLevel(f.db, { ...member, id: "member" }, "disabled-mailbox"), null);
	f.database.db.prepare("UPDATE mailbox_access SET permission = 'invalid' WHERE id = 'member-grant'").run();
	const invalid = await api.getMailboxAccessLevel(f.db, member, "shared");
	assert.equal(invalid?.canRead, false);
	assert.equal(invalid?.canSendAs, false);
	assert.equal(invalid?.canSendOnBehalf, false);
	assert.equal(invalid?.canManage, false);
	assert.deepEqual(await api.listAccessibleMailboxes(f.db, member), []);
});

test("new-message recipients require a readable grant and active accounts", async (t) => {
	const f = await fixture(t);
	assert.deepEqual(
		(await api.getMailboxNotificationUserIds(f.env, "shared", "owner")).sort(),
		["domain-owner", "member", "owner"],
	);
	f.database.db.prepare("UPDATE mailbox_access SET permission = 'invalid' WHERE id = 'member-grant'").run();
	assert.deepEqual(
		(await api.getMailboxNotificationUserIds(f.env, "shared", "owner")).sort(),
		["domain-owner", "owner"],
	);
	assert.deepEqual((await api.getMailboxNotificationUserIds(f.env, "personal", "owner")).sort(), ["domain-owner", "owner"]);
	assert.deepEqual(await api.getMailboxNotificationUserIds(f.env, "disabled-mailbox", "owner"), []);
	assert.deepEqual(await api.getMailboxNotificationUserIds(f.env, "missing", "owner"), []);
	f.database.db.prepare("UPDATE users SET disabled = 1 WHERE id = 'owner'").run();
	assert.deepEqual(await api.getMailboxNotificationUserIds(f.env, "shared", "owner"), ["domain-owner"]);
	f.database.db.prepare("UPDATE users SET deleted_at = 1 WHERE id = 'domain-owner'").run();
	assert.deepEqual(await api.getMailboxNotificationUserIds(f.env, "shared", "owner"), []);
});

test("notification recipients are queried in batches below D1's bind limit", async (t) => {
	const f = await fixture(t);
	const addUser = f.database.db.prepare(`
		INSERT INTO users (id, email, password_hash, name, role, disabled, deleted_at, created_at)
		VALUES (?, ?, 'hash', 'Delegate', 'user', 0, NULL, 1)
	`);
	const addGrant = f.database.db.prepare(`
		INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_by_user_id, created_at)
		VALUES (?, 'shared', ?, 'read_only', 'owner', 1)
	`);
	for (let index = 0; index < 105; index++) {
		const id = `delegate-${index}`;
		addUser.run(id, `${id}@example.test`);
		addGrant.run(`grant-${index}`, id);
	}
	f.statements.length = 0;
	const recipients = await api.getMailboxNotificationUserIds(f.env, "shared", "owner");
	assert.equal(recipients.length, 108);
	const recipientQueries = f.statements.filter((sql) => sql.toLowerCase().includes('from "users"') && sql.toLowerCase().includes(' in ('));
	assert.equal(recipientQueries.length, 2);
	assert.ok(recipientQueries.every((sql) => (sql.match(/\?/g) ?? []).length <= 100));
	f.statements.length = 0;
	const delivered = [];
	f.env.REALTIME = { getByName: (id) => ({ fetch: async () => { delivered.push(id); return new Response(); } }) };
	f.env.VAPID_PUBLIC_KEY = `B${"A".repeat(86)}`;
	f.env.VAPID_PRIVATE_KEY = "A".repeat(43);
	f.env.VAPID_SUBJECT = "mailto:push@example.test";
	await api.notifyUsersOfNewMessage(f.env, recipients, {
		type: "new_message", mailboxId: "shared", messageId: "message", from: "sender@example.test", fromName: null, subject: "Hello",
	});
	assert.equal(delivered.length, 108);
	const pushQueries = f.statements.filter((sql) => /from \"(?:push_subscriptions|push_devices)\"/i.test(sql));
	assert.equal(pushQueries.length, 4);
	assert.ok(pushQueries.every((sql) => (sql.match(/\?/g) ?? []).length <= 100));
});
