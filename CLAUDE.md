# standalone-accounts

Shared account framework: AccountKit (Swift) + @standalone/accounts (Node) + `contract/`. Design of record:
`docs/DESIGN.md`. The wire protocol is permanent once an app ships: within a version only additive, optional
changes, and fixtures are append-only. Breaking changes are a new version (`contract/README.md`).

## Build & Run

- Swift tests (macOS): `swift test 2>&1 | grep -E "error:|recorded an issue|Test run"`
- iOS build: `xcodebuild -scheme AccountKit -destination 'generic/platform=iOS' build 2>&1 | grep -E "error:|warning:.*Swift|BUILD SUCCEEDED|BUILD FAILED"`
- Server: `npm install`, `npm test` (needs `TEST_DATABASE_URL`, default `postgres://appoutlet:appoutlet@localhost:5470/accounts_test`
  on AppOutlet's dev container), `npm run typecheck`, `npm run build`
- Release: bump `version` in package.json, commit, tag `vX.Y.Z`, push with tags; hosts change their `#vX.Y.Z`.
- After changing `server/src/contract/<version>/`: `npm run contract:openapi`, then both test suites.
