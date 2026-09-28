import { z } from 'zod'
import { dateTime } from '../http/schema.js'

// Admin API shapes (docs/DESIGN.md "Admin"). Hashes and secrets are never part of them.

const status = z.enum(['active', 'grace', 'granted', 'expired', 'revoked', 'suspended', 'none'])
const environment = z.enum(['Production', 'Sandbox', 'Xcode'])
const source = z.enum(['subscription', 'purchase', 'grant'])

export const accountRow = z.object({
	id: z.string(),
	supportId: z.string(),
	status,
	plan: z.string().nullable(),
	source: source.nullable(),
	environment: environment.nullable(),
	expiresAt: dateTime.nullable(),
	createdAt: dateTime,
	lastSeenAt: dateTime.nullable(),
	devices: z.number().int(),
})

export const listQuery = z.object({
	q: z
		.string()
		.trim()
		.min(1)
		.max(200)
		.optional()
		.meta({ description: 'Anything that identifies an account: see `searchAccounts`' }),
	status: status.optional(),
	environment: environment.optional(),
	source: source.optional(),
	createdAfter: z.coerce.date().optional(),
	createdBefore: z.coerce.date().optional(),
	seenAfter: z.coerce.date().optional(),
	cursor: z.string().max(200).optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
})
export const listResponse = z.object({ accounts: z.array(accountRow), nextCursor: z.string().nullable() })

export const detailResponse = z.object({
	account: accountRow.omit({ devices: true }).extend({ willRenew: z.boolean().nullable() }),
	purchases: z.array(
		z.object({
			id: z.string(),
			type: z.enum(['subscription', 'non_consumable']),
			bundleId: z.string(),
			originalTransactionId: z.string(),
			environment,
			plan: z.string().nullable(),
			productId: z.string(),
			status: z.enum(['active', 'grace', 'expired', 'revoked']),
			expiresAt: dateTime.nullable(),
			graceExpiresAt: dateTime.nullable(),
			autoRenew: z.boolean().nullable(),
			revokedAt: dateTime.nullable(),
			updatedAt: dateTime,
		}),
	),
	grants: z.array(
		z.object({
			id: z.string(),
			plan: z.string(),
			source: z.enum(['manual', 'promo', 'beta']),
			startsAt: dateTime,
			expiresAt: dateTime.nullable(),
			note: z.string().nullable(),
			createdBy: z.string().nullable(),
			revokedAt: dateTime.nullable(),
		}),
	),
	suspensions: z.array(
		z.object({
			id: z.string(),
			reason: z.string(),
			startsAt: dateTime,
			endsAt: dateTime.nullable(),
			createdBy: z.string().nullable(),
			liftedAt: dateTime.nullable(),
		}),
	),
	links: z.array(z.object({ kind: z.string(), value: z.string(), createdAt: dateTime, lastSeenAt: dateTime })),
	hints: z.array(z.object({ kind: z.string(), value: z.string(), lastSeenAt: dateTime })),
	devices: z.array(
		z.object({
			platform: z.string(),
			name: z.string().nullable(),
			appVersion: z.string().nullable(),
			boundAt: dateTime,
			lastSeenAt: dateTime,
		}),
	),
	tokens: z.array(
		z.object({
			prefix: z.string(),
			deviceName: z.string().nullable(),
			deviceId: z.string().nullable(),
			platform: z.string().nullable(),
			appVersion: z.string().nullable(),
			appBuild: z.number().int().nullable(),
			checkedInAt: dateTime.nullable(),
			createdAt: dateTime,
			lastUsedAt: dateTime.nullable(),
			revokedAt: dateTime.nullable(),
		}),
	),
	events: z.array(
		z.object({
			id: z.number().int(),
			kind: z.string(),
			actor: z.string(),
			data: z.record(z.string(), z.unknown()),
			at: dateTime,
		}),
	),
})

export const idParams = z.object({ id: z.uuid() })
export const grantParams = z.object({ id: z.uuid(), grantId: z.uuid() })

export const grantBody = z.strictObject({
	plan: z.string().min(1).default('pro'),
	source: z.enum(['manual', 'promo', 'beta']).default('manual'),
	expiresAt: z.coerce.date().nullable().default(null),
	note: z.string().trim().max(500).nullable().default(null),
})
export const createBody = z.strictObject({
	note: z.string().trim().max(500).optional(),
	grant: grantBody.optional().meta({ description: 'Give the new account access right away' }),
})
export const suspendBody = z.strictObject({
	reason: z.string().trim().min(1).max(500),
	endsAt: z.coerce.date().nullable().default(null),
})
export const noteBody = z.strictObject({ text: z.string().trim().min(1).max(4000) })
export const ticketBody = z.strictObject({
	ticket: z.string().trim().min(1).max(500).meta({ description: 'A ticket URL or id' }),
})
export const attachBody = z.strictObject({ accountId: z.uuid() })

export const claimCodeResponse = z.object({ code: z.string(), expiresAt: dateTime, link: z.string() })
export const createResponse = z.object({ id: z.string(), supportId: z.string(), claim: claimCodeResponse })
export const idResponse = z.object({ id: z.string() })
export const refreshResponse = z.object({ subscriptions: z.number().int() })

export const unclaimedResponse = z.object({
	purchases: z.array(
		z.object({
			id: z.string(),
			type: z.enum(['subscription', 'non_consumable']),
			originalTransactionId: z.string(),
			environment,
			productId: z.string(),
			status: z.enum(['active', 'grace', 'expired', 'revoked']),
			expiresAt: dateTime.nullable(),
			createdAt: dateTime,
		}),
	),
})
