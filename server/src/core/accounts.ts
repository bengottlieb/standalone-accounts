import type { AcctDb } from '../db/tables.js'
import type { AcctConfig } from './config.js'
import { recordEvent, type Actor } from './events.js'
import { generateCode } from './ids.js'

/** Creates an empty account (no access until a subscription or grant attaches) with a fresh Support ID. */
export async function createAccount(db: AcctDb, config: AcctConfig, actor: Actor, reason: string) {
	for (let attempt = 0; attempt < 5; attempt++) {
		const row = await db
			.insertInto('acct_accounts')
			.values({ support_id: generateCode(config.codePrefix), status: 'none' })
			.onConflict((oc) => oc.column('support_id').doNothing())
			.returning(['id', 'support_id'])
			.executeTakeFirst()
		if (!row) continue // a Support ID collision (~40 bits): draw another
		await recordEvent(db, row.id, 'created', actor, { reason })
		return row
	}
	throw new Error('could not allocate a unique Support ID')
}

/**
 * Deletes the account and everything that hangs off it (links, devices, tokens, grants, host data). Its
 * subscriptions become unclaimed, so a later `/auth/purchase` with them starts a fresh account. Its timeline goes
 * too (it names devices); only a tombstone event with no personal data remains. Run inside a transaction.
 */
export async function deleteAccount(db: AcctDb, accountId: string, actor: Actor) {
	const deleted = await db.deleteFrom('acct_accounts').where('id', '=', accountId).returning('id').executeTakeFirst()
	if (!deleted) return false
	await db.deleteFrom('acct_events').where('account_id', '=', accountId).execute()
	await recordEvent(db, accountId, 'deleted', actor)
	return true
}
