import { sql } from 'kysely'
import type { AcctDb } from '../db/tables.js'
import type { AccessSource, AccountStatus, StoreEnvironment } from '../db/tables.js'

export interface ListFilters {
	ids?: string[]
	status?: AccountStatus
	environment?: StoreEnvironment
	source?: AccessSource
	createdAfter?: Date
	createdBefore?: Date
	seenAfter?: Date
	/** Opaque keyset cursor from the previous page (`createdAt|id`). */
	cursor?: string
	limit: number
}

/**
 * Accounts newest first, filtered, with their device count and ways to sign in; one extra row tells whether another
 * page exists.
 */
export async function listAccounts(db: AcctDb, f: ListFilters) {
	let query = db
		.selectFrom('acct_accounts as a')
		.select([
			'a.id',
			'a.support_id',
			'a.status',
			'a.plan_id',
			'a.access_source',
			'a.access_environment',
			'a.access_expires_at',
			'a.created_at',
			'a.last_seen_at',
			(eb) =>
				eb
					.selectFrom('acct_device_credentials as c')
					.select(eb.fn.countAll<number>().as('n'))
					.whereRef('c.account_id', '=', 'a.id')
					.as('devices'),

			(eb) => eb.selectFrom('acct_passwords as p').select('p.email').whereRef('p.account_id', '=', 'a.id').as('email'),
			// Ways to sign in besides a password; an app transaction only finds the account on its own device.
			sql<
				string[]
			>`ARRAY(SELECT DISTINCT l.kind FROM acct_links l WHERE l.account_id = a.id AND l.kind <> 'app_transaction' ORDER BY l.kind)`.as(
				'sign_in_kinds',
			),
		])
		.orderBy('a.created_at', 'desc')
		.orderBy('a.id', 'desc')
		.limit(f.limit + 1)
	if (f.ids) query = query.where('a.id', 'in', f.ids.length ? f.ids : ['00000000-0000-0000-0000-000000000000'])
	if (f.status) query = query.where('a.status', '=', f.status)
	if (f.environment) query = query.where('a.access_environment', '=', f.environment)
	if (f.source) query = query.where('a.access_source', '=', f.source)
	if (f.createdAfter) query = query.where('a.created_at', '>=', f.createdAfter)
	if (f.createdBefore) query = query.where('a.created_at', '<', f.createdBefore)
	if (f.seenAfter) query = query.where('a.last_seen_at', '>=', f.seenAfter)
	if (f.cursor) {
		const [at, id] = Buffer.from(f.cursor, 'base64url').toString().split('|')
		query = query.where(sql<boolean>`(a.created_at, a.id) < (${new Date(at!)}, ${id}::uuid)`)
	}
	const rows = await query.execute()
	const page = rows.slice(0, f.limit)
	const last = page.at(-1)
	const nextCursor =
		rows.length > f.limit && last
			? Buffer.from(`${last.created_at.toISOString()}|${last.id}`).toString('base64url')
			: null
	return {
		nextCursor,
		accounts: page.map((r) => ({
			id: r.id,
			supportId: r.support_id,
			status: r.status,
			plan: r.plan_id,
			source: r.access_source,
			environment: r.access_environment,
			expiresAt: r.access_expires_at,
			createdAt: r.created_at,
			lastSeenAt: r.last_seen_at,
			devices: Number(r.devices),
			email: r.email,
			signInKinds: r.sign_in_kinds,
		})),
	}
}
