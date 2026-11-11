# Mailflare commercial-licensing removal — implementation plan

## 1. Scope and inspected inputs

Prepared on 2026-11-10 for `/home/matthew/Development/mailflare`, branch `ourflare`, HEAD `cee65a5fd1ad27f21c72e492aa8cbf504ff40060` (Mailflare 0.5.4).

**Goal:** delete Mailflare's commercial feature licensing, not merely bypass its checks. Branding, account administration without a software seat cap, shared mailboxes, account forwarding, and administrator-managed booking hosts become normal installation features on Workers and Node. Existing authorization and operational restrictions still apply. This does not change the project's legal license.

## Progress

### Phase 0 — Node 22 Compose baseline established; Node 24 test target unresolved

- Commit: `chore(plan): record implementation baseline`.
- Compose runtime: Node `v22.23.4`, npm `10.9.9`, based on `node:22-bookworm-slim` (Docker image digest `sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d`). `npm ci --ignore-scripts && npm rebuild better-sqlite3` succeeded in the Dockerfile dependency stage; npm reported 35 audit findings (1 low, 20 moderate, 11 high, 3 critical). Dockerfile's Node build stage (`npm run build:node`) passed.
- `docker compose ... run ... node --test tests/*.test.mjs`: initially blocked because the Docker build stage lacks the `openssl` executable required by `tests/sns-signature.test.mjs`. Repeated in an ephemeral Compose container after installing `openssl` there (no repository/image change): exit 1, 568 tests, 558 pass, 8 fail, 2 skipped. Failures: two account-alias manager cases fail inserting `api_keys.prefix` (NOT NULL); six `manual-dns-checks.test.mjs` assertions fail. The Node 26-only layout bundle cleanup failure did not recur. Do not treat the missing `openssl` CLI as a source test failure; note the standard build image does not include it.
- `npx tsc --noEmit --incremental false`: exit 2. Errors: `src/app/page.tsx` missing `calendarEnabled`/`driveEnabled`; `src/lib/domains/resend-receiving.ts` missing `status` on inferred MX type; `src/lib/jmap/identities.ts` unreachable `??` right operand; unresolved `@/lib/cloudflare` and `@/lib/jmap/handler` imports in `src/app/.well-known/jmap/route.ts`.
- `npm run lint`: exit 1, 88 errors and 85 warnings across existing React Compiler/hooks, TypeScript and unused-import diagnostics.
- `npm run build`: pass (Worker/vinext build) after unsetting Dockerfile's `MAILFLARE_RUNTIME=node` for this command. An initial run with that Node-only alias set failed with four missing Cloudflare runtime exports; it was not the Worker build configuration. `npm run build:node`: pass in the Docker build stage; Next skipped type validation per existing config.
- Reviewed `tests/account-alias-selection.test.mjs`, `tests/manual-dns-checks.test.mjs`, `CLAUDE.md`, and the installed Next package. No Next `AGENTS.md` was present.
- No application source changes. No database/provider smoke was run. Compare future checks to this Node 22 Compose baseline; do not fix unrelated defects in feature commits.

**Unresolved:** the plan says the tests target Node 24, but `Dockerfile:3` deploys Node 22. The baseline now represents the actual self-hosted Compose/Docker runtime; a separate Node 24 comparison remains pending until the project resolves which runtime the test target represents. The earlier Node 26 results are superseded for deployment-runtime comparisons. Database engines and provider credentials were not checked.

### Prepared patch: inspected, not applied

File: `mailflare-self-hosted-team.patch` at the repository root.

- SHA-256: `5f58eb8c932d3e9df7a239fa4399627caa87b4ac92c328a163334a733d0bcbe6`.
- Mail-format commit: `140c8235d4268fde6dbb8d05c78eb1367443dd0e`; subject “Enable self-hosted branding and unlimited shared-mailbox teams”.
- `git apply --check mailflare-self-hosted-team.patch` passes against the inspected HEAD.
- Its 10 files introduce `SELF_HOSTED_TEAM_FEATURES`, override four entitlement fields, replace the direct sharing-license query with an always-enabled helper, revise three tests, and add fork notes and a security-oriented test suite.
- It **does not remove licensing**: status reads/initialization, Paymug calls, activation endpoints, commercial UI, upgrade requests, license storage, and seat bookkeeping remain. It deliberately leaves forwarding paid-only. Its documentation says no migration is necessary, which is not the design for this removal.
- Reuse the security scenarios in its proposed `tests/self-hosted-team.test.mjs`, not its entitlement architecture. Port tests to real feature behavior without importing deleted license helpers or seeding license rows in fully migrated databases.
- **Do not apply this patch wholesale.** Implement directly against HEAD. Leave the user's untracked patch untouched and uncommitted; it is reference material, not deliverable runtime code. If someone has applied it before implementation starts, account for its three added files explicitly as described below.

The patch was initially absent, then appeared after the user's instruction to recheck. At the end of inspection it was the only untracked file; tracked and staged application diffs were empty. No application changes were implemented. Plan-mode output belongs at `/home/matthew/.opencode/plan/IMPLEMENTATION_PLAN.md`, not in the repository.

### Explicit choices

1. Delete commercial gates at their callers; do not retain an entitlement service returning `true`, a fictional Team license, a feature-policy object, or runtime-specific replacement gates.
2. Remove licensing routes, rather than maintain compatibility endpoints: `/licenses` and `/api/licenses` plus its three action URLs cease to exist. A stale authenticated link should resolve as not found; authorization middleware may redirect an unauthenticated browser first. Do not add a new redirect or deactivation call.
3. Remove the internal response fields `seats`, `canForwardEmail`, and `canCustomizeBranding`, updating all repository consumers. Keep `canCreateShared` and `canManageHosts`: these still communicate real role-based permissions. Public `/api/v1` account and mailbox behavior keeps its existing authorization scope and JSON shape, except removal of commercial-denial responses.
4. Drop `license_settings` through new migrations in every dialect. Do not erase historical migrations or licensing data inside stored backup objects.
5. Continue writing backup format version 2 and accepting versions 1 and 2. Read and discard the one retired table through a narrow import compatibility rule. Do not add a backup format solely to remove one table.
6. Preserve `app_settings`, custom names/icons, all accounts, grants, forwarding destinations, booking hosts, and infrastructure configuration. No reactivation, account deletion, grant creation, or automatic role promotion.
7. No dependency changes, new licensing flags, separate favicon upload, provider changes, broad auth refactor, migration-runner rewrite, or unrelated failure fixes.

## 2. Complete inventory

Paths are repository-relative. A listed shared module stays unless its deletion is explicitly specified. These are all commercial gates found by tracked-file searches, plus their licensing-only callers, response types, tests, storage, and documentation.

### 2.1 Licensing-only server modules — delete after callers are removed

| Exact path | Relevant symbols / responsibility |
| --- | --- |
| `src/lib/licenses/constants.ts` | `LICENSE_PRODUCT_IDS` (Pro `ebafa58f-af9f-4b8a-a48d-6cfd44dd2053`, Team `6e42b54c-3221-4f8f-93a7-bab494f9e224`), `LICENSE_STATUS_CHANGED_EVENT` (`mailflare:license-status-changed`). |
| `src/lib/licenses/paymug.ts` | `PAYMUG_BASE_URL`, `callPaymugLicenseApi`; requests to `https://app.paymug.co/api/v1/licenses/{activate,validate,deactivate}` and vendor error translation. |
| `src/lib/licenses/service.ts` | `LICENSE_SETTINGS_ID`, `getOrCreateLicenseSettings`, `toLicenseStatus`, `getLicenseStatus`, `getLicenseEntitlements`, `updateLicenseFromPaymug`, `activateLicense`, `validateLicense`, `deactivateLicense`; initialization writes, key hashes, instance identity/version reporting, plan/state/features/seats. |
| `src/lib/licenses/seats.ts` | `countUsedAccountSeats`, `getAccountSeatError`; enabled-account count and quota rejection. |
| `src/lib/licenses/utils.ts` | `hashLicenseKey`, `parseFeatures`, `parsePaymugLicenseResponse`, `normalizeLicensePlan`. Searches found no non-licensing callers requiring these functions. |
| `src/lib/licenses/types.d.ts` | `LicensePlan`, `LicenseState`, `PaymugLicenseAction`, `PaymugLicenseResponse`, `LicenseStatus`, `LicenseActivationInput`, `LicenseDeactivationInput`, `LicenseEntitlements`. |
| `src/lib/mailboxes/access-utils.ts` | `isTeamMailboxSharingEnabled`; a separate direct query of `licenseSettings`, returning false on errors. Delete the file, not just its query. |

### 2.2 Commercial API surface — delete exact files

| Exact path | Relevant symbols |
| --- | --- |
| `src/app/api/licenses/route.ts` | `GET`, license status, no-store response. |
| `src/app/api/licenses/activate/route.ts` | `POST`, `activateLicense`. |
| `src/app/api/licenses/validate/route.ts` | `POST`, `validateLicense`. |
| `src/app/api/licenses/deactivate/route.ts` | `POST`, `deactivateLicense`. |
| `src/app/api/licenses/utils.ts` | `licenseKeySchema`, `requireLicenseAdmin`, `parseLicenseKeyRequest`, `getLicenseInstanceUrl`, `getLicenseErrorResponse`. Its primary-admin guard is specific to the deleted routes; do not delete shared auth primitives. |
| `src/app/api/licenses/types.d.ts` | `LicenseKeyRequest`, `LicenseApiResponse`. |

### 2.3 Commercial checks in retained server code

| Exact path | Symbols / exact change boundary |
| --- | --- |
| `src/lib/api/admin-auth.ts` | Delete `canShareAdminMailboxes` and `canManageAdminAccounts`; retain `authenticateAdminApiKey` and its admin-role plus requested-scope checks. |
| `src/app/api/accounts/utils.ts` | `requireTeamAdmin` combines session/admin auth with account entitlement; `requireTeamSharingAdmin` wraps it with sharing entitlement. Collapse to the same existing auth logic under `requireAdminSession`, without either entitlement. Keep account/domain query helpers. |
| `src/app/api/accounts/route.ts` | `GET` entitlement/count query and `seats` response; `GET`, `POST`, `DELETE` use `requireTeamAdmin`. Keep `canManageUsers`, primary-only admin creation, validation and deletion rules. |
| `src/app/api/accounts/create.ts` | `createAccountResponse`: initial `getAccountSeatError`; shared by dashboard and v1/MCP. Remove only quota check/import, preserving domain ownership, aliases, conflicts, batching, provisioning and rollback. |
| `src/app/api/accounts/[id]/route.ts` | `GET` forwarding capability field; `PATCH` forwarding entitlement and disabled-to-enabled seat check; both use admin helper. Keep deleted-account conflict, editable-target/role checks, passkey-only protection, step-up grants, audit and session revocation. |
| `src/lib/accounts/deletion.ts` | `restoreAccount`: seat check/import only. `deleteAccounts`, transfer, retention and purge are not licensing code. |
| `src/app/api/v1/accounts/utils.ts` | `GET` and `POST`: account entitlement checks via `canManageAdminAccounts`; preserve scoped-key auth and creator/account restrictions. |
| `src/app/api/v1/accounts/[id]/utils.ts` | `GET` and `PATCH`: account entitlement; `PATCH`: forwarding entitlement. Preserve scoped-key auth, creator/self filter, role restrictions and credential-security handling. |
| `src/app/api/v1/mailboxes/utils.ts` | `POST`: `canShareAdminMailboxes` for `type === "shared"`. Preserve key scope, owner and domain queries, duplicate checks and routing rollback. |
| `src/app/api/mailboxes/route.ts` | `GET`: entitlement operand of `canCreateShared`; `POST`: mixed admin-role/commercial condition for shared creation. Retain role check and replace error with `Forbidden`. |
| `src/lib/mailboxes/access.ts` | `getMailboxAccessLevel`: remove license operand, keep shared-type and explicit-grant lookup; `listAccessibleMailboxes`: remove early `return owned` based on license. Keep disabled checks, ownership, permission rank and shared joins. |
| `src/lib/mailboxes/settings-access.ts` | `getMailboxSettingsAccess`: remove final commercial operand from owner/account-manager condition. Keep `canManageUsers`, `canManageUserAccount`, disabled-mailbox/deleted-owner filters and configuration/content separation. |
| `src/lib/realtime/utils.ts` | `getMailboxNotificationUserIds`: sharing-license operand on delegated notification fanout. Retain shared-type, explicit grants, deduplication and existing owner/domain-owner policy; see status-hardening requirements below. |
| `src/lib/branding/service.ts` | `getBranding`: paid-only fallback; `updateBranding`: entitlement rejection. Keep `APP_SETTINGS_ID`, `DEFAULT_APP_NAME`, `BRANDING_ICON_KEY`, persistence and genuine missing-settings fallback. Remove capability fields from returned `Branding`. |
| `src/app/api/branding/route.ts` | `PUT` maps licensing error text to 403; replace with ordinary 500 for persistence failures. Primary-admin authorization still independently returns 403. Public `GET` remains public. |
| `src/app/api/branding/icon/route.ts` | `GET`: pre-query entitlement fallback. Keep custom object lookup, packaged fallback, cache policy, MIME and nosniff header. |
| `src/app/api/auth/me/route.ts` | `GET`: entitlement branch of `Promise.all`, `user.canForwardEmail`; retain independent setup-metadata error fallback and authentication. |
| `src/app/api/settings/profile/route.ts` | `PATCH`: forwarding entitlement and returned capability; retain validation, self-only write, identity sync and omission-vs-clear behavior. |
| `src/app/api/settings/forwarding/route.ts` | `PATCH`: forwarding entitlement block; retain session, schema parsing and self-only update. |
| `src/lib/email/account-forwarding.ts` | `getAccountForwardingDestination`: entitlement early return. Keep all marker/MAC and self-forward prevention functions. Add explicit inactive-account exclusion as specified below. |
| `src/app/api/booking/route.ts` | `GET`, `POST`: `canManageHosts = admin && sharing entitlement`; simplify to admin role. |
| `src/app/api/booking/[eventId]/route.ts` | `PATCH`: same mixed condition; leave `DELETE` ownership intact. |
| `src/lib/mcp/admin-tools.ts` | `registerAdminMcpTools`, `manage_accounts` description promises licensing/seats; delete that sentence. Calls already delegate to v1 routes; do not implement a parallel MCP policy. |

### 2.4 Indirect authorization callers — update renamed helper, preserve checks

All callers of the two `requireTeam*Admin` helpers were searched. In addition to routes above, update imports/calls in:

- `src/app/api/accounts/[id]/transfer-primary/route.ts` — `POST`.
- `src/app/api/accounts/[id]/restore/route.ts` — `POST`.
- `src/app/api/accounts/[id]/recovery/route.ts` — `POST`.
- `src/app/api/accounts/[id]/mailboxes/route.ts` — `GET`.
- `src/app/api/accounts/[id]/avatar/route.ts` — `POST`.
- `src/app/api/accounts/[id]/avatar/utils.ts` — its account-authorization helper.
- `src/app/api/mailboxes/[id]/access/route.ts` — `GET`, `POST`, `DELETE`; retain `getSharedMailboxForAdmin` and target-account restrictions in `src/app/api/mailboxes/[id]/access/utils.ts`.

The v1 entrypoints `src/app/api/v1/accounts/route.ts`, `src/app/api/v1/accounts/[id]/route.ts`, and `src/app/api/v1/mailboxes/route.ts` re-export utility handlers; leave their thin exports intact. Mailbox detail/alias/avatar routes using `getMailboxSettingsAccess` inherit the change; do not substitute it for message or sending authorization.

`getMailboxAccessLevel`, `listAccessibleMailboxes`, and `listAccessibleMailboxIds` feed message APIs, sender authorization, JMAP, MCP and other mailbox features. Change the common helpers once, not each content route. In particular retain the accessible-mailbox and `hasMailboxPermission(..., "read_only")` checks in `src/app/api/messages/route.ts` and sender authorization in `src/lib/email/sender.ts`.

### 2.5 Licensing-only UI — delete exact files

- `src/app/(admin)/licenses/page.tsx` — `LicensesPage`, plan cards.
- `src/app/(admin)/licenses/license-activation.tsx` — `LicenseActivation`, status/key/tier/action state.
- `src/app/(admin)/licenses/utils.ts` — `LICENSE_PLANS`, `loadLicenseStatus`, `runLicenseAction`, `formatLicensePlan`, `formatLicenseDate`, Pro/Team checkout URLs.
- `src/app/(admin)/licenses/types.d.ts` — `LicensePlan`, `LicenseAction`, `ActivatableLicensePlan`, `LicenseResponse`.
- `src/components/license-indicator.tsx` — `LicenseIndicator`, upgrade link and status-change listener.
- `src/components/license-indicator-utils.ts` — `loadLicenseIndicatorStatus`, `/api/licenses` request.
- `src/components/license-indicator-types.d.ts` — `LicenseIndicatorResponse`.
- `src/components/license-required-overlay.tsx` — `LicenseRequiredOverlay`.
- `src/components/license-required-overlay-types.d.ts` — `LicenseRequiredOverlayProps`.

### 2.6 Retained UI, response contracts and fixtures

| Exact path | Commercial-only pieces |
| --- | --- |
| `src/app/(admin)/layout.tsx` | `LicenseIndicator` import/render; `/licenses` in `primaryOnlyPrefixes`. Keep all other primary-only routes and providers. |
| `src/app/(dashboard)/layout.tsx` | `LicenseIndicator` import/render. |
| `src/app/(settings)/layout.tsx` | `LicenseIndicator` import/render. |
| `src/app/(calendar)/layout.tsx` | `LicenseIndicator` import/render. |
| `src/app/(drive)/layout.tsx` | `LicenseIndicator` import/render. |
| `src/components/admin-nav.tsx` | `/licenses` link in `sections`, `BadgeDollarSign` import. Retain branding and permissions. |
| `src/app/(admin)/admin/page.tsx` | License overview card and `BadgeDollarSign` import. |
| `src/components/admin-page-titles.ts` | `/licenses` entry in `adminPageTitles`. |
| `src/components/route-title-utils.ts` | `/licenses` entry in `staticRouteTitles`. |
| `src/components/dashboard-shell.tsx` | `/licenses` in `adminPrefixes`. |
| `src/components/icons.tsx` | `BadgeDollarSign` export and `HugeBadgeDollarSignIcon` alias are used only by the two deleted license links/cards; remove after confirming no new consumers. Keep `LockKeyhole`, used by password-reset UI. |
| `src/app/(admin)/accounts/page.tsx` | `seats`, `setSeats`, `teamRequired`, `setTeamRequired`, `seatsFull`, error-text paywall detection, overlay and seat-dependent button disabling. Keep real `canManage`, errors, loading, delete/restore and form validation. |
| `src/app/(admin)/accounts/types.d.ts` | `AccountResponse.seats`. |
| `src/app/(admin)/accounts/[id]/page.tsx` | `account.canForwardEmail &&` wrapper; render existing forwarding controls under existing edit/disabled rules. |
| `src/app/(admin)/accounts/[id]/types.d.ts` | `canForwardEmail` field. |
| `src/app/(admin)/branding/page.tsx` | `!branding.canCustomizeBranding` paywall branch and its now-unused imports; retain existing form. |
| `src/lib/branding/types.d.ts` | `Branding.canCustomizeBranding`. |
| `src/components/branding-provider-utils.ts` | `DEFAULT_BRANDING.canCustomizeBranding`; preserve fallback name/icon. |
| `src/components/settings/types.d.ts` | `ProfileFormResponse.user.canForwardEmail`, `AccountSettingsResponse.user.canForwardEmail`. No live settings component uses these flags. Do not build new forwarding UI. |
| `tests/i18n.test.mjs` | `getHomeBranding` mock still returns `canCustomizeBranding`; remove stale field. |

`src/components/branding-provider.tsx`, `src/components/branding-provider-types.d.ts`, `src/app/home-server-utils.ts`, and the root layout consume `Branding` structurally; verify they compile with the smaller shape. Their refresh/versioned-icon behavior is not licensing code.

### 2.7 Persistence, migration history and backup surface

- `src/db/schema/index.ts:1050` — `licenseSettings` declaration; also its member in exported `schema` near line 1297. All columns are licensing-only: `id`, `instance_id`, `instance_url`, `license_key_hash`, `plan`, `state`, `features`, `seat_limit`, `activated_at`, `validated_at`, `updated_at`. No application foreign key to this table was found.
- `src/db/schema/index.ts-e` — tracked stale SQLite-only schema copy, with `licenseSettings` and an exported `schema` member. No references were found; all three Drizzle configs point to `index.ts`. Delete this exact obsolete copy in the final persistence/cleanup phase after repeating the reference search. Do not maintain a second schema or delete neighboring files.
- `src/lib/backups/export.ts` — `BACKUP_TABLES`, `REQUIRED_BACKUP_TABLES`, `INTERNAL_TABLES`, `assertBackupTablesCoverDatabase`, `isDatabaseBackupDocument`, `parseDatabaseBackup`, `restoreDatabaseRecords`, `exportDatabaseRecords`.
- `src/lib/backups/table-groups.ts` — `BACKUP_TABLE_GROUPS`, system group includes `license_settings`.
- `src/lib/backups/types.d.ts` — `DatabaseBackupTable` includes `license_settings`; `DatabaseBackupDocument.includedTables` currently uses this live table union.
- SQLite history: `drizzle/migrations/0013_add_license_settings.sql`, `drizzle/migrations/0060_add_license_seat_limit.sql`; corresponding historical journal/snapshots in `drizzle/migrations/meta/`.
- PostgreSQL/MySQL history: `drizzle/migrations-pg/0000_baseline.sql`, `drizzle/migrations-mysql/0000_baseline.sql` create the table including seat limit; historical snapshots in each `meta/` directory.
- `src/lib/migrations/bundle.json`, `bundle-postgres.json`, `bundle-mysql.json` include that history. Keep historical entries and append the new drop migrations by running the bundler.
- `scripts/generate-migration-bundle.mjs` reads sorted `.sql` files; `src/lib/migrations/service.ts` selects bundles and records filenames in `d1_migrations` or `mailflare_migrations`; Node SQLite uses `server/runtime/migrate.ts`. Keep these runners unchanged.
- `src/lib/setup/migration.ts` only delegates to `applyPendingMigrations`. There is **no separate bootstrap CREATE TABLE string to edit** despite older CLAUDE.md wording.
- `tests/database-dialects.test.mjs:migrationTables` currently counts every historical `CREATE TABLE`, without processing drops. Its PostgreSQL/MySQL backup coverage assertions must be corrected when the table is dropped.

### 2.8 Existing tests requiring changes

| Exact path | Required treatment |
| --- | --- |
| `tests/account-alias-selection.test.mjs` | Remove normal license fixture insert; replace paid-license denial and seat-limit cases with no-license auth, repeated account creation and absence-of-quota assertions. Preserve alias/provisioning/rollback cases. |
| `tests/mailbox-settings-management.test.mjs` | Remove plan fixture argument and license insert/update; collapse plan-loop test into ordinary management behavior without license state. Preserve content/sender denial and identity checks. |
| `tests/messages-route-performance.test.mjs` | Remove license fixture insert and inactive-license denial; retain missing/disabled/private/invalid-grant denials and query/performance assertions; verify ordinary shared grants succeed. |
| `tests/image-response-cache.test.mjs` | Remove license-service mock and `custom` licensing switch; test configured icon, missing object, missing settings/table and asset fallback directly, preserving caching assertions. |
| `tests/setup-bootstrap-schema.test.mjs` | Remove positive license-table/insert expectation; assert table absence after migrations and keep mailbox insert and migration-idempotence coverage. |
| `tests/i18n.test.mjs` | Remove stale capability fixture; catalog parity/placeholder checks remain. |
| `tests/backup-table-list.test.mjs` | Test coverage before and after the removal migration, retired-table exclusion and unknown-table failure. |
| `tests/database-dialects.test.mjs` | Account for ordered drops; test live schema/bundle consistency without pretending historical CREATEs are live tables. |

Keep `tests/backup-restore-passkeys.test.mjs` passing; the backup changes must preserve passkey restore recounting and second-factor derivation. New focused tests are named in the phases.

### 2.9 Catalogs, docs and intentional non-removals

Catalogs: `src/lib/i18n/en.json` and all 33 files in `public/locales/`: `ar.json`, `bn.json`, `de.json`, `es.json`, `fa.json`, `fr.json`, `gu.json`, `ha.json`, `hi.json`, `id.json`, `it.json`, `ja.json`, `kn.json`, `ko.json`, `ml.json`, `mr.json`, `ms.json`, `nl.json`, `pa.json`, `pl.json`, `pt-BR.json`, `pt-PT.json`, `ru.json`, `si.json`, `sw.json`, `ta.json`, `te.json`, `th.json`, `tr.json`, `uk.json`, `ur.json`, `vi.json`, `zh-CN.json`.

- Delete keys prefixed `license.` and `licenses.`, plus `admin.nav.licenses`, `admin.section.licenses`, `branding.proOnly`, `branding.licenseRequired`, `branding.originalNote`, `accounts.seatsUsed`, `accounts.seatsFull`.
- Rewrite retained `admin.section.accounts` to “Add and manage user accounts.” and `adminKeys.perm.accountsDesc` to “Create and update accounts.”; translate the same meaning in every locale. Do not leave commercial prose under retained keys.
- `docs/deployment.md`, “Branding license”: replace activation instructions with primary-admin branding configuration and migration/backup upgrade notes.
- `docs/api.md`: booking-host and scoped-admin-key licensing statements; replace only commercial restrictions, preserving authorization/ownership wording.
- `CLAUDE.md`: access-control paragraph and “Licensing gates branding”; document license-free features and configuration/content separation. Also correct obsolete bootstrap wording if editing that paragraph.
- Add the prepared patch's intended `docs/landing-in-love-fork.md`, rewritten for **full removal**, and a short README link/note. Document forwarding, all runtimes, migrations, retired backup handling and source/license obligations. Do not copy its stale baseline numbers as current results or claim there is no migration.
- If the patch was applied meanwhile: delete `src/lib/licenses/self-hosted.ts`; replace its proposed `tests/self-hosted-team.test.mjs` with the behavior tests below and update the added docs, rather than retaining a fake entitlement layer.
- Leave `LICENSE`, README's legal-license section, package `license` metadata, lockfile dependency licenses, and generated `cloudflare-env.d.ts` copyright/license notices unchanged.
- Leave voluntary funding/sponsorship links in `README.md` and `.github/FUNDING.yml`; `store.paymug.co/buy/mailflare-sponsor` and `/buy/custom` do not enforce feature access. Explicitly distinguish them from deleted `app.paymug.co` API/Pro/Team checkout URLs.
- Leave historical changelog text (`changelog/0.2.1.md`), historical migration SQL, old snapshots, and their bundled historical statements intact. Keep Spamhaus's non-commercial-use terms in `spamFilter.spamhausHint`; they describe a third-party service, not Mailflare entitlements. `drizzle.team` in database documentation is unrelated.
- Searches found no commercial licensing variables or runtime gates in `server/`, `scripts/`, environment examples, `env.d.ts`, Worker configuration, Docker configuration or update workflows. `worker.ts` still matters for forwarding verification, not license deletion.

## 3. Final architecture and security invariants

### Architecture

The normal path becomes **authenticate → authorize actor and resource → validate → act**, without a license query, status initialization, vendor call or quota lookup. `requireAdminSession` is simply the renamed existing session/admin helper. Scoped API keys and MCP continue using `authenticateAdminApiKey`. Mailbox content still uses `getMailboxAccessLevel`/accessible IDs, never administrator status alone. Branding stays in `app_settings` and object storage; forwarding stays in `users.forwarding_email`; grants stay in `mailbox_access`.

Historical licenses have no effect whether active, expired, absent, inaccessible or malformed. No application code creates or reads the retired table. Backup import is the only retained compatibility reader of its **name**, and never executes SQL against it. There is no Paymug activation/deactivation during upgrade, startup, settings reads or restore.

### Non-negotiable invariants

1. **Authentication:** existing session expiry/token validation, disabled/deleted-user rejection in `src/lib/auth/cookies.ts`, API-key lookup, revocation and scopes remain. UI visibility is not authorization. Keep origin/CSRF checks where currently present, particularly booking mutation origin checks. Do not change unrelated routes' existing unauthenticated status codes to make tests easier.
2. **Administrative privileges:** branding writes and existing primary-only pages remain primary-admin-only. Account mutations keep `canManageUsers`, `canManageUserAccount`, primary-only admin/role changes, primary-account enablement, recovery/step-up and session revocation. The v1 interface retains its existing admin-key-and-scope authority model; do not silently widen it to arbitrary authenticated keys, or redesign its relationship to dashboard management flags in this task.
3. **Ownership:** v1 creator/self constraints, domain ownership, alias domain ownership, shared-mailbox management ownership, booking event ownership and self-only profile writes stay. Settings access for an authorized account manager must not become message-read or sender access. A primary administrator does not automatically gain another user's message contents by removal of licensing.
4. **Mailbox grants:** non-owner content access still requires a shared mailbox and an explicit grant. Keep cumulative levels `read_only < send_on_behalf < send_as < full_access`; read-only never sends, send-on-behalf never becomes send-as, and only full-access grants configure mailbox settings. Revocation affects list/read/send/notification paths immediately. Missing, disabled, unassigned and another user's personal mailboxes stay inaccessible; invalid permission values never grant read/send/manage.
5. **Account status:** disabled/deleted actors cannot use sessions or keys to acquire the newly available features. Account restoration removes only the seat restriction, not target/actor/status checks. Shared-grant creation keeps its active-target restriction. Calendar hosts must remain enabled and calendar-enabled. Account forwarding must not forward for a disabled/deleted owner.
6. **Validation:** keep Zod request schemas, email normalization/null handling, name/icon bounds, MIME allowlist, alias uniqueness/conflict checks, valid host selection and 20-host maximum, and resource validation before persistence. Preserve passkey-only password and concurrent security-change defenses. Do not remove error handling or routing rollback with the license branches.
7. **Forwarding loops and delivery:** keep `MAILFLARE_FORWARDED_HEADER`, `markerSecret`, `markerMac`, `forwardedMarker`, constant-time marker comparison in `isForwardedMarkerValid`, same-recipient normalization, and `alreadyForwarded` checks in both `worker.ts` and `src/lib/email/intake.ts`. Preserve rule precedence, keep-copy behavior, verified Cloudflare destinations, and store-on-forward-failure behavior. Provider intake without a forwarding action remains unable to forward; “available” does not invent transport support.
8. **Backup safety:** validation and complete-group checks happen before the first destructive statement (`UPDATE users SET deleted_at...` in `restoreDatabaseRecords`). Only recognized retired licensing input is discarded; unknown included tables must still fail. Retain legacy message-body conversion, MFA derivation, passkey recounting, trigger behavior, live-table dependency order and partial-backup rejection.

### Inspected security gaps: bounded treatment, not assumptions

- `getAccountForwardingDestination` currently selects only `forwardingEmail`, not account status. `resolveInboundAddress` checks mailbox/domain state but does not substitute for checking the owner's disabled/deleted state. Add `disabled = false` and `deleted_at IS NULL` predicates to the account lookup when removing the paywall. This is a deliberate fail-closed tightening on the newly opened path; do not alter mail storage/retention policy for disabled accounts.
- `getMailboxNotificationUserIds` currently reads grants without validating their permission/account status and has no disabled-mailbox filter. When opening shared notification fanout, fetch mailbox `disabled`, return no recipients for missing/disabled mailboxes, accept delegated IDs only with readable valid permission, and filter the final existing owner/domain-owner/delegate recipient set through active, nondeleted users. Reuse `hasMailboxPermission` for delegated permission interpretation. Keep the existing owner/domain-owner inclusion policy for active accounts; no new admin-wide recipient class. This prevents newly enabled fanout from pushing content to inactive/invalid delegates. Test it, rather than claiming the prepared patch already proves it.
- Key auth currently rejects `disabled` but does not independently check `deletedAt`; normal soft deletion sets both. Test the normal disabled/deleted lifecycle. If a fixture or supported restore can produce a deleted-but-enabled key owner, add the minimal `user.deletedAt` rejection in `src/lib/api/key-auth.ts` with a regression test; do not bypass it or dismiss it as a quota change. This narrow extension requires implementation-time evidence.

## 4. Ordered implementation phases

Each phase is a small coherent commit. Run its focused tests and a no-emit type check before committing; compare unrelated failures to Phase 0. Do not deploy intermediate commits. Phases are ordered so shared licensing modules remain until their last caller disappears.

### Phase 0 — establish runnable baseline (no feature change)

**Files/symbols:** `package.json`, `package-lock.json`, prepared patch, tests, existing build/type configuration; read only except local dependency installation and diagnostic output once execution is authorized.

**Edits:** none. Preserve the untracked patch. Use the supported project Node version available in deployment/CI (tests target Node 24); install the lockfile with `npm ci`, without upgrading packages. Record Git SHA, runtime versions, exact commands, exits and failure names. Read the installed Next.js agent docs before implementation as CLAUDE.md requires.

**Dependencies:** implementation/execution mode, installed dependencies; disposable databases for smoke checks.

**Tests:** full node suite, `npx tsc --noEmit --incremental false`, lint, Worker and Node builds. See baseline section for current blockers and the patch author's separately reported failures.

**Acceptance:** distinguish environment blockers, independently reproduced pre-existing defects, and passing checks. Do not assume the patch author's results are reproducible. Capture enough detail to identify a new failure later. Do not fix unrelated DNS/type defects inside a removal commit.

**Commit boundary:** none; optionally a separate test-fixture repair commit only for a demonstrably broken fixture required by this work, with unchanged production security checks.

### Phase 1 — open shared access and notifications, retain grants

**Files/symbols:** `src/lib/mailboxes/access.ts`, `src/lib/mailboxes/access-utils.ts`, `src/lib/mailboxes/settings-access.ts`, `src/lib/realtime/utils.ts`; `tests/messages-route-performance.test.mjs`, `tests/mailbox-settings-management.test.mjs`; new `tests/self-hosted-team.test.mjs` adapted from patch.

**Concrete edits:**

1. Delete the sharing-license condition/import in both access-helper paths; delete `access-utils.ts` after removing its realtime import.
2. Remove only the entitlement operand/import from `getMailboxSettingsAccess`.
3. Remove realtime's sharing-license operand and add the bounded mailbox/grant/account-status filtering described in Section 3.
4. Replace inactive-license denial expectations with success for valid grants. At this stage license tables can still exist, but tests must stop depending on them for normal feature operation. Remove normal license fixture setup now; defer legacy-row testing to migration tests.
5. Port patch tests for all four permission levels, unauthorized grant management, revocation, listing and notifications. No `SELF_HOSTED_TEAM_FEATURES` module or entitlement assertions.

**Dependencies:** Phase 0. No schema change yet.

**Acceptance:** unlicensed shared access succeeds only with the same valid grants; unrelated personal/disabled mailboxes remain denied; invalid grants and inactive users receive no delegated notifications; configuration access alone never permits message reads or sending. No licensing SQL is issued by these helpers. Existing owner/domain-owner notification policy is preserved for active accounts.

**Tests:** `node --test tests/self-hosted-team.test.mjs tests/mailbox-settings-management.test.mjs tests/messages-route-performance.test.mjs tests/jmap-request-memo.test.mjs`. Keep query/performance assertions; do not weaken them to hide a licensing-query removal regression.

**Commit:** `refactor(mailboxes): remove commercial sharing gates, preserve grants`.

### Phase 2 — remove account quotas and commercial admin gates

**Files/symbols:** `src/app/api/accounts/utils.ts`; every exact helper caller in Sections 2.3–2.4; `src/app/api/accounts/create.ts`, `src/app/api/accounts/route.ts`, `src/app/api/accounts/[id]/route.ts`, `src/lib/accounts/deletion.ts`; `src/lib/api/admin-auth.ts`; `src/app/api/v1/accounts/utils.ts`, `src/app/api/v1/accounts/[id]/utils.ts`, `src/app/api/v1/mailboxes/utils.ts`; `src/app/api/mailboxes/route.ts`; accounts page/types; `src/lib/mcp/admin-tools.ts`; relevant tests.

**Concrete edits:**

1. Rename existing `requireTeamAdmin` to `requireAdminSession`, remove its entitlement branch, replace `requireTeamSharingAdmin` calls with it and delete that redundant wrapper. Preserve the helper's session/admin try/catch and response structure/status.
2. Update every listed import/call, including restore, recovery, avatar and primary-transfer callers. Repeat whole-repo caller search.
3. Delete account-entitlement checks in v1 handlers. Delete `canManageAdminAccounts` and `canShareAdminMailboxes` exports; retain key authentication.
4. Delete seat checks in account create, re-enable and restore; remove `countUsedAccountSeats` query and the `seats` field in account-list JSON. Delete `src/lib/licenses/seats.ts` after its callers are gone.
5. Simplify shared mailbox GET capability to `user.role === "admin"`; POST keeps an explicit non-admin 403 for shared creation. v1 POST already requires admin role through scoped-key authentication; remove only the commercial branch.
6. Remove all account-page seat/paywall state, overlays and quota disabling, plus `AccountResponse.seats`. Preserve the real permission-based create button and ordinary errors. Delete overlay component/type files now that no callers remain.
7. Remove the MCP commercial/seat description sentence. Forwarding checks in account-update handlers remain until Phase 4.

**Dependencies:** Phase 1; auth helpers stay intact. No migration yet.

**Acceptance:** accounts can be repeatedly created/re-enabled/restored without quotas; dashboard, v1 and MCP creation share the existing implementation; actor/role/domain/alias/creator restrictions and rollback are unchanged. Ordinary users still cannot create shared mailboxes or manage accounts. No dead `requireTeam*`, quota helpers or seat UI remain.

**Tests:** `node --test tests/account-alias-selection.test.mjs tests/account-password-race.test.mjs tests/self-hosted-team.test.mjs tests/mailbox-settings-management.test.mjs`. Extend tests for unauthorized/wrong-scope/inactive key owners, non-primary role changes, re-enable and restore. Assert foreign creator/domain targets remain denied. Preserve invalid session=403 and invalid key=401 expectations where currently used.

**Commit:** `refactor(accounts): remove paid quotas and licensing guards`.

### Phase 3 — branding without entitlements

**Files/symbols:** `src/lib/branding/service.ts`, `src/lib/branding/types.d.ts`, `src/app/api/branding/route.ts`, `src/app/api/branding/icon/route.ts`, `src/components/branding-provider-utils.ts`, `src/app/(admin)/branding/page.tsx`, `tests/image-response-cache.test.mjs`, `tests/i18n.test.mjs`, branding tests in `tests/self-hosted-team.test.mjs`.

**Concrete edits:** remove branding entitlement reads/rejections, `Branding.canCustomizeBranding` and all returned/default/mock fields; delete the paywall UI branch and unused branch-only imports. Simplify PUT's persistence catch to 500 without matching license text. Do not touch the independent primary-admin guard. Keep app settings reads/defaults and custom icon lookup, write, fallback and caching behavior.

**Dependencies:** Phase 0; can follow Phase 2 as ordered. No schema change.

**Acceptance:** existing custom brand/icon becomes visible even on previously inactive installs; empty/unmigrated settings fall back to Mailflare assets; only primary admin can write; malformed name, invalid MIME and oversize icon are still rejected. No new logo/favicon storage model.

**Tests:** `node --test tests/image-response-cache.test.mjs tests/i18n.test.mjs tests/self-hosted-team.test.mjs`. Add ordinary-admin and non-admin write denials, valid primary save, 60-character boundary and 2 MB/type boundary cases; verify no-license reads and icon fallback without a licensing stub.

**Commit:** `refactor(branding): remove commercial customization gate`.

### Phase 4 — forwarding and booking hosts without commercial policy

**Files/symbols:** `src/lib/email/account-forwarding.ts`; `src/app/api/settings/profile/route.ts`, `src/app/api/settings/forwarding/route.ts`, `src/app/api/auth/me/route.ts`; dashboard/v1 account-update handlers; `src/components/settings/types.d.ts`; account detail page/types; two booking route files. Verification dependencies: `worker.ts`, `src/lib/email/intake.ts`, `src/lib/email/incoming.ts`, `src/lib/booking/hosts.ts`, `src/lib/validators.ts` remain structurally unchanged unless an evidence-backed regression requires a minimal fix.

**Concrete edits:**

1. Remove forwarding commercial blocks/imports from destination lookup and all four mutation surfaces (profile, dedicated forwarding, dashboard account, v1 account).
2. Add active/nondeleted owner predicates to forwarding destination lookup. Preserve no-destination/self-destination return and HMAC marker code verbatim.
3. Delete `canForwardEmail` response fields and type members; remove account-detail JSX wrapper, not its field validation or edit-state disabling.
4. Replace auth/me's entitlement-plus-setup `Promise.all` with its existing setup pair and existing error fallback, preserving authenticated responses when optional setup metadata fails.
5. Change booking `canManageHosts` to the admin-role expression in GET/POST/PATCH only. Keep `calendarAccessError`, session origin, `validBookingHostIds`, owner filters and conflict checks.

**Dependencies:** Phases 2–3, because they leave only forwarding/booking entitlement callers before commercial module deletion.

**Acceptance:** users can set/clear their forwarding destination without a paid license; omitted destination is preserved; existing stored destinations start operating without reentry; disabled/deleted owner does not forward. Self-forward, second-hop loop suppression, signed-marker verification, failed-forward copy preservation and unsupported-provider behavior are unchanged. Only admins may add other booking hosts; ordinary users retain self-only hosting, and disabled/calendar-disabled or excessive hosts fail validation.

**Tests:** new `tests/account-forwarding.test.mjs` for real destination lookup + intake forwarding and marker tests; new `tests/booking-host-permissions.test.mjs` for route authorization/selection; existing `tests/calendar-confirmation.test.mjs`, `tests/inbound-hardening.test.mjs`, `tests/intake-signature.test.mjs`, `tests/current-user-permission-reset.test.mjs`, `tests/landing-account-auth.test.mjs`.

Exercise no marker, correct marker, forged marker with secret, unsigned fallback without secret, normalized self-address, an A→B→A second pass, forwarding callback failure with storage/queue continuation, unauthorized and invalid-email updates, inactive owner and alias lookup. Both Worker and shared intake must retain their guard; automated shared-intake tests plus a Worker runtime smoke test in final verification cover the two entrypoints. Do not contact real mail providers in unit tests.

**Commit:** `refactor(mail): remove forwarding and booking license restrictions`.

### Phase 5 — delete commercial UI/API/service implementation

**Files/symbols:** all files in Sections 2.1–2.2 and 2.5 not already deleted; the five layout files, nav, overview, title maps, dashboard shell and icons in Section 2.6.

**Concrete edits:**

1. Remove `LicenseIndicator` usage/imports from every layout before deleting its three files.
2. Remove `/licenses` nav/card/title/prefix entries; preserve `/branding` primary-only protection and all layout providers. Remove exclusively used `BadgeDollarSign` import/export/underlying alias, not shared security icons.
3. Delete the four commercial page files and six API files exactly listed.
4. Whole-repo search for remaining licensing imports; after earlier phases account for every caller, delete the remaining six `src/lib/licenses/*` files (including any already removed seat file only once). If patch had been applied, also delete `self-hosted.ts`.
5. Do not yet drop the table; no runtime code now needs it. No dummy status response, synthetic plan, global `true` helper or migration-triggered vendor request.

**Dependencies:** Phases 1–4. Keep catalogs until references disappear in this phase, then remove catalog keys in Phase 8.

**Acceptance:** no live license endpoint/page, vendor request, upgrade indicator/overlay, checkout control, licensing module or product ID remains in application code. Existing primary-admin page protection and providers continue working. A new and an upgraded install can exercise features without initializing license state.

**Tests:** full focused suite from previous phases; `tests/layout-mail-search-provider.test.mjs` (do not undo HEAD's provider fix), `tests/route-title.test.mjs`; build/type check. Add a small removal/source-contract assertion in `tests/self-hosted-team.test.mjs` for absent license modules/route files and forbidden runtime imports, supplemented by HTTP route smoke verification later.

**Commit:** `refactor(licensing): delete commercial services routes and upgrade UI`.

### Phase 6 — retire backup table with strict legacy import compatibility

**Files/symbols:** `src/lib/backups/export.ts`, `table-groups.ts`, `types.d.ts`; `tests/backup-table-list.test.mjs`; new `tests/backup-license-compatibility.test.mjs`.

**Concrete edits:** implement Section 5's backup design. Remove `license_settings` from active tables, required tables, groups and union. Add a documented retired-table exclusion to `INTERNAL_TABLES` for databases awaiting the drop. Allow exactly that historical included-table name at the raw-input validation boundary, validate its array/row shape, then discard it before normal live-table/group processing. Keep existing legacy message-body handling and no-includedTables support. Do not widen live types to arbitrary SQL table names.

**Dependencies:** Phase 5. Must land **before or with** the schema/drop commit, because pre-drop databases still contain the table and backups must keep working during the upgrade window.

**Acceptance:** new exports omit retired data before and after migration. Full v1/v2 old backups with retired rows restore into both database states; retired rows are never inserted/queried/used. Unknown included tables, duplicates, malformed retired input and partial groups fail before destructive SQL. All current live tables remain in one group and dependency order.

**Tests:** `node --test tests/backup-license-compatibility.test.mjs tests/backup-table-list.test.mjs tests/backup-restore-passkeys.test.mjs`. Add the exact fixture matrix in Section 5, including unchanged sentinel user on validation failure. At this transitional commit the existing create-only dialect test may still see the retired table as internal; Phase 7 fixes its general drop handling before removing it physically.

**Commit:** `fix(backups): accept and discard retired license settings`.

### Phase 7 — remove persisted licensing in all dialects

**Files/symbols:** `src/db/schema/index.ts:licenseSettings` and `schema`; stale `src/db/schema/index.ts-e`; new SQLite/PG/MySQL migrations, new metadata/journal entries and all bundles; `tests/database-dialects.test.mjs:migrationTables`; `tests/setup-bootstrap-schema.test.mjs`; remaining old test fixture SQL; `scripts/db-smoke.ts`.

**Concrete edits:**

1. Delete the schema declaration/export member; repeat the no-reference check, then delete only the obsolete tracked `index.ts-e` copy.
2. Generate/reconcile all three dialect migrations as Section 5 specifies; append one idempotent drop per dialect and matching new metadata, never edit applied SQL/snapshots. Regenerate all three bundles.
3. Change `migrationTables` to process supported CREATE/DROP TABLE statements in sorted migration order into a live set. Do not just exclude `license_settings` from assertions; add a focused CREATE→DROP fixture/self-check so the test cannot regress to historical-union behavior. Keep SQLite's real replay coverage test and existing skips unchanged.
4. Add explicit post-migration absence checks in dialect/schema tests and bootstrap test, plus new upgrade test `tests/license-removal-migration.test.mjs` for preservation/idempotence. Remove any normal feature-fixture license SQL still found. Only dedicated upgrade/legacy-backup fixtures may create or reference retired rows.
5. Extend `scripts/db-smoke.ts` with an introspected absence assertion and legacy-backup normalization/restore assertion. Use existing introspection/executor helpers and avoid nonportable raw SQL. Dedicated upgrade replay, not the normal smoke script's fully migrated insert path, seeds old license rows.

**Dependencies:** Phase 6 and all application gate deletion phases. Backups/list groups/types and migrations must be correct together in the delivered release.

**Acceptance:** fresh and upgrade replay on SQLite/D1, PostgreSQL and MySQL finishes with no table; existing users/mailboxes/brands/grants/forwarding remain identical; repeated migration is a no-op, including a table already absent. Bundles/journals agree, and no extra generated schema alterations are shipped. No message/folder/mailbox/alias behavior or trigger definitions are changed, so no new equivalent trigger migration is required; verify existing triggers survive.

**Tests:** full `node --test tests/*.test.mjs`; targeted dialect/backup/bootstrap/removal tests; three-dialect disposable DB smoke and D1 local migration replay. Include PG/MySQL fresh and pre-drop upgrade fixtures; record unavailable engines as unverified, not passed.

**Commit:** `refactor(db): drop retired license settings across dialects` — include schema, all dialect SQL/metadata/bundles, coverage fix and fixtures in this single boundary.

### Phase 8 — catalog, documentation and final integration cleanup

**Files/symbols:** exact catalog/doc list in Section 2.9, rewritten fork notes and README; test expectations affected by deleted translations. No source-license or dependency changes.

**Concrete edits:** apply exact key deletion/rewording list to every catalog, remove localized commercial claims, write accurate migration/backup/feature docs, document internal response-field removal and no reverse compatibility with old commercial binaries. Preserve legal notices, donation links, historical SQL/snapshots/changelog and Spamhaus terms. Verify any patch-sourced test/docs no longer claim entitlement policy or no migration.

**Dependencies:** Phases 1–7; deleting translation keys earlier would break typed live references.

**Acceptance:** catalog parity and placeholder checks pass; no live commercial copy/request/link/gate or obsolete field exists; docs describe unlimited software accounts but not unlimited infrastructure/provider resources. README/source notice does not imply a paid license is active or that AGPL obligations disappear.

**Tests:** `node --test tests/i18n.test.mjs tests/route-title.test.mjs`; then every final verification command in Section 7. Capture final failure delta and manual smoke evidence. No new failure may be excused by the old patch report without reproduction.

**Commit:** `docs(i18n): document license-free features and upgrade compatibility`.

## 5. Concrete migration and backup-compatibility design

### 5.1 Forward-only migrations

At inspected HEAD the latest SQLite file is `0083_add_message_has_unsubscribe.sql`; PG and MySQL end at `0007_message_has_unsubscribe.sql`. Reserve these next names (recheck collisions before implementation):

| Dialect | New file | Sole effective statement |
| --- | --- | --- |
| SQLite / D1 / libSQL | `drizzle/migrations/0084_remove_license_settings.sql` | `DROP TABLE IF EXISTS "license_settings";` |
| PostgreSQL | `drizzle/migrations-pg/0008_remove_license_settings.sql` | `DROP TABLE IF EXISTS "license_settings";` |
| MySQL / MariaDB | `drizzle/migrations-mysql/0008_remove_license_settings.sql` | ``DROP TABLE IF EXISTS `license_settings`;`` |

No `CASCADE`, no FK disabling, no rebuild of another table, no data copy to `app_settings`, no default or privilege change. SQLite's associated index and the other dialects' table-local unique constraints disappear with the table. Historical CREATE/ALTER still execute during fresh replay, followed by the drop; do not rewrite history to avoid the transient table.

Run the required commands after deleting the live schema definition:

```sh
npm run db:generate -- --name remove_license_settings
npm run db:generate:pg -- --name remove_license_settings
npm run db:generate:mysql -- --name remove_license_settings
npm run db:bundle
```

**Known tooling complication, resolved handling:** SQLite's journal last index is 75 although filenames reach 0083; latest saved snapshot is `0080_snapshot.json`. PG/MySQL journals reach index 7 but latest snapshots are `0004_snapshot.json`. Existing instructions already note SQLite snapshot rename prompts. Thus do not accept generated filenames, unrelated diffs or guessed rename answers blindly. Use generation to obtain the new schema snapshot, then reconcile only the newly generated artifacts into the reserved next filename/journal tag, change the new SQL to the single idempotent drop above, and ensure the new snapshot represents the current schema minus this table, including already-applied 0081–0083 / 0005–0007 changes. Do not ship duplicate ALTERs for those changes. If the generator cannot produce a usable new snapshot, use its current schema serialization to author a new snapshot plus the single hand-written drop; preserve all old snapshot contents and append the journal entry. This repository already uses hand-written migrations. Do not solve it by regenerating baselines or editing historical metadata to hide drift. Report the exact generator conflict and resulting new filenames in the implementation summary.

Append appropriate journal entries and new snapshots in all three `meta/` directories. New snapshots must link to the preceding snapshot IDs according to the existing dialect format. Regenerate the bundles after final filenames are fixed. Verify the complete generated diff before accepting it.

The table has no inbound schema FK or triggers found during inspection; verify that on the actual target schema before drop. If an installation has nonstandard external dependencies on it, fail safely and report them; do not add CASCADE to destroy unknown data.

MySQL DDL auto-commits. The existing runner records its migration after SQL; `IF EXISTS` makes retry safe after a successful drop followed by ledger-write failure. SQLite/PG retain existing batch/transaction execution. Existing migration ledgers and history remain recognized.

### 5.2 Deployment order and rollback

1. Retain a full pre-upgrade backup and exact previous application release/source. Backups can contain secrets; do not commit them or logs of their rows.
2. Deploy the completed license-free application; it must work with or without the old table. Node may apply migrations on startup; Workers may apply through the admin migration endpoint or D1 tooling. The new app's backup exclusions handle either state.
3. Apply all pending migrations using the existing runtime path. Observe absence and ledger status. Do not run old application instances against a database after the drop; coordinate the upgrade rather than promising mixed-version operation.
4. Verify preserved feature data and run/export/restore checks on a disposable copy before trusting production recovery.
5. This is intentional deletion of obsolete licensing metadata. There is no automatic down migration. Rolling back to a commercial release after the drop requires restoring a matching pre-upgrade database/backup using that old release's recovery procedure. Do not merely redeploy the old binary or invent a paid entitlement.

### 5.3 Active and retired backup table rules

In `src/lib/backups/export.ts`:

- Remove `license_settings` from `BACKUP_TABLES` and `REQUIRED_BACKUP_TABLES`; keep the remaining ordering exactly unchanged.
- Add the literal to `INTERNAL_TABLES` with a one-line reason: retired commercial metadata on databases awaiting the removal migration is intentionally neither exported nor restored. Adjust the list's D1-only header comment to describe internal/derived/retired exclusions accurately. Keep this exclusion after migration to support legitimately pending installations, not to pretend the live schema includes it.
- Remove it from the system group and `DatabaseBackupTable`. Keep every live table assigned exactly once; `app_settings` still covers branding/provider secrets and must not be dropped or filtered.
- `exportDatabaseRecords` keeps format version 2 and writes no retired table into `tables` or `includedTables`, regardless of whether the physical old table exists.

### 5.4 Legacy document normalization: exact validation order

Implement narrowly in `parseDatabaseBackup` / `isDatabaseBackupDocument` rather than putting retired tables back into the live union. A local raw-document view may use `Record<string, unknown>` at this boundary; the validated result still uses the existing live `DatabaseBackupDocument` type.

1. Parse JSON and validate format/version and that `tables` is a non-array object. Invalid input gets the existing invalid-backup error before touching the database.
2. If raw `tables.license_settings` is present, require an array of non-null non-array record objects; reject malformed input even though it will be discarded. Do not trust/interpret plan, state, instance, keys, feature values or seats. No network request, table creation or insert.
3. If raw `includedTables` is present, first validate a nonempty array of unique names against **live table names plus the exact retired name**. Every included name must have an array in `tables`, including the retired name. Reject unknown included names; do not turn this into a permissive ignore-all-unknown rule. Check duplicates before filtering, not after.
4. Construct/normalize the document with `license_settings` removed from both `tables` and `includedTables`, then apply the normal live-table guard. If filtering produces an empty included list, reject; a license-only file is not a full restore. A normal complete old backup has other system tables, so the system group remains represented. Check current required live tables when no included list exists; the retired table is no longer required.
5. Preserve the existing `mergeLegacyMessageBodies` compatibility path and its validation; do not accidentally treat it as a new allowed arbitrary included-table name. Retain existing behavior for historical extra legacy data rather than broadening the included-name allowlist.
6. Keep `groupsForDocumentVersion` semantics: version 1 predates Drive, version 2 covers all current groups. Perform complete-group rejection after normalization, before deletion. Filling missing optional tables must not make a partial document falsely count as a full-group backup.
7. Keep `fillMissingBackupTables`, live row validation, target-migration checks and available-column checks before the first destructive statement. Restoring never emits SQL mentioning the retired table. On a pre-drop target, its old physical rows are left alone until the drop migration; they cannot affect runtime behavior and never get re-exported.

Do not promise that new backups restore into older commercial versions: they may require `license_settings`. Support old-full-backup → new-app restoration and document the reverse-version limitation. Retain old backup objects unchanged.

### 5.5 Test matrix

Use compact programmatically constructed documents, not production backups or license keys. Assert preserved live data, no retired SQL, and unchanged sentinel data on rejection.

| Document | Pre-drop database | Post-drop database |
| --- | --- | --- |
| Current complete v2 export (no retired table) | Restore succeeds; no retired insert/read; new export omits old physical table. | Restore succeeds and table stays absent. |
| Old complete v1, no `includedTables`, with populated retired array | Accept/discard; legacy message bodies and optional-table defaults still work. | Same; no recreation. |
| Old complete v1 with `includedTables` naming retired table | Accept/discard; retain v1 no-Drive compatibility. | Same. |
| Old complete v2 with `includedTables` naming populated/empty retired table | Accept/discard, preserve branding/users/grants/forwarding. | Same. |
| Complete document omitting retired table altogether | Accept; no retired table required. | Accept. |
| Partial group export, including one whose only system table is retired metadata | Reject before destructive SQL. | Same. |
| Duplicate included names, unknown included name, missing included retired array, non-array retired value or invalid retired row | Reject before destructive SQL, never grant arbitrary table access. | Same. |

Migration tests must seed a legacy license row **before** applying the new drop, then compare unrelated user/domain/mailbox/grant/app-settings data after it. Test fresh full replay, pre-drop upgrade, already-absent table and rerun. SQLite tests should exercise both the Node migration path and bundled D1-compatible path. PG/MySQL tests and smoke use real corresponding executors, not SQLite SQL pretending to be another dialect.

Do not rewrite the restore engine's existing nontransactional teardown/insert behavior in this task. Validation-before-deletion is mandatory; atomic recovery from an arbitrary mid-write database failure is an existing residual risk, not something this change can claim to solve.

## 6. Baseline: observed versus reported

### Observed in this planning environment

Runtime: Node `v26.13.0`, npm `12.2.2`. `node_modules/` is absent. No application build/test dependency installation was performed in Plan mode. Consequently this is an **environment-blocked baseline**, not evidence of 87 application bugs.

| Command actually attempted | Result |
| --- | --- |
| `git apply --check mailflare-self-hosted-team.patch` | Pass; patch not applied. |
| `node --test tests/*.test.mjs` | Exit 1: 144 reported tests, 57 pass, 87 fail, 0 skipped. Failures are missing imports such as `esbuild`, `better-sqlite3`, `drizzle-orm`; many files fail at module loading, so real test totals are not established. |
| `tsc --noEmit --incremental false` | Exit 127, `tsc: command not found`; installed TypeScript unavailable. No current source type-error count can be asserted. |
| `npm run lint` | Exit 127, `vp: command not found`. |
| `npm run build` | Bundle generation completed with no tracked content diff; then exit 127, `vp: command not found`. No Worker build reached. |
| `npm run build:node` | Bundle generation completed with no tracked content diff; then exit 127, `next: command not found`. No Next/server build reached. |

The test runner's complete observed output was retained by the harness at `/home/matthew/.local/share/opencode/shell/9f4abf18e4eada618b6a5ff1cf2d8d5ff27e401c/sh_1c8b65c56001RJiUFGudr59GfQ.out`. No live database or mail/provider smoke was performed. Do not infer that credentials or reachable database services are available.

### Separately reported inside the prepared patch, not independently verified here

Its proposed fork notes report **564 passed, 8 failed, 2 skipped**, with the same eight failures allegedly reproduced upstream: two account API-key fixtures and six manual DNS checks. They also report two type errors reproduced upstream in `src/app/page.tsx` and `src/lib/domains/resend-receiving.ts`. The patch supplies neither exact failure names/messages nor a successful build result. These numbers describe the author's patched environment, not this checkout's observed test execution.

Phase 0 must reproduce and name those failures after installation; inspect `tests/account-alias-selection.test.mjs` and `tests/manual-dns-checks.test.mjs`, but do not guess which cases failed or relax API-key security based on this report. The current alias fixture does populate `key_sha256`, so an older fixture report cannot be accepted without evidence. Builds ignore some TypeScript errors (`next.config.ts`), so a successful build will not replace the separate no-emit check.

## 7. Final verification

### Automated commands, after dependencies and completed changes

Run from the repository root. TypeScript/build outputs are permitted only during implementation, not as new planning artifacts.

```sh
git status --short
node --version
npm --version
npm run db:bundle
node --test tests/*.test.mjs
npx tsc --noEmit --incremental false
npm run lint
npm run build
npm run build:node
git diff --check
```

Also run focused tests separately while iterating:

```sh
node --test tests/self-hosted-team.test.mjs tests/account-alias-selection.test.mjs tests/mailbox-settings-management.test.mjs tests/messages-route-performance.test.mjs
node --test tests/account-forwarding.test.mjs tests/booking-host-permissions.test.mjs tests/image-response-cache.test.mjs
node --test tests/backup-license-compatibility.test.mjs tests/license-removal-migration.test.mjs tests/backup-table-list.test.mjs tests/backup-restore-passkeys.test.mjs tests/setup-bootstrap-schema.test.mjs tests/database-dialects.test.mjs
```

Migration smoke **only against throwaway databases**: `scripts/db-smoke.ts` exports and restores all records and is not safe to aim at production. Set URLs below to empty isolated databases; use a unique scratch SQLite path and local D1 state directory. The schema dialect must match each URL.

```sh
MAILFLARE_DB_DIALECT=sqlite npm run db:smoke -- "file:/tmp/opencode/mailflare-license-removal-smoke.sqlite"
MAILFLARE_DB_DIALECT=postgres npm run db:smoke -- "pglite://memory" pglite
MAILFLARE_DB_DIALECT=postgres npm run db:smoke -- "$MAILFLARE_TEST_POSTGRES_URL"
MAILFLARE_DB_DIALECT=mysql npm run db:smoke -- "$MAILFLARE_TEST_MYSQL_URL"
npx wrangler d1 migrations apply DB --local --persist-to /tmp/opencode/mailflare-license-removal-d1
npx wrangler d1 execute DB --local --persist-to /tmp/opencode/mailflare-license-removal-d1 --command "SELECT name FROM sqlite_master WHERE type='table' AND name='license_settings'"
```

Do not invoke URL-dependent commands with unset variables. PGlite is a useful PG-path check but does not replace a real PostgreSQL server and cannot validate MySQL. Re-run against pre-drop fixtures for upgrade and old-backup restore cases; the normal smoke command applies all migrations first. Verify new migration ledger entries, zero retired table, preserved data and no pending migration on a second run. Re-running `db:bundle` must yield no further bundle diff after the committed regeneration.

### Runtime/manual acceptance

- Start both completed Worker and Node builds on disposable configurations. New setup and upgraded pre-drop database both load; admin migration/status still works.
- Primary admin can save/read branding and configured icon; ordinary admin/user cannot write. Empty settings use packaged assets. No license request occurs while visiting dashboard, settings, calendar, Drive or admin.
- Create several accounts; re-enable and restore one without a quota. Exercise a restricted admin and wrong-scope API key as negative cases. Verify primary transfer/recovery/step-up paths are still protected.
- Create a shared inbox through dashboard and v1/MCP, grant each permission, read/send/manage according to rank, then revoke. Verify list/message/JMAP and realtime/push recipients; no content reaches an unassigned or disabled/deleted actor.
- Set and clear forwarding; send test messages only to owned test destinations. Verify loop marker on Worker and Node intake, self-forward suppression, A→B→A no second forward and failed-forward local storage. A provider without forwarding support does not acquire it.
- Admin booking with other active/calendar-enabled hosts works; non-admin cannot add others; conflict/ownership/origin rejection remains.
- Old full v1/v2 backups restore on throwaway pre/post-drop databases without recreating licensing metadata; current exports omit it. Partial/malformed/unknown-table input leaves sentinel records untouched. Existing MFA/passkey data restores correctly.
- `/licenses`, `/api/licenses`, and `/api/licenses/{activate,validate,deactivate}` no longer have handlers or successful licensing responses. No outbound request to Paymug's license API occurs. Test stale URLs as authenticated users to avoid confusing an auth redirect with a retained page.

### Residual-code searches

Use `git grep` for tracked application content so the user's untracked reference patch is not mistaken for shipped code. A search returning no matches exits 1; that is success for the forbidden-code checks. Inspect every hit rather than deleting all occurrences of “license”, “team”, “key”, “disabled” or “limit”.

```sh
git grep -n -i -E 'getLicenseEntitlements|getLicenseStatus|LicenseEntitlements|LicenseStatus|PaymugLicense|callPaymug|SELF_HOSTED_TEAM_FEATURES|isTeamMailboxSharingEnabled|canShareAdminMailboxes|canManageAdminAccounts|requireTeamSharingAdmin|requireTeamAdmin|getAccountSeatError|countUsedAccountSeats' -- src tests scripts server worker.ts
git grep -n -E 'canForwardEmail|canCustomizeBranding|accountSeatLimit|seatLimit|seatsFull|teamRequired|LicenseIndicator|LicenseRequiredOverlay' -- src tests ':!src/lib/migrations/bundle*.json'
git grep -n -E '/api/licenses|/licenses|mailflare:license-status-changed|mailflare-pro|mailflare-team|ebafa58f-af9f-4b8a-a48d-6cfd44dd2053|6e42b54c-3221-4f8f-93a7-bab494f9e224' -- src public docs tests README.md CLAUDE.md ':!src/lib/migrations/bundle*.json'
git grep -n -E '"(license\.|licenses\.|admin\.nav\.licenses|admin\.section\.licenses|branding\.proOnly|branding\.licenseRequired|branding\.originalNote|accounts\.seatsUsed|accounts\.seatsFull)' -- src/lib/i18n/en.json public/locales
git grep -n -i -E 'license_settings|licenseSettings|license_key_hash|paymug|commercial|license|licensed|seat_limit' -- src tests docs scripts server worker.ts README.md CLAUDE.md .github
git grep -n 'index.ts-e' -- .
git ls-files '*license*' '*licensing*' '*commercial*'
```

**Expected/legitimate hits:**

- The literal `license_settings` in the single documented backup retirement/import rule, dedicated legacy-backup/upgrade tests, and smoke absence assertions. Normal feature tests must not seed it in fully migrated databases.
- Historical migrations/snapshots and historical statements in regenerated bundles, plus each new drop migration. New live snapshots must not contain the table.
- Removal documentation and named regression tests may explain old routes/behavior; no live link/request/import may survive. Tighten source-only searches when checking runtime references.
- Legal `LICENSE`, source-license documentation/notices, package/dependency metadata, generated Cloudflare notices, historical changelog, voluntary sponsorship/funding URLs and Spamhaus third-party terms as listed in Section 2.9.
- Permission/account concepts, provider API keys, Drive/storage limits, routing limits, booking limits, third-party quota controls, and ordinary “team” wording unrelated to commercial licensing stay.

A text search cannot prove authorization or migrations work. Acceptance requires behavior tests, real migration replay and review of the preserved negative checks.

## 8. Implementation-time evidence still required

These are evidence gaps, not unresolved architecture choices:

1. A dependency-installed baseline and exact existing test/type/build failures; current results are dependency-blocked, and the patch's claimed failures lack detailed logs.
2. Exact Drizzle generator prompts/artifact names and snapshot reconciliation against existing handwritten migrations. The chosen output is a new single-table drop in all dialects, not an open schema-design decision.
3. Availability of real MySQL/PostgreSQL, local workerd/D1 and provider test credentials. Record unavailable checks explicitly; never claim SQLite mocks prove another dialect or live mail transport.
4. Whether supported restore or test fixtures permit deleted-but-enabled API-key owners. If yes, enforce the narrow deleted-status check described above, with a test; no licensing workaround.
5. Notification recipient filtering must be checked against owner/domain-owner semantics and existing call sites when implemented; do not silently broaden access or remove legitimate active owner recipients. The prepared patch covers revocation but not inactive recipients or invalid grants.
6. Repeat the stale `src/db/schema/index.ts-e` reference check immediately before deleting that exact tracked artifact, and check for concurrent user changes/next-migration filename collisions before editing.
7. Existing restore can lose data on mid-write failure; this work validates all new compatibility rejection before deletion but does not make the whole restore atomic. Keep backups and test recovery on copies.

## 9. Execution brief for the implementing model

Work in `/home/matthew/Development/mailflare`; start from HEAD `cee65a5fd1ad27f21c72e492aa8cbf504ff40060`, rechecking user changes. Read AGENTS.md/CLAUDE.md and this plan. The root `mailflare-self-hosted-team.patch` is inspected reference only: do not apply or commit it. Its always-enabled entitlement layer is not the target.

Install locked dependencies and record a real baseline. Execute Phases 1–8 in order with focused tests and separate commits: shared grants/notifications; account quota/admin gates; branding; forwarding/booking; delete commercial UI/API/services; strict legacy backup normalization; all-dialect schema/drop/bundle/tests; catalogs/docs. Remove entitlements, not authentication, roles, scopes, ownership, grants, account-state checks, validation, step-up defenses or loop markers. No fake license and no feature-policy shim.

Drop only `license_settings` in new SQLite 0084 and PG/MySQL 0008 migrations, reconciling stale generator snapshots without rewriting history. New backups omit licensing data; accept old complete v1/v2 documents by validating then discarding only that retired table before live validation/destructive restore. Keep pending old tables excluded from coverage. Fix the dialect test's historical-CREATE-union assumption. Preserve every other persisted table, configuration value and live backup group.

Run the full suite, standalone type check, lint, both builds, three-dialect fresh/upgrade/backup smoke, Worker/Node authorization/forwarding smoke and residual searches. Report actual failure deltas and unrun checks. Do not fix unrelated baseline defects or alter LICENSE/dependency notices. Do not deploy until the whole change and recovery checks are complete.

Skipped during planning: dependency installation, application edits, live database/provider tests and implementation of the prepared patch.
Primary risks: irreversible retirement of licensing metadata, old-binary rollback incompatibility, existing non-atomic restore behavior, and security regressions if a commercial condition is removed together with its authorization operand.
