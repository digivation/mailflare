# Landing in Love fork notes

Mailflare no longer uses commercial product licenses or feature entitlements. Account management, shared mailbox access (with explicit grants), booking hosts, forwarding and custom branding are available without a Mailflare license. The primary administrator configures branding in Admin → Branding. Existing role, scope, ownership, account-state, mailbox-grant and validation checks remain; infrastructure and provider quotas, fees and limits still apply.

## Runtime and upgrade compatibility

This removal applies to both the Cloudflare Worker/D1 deployment and the self-hosted Node runtime. Apply the release's pending migrations using Admin settings (or the documented migration process for the configured database). The forward-only migrations drop the retired `license_settings` table in SQLite/D1, PostgreSQL and MySQL. User, mailbox, branding and other application data are retained. New backups omit licensing metadata; complete older backups containing that retired table remain importable, but the licensing rows are discarded.

This compatibility is intentionally one-way. An older commercial Mailflare binary may require the dropped table and removed licensing endpoints, and is not supported against the upgraded database. Take a database backup before upgrading and do not roll back the binary expecting the commercial system to work.

## Funding and software license

Voluntary sponsorship/funding links support the project and do not activate features or grant a commercial entitlement. They are distinct from the removed product licensing/checkout flow. The repository's `LICENSE` remains the legal software license: Mailflare is distributed under the GNU Affero General Public License, version 3. This feature removal does not waive or replace AGPL obligations; review the license for obligations applicable to your use, modification and network deployment. Preserve source copyright and third-party notices. Third-party service terms, including Spamhaus's non-commercial-use restriction, remain applicable to those services.
