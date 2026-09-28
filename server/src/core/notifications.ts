import type {
	JWSRenewalInfoDecodedPayload,
	JWSTransactionDecodedPayload,
	ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library'
import type { Updateable } from 'kysely'
import type { AcctDb, AcctPurchasesTable, PurchaseType, StoreEnvironment } from '../db/tables.js'
import { refreshAccess } from './access.js'
import { initialStatus, planForProduct, purchaseType } from './purchases.js'

export interface VerifiedNotification {
	payload: ResponseBodyV2DecodedPayload
	transaction?: JWSTransactionDecodedPayload
	renewalInfo?: JWSRenewalInfoDecodedPayload
}

export type NotificationOutcome = 'duplicate' | 'applied' | 'stale' | 'recorded' | 'test' | 'error'

type Purchase = { type: PurchaseType; expires_at: Date | null }
type Patch = Updateable<AcctPurchasesTable>

const date = (ms: number | undefined) => (ms === undefined ? null : new Date(ms))
const later = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b)

/** Types that change nothing on the purchase; they are recorded only. */
const RECORD_ONLY = new Set([
	'DID_CHANGE_RENEWAL_PREF',
	'OFFER_REDEEMED',
	'PRICE_INCREASE',
	'REFUND_DECLINED',
	'CONSUMPTION_REQUEST',
	'RENEWAL_EXTENSION',
	'EXTERNAL_PURCHASE_TOKEN',
])

/** The purchase change a notification calls for, or null when it only needs recording. */
export function purchasePatch(
	n: VerifiedNotification,
	purchase: Purchase,
	planId: string | null,
	now = new Date(),
): Patch | null {
	const { notificationType: type, subtype } = n.payload
	const tx = n.transaction
	const txExpires = date(tx?.expiresDate)
	switch (type) {
		case 'ONE_TIME_CHARGE':
			return { status: 'active', revoked_at: null }
		case 'SUBSCRIBED':
		case 'DID_RENEW':
			return {
				status: 'active',
				expires_at: later(purchase.expires_at, txExpires),
				grace_expires_at: null,
				revoked_at: null,
				// A new product (upgrade, crossgrade) moves the plan along with it.
				...(planId && tx?.productId ? { product_id: tx.productId, plan_id: planId } : {}),
			}
		case 'DID_CHANGE_RENEWAL_STATUS':
			if (subtype === 'AUTO_RENEW_ENABLED') return { auto_renew: true }
			if (subtype === 'AUTO_RENEW_DISABLED') return { auto_renew: false }
			return null
		case 'RENEWAL_EXTENDED':
			return { expires_at: later(purchase.expires_at, txExpires) }
		case 'DID_FAIL_TO_RENEW':
			return subtype === 'GRACE_PERIOD'
				? { status: 'grace', grace_expires_at: date(n.renewalInfo?.gracePeriodExpiresDate) }
				: { status: 'expired' }
		case 'GRACE_PERIOD_EXPIRED':
		case 'EXPIRED':
			return { status: 'expired' }
		case 'REFUND':
		case 'REVOKE':
			// The only case where expires_at may move backwards.
			return {
				status: 'revoked',
				revoked_at: date(tx?.revocationDate) ?? date(n.payload.signedDate) ?? now,
				...(txExpires ? { expires_at: txExpires } : {}),
			}
		case 'REFUND_REVERSED':
			return {
				status: purchase.type === 'non_consumable' || (txExpires && txExpires > now) ? 'active' : 'expired',
				revoked_at: null,
				expires_at: later(purchase.expires_at, txExpires),
			}
		default:
			return null
	}
}

/**
 * Records a verified notification once per notificationUUID and applies it to its purchase in one transaction with
 * `processed_at`, so a failure leaves it unprocessed for Apple's retry. Changes apply only from notifications signed
 * no earlier than the purchase's last applied event. A notification for an unknown originalTransactionId keeps an
 * unclaimed purchase (no account): the app's `/auth/purchase` claims it, or an admin does. One whose
 * `appAccountToken` names an existing account is attached to it straight away.
 */
export async function processNotification(db: AcctDb, n: VerifiedNotification, now = new Date()) {
	const { payload, transaction: tx } = n
	const uuid = payload.notificationUUID!
	const type = String(payload.notificationType)
	const signedAt = new Date(payload.signedDate!)
	await db
		.insertInto('acct_store_notifications')
		.values({
			notification_uuid: uuid,
			notification_type: type,
			subtype: payload.subtype ? String(payload.subtype) : null,
			bundle_id: tx?.bundleId ?? null,
			original_transaction_id: tx?.originalTransactionId ?? null,
			environment: payload.data?.environment ? String(payload.data.environment) : null,
			signed_date: signedAt,
		})
		.onConflict((oc) => oc.column('notification_uuid').doNothing())
		.execute()

	return db.transaction().execute(async (trx): Promise<{ outcome: NotificationOutcome; accountId?: string }> => {
		const row = await trx
			.selectFrom('acct_store_notifications')
			.select('processed_at')
			.where('notification_uuid', '=', uuid)
			.forUpdate()
			.executeTakeFirstOrThrow()
		if (row.processed_at) return { outcome: 'duplicate' }
		const finish = async (outcome: NotificationOutcome, accountId?: string, error?: string) => {
			await trx
				.updateTable('acct_store_notifications')
				.set({ processed_at: now, account_id: accountId ?? null, error: error ?? null })
				.where('notification_uuid', '=', uuid)
				.execute()
			return { outcome, accountId }
		}
		if (type === 'TEST') return finish('test')
		const otid = tx?.originalTransactionId
		if (!tx || !otid) return finish('recorded')

		let purchase = await trx
			.selectFrom('acct_purchases')
			.selectAll()
			.where('original_transaction_id', '=', otid)
			.forUpdate()
			.executeTakeFirst()
		const planId = tx.productId ? await planForProduct(trx, tx.productId) : null
		if (!purchase) {
			const kind = purchaseType(tx.type)
			// A subscription no plan lists is a misconfigured plan; other products (puzzle packs, consumables) are the
			// host's business, not an account's access.
			if (!planId && kind === 'subscription')
				return finish('error', undefined, `unknown product: ${tx.productId ?? '(none)'}`)
			if (!planId || !kind) return finish('recorded')
			const expires = date(tx.expiresDate)
			const owner = tx.appAccountToken
				? await trx.selectFrom('acct_accounts').select('id').where('id', '=', tx.appAccountToken).executeTakeFirst()
				: undefined
			purchase = await trx
				.insertInto('acct_purchases')
				.values({
					account_id: owner?.id ?? null,
					type: kind,
					bundle_id: tx.bundleId ?? '',
					original_transaction_id: otid,
					environment: tx.environment as StoreEnvironment,
					plan_id: planId,
					product_id: tx.productId!,
					status: initialStatus(kind, expires, now),
					expires_at: expires,
					app_account_token: tx.appAccountToken ?? null,
				})
				.returningAll()
				.executeTakeFirstOrThrow()
		}
		const accountId = purchase.account_id ?? undefined
		if (purchase.last_event_at && signedAt < purchase.last_event_at) return finish('stale', accountId)
		if (RECORD_ONLY.has(type)) return finish('recorded', accountId)
		const patch = purchasePatch(n, purchase, planId, now)
		if (!patch) {
			if (accountId) await refreshAccess(trx, accountId, 'apple', now)
			return finish('recorded', accountId)
		}
		await trx
			.updateTable('acct_purchases')
			.set({ ...patch, last_event_at: signedAt, updated_at: now })
			.where('id', '=', purchase.id)
			.execute()
		if (accountId) await refreshAccess(trx, accountId, 'apple', now)
		return finish('applied', accountId)
	})
}
