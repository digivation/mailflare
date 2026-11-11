import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, readdirSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { build } from "esbuild";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = JSON.parse(readFileSync(join(root, "src/lib/migrations/bundle.json"), "utf8")).migrations;
const drop = migrations.find(({ name }) => name === "0084_remove_license_settings.sql");
const temp = mkdtempSync(join(root, "node_modules/.cache/license-removal-"));
const runnerPath = join(temp, "runner.mjs");
await build({ stdin: { contents: 'export { SqliteDatabase } from "./server/runtime/sqlite-database.ts"; export { applyMigrations } from "./server/runtime/migrate.ts"; export { applyPendingMigrations } from "./src/lib/migrations/service.ts";', resolveDir: root }, outfile: runnerPath, bundle: true, platform: "node", format: "esm", target: "node22", tsconfig: join(root, "tsconfig.json"), packages: "external", alias: { "@": join(root, "src") }, logLevel: "silent" });
const { SqliteDatabase, applyMigrations, applyPendingMigrations } = await import(pathToFileURL(runnerPath).href);

const asD1 = (sqlite) => ({
	prepare(sql) {
		let params = [];
		const statement = { bind(...values) { params = values; return statement; }, async run() { return sqlite.prepare(sql).run(...params); }, async first() { return sqlite.prepare(sql).get(...params) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...params) }; } };
		return statement;
	},
	async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
});

test.after(() => rmSync(temp, { recursive: true, force: true }));

test("license removal upgrades old data, preserves feature tables and is idempotent", () => {
	const db = new Database(":memory:");
	db.pragma("foreign_keys = ON");
	try {
		for (const migration of migrations) if (migration !== drop) for (const statement of migration.statements) db.exec(statement);
		db.exec("INSERT INTO users (id,email,password_hash,name,forwarding_email,created_at) VALUES ('u','u@example.test','x','User','f@example.test',1)");
		db.exec("INSERT INTO domains (id,user_id,hostname,zone_id,created_at) VALUES ('d','u','example.test','z',1)");
		db.exec("INSERT INTO mailboxes (id,user_id,domain_id,local_part,created_at) VALUES ('m','u','d','box',1)");
		db.exec("INSERT INTO mailbox_access (id,mailbox_id,user_id,permission,created_by_user_id,created_at) VALUES ('g','m','u','full_access','u',1)");
		db.exec("UPDATE app_settings SET app_name='Brand' WHERE id='default'");
		db.exec("INSERT INTO license_settings (id,instance_id,updated_at) VALUES ('old','instance',1)");
		assert.equal(db.prepare("PRAGMA foreign_key_list(license_settings)").all().length, 0);
		assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND sql LIKE '%license_settings%'").all().length, 0);
		const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(({ name }) => name).sort();
		for (const statement of drop.statements) db.exec(statement);
		for (const statement of drop.statements) db.exec(statement);
		assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='license_settings'").get(), undefined);
		assert.deepEqual(db.prepare("SELECT forwarding_email FROM users WHERE id='u'").get(), { forwarding_email: "f@example.test" });
		assert.equal(db.prepare("SELECT hostname FROM domains WHERE id='d'").get().hostname, "example.test");
		assert.equal(db.prepare("SELECT local_part FROM mailboxes WHERE id='m'").get().local_part, "box");
		assert.equal(db.prepare("SELECT permission FROM mailbox_access WHERE id='g'").get().permission, "full_access");
		assert.equal(db.prepare("SELECT app_name FROM app_settings WHERE id='default'").get().app_name, "Brand");
		assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(({ name }) => name).sort(), triggers);
	} finally { db.close(); }
});

test("the removal migration is safe when license_settings is already absent", () => {
	const db = new Database(":memory:");
	try { for (const statement of drop.statements) db.exec(statement); assert.ok(true); }
	finally { db.close(); }
});

test("Node runner applies fresh and pre-drop upgrades", async () => {
	const dir = join(temp, "old-migrations"); mkdirSync(join(dir, "meta"), { recursive: true });
	for (const file of readdirSync(join(root, "drizzle/migrations")).filter((name) => name.endsWith(".sql") && name !== "0084_remove_license_settings.sql")) copyFileSync(join(root, "drizzle/migrations", file), join(dir, file));
	writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify({ entries: [] }));
	const db = new SqliteDatabase(":memory:");
	try {
		await applyMigrations(db, dir);
		db.db.exec("INSERT INTO license_settings (id,instance_id,updated_at) VALUES ('old','old',1)");
		assert.ok((await applyMigrations(db, join(root, "drizzle/migrations"))).includes("0084_remove_license_settings.sql"));
		assert.equal(db.db.prepare("SELECT name FROM sqlite_master WHERE name='license_settings'").get(), undefined);
		assert.deepEqual(await applyMigrations(db, join(root, "drizzle/migrations")), []);
	} finally { db.db.close(); }
});

test("bundled D1-compatible runner applies the drop migration", async () => {
	const db = new Database(":memory:");
	try {
		const d1 = asD1(db);
		const result = await applyPendingMigrations(d1);
		assert.ok(result.applied.includes("0084_remove_license_settings.sql"));
		assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='license_settings'").get(), undefined);
		assert.equal((await applyPendingMigrations(d1)).applied.length, 0);
	} finally { db.close(); }
});

test("PostgreSQL PGlite fresh and pre-drop migration replay", async () => {
	const postgres = JSON.parse(readFileSync(join(root, "src/lib/migrations/bundle-postgres.json"), "utf8")).migrations;
	for (const upgrade of [false, true]) {
		const pg = new PGlite();
		try {
			for (const migration of postgres) {
				if (migration.name === "0008_remove_license_settings.sql") continue;
				for (const sql of migration.statements) await pg.exec(sql);
			}
			if (upgrade) await pg.exec("INSERT INTO license_settings (id, instance_id, updated_at) VALUES ('old','old',1)");
			const { rows: inbound } = await pg.query("SELECT conname FROM pg_constraint WHERE confrelid='license_settings'::regclass");
			assert.equal(inbound.length, 0);
			const { rows: triggers } = await pg.query("SELECT tgname FROM pg_trigger WHERE tgrelid='license_settings'::regclass AND NOT tgisinternal");
			assert.equal(triggers.length, 0);
			const removal = postgres.find(({ name }) => name === "0008_remove_license_settings.sql");
			for (const sql of removal.statements) await pg.exec(sql);
			const { rows } = await pg.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='license_settings'");
			assert.equal(rows.length, 0);
		} finally { await pg.close(); }
	}
});
