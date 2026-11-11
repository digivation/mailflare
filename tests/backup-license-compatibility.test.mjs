import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import Database from "better-sqlite3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "node_modules/.cache/backup-license-compatibility.mjs");
await build({ stdin: { contents: 'export * from "./src/lib/backups/export";', resolveDir: root, loader: "ts" }, outfile, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent", alias: { "@": join(root, "src") } });
const { exportDatabaseRecords, restoreDatabaseRecords } = await import(pathToFileURL(outfile).href);
const { migrations } = JSON.parse(readFileSync(join(root, "src/lib/migrations/bundle.json"), "utf8"));

function createDb(withRetired = true) {
	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = ON");
	for (const migration of migrations) for (const statement of migration.statements) sqlite.exec(statement);
	if (!withRetired) sqlite.exec("DROP TABLE IF EXISTS license_settings");
	sqlite.exec("INSERT INTO users (id,email,password_hash,name,role,is_primary_admin,disabled,can_manage_mailboxes,can_manage_domains,can_manage_users,keyboard_shortcuts_enabled,spam_protection_enabled,show_full_recipient_addresses,remote_content_mode,require_second_factor,totp_enabled,created_at) VALUES ('sentinel','s@example.test','x','Sentinel','user',0,0,0,0,0,1,1,0,'allow',0,0,1)");
	return sqlite;
}

function seedPreservedData(db) {
	db.exec("UPDATE users SET forwarding_email='forward@example.test' WHERE id='sentinel'");
	db.exec("INSERT INTO domains (id,user_id,hostname,zone_id,status,created_at) VALUES ('domain-1','sentinel','example.test','zone-1','active',1)");
	db.exec("INSERT INTO mailboxes (id,user_id,domain_id,local_part,created_at) VALUES ('mailbox-1','sentinel','domain-1','shared',1)");
	db.exec("INSERT INTO mailbox_access (id,mailbox_id,user_id,permission,created_by_user_id,created_at) VALUES ('grant-1','mailbox-1','sentinel','full_access','sentinel',1)");
	db.exec("INSERT INTO routing_rules (id,user_id,domain_id,scope,pattern,match_value,action,forward_to,created_at) VALUES ('forward-rule','sentinel','domain-1','domain','*','*','forward','route@example.test',1)");
	db.exec("UPDATE app_settings SET app_name='Branded Mail' WHERE id='default'");
}

function assertPreservedData(db) {
	assert.deepEqual(db.prepare("SELECT forwarding_email FROM users WHERE id='sentinel'").get(), { forwarding_email: "forward@example.test" });
	assert.deepEqual(db.prepare("SELECT hostname FROM domains WHERE id='domain-1'").get(), { hostname: "example.test" });
	assert.deepEqual(db.prepare("SELECT local_part FROM mailboxes WHERE id='mailbox-1'").get(), { local_part: "shared" });
	assert.deepEqual(db.prepare("SELECT permission FROM mailbox_access WHERE id='grant-1'").get(), { permission: "full_access" });
	assert.deepEqual(db.prepare("SELECT app_name FROM app_settings WHERE id='default'").get(), { app_name: "Branded Mail" });
	assert.deepEqual(db.prepare("SELECT forward_to FROM routing_rules WHERE id='forward-rule'").get(), { forward_to: "route@example.test" });
}

function handle(sqlite, sqlLog = []) {
	return {
		prepare(sql) {
			sqlLog.push(sql);
			const statement = { params: [], bind(...params) { statement.params = params; return statement; }, async all() { return { results: sqlite.prepare(sql).all(...statement.params) }; }, async run() { return sqlite.prepare(sql).run(...statement.params); }, async first() { return sqlite.prepare(sql).get(...statement.params) ?? null; } };
			return statement;
		},
		async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
	};
}

const bytes = (doc) => new TextEncoder().encode(JSON.stringify(doc));
const userCount = (db) => db.prepare("SELECT count(*) AS n FROM users").get().n;
const restore = (d1, doc) => { const content = bytes(doc); return restoreDatabaseRecords(d1, content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength)); };

test("current complete v2 exports omit retired metadata and restore on pre/post-drop databases", async () => {
	for (const preDrop of [true, false]) {
		const db = createDb(preDrop), sql = [], d1 = handle(db, sql);
		const backup = await exportDatabaseRecords(d1);
		const current = JSON.parse(new TextDecoder().decode(backup));
		assert.equal("license_settings" in current.tables, false);
		assert.equal(current.includedTables.includes("license_settings"), false);
		await restore(d1, current);
		assert.deepEqual(db.prepare("SELECT id,name FROM users").get(), { id: "sentinel", name: "Sentinel" });
		assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='license_settings'").get() !== undefined, preDrop);
		assert.equal(sql.some((query) => /license_settings/i.test(query)), false);
	}
});

test("legacy v1 and v2 complete documents normalize retired rows and preserve legacy compatibility", async () => {
	for (const preDrop of [true, false]) for (const version of [1, 2]) for (const included of [false, true]) for (const retiredRows of [[], [{ plan: "ignored", seats: 99 }]]) {
		const db = createDb(preDrop), sql = [], d1 = handle(db, sql);
		seedPreservedData(db);
		const current = JSON.parse(new TextDecoder().decode(await exportDatabaseRecords(d1)));
		current.version = version;
		current.tables.license_settings = retiredRows;
		// Retain the old body-table path and omit v1's later optional Drive group.
		current.tables.message_bodies = version === 1 ? [{ message_id: "legacy-message", text_body: "legacy body" }] : [];
		if (version === 1) {
			current.tables.messages.push({ id: "legacy-message", user_id: "sentinel", direction: "inbound", from_addr: "sender@example.test", to_addr: "s@example.test", status: "received", read: 0, starred: 0, has_unsubscribe: 0, created_at: 1 });
			delete current.tables.drive_items;
			delete current.tables.drive_upload_parts;
			delete current.tables.drive_shares;
			current.includedTables = current.includedTables.filter((table) => !table.startsWith("drive_"));
		}
		if (included) current.includedTables.push("license_settings"); else delete current.includedTables;
		await restore(d1, current);
		assert.deepEqual(db.prepare("SELECT id,name FROM users").get(), { id: "sentinel", name: "Sentinel" });
		assertPreservedData(db);
		if (version === 1) assert.equal(db.prepare("SELECT text_body FROM messages WHERE id='legacy-message'").get().text_body, "legacy body");
		assert.equal(sql.some((query) => /license_settings/i.test(query)), false);
	}
});

test("complete legacy documents may omit the retired table", async () => {
	for (const preDrop of [true, false]) {
		const db = createDb(preDrop), d1 = handle(db);
		const doc = JSON.parse(new TextDecoder().decode(await exportDatabaseRecords(d1)));
		await restore(d1, doc);
		assert.deepEqual(db.prepare("SELECT id,name FROM users").get(), { id: "sentinel", name: "Sentinel" });
	}
});

test("malformed, unknown, duplicate and partial inputs reject on both database states before sentinel deletion", async () => {
	const cases = [
		(doc) => { doc.tables.license_settings = null; },
		(doc) => { doc.tables.license_settings = [null]; },
		(doc) => { doc.tables.license_settings = [ [] ]; },
		(doc) => { doc.includedTables.push("not_a_table"); },
		(doc) => { doc.includedTables.push(doc.includedTables[0]); },
		(doc) => { doc.includedTables.push("license_settings"); delete doc.tables.license_settings; },
		(doc) => { doc.includedTables = ["license_settings"]; doc.tables.license_settings = []; },
		(doc) => { doc.includedTables = ["app_settings"]; doc.tables.app_settings = []; },
	];
	for (const preDrop of [true, false]) for (const mutate of cases) {
		const db = createDb(preDrop), sql = [], d1 = handle(db, sql);
		const doc = JSON.parse(new TextDecoder().decode(await exportDatabaseRecords(d1)));
		mutate(doc);
		await assert.rejects(restore(d1, doc));
		assert.deepEqual(db.prepare("SELECT id,name FROM users").get(), { id: "sentinel", name: "Sentinel" });
		assert.equal(sql.some((query) => /^(?:UPDATE users SET deleted_at|DELETE FROM users)/i.test(query)), false);
		assert.equal(sql.some((query) => /license_settings/i.test(query)), false);
	}
});
