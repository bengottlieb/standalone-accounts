# standalone-accounts

The shared account framework for Standalone apps (StoreKeeper, Peasel, Crosswords). One repo, two halves, one
contract:

| Path | What |
|---|---|
| `Package.swift`, `Sources/AccountKit` | **AccountKit**, the Swift client: device secret, identity collection (App Store transaction, CloudKit hint), the reinstall stamp, protocol DTOs, `AccountService` over an app-supplied `AccountTransport` |
| `package.json`, `server/` | **@standalone/accounts**, the server library: contract schemas (Zod) now; tables, link resolution, purchases, grants, claim codes and admin routes next |
| `contract/` | One directory per protocol version (`v1/`): `openapi.json` (generated from the Zod schemas) and `fixtures/*.json`, request/response pairs both test suites check. Rules in `contract/README.md` |
| `docs/DESIGN.md` | The design of record |

## Using it

- Swift: `.package(url: "git@github.com:bengottlieb/standalone-accounts.git", from: "0.1.0")`, product `AccountKit`.
- Node: `"@standalone/accounts": "github:bengottlieb/standalone-accounts#v0.1.0"` (built on install by `prepare`).

## Changing the protocol

Shipped apps pin it, so within a version changes are additive only and fixtures are append-only; anything else is a
new version served alongside (see `contract/README.md`). Edit `server/src/contract/<version>/`, run
`npm run contract:openapi`, add fixtures, then run both `npm test` and `swift test`.
