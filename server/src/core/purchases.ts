import { sql } from 'kysely'
import type { AcctDb, PurchaseStatus, PurchaseType, StoreEnvironment } from '../db/tables.js'

/** The fields of a verified StoreKit transaction that shape a purchase. Dates are epoch milliseconds, as Apple signs them. */
export interface SignedTransaction {
	type: PurchaseType
	bundleId: string
	originalTransactionId: string
	productId: string
	environment: StoreEnvironment
	purchaseDate?: number
	expiresDate?: number
	signedDate: number
	appAccountToken?: string
}

/** StoreKit's transaction `type` → ours; null for kinds that never grant a plan (consumables). */
export function purchaseType(storeKitType: string | undefined): PurchaseType | null {
	if (storeKitType === 'Auto-Renewable Subscription') return 'subscription'
	if (storeKitType === 'Non-Consumable') return 'non_consumable'
	return null
}

/** The plan a StoreKit product grants, or null for a product no plan lists. */
export async function planForProduct(db: AcctDb, productId: string): Promise<string | null> {
	const row = await db
		.selectFrom('acct_plans')
		.select('id')
		.where(sql<boolean>`${productId} = ANY(product_ids)`)
		.orderBy('id')
		.executeTakeFirst()
	return row?.id ?? null
}

const later = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b)

/** A new purchase's status: a one-time purchase is active until refunded, a subscription until it expires. */
export function initialStatus(type: PurchaseType, expiresAt: Date | null, now: Date): PurchaseStatus {
	if (type === 'non_consumable') return 'active'
	return expiresAt && expiresAt > now ? 'active' : 'expired'
}

/**
 * Creates or updates the purchase for a verified, unrevoked transaction, keyed by originalTransactionId, and returns
 * it. `accountId` attaches it (an unclaimed one included); null leaves ownership as it is. An existing one only takes
 * fields from a transaction signed no earlier than its last applied event, never moves `expires_at` backwards
 * (restores often present an older transaction), keeps `grace` while `grace_expires_at` is ahead, and stays `revoked`
 * unless this transaction was purchased after the revocation. Run inside a transaction.
 */
export async function applyTransaction(
	db: AcctDb,
	tx: SignedTransaction,
	planId: string,
	accountId: string | null,
	now = new Date(),
) {
	const signedAt = new Date(tx.signedDate)
	const expiresAt = tx.expiresDate === undefined ? null : new Date(tx.expiresDate)
	const inserted = await db
		.insertInto('acct_purchases')
		.values({
			account_id: accountId,
			type: tx.type,
			bundle_id: tx.bundleId,
			original_transaction_id: tx.originalTransactionId,
			environment: tx.environment,
			plan_id: planId,
			product_id: tx.productId,
			status: initialStatus(tx.type, expiresAt, now),
			expires_at: expiresAt,
			app_account_token: tx.appAccountToken ?? null,
			last_event_at: signedAt,
		})
		.onConflict((oc) => oc.column('original_transaction_id').doNothing())
		.returningAll()
		.executeTakeFirst()
	if (inserted) return inserted

	const row = await db
		.selectFrom('acct_purchases')
		.selectAll()
		.where('original_transaction_id', '=', tx.originalTransactionId)
		.forUpdate()
		.executeTakeFirstOrThrow()
	const owner = accountId ?? row.account_id
	if (row.last_event_at && signedAt < row.last_event_at) {
		if (owner === row.account_id) return row
		return db
			.updateTable('acct_purchases')
			.set({ account_id: owner, updated_at: now })
			.where('id', '=', row.id)
			.returningAll()
			.executeTakeFirstOrThrow()
	}
	const expires = later(row.expires_at, expiresAt)
	let status = initialStatus(row.type, expires, now)
	if (status === 'expired' && row.grace_expires_at && row.grace_expires_at > now) status = 'grace'
	const purchasedAt = new Date(tx.purchaseDate ?? tx.signedDate)
	const stillRevoked = row.status === 'revoked' && (!row.revoked_at || purchasedAt <= row.revoked_at)
	return db
		.updateTable('acct_purchases')
		.set({
			account_id: owner,
			environment: tx.environment,
			plan_id: planId,
			product_id: tx.productId,
			status: stillRevoked ? 'revoked' : status,
			expires_at: expires,
			...(status === 'active' ? { grace_expires_at: null } : {}),
			...(stillRevoked ? {} : { revoked_at: null }),
			app_account_token: tx.appAccountToken ?? row.app_account_token,
			last_event_at: signedAt,
			updated_at: now,
		})
		.where('id', '=', row.id)
		.returningAll()
		.executeTakeFirstOrThrow()
}

/** Marks a known purchase revoked (refund or revocation) and returns its account, if it has one. */
export async function revokePurchase(db: AcctDb, originalTransactionId: string, revokedAt: Date, now = new Date()) {
	const row = await db
		.updateTable('acct_purchases')
		.set({ status: 'revoked', revoked_at: revokedAt, updated_at: now })
		.where('original_transaction_id', '=', originalTransactionId)
		.returning('account_id')
		.executeTakeFirst()
	return row?.account_id ?? null
}
