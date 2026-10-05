import { randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { AcctDb } from '../db/tables.js'
import { HttpError } from '../http/errors.js'
import { keyedHash } from './ids.js'

const ROUNDS = 10
const RESET_MS = 60 * 60 * 1000

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** The shortest password a new one may be unless the host sets `signIn.password.minLength`. */
export const DEFAULT_MIN_PASSWORD_LENGTH = 8

/**
 * 400 `password_too_short` (with `minLength`) for a password being set that's under the host's minimum. Only checked
 * when a password is set (register, reset, change), never at sign-in: an existing password keeps working whatever the
 * policy has become since.
 */
export function checkNewPassword(password: string, minLength = DEFAULT_MIN_PASSWORD_LENGTH) {
	if (password.length < minLength) throw new HttpError(400, 'password_too_short', {}, { minLength })
}

/** The account an email signs in to, with its hash. */
export async function passwordAccount(db: AcctDb, email: string) {
	return db.selectFrom('acct_passwords').selectAll().where('email', '=', normalizeEmail(email)).executeTakeFirst()
}

/** Checks a hash the host wrote before moving its passwords here (e.g. argon2); bcrypt hashes never reach it. */
export type LegacyPasswordCheck = (hash: string, password: string) => Promise<boolean>

const DUMMY_HASH = bcrypt.hash('timing-equaliser-not-a-real-password', ROUNDS)

const isBcrypt = (hash: string) => /^\$2[abxy]\$/.test(hash)

/** Whether `password` matches `hash`: bcrypt, or a host's legacy format through `legacy` (false without one). */
export async function passwordMatches(hash: string, password: string, legacy?: LegacyPasswordCheck) {
	if (isBcrypt(hash)) return bcrypt.compare(password, hash)
	return legacy ? legacy(hash, password) : false
}

/**
 * Checks the account's password, and on a match against a legacy hash re-saves it as bcrypt, so each imported
 * password moves to the library's format the first time it's used.
 */
export async function verifyAccountPassword(
	db: AcctDb,
	row: { account_id: string; password_hash: string },
	password: string,
	legacy?: LegacyPasswordCheck,
) {
	if (!(await passwordMatches(row.password_hash, password, legacy))) return false
	if (!isBcrypt(row.password_hash))
		await db
			.updateTable('acct_passwords')
			.set({ password_hash: await bcrypt.hash(password, ROUNDS), updated_at: new Date() })
			.where('account_id', '=', row.account_id)
			.execute()
	return true
}

/**
 * The account an email and password sign in to, or null: for a host's own sign-in (a website) on the same
 * accounts. No device, token or rate limit: the host brings its own session and throttling.
 */
export async function checkEmailPassword(db: AcctDb, email: string, password: string, legacy?: LegacyPasswordCheck) {
	const row = await passwordAccount(db, email)
	if (!row) {
		// As slow as a wrong password, so timing doesn't reveal which emails have accounts.
		await bcrypt.compare(password, await DUMMY_HASH)
		return null
	}
	return (await verifyAccountPassword(db, row, password, legacy)) ? row.account_id : null
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
