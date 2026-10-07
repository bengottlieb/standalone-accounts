import type { AcctDb } from '../db/tables.js'
import type { AccountSummary } from '../routes/contract.js'
import { LIVE_STATUSES } from '../db/tables.js'

/** How the account can be signed in to: its password (labelled with the email) and its sign-in links. */
export async function signInIdentities(db: AcctDb, accountId: string, kinds: string[]) {
	const [password, links, labels] = await Promise.all([
		db.selectFrom('acct_passwords').select('email').where('account_id', '=', accountId).executeTakeFirst(),
		db
			.selectFrom('acct_links')
			.select('kind')
			.where('account_id', '=', accountId)
			.where('kind', 'in', kinds)
			.orderBy('created_at')
			.execute(),
		db
			.selectFrom('acct_hints')
			.select(['kind', 'value'])
			.where('account_id', '=', accountId)
			.where((eb) => eb.or([eb('kind', 'like', '%\\_label'), eb('kind', 'like', '%\\_name')]))
			.execute(),
	])
	const hint = (kind: string, suffix: string) => labels.find((l) => l.kind === `${kind}_${suffix}`)?.value
	return [
		...(password ? [{ kind: 'password', label: password.email }] : []),
		...links.map((l) => {
			const label = hint(l.kind, 'label')
			const name = hint(l.kind, 'name')
			return { kind: l.kind, ...(label ? { label } : {}), ...(name ? { name } : {}) }
		}),
	]
}

/** The account as its devices see it (docs/DESIGN.md "Protocol"). Dates stay `Date`s; Fastify serializes them. */
export async function accountSummary(db: AcctDb, accountId: string, kinds: string[] = ['apple', 'game_center']) {
	const a = await db.selectFrom('acct_accounts').selectAll().where('id', '=', accountId).executeTakeFirstOrThrow()
	const access = {
		status: a.status,
		active: LIVE_STATUSES.includes(a.status),
		...(a.plan_id ? { plan: a.plan_id } : {}),
		...(a.access_source ? { source: a.access_source } : {}),
		...(a.access_environment ? { environment: a.access_environment } : {}),
		...(a.access_expires_at ? { expiresAt: a.access_expires_at } : {}),
		...(a.access_will_renew !== null ? { willRenew: a.access_will_renew } : {}),
	}
	const identities = await signInIdentities(db, accountId, kinds)
	return { id: a.id, supportID: a.support_id, createdAt: a.created_at, access, identities } as unknown as AccountSummary
}
