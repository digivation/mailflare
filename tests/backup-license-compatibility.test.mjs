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

test("legacy license table is validated then discarded for v1/v2, with or without includedTables", async () => {
	for (const preDrop of [true, false]) for (const version of [1, 2]) for (const included of [false, true]) {
		const db = createDb(preDrop), sql = [], d1 = handle(db, sql);
		const current = JSON.parse(new TextDecoder().decode(await exportDatabaseRecords(d1)));
		current.version = version;
		current.tables.license_settings = [{ plan: "ignored", seats: 99 }];
		if (included) current.includedTables.push("license_settings"); else delete current.includedTables;
		const content = bytes(current);
		await restoreDatabaseRecords(d1, content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength));
		assert.equal(userCount(db), 1);
		assert.equal(sql.some((query) => /(?:FROM|INTO|DELETE FROM)\s+license_settings/i.test(query)), false);
		const fresh = JSON.parse(new TextDecoder().decode(await exportDatabaseRecords(d1)));
		assert.equal("license_settings" in fresh.tables, false);
		assert.equal(fresh.includedTables.includes("license_settings"), false);
	}
});

test("malformed, unknown, duplicate and partial inputs reject before sentinel deletion", async () => {
	const cases = [
		(doc) => { doc.tables.license_settings = null; },
		(doc) => { doc.tables.license_settings = [null]; },
		(doc) => { doc.tables.license_settings = [ [] ]; },
		(doc) => { doc.includedTables.push("license_settings"); },
		(doc) => { doc.includedTables.push("not_a_table"); },
		(doc) => { doc.includedTables.push(doc.includedTables[0]); },
		(doc) => { doc.includedTables = ["license_settings"]; doc.tables.license_settings = []; },
		(doc) => { doc.includedTables = ["app_settings"]; doc.tables.app_settings = []; },
	];
	for (const mutate of cases) {
		const db = createDb(), sql = [], d1 = handle(db, sql);
		const doc = JSON.parse(new TextDecoder().decode(await exportDatabaseRecords(d1)));
		mutate(doc);
		const content = bytes(doc);
		await assert.rejects(restoreDatabaseRecords(d1, content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength)));
		assert.equal(userCount(db), 1);
		assert.equal(sql.some((query) => /^(?:UPDATE users SET deleted_at|DELETE FROM users)/i.test(query)), false);
	}
});
