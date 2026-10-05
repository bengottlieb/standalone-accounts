import { sql } from 'kysely'
import type { AppStoreVerifier } from '../appstore/verify.js'
import type { AcctDb } from '../db/tables.js'
import type { AcctConfig } from '../core/config.js'
import { keyedHash, normalizeCode } from '../core/ids.js'
import type { StoreApi } from '../appstore/store-api.js'

/** Host search fields (StoreKeeper: tracked app names). Returns matching account ids. */
export type SearchHook = (db: AcctDb, q: string) => Promise<string[]>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE = /^[A-Z]{2}-[0-9A-Z]{4}-[0-9A-Z]{4}$/
const ORDER_ID = /^M[0-9A-Z]{9,11}$/i
const DIGITS = /^\d{6,}$/
const HEX_PREFIX = /^[0-9a-f-]{4,35}$/i

const ids = (rows: { account_id: string | null }[]) => rows.map((r) => r.account_id).filter((id): id is string => !!id)

/**
 * The accounts a pasted value identifies, recognizing its shape: account id or prefix, Support ID or claim code,
 * Apple Order ID (via the App Store Server API), original transaction or app transaction id, a host device id, a
 * sign-in email, and otherwise device names, sign-in emails containing it, iCloud hints and the host's fields.
 * Returns ids, most specific match first.
 */
export async function searchAccounts(
	db: AcctDb,
	config: AcctConfig,
	api: StoreApi | null,
	verifier: AppStoreVerifier,
	input: string,
	hook?: SearchHook,
) {
	const q = input.trim()
	const found: string[] = []
	const code = normalizeCode(q)
	if (CODE.test(code)) {
		found.push(
			...ids(await db.selectFrom('acct_accounts').select('id as account_id').where('support_id', '=', code).execute()),
		)
		found.push(
			...ids(
				await db
					.selectFrom('acct_claim_codes')
					.select('account_id')
					.where('code_hash', '=', keyedHash(config.secret, code))
					.execute(),
			),
		)
	}
	if (UUID.test(q)) {
		found.push(
			...ids(
				await db.selectFrom('acct_accounts').select('id as account_id').where('id', '=', q.toLowerCase()).execute(),
			),
		)
		found.push(
			...ids(
				await db.selectFrom('acct_tokens').select('account_id').where('device_id', '=', q.toLowerCase()).execute(),
			),
		)
	} else if (HEX_PREFIX.test(q)) {
		found.push(
			...ids(
				await db
					.selectFrom('acct_accounts')
					.select('id as account_id')
					.where(sql<string>`id::text`, 'like', `${q.toLowerCase()}%`)
					.limit(50)
					.execute(),
			),
		)
	}
	if (ORDER_ID.test(q) && api) {
		const otids: string[] = []
		for (const jws of await api.lookUpOrder(q.toUpperCase())) {
			const tx = await verifier.transaction(jws).catch(() => null)
			if (tx?.originalTransactionId) otids.push(tx.originalTransactionId)
		}
		if (otids.length)
			found.push(
				...ids(
					await db
						.selectFrom('acct_purchases')
						.select('account_id')
						.where('original_transaction_id', 'in', otids)
						.execute(),
				),
			)
	}
	if (q.includes('@'))
		found.push(
			...ids(await db.selectFrom('acct_passwords').select('account_id').where('email', '=', q.toLowerCase()).execute()),
		)
	if (DIGITS.test(q)) {
		found.push(
			...ids(
				await db.selectFrom('acct_purchases').select('account_id').where('original_transaction_id', '=', q).execute(),
			),
		)
		found.push(...ids(await db.selectFrom('acct_links').select('account_id').where('value', '=', q).execute()))
	}
	if (!found.length && q.length >= 2) {
		const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
		found.push(
			...ids(
				await db
					.selectFrom('acct_device_credentials')
					.select('account_id')
					.where('device_name', 'ilike', like)
					.limit(50)
					.execute(),
			),
		)
		found.push(...ids(await db.selectFrom('acct_hints').select('account_id').where('value', '=', q).execute()))
		found.push(
			...ids(
				await db.selectFrom('acct_passwords').select('account_id').where('email', 'ilike', like).limit(50).execute(),
			),
		)
		if (hook) found.push(...(await hook(db, q)))
	}
	return [...new Set(found)]
}
