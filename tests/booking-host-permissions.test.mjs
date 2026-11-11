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

const routeMocks = {
	"next/server": "export const NextResponse = { json: (body, init) => Response.json(body, init) };",
	"@/lib/cloudflare": "export function getEnv() { return globalThis.permissionRouteEnv; }",
	"@/lib/auth/cookies": "export async function getCurrentUser(_env, request) { return JSON.parse(request.headers.get('x-user') || 'null'); } export async function requireUser(_env, request) { const user = JSON.parse(request.headers.get('x-user') || 'null'); if (!user) throw new Error('Unauthorized'); return user; }",
	"@/lib/profile/sync": "export async function syncPersonalIdentity() {}",
	"@/lib/calendar/api-auth": "export function calendarAccessError() { return null; }",
	"@/lib/booking/username": "export async function ensureBookingUsername() { return 'owner'; }",
};
await build({
	stdin: { contents: `export { GET, POST } from './src/app/api/booking/route.ts'; export { PATCH } from './src/app/api/booking/[eventId]/route.ts'; export { PATCH as profilePatch } from './src/app/api/settings/profile/route.ts'; export { PATCH as forwardingPatch } from './src/app/api/settings/forwarding/route.ts';`, resolveDir: root, sourcefile: "permission-route-test.ts" },
	outfile: join(directory, "routes.mjs"), bundle: true, platform: "node", format: "esm", target: "node22", tsconfig: join(root, "tsconfig.json"), packages: "external", alias: { "cloudflare:workers": "./server/runtime/cloudflare-workers.ts" }, logLevel: "silent",
	plugins: [{ name: "route-mocks", setup(builder) { builder.onResolve({ filter: /.*/ }, ({ path }) => path in routeMocks ? { path, namespace: "mock" } : undefined); builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: routeMocks[path], loader: "js" })); } }],
});
const routes = await import(pathToFileURL(join(directory, "routes.mjs")).href);

async function fixture(t) {
	const database = new api.SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await api.applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`INSERT INTO users (id,email,password_hash,name,role,disabled,calendar_enabled,deleted_at,created_at) VALUES
		('owner','owner@example.test','hash','Owner','user',0,1,NULL,1),
		('admin','admin@example.test','hash','Admin','admin',0,1,NULL,1),
		('host','host@example.test','hash','Host','user',0,1,NULL,1),
		('disabled','disabled@example.test','hash','Disabled','user',1,1,NULL,1),
		('no-calendar','no-calendar@example.test','hash','No calendar','user',0,0,NULL,1),
		('deleted','deleted@example.test','hash','Deleted','user',0,1,1,1)`);
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
	assert.equal(await api.validBookingHostIds(db, "owner", ["deleted"], true), null);
	assert.equal(await api.validBookingHostIds(db, Array.from({ length: 20 }, (_, i) => `missing-${i}`)[0], [], true), null);
	assert.equal(await api.validBookingHostIds(db, "owner", Array.from({ length: 20 }, (_, i) => `missing-${i}`), true), null);
	assert.deepEqual(api.parseBookingHostIds('["host","host"]', "owner"), ["owner"]);
	assert.deepEqual(api.parseBookingHostIds('[1]', "owner"), ["owner"]);
	assert.equal(await api.validBookingHostIds(db, "owner", ["host", "host"], true), null);
});

function session(user) { return { id: user, email: `${user}@example.test`, name: user, role: user === "admin" ? "admin" : "user", calendarEnabled: true }; }
function request(path, user, method = "GET", body, origin = true) {
	const headers = { "x-user": JSON.stringify(session(user)) };
	if (body !== undefined) headers["content-type"] = "application/json";
	if (method !== "GET" && origin) headers.Origin = "https://mail.test";
	return new Request(`https://mail.test${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const bookingInput = (hosts) => ({ name: "Consultation", slug: "consultation", hostIds: hosts, durationMinutes: 30, weekdays: [1], startTime: "09:00", endTime: "10:00", timeZone: "UTC", enabled: true });

test("booking handlers compute admin access, enforce host selection, origin, and owner scope", async (t) => {
	const { database } = await fixture(t);
	globalThis.permissionRouteEnv = { DB: database };
	t.after(() => { delete globalThis.permissionRouteEnv; });
	const adminGet = await routes.GET(request("/api/booking", "admin"));
	assert.equal((await adminGet.json()).canManageHosts, true);
	assert.equal((await routes.GET(new Request("https://mail.test/api/booking"))).status, 401);
	const userGet = await routes.GET(request("/api/booking", "owner"));
	assert.equal((await userGet.json()).canManageHosts, false);
	assert.equal((await routes.POST(request("/api/booking", "admin", "POST", bookingInput(["host"]), false))).status, 403);
	assert.equal((await routes.POST(request("/api/booking", "owner", "POST", bookingInput(["host"])))).status, 400);
	const created = await routes.POST(request("/api/booking", "admin", "POST", bookingInput(["host"])));
	assert.equal(created.status, 200);
	const { event } = await created.json();
	assert.deepEqual(JSON.parse(event.hostIds), ["admin", "host"]);
	assert.equal((await routes.PATCH(request(`/api/booking/${event.id}`, "owner", "PATCH", bookingInput([])), { params: Promise.resolve({ eventId: event.id }) })).status, 404);
	assert.equal((await routes.PATCH(request(`/api/booking/${event.id}`, "admin", "PATCH", bookingInput(["host"]), false), { params: Promise.resolve({ eventId: event.id }) })).status, 403);
});

test("profile and forwarding endpoints retain validation while allowing unlicensed updates", async (t) => {
	const { database } = await fixture(t);
	globalThis.permissionRouteEnv = { DB: database };
	t.after(() => { delete globalThis.permissionRouteEnv; });
	const user = { ...session("owner"), forwardingEmail: null, resetEmail: "owner@example.test", avatarKey: null };
	const profileRequest = (body) => new Request("https://mail.test/api/settings/profile", { method: "PATCH", headers: { "content-type": "application/json", "x-user": JSON.stringify(user) }, body: JSON.stringify(body) });
	await assert.rejects(routes.profilePatch(new Request("https://mail.test/api/settings/profile", { method: "PATCH" })), /Unauthorized/);
	assert.equal((await routes.profilePatch(profileRequest({ name: "Owner", resetEmail: "owner@example.test", forwardingEmail: "bad" }))).status, 400);
	assert.equal((await routes.profilePatch(profileRequest({ name: "Owner", resetEmail: "owner@example.test", forwardingEmail: "forward@example.test" }))).status, 200);
	user.forwardingEmail = "forward@example.test";
	assert.equal((await routes.profilePatch(profileRequest({ name: "Owner", resetEmail: "owner@example.test" }))).status, 200);
	assert.equal(database.db.prepare("SELECT forwarding_email FROM users WHERE id='owner'").get().forwarding_email, "forward@example.test");
	const forward = (email) => new Request("https://mail.test/api/settings/forwarding", { method: "PATCH", headers: { "content-type": "application/json", "x-user": JSON.stringify(user) }, body: JSON.stringify({ forwardingEmail: email }) });
	await assert.rejects(routes.forwardingPatch(new Request("https://mail.test/api/settings/forwarding", { method: "PATCH" })), /Unauthorized/);
	assert.equal((await routes.forwardingPatch(forward("invalid"))).status, 400);
	assert.equal((await routes.forwardingPatch(forward(""))).status, 200);
	assert.equal(database.db.prepare("SELECT forwarding_email FROM users WHERE id='owner'").get().forwarding_email, null);
});
