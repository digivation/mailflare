import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "account-forwarding-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: { contents: `export { SqliteDatabase } from "./server/runtime/sqlite-database.ts"; export { applyMigrations } from "./server/runtime/migrate.ts"; export { getDb } from "./src/db/index.ts"; export { getAccountForwardingDestination, forwardedMarker, isForwardedMarkerValid } from "./src/lib/email/account-forwarding.ts"; export { intakeIncomingMail } from "./src/lib/email/intake.ts";`, resolveDir: root, sourcefile: "account-forwarding-test.ts" },
	outfile: join(directory, "entry.mjs"), bundle: true, platform: "node", format: "esm", target: "node22", tsconfig: join(root, "tsconfig.json"), packages: "external", alias: { "cloudflare:workers": "./server/runtime/cloudflare-workers.ts" }, logLevel: "silent",
});
const api = await import(pathToFileURL(join(directory, "entry.mjs")).href);

async function fixture(t) {
	const database = new api.SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await api.applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`
		INSERT INTO users (id,email,password_hash,name,role,disabled,deleted_at,created_at,forwarding_email) VALUES
		('owner','owner@example.test','hash','Owner','admin',0,NULL,1,'Destination@example.test'),
		('disabled','disabled@example.test','hash','Disabled','user',1,NULL,1,'bad@example.test'),
		('deleted','deleted@example.test','hash','Deleted','user',0,1,1,'bad@example.test');
		INSERT INTO domains (id,user_id,hostname,zone_id,status,created_at) VALUES ('d','owner','example.test','zone','active',1);
		INSERT INTO mailboxes (id,user_id,domain_id,local_part,type,created_at) VALUES ('box','owner','d','owner','personal',1),('b2','owner','d','second','personal',1),('b3','disabled','d','disabled','personal',1),('b4','deleted','d','deleted','personal',1);
		INSERT INTO mailbox_aliases (id,mailbox_id,domain_id,local_part,created_at) VALUES ('alias','box','d','alias',1);
	`);
	const statements = [];
	const prepare = database.prepare.bind(database);
	database.prepare = (sql) => { statements.push(sql); assert.doesNotMatch(sql, /license_settings|license_entitlements/i); return prepare(sql); };
	const env = { DB: database, INBOUND_WEBHOOK_SECRET: "test-secret", BUCKET: { objects: [], async put(key, body) { this.objects.push([key, body]); } }, INBOUND_QUEUE: { items: [], async send(item) { this.items.push(item); } } };
	return { database, env, db: api.getDb(env), statements };
}

test("destination lookup follows aliases, preserves empty/self values, and excludes inactive owners", async (t) => {
	const f = await fixture(t);
	assert.equal(await api.getAccountForwardingDestination(f.env, "alias@example.test"), "Destination@example.test");
	f.database.db.prepare("UPDATE users SET forwarding_email=NULL WHERE id='owner'").run();
	assert.equal(await api.getAccountForwardingDestination(f.env, "owner@example.test"), null);
	f.database.db.prepare("UPDATE users SET forwarding_email=' OWNER@EXAMPLE.TEST ' WHERE id='owner'").run();
	assert.equal(await api.getAccountForwardingDestination(f.env, "owner@example.test"), null);
	assert.equal(await api.getAccountForwardingDestination(f.env, "disabled@example.test"), null);
	assert.equal(await api.getAccountForwardingDestination(f.env, "deleted@example.test"), null);
	assert.ok(f.statements.length > 0);
});

test("marker signatures require MAC with secret, and unsigned fallback only without one", async () => {
	const env = { INBOUND_WEBHOOK_SECRET: "secret" };
	const marker = await api.forwardedMarker(env);
	assert.equal(await api.isForwardedMarkerValid(env, marker), true);
	const forged = `${marker.slice(0, -1)}${marker.endsWith("0") ? "1" : "0"}`;
	assert.equal(await api.isForwardedMarkerValid(env, forged), false);
	assert.equal(await api.isForwardedMarkerValid(env, "1"), false);
	assert.equal(await api.forwardedMarker({}), "1");
	assert.equal(await api.isForwardedMarkerValid({}, "1"), true);
});

test("shared intake suppresses A-to-B-to-A forwarding and stores after callback failures", async (t) => {
	const f = await fixture(t);
	const raw = new TextEncoder().encode("From: sender@example.net\r\n\r\nbody").buffer;
	let calls = 0;
	const actions = { async forward() { calls += 1; return false; } };
	const first = await api.intakeIncomingMail(f.env, { from: "sender@example.net", to: "owner@example.test", raw, headers: {} }, actions);
	assert.equal(first.action, "store");
	assert.equal(calls, 1);
	assert.equal(f.env.BUCKET.objects.length, 1);
	assert.equal(f.env.INBOUND_QUEUE.items.length, 1);
	const marker = await api.forwardedMarker(f.env);
	await api.intakeIncomingMail(f.env, { from: "owner@example.test", to: "second@example.test", raw, headers: { ["x-mailflare-forwarded"]: marker } }, actions);
	assert.equal(calls, 1, "forwarded second pass must not forward again");
	const unsupported = await api.intakeIncomingMail(f.env, { from: "sender@example.net", to: "owner@example.test", raw, headers: {} }, {});
	assert.equal(unsupported.action, "store");
	assert.equal(f.env.INBOUND_QUEUE.items.length, 3);
});
