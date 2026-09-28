import { sql } from 'kysely'
import type { AcctDb } from '../db/tables.js'
import { HttpError } from '../http/errors.js'
import { recordEvent } from './events.js'

/** A device's identity block after verification: the secret hashed, the app transaction verified or dropped. */
export interface DeviceIdentity {
	secretHash: string
	/** Verified `appTransactionId`; null when absent, unverifiable, or the device sent `includeLinks: false`. */
	appTransactionId: string | null
	/** Unverified hint: stored for admins, never used to find an account. */
	icloudUserID: string | null
	platform: string
	appVersion: string
	deviceName: string | null
}

/** Serializes work on one identity (an app transaction, an original transaction) until the transaction ends. */
export async function lockIdentity(db: AcctDb, key: string) {
	await sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`.execute(db)
}

export type FoundBy = 'device_secret' | 'app_transaction'

/** The account this device proves, by precedence: its secret, then its verified app transaction. */
export async function findAccount(
	db: AcctDb,
	identity: DeviceIdentity,
): Promise<{ accountId: string; foundBy: FoundBy } | null> {
	const credential = await db
		.selectFrom('acct_device_credentials')
		.select('account_id')
		.where('secret_hash', '=', identity.secretHash)
		.executeTakeFirst()
	if (credential) return { accountId: credential.account_id, foundBy: 'device_secret' }
	if (!identity.appTransactionId) return null
	const link = await db
		.selectFrom('acct_links')
		.select('account_id')
		.where('kind', '=', 'app_transaction')
		.where('value', '=', identity.appTransactionId)
		.executeTakeFirst()
	return link ? { accountId: link.account_id, foundBy: 'app_transaction' } : null
}

/**
 * Binds the device to `accountId`: its credential, its app transaction link (when no other account owns it) and its
 * iCloud hint. A credential or, with `strict` (claim codes), an app transaction owned by another account is a 409
 * `identity_in_use`; otherwise another account's app transaction is left alone and logged as a conflict. Run inside a
 * transaction.
 */
export async function bindDevice(
	db: AcctDb,
	accountId: string,
	identity: DeviceIdentity,
	{ strict = false } = {},
	now = new Date(),
) {
	const credential = await db
		.insertInto('acct_device_credentials')
		.values({
			secret_hash: identity.secretHash,
			account_id: accountId,
			platform: identity.platform,
			device_name: identity.deviceName,
			app_version: identity.appVersion,
		})
		.onConflict((oc) =>
			oc.column('secret_hash').doUpdateSet({
				platform: identity.platform,
				device_name: identity.deviceName,
				app_version: identity.appVersion,
				last_seen_at: now,
			}),
		)
		// xmax is 0 on a row this statement inserted, so a new binding is told from a returning device.
		.returning(['account_id', sql<boolean>`xmax = 0`.as('inserted')])
		.executeTakeFirstOrThrow()
	if (credential.account_id !== accountId) throw new HttpError(409, 'identity_in_use')
	if (credential.inserted)
		await recordEvent(db, accountId, 'device_bound', 'device', {
			platform: identity.platform,
			deviceName: identity.deviceName,
		})

	if (identity.appTransactionId) {
		const link = await db
			.insertInto('acct_links')
			.values({ kind: 'app_transaction', value: identity.appTransactionId, account_id: accountId })
			.onConflict((oc) => oc.columns(['kind', 'value']).doUpdateSet({ last_seen_at: now }))
			.returning('account_id')
			.executeTakeFirstOrThrow()
		if (link.account_id !== accountId) {
			if (strict) throw new HttpError(409, 'identity_in_use')
			await recordEvent(db, accountId, 'link_conflict', 'device', { kind: 'app_transaction', ownedBy: link.account_id })
		}
	}
	if (identity.icloudUserID) {
		await db
			.insertInto('acct_hints')
			.values({ account_id: accountId, kind: 'icloud_user', value: identity.icloudUserID })
			.onConflict((oc) => oc.columns(['account_id', 'kind', 'value']).doUpdateSet({ last_seen_at: now }))
			.execute()
	}
}

/** Whether the device's app transaction belongs to an account other than `accountId`. */
export async function appTransactionOwner(db: AcctDb, identity: DeviceIdentity) {
	if (!identity.appTransactionId) return null
	const link = await db
		.selectFrom('acct_links')
		.select('account_id')
		.where('kind', '=', 'app_transaction')
		.where('value', '=', identity.appTransactionId)
		.executeTakeFirst()
	return link?.account_id ?? null
}
