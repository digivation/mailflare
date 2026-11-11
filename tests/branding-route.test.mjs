import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "branding-route-test-"));
const mocks = {
	"next/server": "export const NextResponse = { json: (body, init) => Response.json(body, init) };",
	"@/lib/auth/admin": "export function assertPrimaryAdmin(user) { if (user.role !== 'admin' || !user.isPrimaryAdmin) throw new Error('Forbidden'); }",
	"@/lib/auth/cookies": "export async function requireUser(_env, request) { return JSON.parse(request.headers.get('x-user')); }",
	"@/lib/branding/service": "export async function getBranding() { return globalThis.brandingRouteTest.saved; } export async function updateBranding(_env, input) { globalThis.brandingRouteTest.saved = { appName: input.appName, hasCustomIcon: !!input.icon }; return globalThis.brandingRouteTest.saved; }",
	"@/lib/cloudflare": "export function getEnv() { return {}; }",
};
await build({
	stdin: { contents: "export { PUT } from './src/app/api/branding/route.ts';", resolveDir: root, sourcefile: "branding-route-test.ts" },
	outfile: join(directory, "entry.mjs"), bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent",
	plugins: [{ name: "mocks", setup(builder) {
		builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "mock" } : undefined);
		builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path], loader: "js" }));
	} }],
});
const { PUT } = await import(pathToFileURL(join(directory, "entry.mjs")).href);
after(() => rmSync(directory, { recursive: true, force: true }));

async function put(user, { appName = "Custom", icon } = {}) {
	const form = new FormData();
	form.set("appName", appName);
	if (icon) form.set("icon", icon);
	return PUT(new Request("https://mail.test/api/branding", { method: "PUT", headers: { "x-user": JSON.stringify(user) }, body: form }));
}

test("branding writes stay primary-admin-only and valid primary saves succeed", async () => {
	globalThis.brandingRouteTest = {};
	assert.equal((await put({ role: "admin", isPrimaryAdmin: false })).status, 403);
	assert.equal((await put({ role: "user", isPrimaryAdmin: false })).status, 403);
	const response = await put({ role: "admin", isPrimaryAdmin: true }, { appName: "Custom brand" });
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { appName: "Custom brand", hasCustomIcon: false });
});

test("branding name, icon type and size limits remain enforced", async () => {
	const primary = { role: "admin", isPrimaryAdmin: true };
	assert.equal((await put(primary, { appName: "x".repeat(60) })).status, 200);
	assert.equal((await put(primary, { appName: "x".repeat(61) })).status, 400);
	assert.equal((await put(primary, { icon: new File(["x"], "icon.svg", { type: "image/svg+xml" }) })).status, 400);
	assert.equal((await put(primary, { icon: new File([new Uint8Array(2 * 1024 * 1024 + 1)], "icon.png", { type: "image/png" }) })).status, 413);
});
