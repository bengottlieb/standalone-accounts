import type { AcctDb } from '../db/tables.js'
import { refreshAccess } from './access.js'

/**
 * Nightly catch-up for missed App Store notifications and for time-bound overrides: active subscriptions more than
 * `leewayHours` past their expiry, and grace periods that have ended, become expired; then every account with live
 * or suspended access is recomputed, so ended grants and suspensions take effect. Nothing is deleted; tracked apps
 * simply leave the collection set.
 */
export async function runAccountSweep(db: AcctDb, leewayHours: number, now = new Date()) {
	const lapsed = await db
		.updateTable('acct_purchases')
		.set({ status: 'expired', updated_at: now })
		.where('status', '=', 'active')
		.where('expires_at', '<', new Date(now.getTime() - leewayHours * 3_600_000))
		.executeTakeFirst()
	const graceEnded = await db
		.updateTable('acct_purchases')
		.set({ status: 'expired', updated_at: now })
		.where('status', '=', 'grace')
		.where('grace_expires_at', '<', now)
		.executeTakeFirst()
	const accounts = await db
		.selectFrom('acct_accounts')
		.select(['id', 'status'])
		.where('status', 'in', ['active', 'grace', 'granted', 'suspended'])
		.execute()
	let changed = 0
	for (const { id, status } of accounts) {
		const next = await db.transaction().execute((trx) => refreshAccess(trx, id, 'system', now))
		if (next !== status) changed++
	}
	return {
		expiredActive: Number(lapsed.numUpdatedRows),
		expiredGrace: Number(graceEnded.numUpdatedRows),
		accessChanged: changed,
	}
}
