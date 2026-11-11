import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("account forwarding is license-independent but only resolves active owners", async () => {
	const forwarding = await source("src/lib/email/account-forwarding.ts");
	assert.doesNotMatch(forwarding, /getLicenseEntitlements|canForwardEmail/);
	assert.match(forwarding, /eq\(users\.disabled, false\)/);
	assert.match(forwarding, /isNull\(users\.deletedAt\)/);
	assert.match(forwarding, /getEmailAddress\(destination\).*getEmailAddress\(recipient\)/s);
	assert.match(forwarding, /diff \|= expected\.charCodeAt\(index\) \^ value\.charCodeAt\(index\)/);
});

test("all forwarding mutation paths allow updates without removing existing validation", async () => {
	for (const path of ["src/app/api/settings/profile/route.ts", "src/app/api/settings/forwarding/route.ts", "src/app/api/accounts/[id]/route.ts", "src/app/api/v1/accounts/[id]/utils.ts"]) {
		const route = await source(path);
		assert.doesNotMatch(route, /getLicenseEntitlements|Pro or Team license/);
		assert.match(route, /forwardingEmail/);
	}
});

test("both intake paths retain guarded forwarding and continue to storage", async () => {
	for (const path of ["worker.ts", "src/lib/email/intake.ts"]) {
		const intake = await source(path);
		assert.match(intake, /isForwardedMarkerValid/);
		assert.match(intake, /getAccountForwardingDestination/);
	}
});
