import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("booking management is admin-only and preserves host validation", async () => {
	const collection = await source("src/app/api/booking/route.ts");
	const event = await source("src/app/api/booking/[eventId]/route.ts");
	for (const route of [collection, event]) {
		assert.doesNotMatch(route, /getLicenseEntitlements|canShareMailboxes/);
		assert.match(route, /user\.role === "admin"/);
		assert.match(route, /calendarAccessError/);
		assert.match(route, /hasValidSessionMutationOrigin/);
		assert.match(route, /validBookingHostIds/);
	}
	const hosts = await source("src/lib/booking/hosts.ts");
	assert.match(hosts, /hostIds\.length > 20/);
	assert.match(hosts, /eq\(users\.disabled, false\)/);
	assert.match(hosts, /eq\(users\.calendarEnabled, true\)/);
});
