import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "booking-permissions-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: { contents: `export { SqliteDatabase } from "./server/runtime/sqlite-database.ts"; export { applyMigrations } from "./server/runtime/migrate.ts"; export { getDb } from "./src/db/index.ts"; export { validBookingHostIds, parseBookingHostIds } from "./src/lib/booking/hosts.ts";`, resolveDir: root, sourcefile: "booking-permissions-test.ts" },
	outfile: join(directory, "entry.mjs"), bundle: true, platform: "node", format: "esm", target: "node22", tsconfig: join(root, "tsconfig.json"), packages: "external", alias: { "cloudflare:workers": "./server/runtime/cloudflare-workers.ts" }, logLevel: "silent",
});
const api = await import(pathToFileURL(join(directory, "entry.mjs")).href);

async function fixture(t) {
	const database = new api.SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await api.applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`INSERT INTO users (id,email,password_hash,name,role,disabled,calendar_enabled,deleted_at,created_at) VALUES
		('owner','owner@example.test','hash','Owner','user',0,1,NULL,1),
		('admin','admin@example.test','hash','Admin','admin',0,1,NULL,1),
		('host','host@example.test','hash','Host','user',0,1,NULL,1),
		('disabled','disabled@example.test','hash','Disabled','user',1,1,NULL,1),
		('no-calendar','no-calendar@example.test','hash','No calendar','user',0,0,NULL,1)`);
	return { database, db: api.getDb({ DB: database }) };
}

test("admins can choose active calendar hosts while users are self-only", async (t) => {
	const { db } = await fixture(t);
	assert.deepEqual(await api.validBookingHostIds(db, "owner", ["host"], true), ["owner", "host"]);
	assert.deepEqual(await api.validBookingHostIds(db, "owner", [], false), ["owner"]);
	assert.equal(await api.validBookingHostIds(db, "owner", ["host"], false), null);
});

test("disabled, calendar-disabled, excessive, malformed, and duplicate host selections fail", async (t) => {
	const { db } = await fixture(t);
	assert.equal(await api.validBookingHostIds(db, "owner", ["disabled"], true), null);
	assert.equal(await api.validBookingHostIds(db, "owner", ["no-calendar"], true), null);
	assert.equal(await api.validBookingHostIds(db, Array.from({ length: 20 }, (_, i) => `missing-${i}`)[0], [], true), null);
	assert.equal(await api.validBookingHostIds(db, "owner", Array.from({ length: 20 }, (_, i) => `missing-${i}`), true), null);
	assert.deepEqual(api.parseBookingHostIds('["host","host"]', "owner"), ["owner"]);
	assert.deepEqual(api.parseBookingHostIds('[1]', "owner"), ["owner"]);
	assert.equal(await api.validBookingHostIds(db, "owner", ["host", "host"], true), null);
});
