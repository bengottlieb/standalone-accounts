import { z } from 'zod'

// Version 1 of the wire protocol shared with AccountKit (paths under /api/v1). Shipped clients pin these shapes: within
// v1, add optional fields and new error codes only, never rename or remove one; anything else is v2, served alongside.
// contract/v1/fixtures holds one request/response pair per case, and both test suites check every supported version.

export const Identity = z.strictObject({
	deviceSecret: z.string().regex(/^[0-9a-f]{64}$/),
	appTransactionJWS: z.string().min(1).max(20_000).optional(),
	icloudUserID: z.string().min(1).max(200).optional(), // a hint: stored, never matched
	includeLinks: z.boolean(), // false after a sign-out, so the app transaction can't rejoin the device
	platform: z.enum(['ios', 'ipados', 'macos', 'visionos', 'watchos', 'tvos']),
	appVersion: z.string().min(1).max(50),
	deviceName: z.string().max(200).optional(),
})

export const AccessStatus = z.enum(['active', 'grace', 'granted', 'expired', 'revoked', 'suspended', 'none'])

export const Access = z.strictObject({
	status: AccessStatus,
	active: z.boolean(),
	plan: z.string().optional(),
	source: z.enum(['subscription', 'purchase', 'grant']).optional(),
	environment: z.enum(['Production', 'Sandbox', 'Xcode']).optional(),
	expiresAt: z.iso.datetime().optional(),
	willRenew: z.boolean().optional(),
})

export const AccountSummary = z.strictObject({
	id: z.uuid(),
	supportID: z.string().regex(/^[A-Z]{2}-[0-9A-Z]{4}-[0-9A-Z]{4}$/),
	createdAt: z.iso.datetime(),
	access: Access,
})

/**
 * `POST /check-in`: the app says which build it is, at launch, on returning to the foreground and every few hours while
 * running. With a bearer token, the server records the build on that device. No account needed.
 */
export const CheckInRequest = z.strictObject({
	bundle: z.string().min(1).max(200),
	version: z.string().min(1).max(50),
	/** CFBundleVersion as an integer: what minimum builds compare against. */
	build: z.number().int().nonnegative(),
	platform: Identity.shape.platform,
	osVersion: z.string().max(50).optional(),
	/** The protocol version the build speaks (`v1`). */
	protocolVersion: z.string().regex(/^v\d+$/),
})

/**
 * `required`: this build is below the minimum; show the update screen and make no other calls. `recommended`: a newer
 * build is out; suggest it. `config` is the host's own settings (feature flags, maintenance notices).
 */
export const CheckInResponse = z.strictObject({
	update: z.enum(['required', 'recommended', 'none']),
	minimumBuild: z.number().int().nullable(),
	recommendedBuild: z.number().int().optional(),
	message: z.string().optional(),
	serverTime: z.iso.datetime(),
	protocolVersions: z.array(z.string()).min(1),
	config: z.record(z.string(), z.unknown()),
})

export const DeviceAuthRequest = z.strictObject({ identity: Identity })
export const PurchaseAuthRequest = z.strictObject({
	identity: Identity,
	signedTransactions: z.array(z.string().min(1).max(20_000)).min(1).max(50),
})
export const ClaimRequest = z.strictObject({ identity: Identity, code: z.string().min(1).max(40) })

export const AuthResponse = z.strictObject({ account: AccountSummary, token: z.string().min(1), isNew: z.boolean() })
/** `/auth/device` alone may answer `{ account: null }`: an unknown device in `trigger` mode. */
export const DeviceAuthResponse = z.union([AuthResponse, z.strictObject({ account: z.null() })])
export const OKResponse = z.strictObject({ ok: z.literal(true) })

export const ErrorCode = z.enum([
	'invalid_request',
	'unauthorized',
	'account_suspended',
	'purchase_in_use',
	'identity_in_use',
	'transaction_invalid',
	'transaction_revoked',
	'code_not_found',
	'code_expired',
	'rate_limited',
	'verification_unavailable',
])
export const ErrorResponse = z.strictObject({ error: ErrorCode, message: z.string().optional() })

export type Identity = z.infer<typeof Identity>
export type Access = z.infer<typeof Access>
export type AccountSummary = z.infer<typeof AccountSummary>
export type AuthResponse = z.infer<typeof AuthResponse>
export type ErrorCode = z.infer<typeof ErrorCode>
