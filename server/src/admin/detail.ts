import type { AcctDb } from '../db/tables.js'

/** Names the admins behind `admin:<user id>` actors (the host owns its users). */
export type AdminNames = (userIds: string[]) => Promise<Record<string, string>>

/** Everything an admin sees about one account. Secrets and hashes never leave the database. */
export async function accountDetail(db: AcctDb, accountId: string, adminNames?: AdminNames) {
	const account = await db.selectFrom('acct_accounts').selectAll().where('id', '=', accountId).executeTakeFirst()
	if (!account) return null
	const [purchases, grants, suspensions, links, hints, devices, tokens, events] = await Promise.all([
		db
			.selectFrom('acct_purchases')
			.selectAll()
			.where('account_id', '=', accountId)
			.orderBy('created_at', 'desc')
			.execute(),
		db
			.selectFrom('acct_grants')
			.selectAll()
			.where('account_id', '=', accountId)
			.orderBy('created_at', 'desc')
			.execute(),
		db
			.selectFrom('acct_suspensions')
			.selectAll()
			.where('account_id', '=', accountId)
			.orderBy('created_at', 'desc')
			.execute(),
		db
			.selectFrom('acct_links')
			.select(['kind', 'value', 'created_at', 'last_seen_at'])
			.where('account_id', '=', accountId)
			.execute(),
		db.selectFrom('acct_hints').select(['kind', 'value', 'last_seen_at']).where('account_id', '=', accountId).execute(),
		db
			.selectFrom('acct_device_credentials')
			.select(['platform', 'device_name', 'app_version', 'created_at', 'last_seen_at'])
			.where('account_id', '=', accountId)
			.orderBy('last_seen_at', 'desc')
			.execute(),
		db
			.selectFrom('acct_tokens')
			.select([
				'prefix',
				'device_name',
				'device_id',
				'platform',
				'app_version',
				'app_build',
				'checked_in_at',
				'created_at',
				'last_used_at',
				'revoked_at',
			])
			.where('account_id', '=', accountId)
			.orderBy('created_at', 'desc')
			.limit(50)
			.execute(),
		db
			.selectFrom('acct_events')
			.select(['id', 'kind', 'actor', 'data', 'created_at'])
			.where('account_id', '=', accountId)
			.orderBy('id', 'desc')
			.limit(200)
			.execute(),
	])
	// Admins appear in the timeline by email rather than by user id.
	const adminIds = [
		...new Set(
			events
				.map((e) => e.actor)
				.filter((a) => a.startsWith('admin:'))
				.map((a) => a.slice(6)),
		),
	]
	const names = adminIds.length && adminNames ? await adminNames(adminIds) : {}
	const actorName = (actor: string) =>
		actor.startsWith('admin:') ? `admin:${names[actor.slice(6)] ?? actor.slice(6)}` : actor
	return {
		account: {
			id: account.id,
			supportId: account.support_id,
			status: account.status,
			plan: account.plan_id,
			source: account.access_source,
			environment: account.access_environment,
			expiresAt: account.access_expires_at,
			willRenew: account.access_will_renew,
			createdAt: account.created_at,
			lastSeenAt: account.last_seen_at,
		},
		purchases: purchases.map((s) => ({
			id: s.id,
			type: s.type,
			bundleId: s.bundle_id,
			originalTransactionId: s.original_transaction_id,
			environment: s.environment,
			plan: s.plan_id,
			productId: s.product_id,
			status: s.status,
			expiresAt: s.expires_at,
			graceExpiresAt: s.grace_expires_at,
			autoRenew: s.auto_renew,
			revokedAt: s.revoked_at,
			updatedAt: s.updated_at,
		})),
		grants: grants.map((g) => ({
			id: g.id,
			plan: g.plan_id,
			source: g.source,
			startsAt: g.starts_at,
			expiresAt: g.expires_at,
			note: g.note,
			createdBy: g.created_by,
			revokedAt: g.revoked_at,
		})),
		suspensions: suspensions.map((s) => ({
			id: s.id,
			reason: s.reason,
			startsAt: s.starts_at,
			endsAt: s.ends_at,
			createdBy: s.created_by,
			liftedAt: s.lifted_at,
		})),
		links: links.map((l) => ({ kind: l.kind, value: l.value, createdAt: l.created_at, lastSeenAt: l.last_seen_at })),
		hints: hints.map((h) => ({ kind: h.kind, value: h.value, lastSeenAt: h.last_seen_at })),
		devices: devices.map((d) => ({
			platform: d.platform,
			name: d.device_name,
			appVersion: d.app_version,
			boundAt: d.created_at,
			lastSeenAt: d.last_seen_at,
		})),
		tokens: tokens.map((t) => ({
			prefix: t.prefix,
			deviceName: t.device_name,
			deviceId: t.device_id,
			platform: t.platform,
			appVersion: t.app_version,
			appBuild: t.app_build,
			checkedInAt: t.checked_in_at,
			createdAt: t.created_at,
			lastUsedAt: t.last_used_at,
			revokedAt: t.revoked_at,
		})),
		events: events.map((e) => ({ id: e.id, kind: e.kind, actor: actorName(e.actor), data: e.data, at: e.created_at })),
	}
}
