import type { Selectable } from 'kysely'
import type { AcctDb } from '../db/tables.js'
import { recordEvent, type Actor } from './events.js'
import type { AcctAccountsTable, AcctGrantsTable, AcctPurchasesTable } from '../db/tables.js'

type Access = Pick<
	Selectable<AcctAccountsTable>,
	'status' | 'plan_id' | 'access_source' | 'access_environment' | 'access_expires_at' | 'access_will_renew'
>
type Purchase = Selectable<AcctPurchasesTable>
type Grant = Selectable<AcctGrantsTable>

const NONE: Access = {
	status: 'none',
	plan_id: null,
	access_source: null,
	access_environment: null,
	access_expires_at: null,
	access_will_renew: null,
}
const time = (d: Date | null) => d?.getTime() ?? Number.POSITIVE_INFINITY

function fromPurchase(s: Purchase, status: Access['status']): Access {
	const expires = status === 'grace' ? s.grace_expires_at : s.expires_at
	return {
		status,
		plan_id: s.plan_id,
		access_source: s.type === 'non_consumable' ? 'purchase' : 'subscription',
		access_environment: s.environment,
		access_expires_at: expires,
		access_will_renew: s.auto_renew,
	}
}

/**
 * Effective access (docs/DESIGN.md "Access"): a suspension overrides everything; then an active purchase (a one-time
 * purchase, never expiring, before a subscription), one in its grace period, or a live grant; otherwise the last
 * purchase's lapsed state, or `none`.
 */
export function effectiveAccess(subs: Purchase[], grants: Grant[], suspended: boolean, now: Date): Access {
	if (suspended) return { ...NONE, status: 'suspended' }
	const latest = [...subs].sort((a, b) => time(b.expires_at) - time(a.expires_at))
	const active = latest.find((s) => s.status === 'active')
	if (active) return fromPurchase(active, 'active')
	const grace = latest.find((s) => s.status === 'grace')
	if (grace) return fromPurchase(grace, 'grace')
	const live = grants
		.filter((g) => !g.revoked_at && g.starts_at <= now && (!g.expires_at || g.expires_at > now))
		.sort((a, b) => time(b.expires_at) - time(a.expires_at))[0]
	if (live)
		return {
			status: 'granted',
			plan_id: live.plan_id,
			access_source: 'grant',
			access_environment: null,
			access_expires_at: live.expires_at,
			access_will_renew: null,
		}
	const lapsed = latest[0]
	return lapsed ? fromPurchase(lapsed, lapsed.status) : NONE
}

/** Recomputes and stores the account's effective access, recording a change. Returns the new status. */
export async function refreshAccess(db: AcctDb, accountId: string, actor: Actor = 'system', now = new Date()) {
	const [account, subs, grants, suspension] = await Promise.all([
		db
			.selectFrom('acct_accounts')
			.select(['status', 'plan_id', 'access_expires_at'])
			.where('id', '=', accountId)
			.forUpdate()
			.executeTakeFirst(),
		db.selectFrom('acct_purchases').selectAll().where('account_id', '=', accountId).execute(),
		db.selectFrom('acct_grants').selectAll().where('account_id', '=', accountId).execute(),
		db
			.selectFrom('acct_suspensions')
			.select('id')
			.where('account_id', '=', accountId)
			.where('lifted_at', 'is', null)
			.where('starts_at', '<=', now)
			.where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', now)]))
			.executeTakeFirst(),
	])
	if (!account) return null
	const access = effectiveAccess(subs, grants, !!suspension, now)
	await db
		.updateTable('acct_accounts')
		.set({ ...access, updated_at: now })
		.where('id', '=', accountId)
		.execute()
	if (access.status !== account.status || access.plan_id !== account.plan_id)
		await recordEvent(db, accountId, 'access_changed', actor, {
			from: account.status,
			to: access.status,
			plan: access.plan_id,
		})
	return access.status
}
