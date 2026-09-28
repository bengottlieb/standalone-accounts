import { sql } from 'kysely'
import type { AcctDb } from '../db/tables.js'
import { refreshAccess } from './access.js'
import { recordEvent, type Actor } from './events.js'
import type { AcctHooks } from './hooks.js'

/**
 * Whether the account has no way to sign in to it: no password and no sign-in link (`kinds`). Such an account lives
 * only on its devices, so signing in elsewhere may fold it in.
 */
export async function isAnonymous(db: AcctDb, accountId: string, kinds: string[]) {
	const password = await db
		.selectFrom('acct_passwords')
		.select('account_id')
		.where('account_id', '=', accountId)
		.executeTakeFirst()
	if (password) return false
	const link = await db
		.selectFrom('acct_links')
		.select('kind')
		.where('account_id', '=', accountId)
		.where('kind', 'in', kinds)
		.executeTakeFirst()
	return !link
}

/**
 * Folds anonymous account `fromId` into `intoId` (docs/DESIGN.md "Sign-in"): the library moves purchases, grants,
 * links, hints, devices and tokens first, then the host moves its data (its hook may delete its own row for `fromId`,
 * which may take the account with it), then `fromId` is deleted and access recomputed. Run inside a transaction.
 */
export async function mergeInto(
	db: AcctDb,
	fromId: string,
	intoId: string,
	actor: Actor,
	hooks?: AcctHooks,
	host?: unknown,
) {
	for (const table of [
		'acct_purchases',
		'acct_grants',
		'acct_suspensions',
		'acct_links',
		'acct_device_credentials',
		'acct_tokens',
		'acct_claim_codes',
	] as const)
		await db.updateTable(table).set({ account_id: intoId }).where('account_id', '=', fromId).execute()
	await sql`INSERT INTO acct_hints (account_id, kind, value, last_seen_at)
		SELECT ${intoId}, kind, value, last_seen_at FROM acct_hints WHERE account_id = ${fromId}
		ON CONFLICT (account_id, kind, value) DO NOTHING`.execute(db)
	await hooks?.mergeAccounts?.(db, fromId, intoId, host)
	await db.deleteFrom('acct_accounts').where('id', '=', fromId).execute()
	await recordEvent(db, fromId, 'merged', actor, { into: intoId })
	await recordEvent(db, intoId, 'merged', actor, { from: fromId })
	await refreshAccess(db, intoId, actor)
}
