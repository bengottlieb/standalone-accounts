import type { ColumnType, Generated, Kysely } from 'kysely'

// The account framework's tables (server/migrations). A host's own Kysely interface may extend `AcctTables`; the
// library only ever touches these.

type Timestamp = ColumnType<Date, Date | string, Date | string>
type DefaultTimestamp = ColumnType<Date, Date | string | undefined, Date | string>

/** Effective access, materialized on the account row. `active`, `grace` and `granted` are live. */
export type AccountStatus = 'active' | 'grace' | 'granted' | 'expired' | 'revoked' | 'suspended' | 'none'
/** A subscription's state; one-time purchases are only ever `active` or `revoked`. */
export type PurchaseStatus = 'active' | 'grace' | 'expired' | 'revoked'
export type PurchaseType = 'subscription' | 'non_consumable'
export type StoreEnvironment = 'Production' | 'Sandbox' | 'Xcode'
export type AccessSource = 'subscription' | 'purchase' | 'grant'
export type GrantSource = 'manual' | 'promo' | 'beta'

export const LIVE_STATUSES: readonly AccountStatus[] = ['active', 'grace', 'granted']

export interface AcctPlansTable {
	id: string
	name: string
	/** StoreKit products that grant the plan: subscriptions while active, one-time purchases until refunded. */
	product_ids: ColumnType<string[], string[] | undefined, string[]>
	/** The host's per-plan limits (StoreKeeper: tracked apps, keywords); the library only stores them. */
	limits: ColumnType<Record<string, number>, string | undefined, string>
	created_at: DefaultTimestamp
}

export interface AcctAccountsTable {
	id: Generated<string>
	support_id: string
	status: ColumnType<AccountStatus, AccountStatus | undefined, AccountStatus>
	plan_id: string | null
	access_source: AccessSource | null
	access_environment: StoreEnvironment | null
	access_expires_at: Timestamp | null
	access_will_renew: boolean | null
	last_seen_at: Timestamp | null
	created_at: DefaultTimestamp
	updated_at: DefaultTimestamp
}

export interface AcctPurchasesTable {
	id: Generated<string>
	/** Null for a purchase no account has claimed yet. */
	account_id: string | null
	type: PurchaseType
	bundle_id: string
	original_transaction_id: string
	environment: StoreEnvironment
	plan_id: string | null
	product_id: string
	status: PurchaseStatus
	expires_at: Timestamp | null
	grace_expires_at: Timestamp | null
	auto_renew: boolean | null
	app_account_token: string | null
	last_event_at: Timestamp | null
	revoked_at: Timestamp | null
	created_at: DefaultTimestamp
	updated_at: DefaultTimestamp
}

export interface AcctLinksTable {
	kind: string
	value: string
	account_id: string
	created_at: DefaultTimestamp
	last_seen_at: DefaultTimestamp
}

export interface AcctHintsTable {
	account_id: string
	kind: string
	value: string
	last_seen_at: DefaultTimestamp
}

export interface AcctDeviceCredentialsTable {
	secret_hash: string
	account_id: string
	platform: string
	device_name: string | null
	app_version: string | null
	created_at: DefaultTimestamp
	last_seen_at: DefaultTimestamp
}

export interface AcctTokensTable {
	id: Generated<string>
	account_id: string
	token_hash: string
	prefix: string
	device_name: string | null
	/** A host's own device id for this token (StoreKeeper's `devices`), if it keeps one. */
	device_id: string | null
	credential_hash: string | null
	/** From the device's latest check-in. */
	platform: string | null
	app_version: string | null
	app_build: number | null
	os_version: string | null
	checked_in_at: Timestamp | null
	created_at: DefaultTimestamp
	last_used_at: Timestamp | null
	revoked_at: Timestamp | null
}

export interface AcctGrantsTable {
	id: Generated<string>
	account_id: string
	plan_id: string
	source: GrantSource
	starts_at: DefaultTimestamp
	expires_at: Timestamp | null
	note: string | null
	/** The admin (host user id) who granted it. */
	created_by: string | null
	created_at: DefaultTimestamp
	revoked_at: Timestamp | null
}

export interface AcctSuspensionsTable {
	id: Generated<string>
	account_id: string
	reason: string
	starts_at: DefaultTimestamp
	ends_at: Timestamp | null
	created_by: string | null
	created_at: DefaultTimestamp
	lifted_at: Timestamp | null
}

export interface AcctClaimCodesTable {
	code_hash: string
	account_id: string
	expires_at: Timestamp
	created_by: string | null
	created_at: DefaultTimestamp
	redeemed_at: Timestamp | null
}

export interface AcctEventsTable {
	id: Generated<number>
	account_id: string
	kind: string
	actor: string
	data: ColumnType<Record<string, unknown>, string | undefined, string>
	created_at: DefaultTimestamp
}

export interface AcctStoreNotificationsTable {
	notification_uuid: string
	notification_type: string
	subtype: string | null
	bundle_id: string | null
	original_transaction_id: string | null
	environment: string | null
	signed_date: Timestamp
	received_at: DefaultTimestamp
	processed_at: Timestamp | null
	account_id: string | null
	error: string | null
}

export interface AcctPasswordsTable {
	account_id: string
	email: string
	password_hash: string
	created_at: DefaultTimestamp
	updated_at: DefaultTimestamp
}

export interface AcctPasswordResetsTable {
	code_hash: string
	account_id: string
	expires_at: Timestamp
	used_at: Timestamp | null
	created_at: DefaultTimestamp
}

export interface AcctTables {
	acct_plans: AcctPlansTable
	acct_accounts: AcctAccountsTable
	acct_purchases: AcctPurchasesTable
	acct_links: AcctLinksTable
	acct_hints: AcctHintsTable
	acct_device_credentials: AcctDeviceCredentialsTable
	acct_tokens: AcctTokensTable
	acct_grants: AcctGrantsTable
	acct_suspensions: AcctSuspensionsTable
	acct_claim_codes: AcctClaimCodesTable
	acct_events: AcctEventsTable
	acct_store_notifications: AcctStoreNotificationsTable
	acct_passwords: AcctPasswordsTable
	acct_password_resets: AcctPasswordResetsTable
}

/** The library's view of the host's database (or a transaction on it). */
export type AcctDb = Kysely<AcctTables>
