import { z } from 'zod';

// The wire protocol shared with AccountKit. Shipped clients pin these shapes: add optional fields, never rename or
// remove one. contract/fixtures holds one request/response pair per case and both test suites check them.

export const Identity = z.strictObject({
	deviceSecret: z.string().regex(/^[0-9a-f]{64}$/),
	appTransactionJWS: z.string().min(1).max(20_000).optional(),
	icloudUserID: z.string().min(1).max(200).optional(), // a hint: stored, never matched
	includeLinks: z.boolean(), // false after a sign-out, so the app transaction can't rejoin the device
	platform: z.enum(['ios', 'ipados', 'macos', 'visionos', 'watchos', 'tvos']),
	appVersion: z.string().min(1).max(50),
	deviceName: z.string().max(200).optional(),
});

export const AccessStatus = z.enum(['active', 'grace', 'granted', 'expired', 'revoked', 'suspended', 'none']);

export const Access = z.strictObject({
	status: AccessStatus,
	active: z.boolean(),
	plan: z.string().optional(),
	source: z.enum(['subscription', 'grant']).optional(),
	environment: z.enum(['Production', 'Sandbox', 'Xcode']).optional(),
	expiresAt: z.iso.datetime().optional(),
	willRenew: z.boolean().optional(),
});

export const AccountSummary = z.strictObject({
	id: z.uuid(),
	supportID: z.string().regex(/^[A-Z]{2}-[0-9A-Z]{4}-[0-9A-Z]{4}$/),
	createdAt: z.iso.datetime(),
	access: Access,
});

export const DeviceAuthRequest = z.strictObject({ identity: Identity });
export const PurchaseAuthRequest = z.strictObject({ identity: Identity, signedTransactions: z.array(z.string().min(1).max(20_000)).min(1).max(50) });
export const ClaimRequest = z.strictObject({ identity: Identity, code: z.string().min(1).max(40) });

export const AuthResponse = z.strictObject({ account: AccountSummary, token: z.string().min(1), isNew: z.boolean() });
/** `/auth/device` alone may answer `{ account: null }`: an unknown device in `trigger` mode. */
export const DeviceAuthResponse = z.union([AuthResponse, z.strictObject({ account: z.null() })]);
export const OKResponse = z.strictObject({ ok: z.literal(true) });

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
]);
export const ErrorResponse = z.strictObject({ error: ErrorCode, message: z.string().optional() });

export type Identity = z.infer<typeof Identity>;
export type Access = z.infer<typeof Access>;
export type AccountSummary = z.infer<typeof AccountSummary>;
export type AuthResponse = z.infer<typeof AuthResponse>;
export type ErrorCode = z.infer<typeof ErrorCode>;
