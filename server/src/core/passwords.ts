import { randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { AcctDb } from '../db/tables.js'
import { HttpError } from '../http/errors.js'
import { keyedHash } from './ids.js'

const ROUNDS = 10
const RESET_MS = 60 * 60 * 1000

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** The account an email signs in to, with its hash. */
export async function passwordAccount(db: AcctDb, email: string) {
	return db.selectFrom('acct_passwords').selectAll().where('email', '=', normalizeEmail(email)).executeTakeFirst()
}

export async function passwordMatches(hash: string, password: string) {
	return bcrypt.compare(password, hash)
}

/** Sets the account's email and password, adding them to an account without; 409 `email_in_use` if another has it. */
export async function storePassword(db: AcctDb, accountId: string, email: string, password: string) {
	const normalized = normalizeEmail(email)
	const taken = await db
		.selectFrom('acct_passwords')
		.select('account_id')
		.where('email', '=', normalized)
		.executeTakeFirst()
	if (taken && taken.account_id !== accountId) throw new HttpError(409, 'email_in_use')
	const hash = await bcrypt.hash(password, ROUNDS)
	await db
		.insertInto('acct_passwords')
		.values({ account_id: accountId, email: normalized, password_hash: hash })
		.onConflict((oc) =>
			oc.column('account_id').doUpdateSet({ email: normalized, password_hash: hash, updated_at: new Date() }),
		)
		.execute()
}

/** A six-digit reset code for the account (only its keyed hash is kept), valid for an hour. */
export async function createResetCode(db: AcctDb, secret: string, accountId: string, now = new Date()) {
	const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
	await db
		.insertInto('acct_password_resets')
		.values({
			code_hash: keyedHash(secret, `${accountId}:${code}`),
			account_id: accountId,
			expires_at: new Date(now.getTime() + RESET_MS),
		})
		.execute()
	return code
}

/**
 * Spends a reset code: 410 `code_expired` for a wrong, used or expired one. Every other open code for the account is
 * spent with it. Run inside a transaction.
 */
export async function spendResetCode(db: AcctDb, secret: string, accountId: string, code: string, now = new Date()) {
	const row = await db
		.selectFrom('acct_password_resets')
		.selectAll()
		.where('code_hash', '=', keyedHash(secret, `${accountId}:${code.trim()}`))
		.forUpdate()
		.executeTakeFirst()
	if (!row || row.used_at || row.expires_at <= now) throw new HttpError(410, 'code_expired')
	await db
		.updateTable('acct_password_resets')
		.set({ used_at: now })
		.where('account_id', '=', accountId)
		.where('used_at', 'is', null)
		.execute()
}
