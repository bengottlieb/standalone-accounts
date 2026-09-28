import type { JWSTransactionDecodedPayload } from '@apple/app-store-server-library'
import type { AppStoreVerifier } from '../appstore/verify.js'
import { SignedDataInvalid, VerificationUnavailable } from '../appstore/verify.js'
import type { AcctDb } from '../db/tables.js'
import { HttpError } from '../http/errors.js'
import { planForProduct, purchaseType, type SignedTransaction } from './purchases.js'
import type { StoreEnvironment } from '../db/tables.js'

export interface VerifiedPurchase {
	tx: SignedTransaction
	planId: string
	/** When Apple revoked it (refund), or null. */
	revokedAt: Date | null
}

/**
 * Verifies each signed transaction: Apple's signature, one of the server's apps, a subscription or one-time purchase
 * of a product a plan lists. Any failure is a 422 `transaction_invalid` with the reason (503 when Apple's revocation check is down).
 */
export async function verifyPurchases(
	db: AcctDb,
	verifier: AppStoreVerifier,
	signed: string[],
): Promise<VerifiedPurchase[]> {
	const out: VerifiedPurchase[] = []
	for (const jws of signed) {
		let tx: JWSTransactionDecodedPayload
		try {
			tx = await verifier.transaction(jws)
		} catch (error) {
			if (error instanceof SignedDataInvalid) throw invalid(error.reason)
			if (error instanceof VerificationUnavailable) throw new HttpError(503, 'verification_unavailable')
			throw error
		}
		const otid = tx.originalTransactionId
		if (!otid || !tx.productId || tx.signedDate === undefined) throw invalid('malformed')
		const type = purchaseType(tx.type)
		if (!type) throw invalid('type')
		const planId = await planForProduct(db, tx.productId)
		if (!planId) throw invalid('product')
		out.push({
			planId,
			revokedAt: tx.revocationDate === undefined ? null : new Date(tx.revocationDate),
			tx: {
				type,
				bundleId: tx.bundleId ?? '',
				originalTransactionId: otid,
				productId: tx.productId,
				environment: tx.environment as StoreEnvironment,
				purchaseDate: tx.purchaseDate,
				expiresDate: tx.expiresDate,
				signedDate: tx.signedDate,
				appAccountToken: tx.appAccountToken,
			},
		})
	}
	return out
}

function invalid(reason: string) {
	return new HttpError(422, 'transaction_invalid', {}, { reason })
}

/**
 * The accounts that already own these purchases: a subscription's current owner, or the account its
 * `appAccountToken` names. More than one is a 409 `purchase_in_use`; so is one that isn't the caller's.
 */
export async function purchaseOwner(db: AcctDb, purchases: VerifiedPurchase[], caller: string | null) {
	const otids = purchases.map((p) => p.tx.originalTransactionId)
	const subs = await db
		.selectFrom('acct_purchases')
		.select('account_id')
		.where('original_transaction_id', 'in', otids)
		.where('account_id', 'is not', null)
		.execute()
	const tokens = purchases.map((p) => p.tx.appAccountToken).filter((t): t is string => !!t)
	const named = tokens.length
		? await db.selectFrom('acct_accounts').select('id').where('id', 'in', tokens).execute()
		: []
	const owners = new Set([...subs.map((s) => s.account_id!), ...named.map((a) => a.id)])
	if (owners.size > 1 || (caller && owners.size === 1 && !owners.has(caller)))
		throw new HttpError(409, 'purchase_in_use')
	return [...owners][0] ?? null
}
