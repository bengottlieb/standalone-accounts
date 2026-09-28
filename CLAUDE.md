# standalone-accounts

Shared account framework: AccountKit (Swift) + @standalone/accounts (Node) + `contract/`. Design of record:
`docs/DESIGN.md`. The wire protocol is permanent once an app ships — only additive, optional changes.

## Build & Run

- Swift tests (macOS): `swift test 2>&1 | grep -E "error:|recorded an issue|Test run"`
- iOS build: `xcodebuild -scheme AccountKit -destination 'generic/platform=iOS' build 2>&1 | grep -E "error:|warning:.*Swift|BUILD SUCCEEDED|BUILD FAILED"`
- Server: `npm install`, `npm test`, `npm run typecheck`
- After changing `server/src/contract/`: `npm run contract:openapi`, then both test suites.
