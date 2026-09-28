import type { AppStoreVerifier } from '../appstore/verify.js'
import type { AcctDb } from '../db/tables.js'
import { HttpError } from '../http/errors.js'
import { refreshAccess } from '../core/access.js'
import { recordEvent, type Actor } from '../core/events.js'
import { planForProduct } from '../core/purchases.js'
import type { PurchaseStatus } from '../db/tables.js'
import type { StoreApi } from '../appstore/store-api.js'

const STATUS: Record<number, PurchaseStatus> = { 1: 'active', 2: 'expired', 3: 'expired', 4: 'grace', 5: 'revoked' }
const date = (ms: number | undefined) => (ms === undefined ? null : new Date(ms))

/**
 * "Refresh from Apple": replaces each of the account's subscriptions with what the App Store Server API says now
 * (verified like any signed data), then recomputes access. Xcode subscriptions have nothing to ask. Returns how many
 * subscriptions were updated.
 */
export async function refreshFromApple(
	db: AcctDb,
	api: StoreApi | null,
	verifier: AppStoreVerifier,
	accountId: string,
	actor: Actor,
) {
	if (!api) throw new HttpError(503, 'appstore_api_unconfigured')
	const subs = await db.selectFrom('acct_purchases').selectAll().where('account_id', '=', accountId).execute()
	let updated = 0
	for (const sub of subs) {
		// One-time purchases have no subscription status to ask for; Xcode ones nothing to ask.
		if (sub.environment === 'Xcode' || sub.type === 'non_consumable') continue
		for (const item of await api.statuses(sub.environment, sub.original_transaction_id)) {
			if (item.originalTransactionId !== sub.original_transaction_id || !item.signedTransactionInfo) continue
			const tx = await verifier.transaction(item.signedTransactionInfo)
			const renewal = item.signedRenewalInfo ? await verifier.renewalInfo(item.signedRenewalInfo) : undefined
			const status = STATUS[item.status] ?? 'expired'
			await db
				.updateTable('acct_purchases')
				.set({
					status,
					expires_at: date(tx.expiresDate),
					grace_expires_at: status === 'grace' ? date(renewal?.gracePeriodExpiresDate) : null,
					revoked_at: status === 'revoked' ? (date(tx.revocationDate) ?? new Date()) : null,
					auto_renew: renewal ? renewal.autoRenewStatus === 1 : sub.auto_renew,
					...(tx.productId
						? { product_id: tx.productId, plan_id: (await planForProduct(db, tx.productId)) ?? sub.plan_id }
						: {}),
					last_event_at: date(tx.signedDate) ?? sub.last_event_at,
					updated_at: new Date(),
				})
				.where('id', '=', sub.id)
				.execute()
			updated++
		}
	}
	await recordEvent(db, accountId, 'refreshed_from_apple', actor, { subscriptions: updated })
	await refreshAccess(db, accountId, actor)
	return updated
}
