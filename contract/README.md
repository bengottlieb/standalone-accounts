# Contract

The wire protocol between AccountKit and servers built on `@standalone/accounts`, one directory per major version
(`v1/` ↔ `/api/accounts/v1/…`). Each holds `openapi.json` (generated: `npm run contract:openapi`) and `fixtures/*.json`, one
request/response pair per case. Both test suites check every version a server still serves.

## Rules

- **Within a version, additive only.** New optional request fields, new response fields, new endpoints, new error
  codes. Never rename, remove, retype or make required. Clients ignore unknown response fields and keep unknown error
  codes; servers ignore unknown request fields.
- **Fixtures are append-only once a build ships.** Editing or deleting one means an app in the field breaks.
- **Anything else is a new version.** Add `vN/` here and `server/src/contract/vN/`, serve `/api/accounts/vN/…` next to the old
  routes, and move AccountKit to it. The old version leaves `versions.ts` (and here) only when no supported build speaks
  it, which the minimum build below enforces.
- **Apps check in:** `POST /api/accounts/v1/check-in` with their bundle, version, build and protocol version, at launch, on
  returning to the foreground and every few hours while running. The answer says `required` (below the server's
  minimum build: show the update screen, make no other calls), `recommended` or `none`, plus the host's `config`.
  Enforcement is cooperative; with a bearer token the server records the build against that device.
