import { z } from 'zod'
import { dateTime } from '../http/schema.js'

// Version 1 of the wire protocol from bengottlieb/standalone-accounts (server/src/contract/v1), as routes enforce it.
// Requests ignore unknown fields, so a newer app can talk to an older server; responses may carry host fields
// (StoreKeeper adds `plan` and `usage` to the account). test/acct-contract.test.ts checks the shared fixtures.

export const identitySchema = z.object({
	deviceSecret: z.string().regex(/^[0-9a-f]{64}$/),
	appTransactionJWS: z.string().min(1).max(20_000).optional(),
	icloudUserID: z.string().min(1).max(200).optional(),
	includeLinks: z.boolean(),
	platform: z.enum(['ios', 'ipados', 'macos', 'visionos', 'watchos', 'tvos']),
	appVersion: z.string().min(1).max(50),
	deviceName: z.string().max(200).optional(),
})
export type IdentityBody = z.infer<typeof identitySchema>

export const checkInBody = z.object({
	bundle: z.string().min(1).max(200),
	version: z.string().min(1).max(50),
	build: z.number().int().nonnegative(),
	platform: identitySchema.shape.platform,
	osVersion: z.string().max(50).optional(),
	protocolVersion: z.string().regex(/^v\d+$/),
})
export const checkInResponseSchema = z.object({
	update: z.enum(['required', 'recommended', 'none']),
	minimumBuild: z.number().int().nullable(),
	recommendedBuild: z.number().int().optional(),
	message: z.string().optional(),
	serverTime: dateTime,
	protocolVersions: z.array(z.string()),
	config: z.record(z.string(), z.unknown()),
})

export const deviceAuthBody = z.object({ identity: identitySchema })
export const purchaseAuthBody = z.object({
	identity: identitySchema,
	signedTransactions: z.array(z.string().min(1).max(20_000)).min(1).max(50),
})
export const claimBody = z.object({ identity: identitySchema, code: z.string().min(1).max(40) })

export const accessSchema = z.object({
	status: z.enum(['active', 'grace', 'granted', 'expired', 'revoked', 'suspended', 'none']),
	active: z.boolean(),
	plan: z.string().optional(),
	source: z.enum(['subscription', 'purchase', 'grant']).optional(),
	environment: z.enum(['Production', 'Sandbox', 'Xcode']).optional(),
	expiresAt: dateTime.optional(),
	willRenew: z.boolean().optional(),
})

export const signInIdentitySchema = z.object({ kind: z.string(), label: z.string().optional() })

export const accountSummarySchema = z.object({
	id: z.string().meta({ format: 'uuid' }),
	supportID: z.string(),
	createdAt: dateTime,
	access: accessSchema,
	identities: z.array(signInIdentitySchema),
})
export type AccountSummary = z.infer<typeof accountSummarySchema>

export const authResponseSchema = z.object({
	account: accountSummarySchema,
	token: z.string(),
	isNew: z.boolean(),
	merged: z.boolean().optional(),
})

const email = z.email().max(320)
// Length policy is the host's (`signIn.password.minLength`), checked only when a password is set.
const password = z.string().min(1).max(200)
export const appleSignInBody = z.object({
	identity: identitySchema,
	identityToken: z.string().min(1).max(10_000),
	name: z.string().max(200).optional(),
})
export const passwordBody = z.object({ identity: identitySchema, email, password })
export const forgotPasswordBody = z.object({ email })
export const resetPasswordBody = z.object({
	identity: identitySchema,
	email,
	code: z.string().min(1).max(20),
	password,
})
export const gameCenterBody = z.object({
	identity: identitySchema,
	teamPlayerID: z.string().min(1).max(200),
	bundleID: z.string().min(1).max(200),
	publicKeyURL: z.url().max(500),
	signature: z.string().min(1).max(4_000),
	salt: z.string().min(1).max(200),
	/** Milliseconds since the epoch, as GameKit reports it. */
	timestamp: z.number().int(),
	displayName: z.string().max(200).optional(),
})
export const setPasswordBody = z.object({ email, password, currentPassword: z.string().max(200).optional() })
export const unlinkBody = z.object({ kind: z.string().min(1).max(50) })
export const deviceAuthResponseSchema = z.union([authResponseSchema, z.object({ account: z.null() })])
