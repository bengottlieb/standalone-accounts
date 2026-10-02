# Passkeys — plan

Status: proposed 2026-10-02, not started. When it's built, the settled parts move into `DESIGN.md` › Sign-in.

## Why

Passkeys (WebAuthn credentials, synced through iCloud Keychain) are the current best practice for signing in without
a password: nothing to remember or reuse, nothing to phish (a passkey only answers its own domain), and Apple's sheet
does the work. Email and password, and Sign in with Apple, stay; emailed reset codes become mainly account recovery.

## Model

- A passkey is a sign-in link of kind `passkey`, keyed by its credential id. An account can have several (one per
  Apple Account or password manager). It counts as a sign-in method (`signInKinds`), so an account with one is no
  longer anonymous, and signing in with it follows `signInWith` like every other link: attach to the device's
  account when nobody owns it, fold an anonymous device account in, 409 `identity_in_use` from a signed-in one.
- **Relying party id** is the host's domain: AppOutlet `appoutlet.us`; PZLServer its own. Apps on one server share
  it, so one passkey signs in to every app the server serves (as Sign in with Apple joins apps on one team).
- The host's `apple-app-site-association` lists the apps under `webcredentials`, and each app has
  `webcredentials:<domain>` in its associated domains. StoreKeeper and AppOutlet already have both (2026-10-02, for
  iCloud Keychain passwords). PZLServer serves `applinks` only today.
- Attestation `none` (Apple's passkeys give none); keep the AAGUID only to name the provider in the account list.
  User verification required.

## Server (`@standalone/accounts`)

- Options: `signIn.passkey = { rpID, rpName, origins }`; left out, the routes answer 404 `signin_unavailable`. A native
  app's assertions carry the origin `https://<rpID>`.
- Library: `@simplewebauthn/server` (the de facto Node implementation) for parsing and verification.
- Tables:
  - `acct_passkeys`: credential id (bytea, unique), account id, public key, sign count, transports, backed up flag,
    AAGUID, name, created / last used.
  - `acct_webauthn_challenges`: challenge, purpose (`register` / `authenticate`), account id for `register`, expiry
    (five minutes), used at. Single use.
- Routes, all additive to contract v1 with fixtures:

  | Route | Auth | Does |
  |---|---|---|
  | `POST /auth/passkey/options` | none | an authentication challenge (discoverable credentials, empty allow list) |
  | `POST /auth/passkey` | none, identity block | verifies the assertion, updates the sign count, then `signInWith` |
  | `POST /account/passkeys/options` | token | a registration challenge naming the account, excluding its credentials |
  | `POST /account/passkeys` | token | verifies the attestation, stores the passkey |
  | `DELETE /account/passkeys/:id` | token | removes one (refused when it's the account's only way to sign in) |

- `AccountSummary.identities` lists passkeys (`kind: passkey`, label: the provider's name from its AAGUID, or
  "Passkey").
- Sign counts: synced passkeys report 0 forever; only a counter that goes backwards from a non-zero value is a clone
  warning (logged and shown in admin, not refused).
- The guess limiter covers `/auth/passkey` by IP, as it does password sign-in.
- Admin detail lists an account's passkeys with created and last-used dates; admins can remove one.

## AccountKit

- DTOs and endpoints for the five routes, and `AccountService` calls: `passkeyRegistrationOptions()`,
  `registerPasskey(_:)`, `passkeySignInOptions()`, `signInWithPasskey(_:)`, `deletePasskey(id:)`.
- A helper that turns the server's options into `ASAuthorizationPlatformPublicKeyCredentialProvider` requests and
  the credential back into the request body. AccountKit stays free of UI: apps run the request with SwiftUI's
  `@Environment(\.authorizationController)` (no UIKit presentation anchor needed).
- AutoFill-assisted sign-in: the email field's request (`performAutoFillAssistedRequest`) offers the passkey in the
  QuickType bar.

## Apps

- StoreKeeper: Settings › Account gets "Add Passkey" and a passkey row per credential; Sign In offers the passkey first
  (and through the email field's autofill). Recovery stays the emailed code and Sign in with Apple.
- Crosswords and Peasel: the same once PZLServer serves `webcredentials` and turns on `signIn.passkey`.

## Testing

- Server: registration and authentication against recorded WebAuthn responses from a software authenticator; replayed
  and expired challenges; a credential owned by another account; the anonymous fold.
- AccountKit: DTO fixtures from the contract; the request/response conversion.
- On a device: iCloud Keychain passkeys on iPhone and Mac (the simulator supports them with an Apple Account signed
  in), including signing in on a second device and deleting a passkey.

## Rollout

1. Server and contract (minor version), AccountKit (same version).
2. AppOutlet turns it on (`rpID: appoutlet.us`); StoreKeeper ships the UI.
3. PZLServer adds `webcredentials` and turns it on; Crosswords and Peasel follow.

## Open questions

- PZLServer's relying party id if its apps are served from more than one domain (a passkey answers one).
- Whether an account may keep only passkeys (no email to reset with) or should be nudged to add a recovery method.
- Showing the provider's name needs an AAGUID list (the community-maintained one) shipped with the server.
