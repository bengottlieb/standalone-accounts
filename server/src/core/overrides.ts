import type { AcctDb } from '../db/tables.js'
import { refreshAccess } from './access.js'
import { recordEvent, type Actor } from './events.js'
import type { GrantSource } from '../db/tables.js'

// Admin overrides (docs/DESIGN.md "Admin"): grants give access, suspensions take it away. Subscriptions are never
// edited by hand. Each runs inside a transaction and recomputes effective access.

export async function addGrant(
	db: AcctDb,
	accountId: string,
	g: { planId: string; source: GrantSource; expiresAt: Date | null; note: string | null },
	actor: Actor,
	createdBy: string | null,
) {
	const row = await db
		.insertInto('acct_grants')
		.values({
			account_id: accountId,
			plan_id: g.planId,
			source: g.source,
			expires_at: g.expiresAt,
			note: g.note,
			created_by: createdBy,
		})
		.returning('id')
		.executeTakeFirstOrThrow()
	await recordEvent(db, accountId, 'grant_added', actor, {
		grantId: row.id,
		plan: g.planId,
		source: g.source,
		expiresAt: g.expiresAt?.toISOString() ?? null,
		note: g.note,
	})
	await refreshAccess(db, accountId, actor)
	return row.id
}

export async function revokeGrant(db: AcctDb, accountId: string, grantId: string, actor: Actor) {
	const row = await db
		.updateTable('acct_grants')
		.set({ revoked_at: new Date() })
		.where('id', '=', grantId)
		.where('account_id', '=', accountId)
		.where('revoked_at', 'is', null)
		.returning('id')
		.executeTakeFirst()
	if (!row) return false
	await recordEvent(db, accountId, 'grant_revoked', actor, { grantId })
	await refreshAccess(db, accountId, actor)
	return true
}

export async function suspend(
	db: AcctDb,
	accountId: string,
	s: { reason: string; endsAt: Date | null },
	actor: Actor,
	createdBy: string | null,
) {
	const row = await db
		.insertInto('acct_suspensions')
		.values({ account_id: accountId, reason: s.reason, ends_at: s.endsAt, created_by: createdBy })
		.returning('id')
		.executeTakeFirstOrThrow()
	await recordEvent(db, accountId, 'suspended', actor, {
		suspensionId: row.id,
		reason: s.reason,
		endsAt: s.endsAt?.toISOString() ?? null,
	})
	await refreshAccess(db, accountId, actor)
	return row.id
}

/** Lifts every open suspension on the account. */
export async function liftSuspensions(db: AcctDb, accountId: string, actor: Actor) {
	const lifted = await db
		.updateTable('acct_suspensions')
		.set({ lifted_at: new Date() })
		.where('account_id', '=', accountId)
		.where('lifted_at', 'is', null)
		.returning('id')
		.execute()
	if (!lifted.length) return false
	await recordEvent(db, accountId, 'suspension_lifted', actor, { count: lifted.length })
	await refreshAccess(db, accountId, actor)
	return true
}
