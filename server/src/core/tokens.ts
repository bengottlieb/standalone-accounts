import { sql } from 'kysely'
import type { AcctDb } from '../db/tables.js'
import type { AcctConfig } from './config.js'
import { generateToken, keyedHash } from './ids.js'
import type { AccountStatus } from '../db/tables.js'

const TOUCH_AFTER_MS = 60_000

declare module 'fastify' {
	interface FastifyRequest {
		/**
		 * The account behind the request's bearer token. The host's auth hook sets it (with `resolveToken`) for tokens
		 * starting with `config.tokenPrefix`, and null otherwise.
		 */
		account: MemberAccount | null
	}
}

/** The account behind a presented bearer token: `request.account`. */
export interface MemberAccount {
	id: string
	status: AccountStatus
	planId: string | null
	tokenId: string
	/** The host device this token registered (#38), or null until it registers one. */
	deviceId: string | null
	/** The device credential the token was issued to; sign-out deletes it. */
	credentialHash: string | null
}

/**
 * Issues a device token and returns its plaintext (shown once). Beyond `maxTokensPerAccount` live tokens, the least
 * recently used ones are revoked.
 */
export async function issueToken(
	db: AcctDb,
	config: AcctConfig,
	accountId: string,
	deviceName: string | null,
	credentialHash: string | null = null,
) {
	const token = generateToken(config.tokenPrefix)
	return db.transaction().execute(async (trx) => {
		// Serializes concurrent issues for one account so the cap holds.
		await trx.selectFrom('acct_accounts').select('id').where('id', '=', accountId).forUpdate().executeTakeFirstOrThrow()
		const row = await trx
			.insertInto('acct_tokens')
			.values({
				account_id: accountId,
				token_hash: keyedHash(config.secret, token),
				prefix: token.slice(0, 12),
				device_name: deviceName,
				credential_hash: credentialHash,
			})
			.returning(['id', 'prefix', 'created_at'])
			.executeTakeFirstOrThrow()
		const keep = trx
			.selectFrom('acct_tokens')
			.select('id')
			.where('account_id', '=', accountId)
			.where('revoked_at', 'is', null)
			.orderBy(sql`coalesce(last_used_at, created_at)`, 'desc')
			.orderBy('created_at', 'desc')
			.limit(config.maxTokensPerAccount)
		await trx
			.updateTable('acct_tokens')
			.set({ revoked_at: new Date() })
			.where('account_id', '=', accountId)
			.where('revoked_at', 'is', null)
			.where('id', '<>', row.id)
			.where('id', 'not in', keep)
			.execute()
		return { ...row, token }
	})
}

/** Resolves a presented token to its account, recording use (on the token and the account) at most once a minute. */
export async function resolveToken(db: AcctDb, secret: string, token: string): Promise<MemberAccount | null> {
	const row = await db
		.selectFrom('acct_tokens as t')
		.innerJoin('acct_accounts as a', 'a.id', 't.account_id')
		.select(['t.id as tokenId', 't.last_used_at', 't.device_id', 't.credential_hash', 'a.id', 'a.status', 'a.plan_id'])
		.where('t.token_hash', '=', keyedHash(secret, token))
		.where('t.revoked_at', 'is', null)
		.executeTakeFirst()
	if (!row) return null
	if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > TOUCH_AFTER_MS) {
		const now = new Date()
		await db.updateTable('acct_tokens').set({ last_used_at: now }).where('id', '=', row.tokenId).execute()
		await db.updateTable('acct_accounts').set({ last_seen_at: now }).where('id', '=', row.id).execute()
	}
	return {
		id: row.id,
		status: row.status,
		planId: row.plan_id,
		tokenId: row.tokenId,
		deviceId: row.device_id,
		credentialHash: row.credential_hash,
	}
}

export async function revokeToken(db: AcctDb, tokenId: string) {
	await db
		.updateTable('acct_tokens')
		.set({ revoked_at: new Date() })
		.where('id', '=', tokenId)
		.where('revoked_at', 'is', null)
		.execute()
}

/** Revokes every live token of the account (a password reset signs every device out). */
export async function revokeAllTokens(db: AcctDb, accountId: string) {
	await db
		.updateTable('acct_tokens')
		.set({ revoked_at: new Date() })
		.where('account_id', '=', accountId)
		.where('revoked_at', 'is', null)
		.execute()
}
