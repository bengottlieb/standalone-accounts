import type { AcctDb } from '../db/tables.js'
import { HttpError } from '../http/errors.js'
import type { AcctConfig } from './config.js'
import { recordEvent, type Actor } from './events.js'
import { generateCode, keyedHash, normalizeCode } from './ids.js'

/** Issues a one-time code (shown once) that binds the device redeeming it to `accountId`. */
export async function createClaimCode(
	db: AcctDb,
	config: AcctConfig,
	accountId: string,
	actor: Actor,
	createdBy: string | null,
	now = new Date(),
) {
	const code = generateCode(config.codePrefix)
	const expiresAt = new Date(now.getTime() + config.claimCodeDays * 86_400_000)
	await db
		.insertInto('acct_claim_codes')
		.values({
			code_hash: keyedHash(config.secret, code),
			account_id: accountId,
			expires_at: expiresAt,
			created_by: createdBy,
		})
		.execute()
	await recordEvent(db, accountId, 'claim_code_created', actor, { expiresAt: expiresAt.toISOString() })
	return { code, expiresAt }
}

/**
 * Consumes a claim code and returns its account: 404 `code_not_found` for an unknown one, 410 `code_expired` for one
 * expired or already used. Run inside a transaction; the row stays locked until it commits.
 */
export async function redeemClaimCode(db: AcctDb, config: AcctConfig, input: string, now = new Date()) {
	const row = await db
		.selectFrom('acct_claim_codes')
		.selectAll()
		.where('code_hash', '=', keyedHash(config.secret, normalizeCode(input)))
		.forUpdate()
		.executeTakeFirst()
	if (!row) throw new HttpError(404, 'code_not_found')
	if (row.redeemed_at || row.expires_at <= now) throw new HttpError(410, 'code_expired')
	await db.updateTable('acct_claim_codes').set({ redeemed_at: now }).where('code_hash', '=', row.code_hash).execute()
	return row.account_id
}
