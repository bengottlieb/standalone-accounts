# Standalone accounts — design of record

Settled 2026-09-28. First users: StoreKeeper (AppOutlet server) and Peasel + Crosswords 7 (PZLServer).

## Principles

1. **An account is an opaque server UUID.** Purchases, grants, devices and identities attach to it; none of them *is*
   the account.
2. **The account id is never a credential.** It can appear in logs, admin, support mail and Apple's `appAccountToken`.
   Signing in always means proving a *link*; the server then issues a per-device bearer token.
3. **No silent merges.** The first verified owner of a link keeps it. Conflicts are 409s and show up in admin; merging
   is a future admin-only tool.
4. **The wire protocol is permanent, server internals are not.** Shipped clients pin the protocol (`contract/`); tables
   and code behind it can migrate.

## Identity links

| Kind | Source | Verified | Finds an account | Notes |
|---|---|---|---|---|
| `device_secret` | 32 random bytes in the Keychain, `ThisDeviceOnly` | holding it is the proof | yes (1st) | server stores SHA-256 only; never *creates* an account |
| `app_transaction` | `AppTransaction.jwsRepresentation` → `appTransactionId` | Apple JWS chain | yes (2nd) | per Apple Account per app, every download, survives reinstall |
| `original_transaction` | a subscription/purchase JWS → `originalTransactionId` | Apple JWS chain | yes (3rd) | also attaches the purchase |
| `apple_id` / `game_center` | Sign in with Apple / Game Center | verified by host plugin | yes | optional, per app (Peasel); SIWA is per team, so it joins apps on one server |
| `icloud_user` | CloudKit user record name | **no** | **never** | stored as a support/admin hint only |

Lookup precedence: known device secret → verified `app_transaction` → verified `original_transaction` → none.
A secret that points at X while the app transaction points at Y keeps the device in X and logs the conflict.

## Per-app settings

- `creation: 'trigger' | 'first-launch'` — StoreKeeper `trigger` (accounts only from a purchase, a claim code or
  admin); Peasel `first-launch` (every install gets an anonymous account).
- `resetOnReinstall: boolean` — Peasel `true` (a fresh app container drops the device secret; the verified app
  transaction rejoins), StoreKeeper `false` (worker Macs and Xcode builds come back on the same secret).
- `tokenPrefix` — `skm_`, `pzl_`.
- Plans and products are per `bundle_id`.

## Protocol (see `contract/v1/openapi.json` and `contract/v1/fixtures/`)

Every call that can bind a device sends the same identity block:
`{ deviceSecret, appTransactionJWS?, icloudUserID?, includeLinks, platform, appVersion, deviceName? }`.
`includeLinks: false` after a sign-out, so the app transaction can't pull the device back in.

| Call | Auth | Result |
|---|---|---|
| `POST /api/accounts/v1/check-in` | none (bearer optional) | `{ update, minimumBuild, recommendedBuild?, message?, serverTime, protocolVersions, config }` |
| `POST /api/accounts/v1/auth/device` | identity | `{ account, token, isNew }`, or `{ account: null }` (200) for an unknown device in `trigger` mode |
| `POST /api/accounts/v1/auth/purchase` | identity + `signedTransactions[]` | `{ account, token, isNew }`; 409 `purchase_in_use` |
| `POST /api/accounts/v1/auth/claim` | identity + `code` | `{ account, token, isNew }`; 409 `identity_in_use`, 410 `code_expired`, 404 `code_not_found` |
| `GET /api/accounts/v1/account` | Bearer | `AccountSummary` |
| `POST /api/accounts/v1/account/signout` | Bearer | revokes the token, unlinks this device's secret |
| `DELETE /api/accounts/v1/account` | Bearer | hard delete (below) |

`AccountSummary` is `{ id, supportID, createdAt, access: { status, active, plan?, source?, environment?, expiresAt?,
willRenew? } }`; `status` is one of active, grace, granted, expired, revoked, suspended, none.

Errors are `{ "error": "<code>", "message"?: "…" }`; clients keep unknown codes rather than failing to decode.

**Versioning** (`contract/README.md`): the protocol lives under its own prefix, `/api/accounts/<version>/`, so it never
collides with a host's own API (PZLServer keeps its older `/api/v1/auth/device` for shipped builds). The major version
is in the path. Within a version changes are additive only
and fixtures are append-only once a build ships; a breaking change is a new version served alongside the old one.
Apps check in (`POST /api/accounts/v1/check-in`: bundle, version, build, protocol version) at launch, on foreground and every
few hours; the answer says whether an update is `required` (below the minimum build: stop and ask for it),
`recommended` or not, and carries the host's `config`. Enforcement is cooperative; a bearer token lets the server
record each device's build. Suspended accounts answer 403 `account_suspended` everywhere
except `GET /account`, `signout` and `DELETE /account`.

## Access

Effective access = **suspension** (overrides everything) → any live **purchase** (a one-time purchase of a plan's
product, active until refunded, or a subscription) → one in its grace period → any live **grant** → none.
`access.source` says which: `purchase`, `subscription` or `grant`.

- Purchases come only from Apple (`/auth/purchase`, App Store Server Notifications V2, "Refresh from Apple"): auto-renewable
  subscriptions and non-consumables of products a plan lists (`acct_plans.product_ids`). Other products (puzzle packs,
  consumables) stay the host's business. No direct edits: Apple's next notification would overwrite them.
- Grants: plan, source (`manual`, `promo`, `beta`), start, optional expiry, note. Expired by the nightly sweep.
- Environment lives on the subscription. Production servers accept `Production` and `Sandbox` (App Review and
  TestFlight buy in Sandbox); `Xcode`-signed only outside production. Stats and digests count Production only.

## Purchases and notifications

- `appAccountToken` = the account id whenever the device already has an account; nothing otherwise.
- A notification for an `originalTransactionId` no account owns is kept as an **unclaimed purchase**
  (`account_id` null; no account is created) with Apple's state applied. The next `/auth/purchase` with it creates the
  account and attaches it; an admin can attach it to an account by hand. Deleting an account unclaims its
  subscriptions the same way.
- A transaction whose `appAccountToken` names a different account than the caller's is 409 `purchase_in_use`.

## Manual accounts and claim codes

Admin creates an account (optionally with a grant) and gets a one-time code (`XX-XXXX-XXXX`, default 7 days,
stored hashed) plus a deep link `<scheme>://claim?code=…`. Redeeming links the device secret and the app transaction.
If that app transaction already belongs to another account → 409 `identity_in_use`; admin grants on that account.

## Sign-in

Optional per server (`registerAccountRoutes({ signIn })`); a method left out answers 404 `signin_unavailable`.
StoreKeeper offers none; Crosswords and Peasel offer all three.

- **Sign in with Apple** (`/auth/apple`): the identity token is verified against Apple's keys for the server's app
  ids; link kind `apple` keyed by `sub`, the email kept as its label. The name Apple gives on first sign-in goes to the
  host (`hooks.signedIn`) and is kept as the `apple_name` hint, returned as the identity's `name` (0.4.2); a later
  sign-in without a name leaves it.
- **Email and password** (`/auth/password/register|signin|forgot|reset`, `/account/password`): `acct_passwords` holds
  the lowercased email and a bcrypt hash. Registering an email that has an account signs in with the right password
  and is 409 `email_in_use` otherwise. A new password (register, reset, change) must be at least the host's
  `signIn.password.minLength` (default 8), else 400 `password_too_short` with `minLength`; signing in never checks
  length, so a password set under an older policy keeps working.
  A host moving its own users onto these accounts can import their hashes in its own format: `signIn.password.
  verifyLegacy` checks a non-bcrypt hash, and a match re-saves it as bcrypt. `checkEmailPassword` lets a host's own
  sign-in (a website) check an email and password against the same accounts, with the same timing for unknown emails.
  Admin search finds an account by its sign-in email. A reset code (six digits, one hour, one use) is emailed by the host
  (`signIn.password.sendResetCode`); resetting spends every open code, revokes every token and signs this device in.
- **Game Center** (`/auth/game-center`): the identity verification signature, checked with the certificate at Apple's
  URL (not chain-verified); link kind `game_center` keyed by the team-scoped player id, the display name as label.
- **Host-verified identities** (PZLServer's PuzzleAnywhere login): the host verifies, then `claimHostIdentity` applies
  the rules below; their kinds are listed in `signIn.hostKinds` so they count as signed in.
- **Passkeys**: planned, not built; see `docs/PASSKEYS.md`.

An account is **anonymous** when it has no password and no sign-in link. Signing in on a device:

| Identity owned by | Device's account | Result |
|---|---|---|
| nobody | any (or none) | attached to the device's account (a new one when it has none) |
| nobody | anonymous, but its verified app transaction belongs to a signed-in account with no method of this kind | that account takes the method and the anonymous one is folded into it; `merged: true` (a device that lost its session, e.g. across a host migration) |
| another account | anonymous | folded in: `hooks.mergeAccounts` moves host data, then purchases, grants, links, devices and tokens move and the anonymous account is deleted; `merged: true` |
| another account | signed in | 409 `identity_in_use`: sign out first |

Signing out of an anonymous account in a `first-launch` app deletes it; any other account keeps everything.
`/account/unlink` removes a method. `AccountSummary.identities` lists the methods (`kind`, `label`).

## Admin

Gated by the host's admin users (viewer = read-only).

- **List**: status (active / grace / expired / revoked / granted / suspended / none), environment, plan, access source,
  created, last seen, devices; filters on each; keyset paging.
- **Smart search**: account id or prefix, Support ID, (original) transaction id, **Apple Order ID** (via the App Store
  Server API *Look Up Order ID*), app transaction id, claim code, device id or name, CloudKit id, plus host hooks
  (StoreKeeper: tracked app; Peasel: nickname, email, Game Center).
- **Detail**: access summary, subscriptions, grants, links, devices, tokens, timeline, support notes and ticket links.
- **Actions**: grant, suspend (reason, optional end), refresh from Apple, create claim code, delete. Every action and
  every link/purchase change is an `acct_events` row (who, when, what, why).

## Support

- Now: a Support ID (`SK-XXXX-XXXX`, derived from the account id, or the device id without an account) shown in the
  app with a copy button; "Contact Support" opens a prefilled email with the Support ID, version, OS, platform,
  environment and access; admin support notes and a ticket link per account.
- Goal (later): in-app conversations — `POST /api/accounts/v1/support/threads`, `…/messages`, replies by push, admin inbox.

## Deletion

`DELETE /api/accounts/v1/account` from the app (required by App Review 5.1.1(v)). The app warns first that deleting does not
cancel an active subscription and offers `manageSubscriptionsSheet`. Hard delete, cascading to links, devices, tokens,
grants and host data; one tombstone event with no personal data. A later purchase restore creates a fresh account.

## Multiple apps per server

Accounts are per server. Subscriptions, grants, plans, devices and tokens carry `bundle_id`. The same person in two
apps has two accounts unless a verified shared link (Sign in with Apple, Game Center) finds the existing one.

## Server library

`@standalone/accounts` (this repo's `package.json`, code in `server/src`), consumed as
`github:bengottlieb/standalone-accounts#<tag>`: Kysely over the host's `pg` pool, independent of the host's ORM
(AppOutlet: Kysely; PZLServer: Drizzle). `migrateAccounts(db)` applies `server/migrations` with its own ledger
(`acct_schema_migrations`); hosts run it at boot before their own migrations. Tables: `acct_plans`, `acct_accounts`
(effective access materialized: `status`, `plan_id`, `access_*`), `acct_purchases`, `acct_links`, `acct_hints`,
`acct_device_credentials`, `acct_tokens`, `acct_grants`, `acct_suspensions`, `acct_claim_codes`, `acct_events`,
`acct_store_notifications`; none references a host table.

A host provides: `request.account` from `resolveToken` in its auth hook; `registerAccountRoutes` (check-in, auth,
account) with its build policy and optional account `extras`; `registerAccountAdminRoutes` with its admin guards, and
optionally a search hook and admin names; an App Store notifications endpoint that verifies with `AppStoreVerifier` and
calls `processNotification`; a nightly `runAccountSweep`. Its own user data references `acct_accounts(id)`. Hooks
(`AcctHooks`) tell it about accounts it must mirror: created, merged, signed in, password reset, deleting, and
`accessChanged` whenever effective access moves (status, plan, expiry or renewal), inside the change's transaction,
so AppOutlet can queue a silent push that has the app re-read its account.

## Rollout

1. Today: this document, `contract/`, `AccountKit` (identity block, device secret, identity collection, DTOs,
   endpoint table, transport protocol).
2. This week: PZLServer's `/auth/device` moves to the protocol and gains `/auth/purchase` and `/auth/claim`; Peasel's
   client adopts `AccountKit`; Peasel ships.
3. Done 2026-09-28: the library was built inside AppOutlet, then extracted here (v0.2.0) with one-time purchases;
   AppOutlet runs on it.
4. Next: PZLServer moves onto it and Crosswords and Peasel onto AccountKit (replacing PZLAccount's device routes);
   StoreKeeper's client moves to AccountKit.

Deferred: admin merge tool, in-app support conversations, soft delete, ORM standardization.
