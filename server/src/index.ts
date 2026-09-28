// @standalone/accounts: the server half of the Standalone account framework (docs/DESIGN.md).

// Contract (shared with AccountKit)
export * as v1 from './contract/v1/schemas.js'
export { versions, type ProtocolVersion } from './contract/versions.js'

// Database
export * from './db/tables.js'
export { migrateAccounts, ACCT_MIGRATIONS_DIR } from './db/migrate.js'

// Settings and routes
export type { AcctConfig } from './core/config.js'
export { registerAccountRoutes, registerAccountAdminRoutes } from './routes/register.js'
export type { AcctRouteOptions, AcctAdminOptions } from './routes/options.js'
export type { BuildPolicy, CheckInOptions } from './routes/check-in-route.js'
export { acctErrorHandler, HttpError } from './http/errors.js'

// App Store
export {
	AppStoreVerifier,
	loadAppleRoots,
	SignedDataInvalid,
	VerificationUnavailable,
	type VerifiedApp,
	type VerifierOptions,
} from './appstore/verify.js'
export { appStoreServerApi, type StoreApi, type StoreApiCredentials } from './appstore/store-api.js'
export { processNotification, type VerifiedNotification, type NotificationOutcome } from './core/notifications.js'

// Accounts, access and tokens, for host code and jobs
export { resolveToken, issueToken, revokeToken, type MemberAccount } from './core/tokens.js'
export { refreshAccess, effectiveAccess } from './core/access.js'
export { createAccount, deleteAccount } from './core/accounts.js'
export { addGrant, revokeGrant, suspend, liftSuspensions } from './core/overrides.js'
export { createClaimCode } from './core/claim.js'
export { recordEvent, type Actor, type EventKind } from './core/events.js'
export { accountSummary } from './core/summary.js'
export { runAccountSweep } from './core/sweep.js'
export { planForProduct } from './core/purchases.js'
export type { SearchHook } from './admin/search.js'

// Sign-in methods (docs/DESIGN.md "Sign-in")
export type { AcctHooks, SignInProfile } from './core/hooks.js'
export type { HostTransaction } from './core/transaction.js'
export type { SignInOptions } from './signin/options.js'
export { appleVerifier, SignInRejected, type AppleIdentity } from './signin/apple.js'
export {
	gameCenterVerifier,
	gameCenterKeyFetcher,
	type GameCenterProof,
	type GameCenterKeyFetcher,
} from './signin/game-center.js'
export { claimHostIdentity, type SignInContext } from './core/sign-in.js'
export { isAnonymous, mergeInto } from './core/merge.js'
export { passwordAccount, passwordMatches, storePassword, normalizeEmail } from './core/passwords.js'
export { signInKinds } from './signin/options.js'
export type { AdminNames } from './admin/detail.js'
