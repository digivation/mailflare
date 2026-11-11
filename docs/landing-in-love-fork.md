# Landing in Love fork notes

Mailflare no longer uses commercial product licenses or feature entitlements. Software account seats are unlimited: administrators can add and manage accounts without a Mailflare license. This does not make provider or infrastructure capacity unlimited; hosting, storage, mail providers and other services can impose their own quotas, fees and limits. Shared mailbox access (with explicit grants), booking hosts and custom branding are also available without a Mailflare license. Forwarding is available where the selected inbound transport supports it; provider intake that cannot forward does not gain forwarding support. The primary administrator configures branding in Admin → Branding. Existing role, scope, ownership, account-state, mailbox-grant and validation checks remain.

## Runtime and upgrade compatibility

This removal applies to both the Cloudflare Worker/D1 deployment and the self-hosted Node runtime. Apply the release's pending migrations using Admin settings (or the documented migration process for the configured database). The forward-only migrations drop the retired `license_settings` table in SQLite/D1, PostgreSQL and MySQL. User, mailbox, branding and other application data are retained. New backups omit licensing metadata; complete older backups containing that retired table remain importable, but the licensing rows are discarded.

The internal account response no longer includes the `seats` field; branding responses no longer include `canCustomizeBranding`, and account responses no longer include `canForwardEmail`. These were internal feature/entitlement indicators, not authorization controls; callers should rely on the normal account, role and resource behavior instead.

This compatibility is intentionally one-way. An older commercial Mailflare binary may require the dropped table, old response fields and removed licensing endpoints, and is not supported against the upgraded database. Older binaries may also be unable to restore or use backups from the upgraded version. Take a database backup before upgrading and do not roll back the binary expecting reverse compatibility.

## Funding and software license

Voluntary sponsorship/funding links support the project and do not activate features or grant a commercial entitlement. They are distinct from the removed product licensing/checkout flow. The repository's `LICENSE` remains the legal software license: Mailflare is distributed under the GNU Affero General Public License, version 3. This feature removal does not waive or replace AGPL obligations; review the license for obligations applicable to your use, modification and network deployment. Preserve source copyright and third-party notices. Third-party service terms, including Spamhaus's non-commercial-use restriction, remain applicable to those services.
