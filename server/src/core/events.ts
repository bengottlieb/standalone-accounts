import type { AcctDb } from '../db/tables.js'

/** Who did something to an account: the device itself, Apple, a scheduled job, or an admin user. */
export type Actor = 'device' | 'apple' | 'system' | `admin:${string}`

export type EventKind =
	| 'created'
	| 'device_bound'
	| 'link_conflict'
	| 'purchase_attached'
	| 'subscription_changed'
	| 'access_changed'
	| 'claim_code_created'
	| 'claimed'
	| 'grant_added'
	| 'grant_revoked'
	| 'suspended'
	| 'suspension_lifted'
	| 'refreshed_from_apple'
	| 'note'
	| 'ticket'
	| 'signed_out'
	| 'deleted'

/** Appends to the account's timeline (the admin audit log and support history). */
export async function recordEvent(
	db: AcctDb,
	accountId: string,
	kind: EventKind,
	actor: Actor,
	data: Record<string, unknown> = {},
) {
	await db
		.insertInto('acct_events')
		.values({ account_id: accountId, kind, actor, data: JSON.stringify(data) })
		.execute()
}
