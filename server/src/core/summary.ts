import type { AcctDb } from '../db/tables.js'
import type { AccountSummary } from '../routes/contract.js'
import { LIVE_STATUSES } from '../db/tables.js'

/** The account as its devices see it (docs/DESIGN.md "Protocol"). Dates stay `Date`s; Fastify serializes them. */
export async function accountSummary(db: AcctDb, accountId: string) {
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
	return { id: a.id, supportID: a.support_id, createdAt: a.created_at, access } as unknown as AccountSummary
}
