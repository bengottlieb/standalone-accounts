-- The account framework (docs/DESIGN.md). An account is an opaque id; purchases, grants, suspensions, identity links
-- and device credentials attach to it. `acct_accounts.status` and the `access_*` columns are its materialized
-- effective access, recomputed whenever any of those change. No table references the host's own tables.

CREATE TABLE acct_plans (
	id text PRIMARY KEY,
	name text NOT NULL,
	product_ids text[] NOT NULL DEFAULT '{}',
	limits jsonb NOT NULL DEFAULT '{}',
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE acct_accounts (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	support_id text NOT NULL UNIQUE,
	status text NOT NULL DEFAULT 'none'
		CHECK (status IN ('active', 'grace', 'granted', 'expired', 'revoked', 'suspended', 'none')),
	plan_id text REFERENCES acct_plans (id),
	access_source text CHECK (access_source IN ('subscription', 'purchase', 'grant')),
	access_environment text CHECK (access_environment IN ('Production', 'Sandbox', 'Xcode')),
	access_expires_at timestamptz,
	access_will_renew boolean,
	last_seen_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acct_accounts_status_idx ON acct_accounts (status);
CREATE INDEX acct_accounts_created_idx ON acct_accounts (created_at DESC, id DESC);

-- Purchases come only from Apple: subscriptions and one-time (non-consumable) purchases of products a plan lists.
-- account_id is null for one no account has claimed yet (a notification that arrived before the app's
-- /auth/purchase, or one whose account was deleted).
CREATE TABLE acct_purchases (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid REFERENCES acct_accounts (id) ON DELETE SET NULL,
	type text NOT NULL CHECK (type IN ('subscription', 'non_consumable')),
	bundle_id text NOT NULL,
	original_transaction_id text NOT NULL UNIQUE,
	environment text NOT NULL CHECK (environment IN ('Production', 'Sandbox', 'Xcode')),
	plan_id text REFERENCES acct_plans (id),
	product_id text NOT NULL,
	status text NOT NULL CHECK (status IN ('active', 'grace', 'expired', 'revoked')),
	expires_at timestamptz,
	grace_expires_at timestamptz,
	auto_renew boolean,
	app_account_token uuid,
	last_event_at timestamptz, -- signedDate of the latest applied transaction/notification; older ones are not applied
	revoked_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acct_purchases_account_idx ON acct_purchases (account_id);
CREATE INDEX acct_purchases_unclaimed_idx ON acct_purchases (created_at) WHERE account_id IS NULL;

-- Verified identities that find an account (kind: app_transaction, game_center, apple_id). One owner each.
CREATE TABLE acct_links (
	kind text NOT NULL,
	value text NOT NULL,
	account_id uuid NOT NULL REFERENCES acct_accounts (id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	last_seen_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (kind, value)
);
CREATE INDEX acct_links_account_idx ON acct_links (account_id);

-- Unverified hints (icloud_user): shown to admins, never used to find an account, so not unique.
CREATE TABLE acct_hints (
	account_id uuid NOT NULL REFERENCES acct_accounts (id) ON DELETE CASCADE,
	kind text NOT NULL,
	value text NOT NULL,
	last_seen_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (account_id, kind, value)
);
CREATE INDEX acct_hints_value_idx ON acct_hints (kind, value);

-- A device's secret, stored as a keyed hash. It proves the account it was bound to and never creates one.
CREATE TABLE acct_device_credentials (
	secret_hash text PRIMARY KEY,
	account_id uuid NOT NULL REFERENCES acct_accounts (id) ON DELETE CASCADE,
	platform text NOT NULL,
	device_name text,
	app_version text,
	created_at timestamptz NOT NULL DEFAULT now(),
	last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acct_device_credentials_account_idx ON acct_device_credentials (account_id);

-- One bearer token per device, stored as a keyed hash. It dies with its device credential (sign-out deletes it).
-- Check-in records the build the device runs.
CREATE TABLE acct_tokens (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid NOT NULL REFERENCES acct_accounts (id) ON DELETE CASCADE,
	token_hash text NOT NULL UNIQUE,
	prefix text NOT NULL,
	device_name text,
	device_id uuid,
	credential_hash text REFERENCES acct_device_credentials (secret_hash) ON DELETE CASCADE,
	platform text,
	app_version text,
	app_build integer,
	os_version text,
	checked_in_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	last_used_at timestamptz,
	revoked_at timestamptz
);
CREATE INDEX acct_tokens_account_idx ON acct_tokens (account_id);
CREATE INDEX acct_tokens_device_idx ON acct_tokens (device_id) WHERE device_id IS NOT NULL;

CREATE TABLE acct_grants (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid NOT NULL REFERENCES acct_accounts (id) ON DELETE CASCADE,
	plan_id text NOT NULL REFERENCES acct_plans (id),
	source text NOT NULL CHECK (source IN ('manual', 'promo', 'beta')),
	starts_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz,
	note text,
	created_by text,
	created_at timestamptz NOT NULL DEFAULT now(),
	revoked_at timestamptz
);
CREATE INDEX acct_grants_account_idx ON acct_grants (account_id);

CREATE TABLE acct_suspensions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid NOT NULL REFERENCES acct_accounts (id) ON DELETE CASCADE,
	reason text NOT NULL,
	starts_at timestamptz NOT NULL DEFAULT now(),
	ends_at timestamptz,
	created_by text,
	created_at timestamptz NOT NULL DEFAULT now(),
	lifted_at timestamptz
);
CREATE INDEX acct_suspensions_account_idx ON acct_suspensions (account_id);

-- One-time codes that bind a device to an account an admin created. Stored as a keyed hash.
CREATE TABLE acct_claim_codes (
	code_hash text PRIMARY KEY,
	account_id uuid NOT NULL REFERENCES acct_accounts (id) ON DELETE CASCADE,
	expires_at timestamptz NOT NULL,
	created_by text,
	created_at timestamptz NOT NULL DEFAULT now(),
	redeemed_at timestamptz
);
CREATE INDEX acct_claim_codes_account_idx ON acct_claim_codes (account_id);

-- The account timeline and audit log. No foreign key: a deleted account keeps its tombstone row.
CREATE TABLE acct_events (
	id bigserial PRIMARY KEY,
	account_id uuid NOT NULL,
	kind text NOT NULL,
	actor text NOT NULL, -- 'device', 'apple', 'system' or 'admin:<host user id>'
	data jsonb NOT NULL DEFAULT '{}',
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acct_events_account_idx ON acct_events (account_id, id DESC);

-- App Store Server Notifications V2, recorded once per notificationUUID (the host's endpoint verifies and hands them
-- to the library).
CREATE TABLE acct_store_notifications (
	notification_uuid uuid PRIMARY KEY,
	notification_type text NOT NULL,
	subtype text,
	bundle_id text,
	original_transaction_id text,
	environment text,
	signed_date timestamptz NOT NULL,
	received_at timestamptz NOT NULL DEFAULT now(),
	processed_at timestamptz,
	account_id uuid REFERENCES acct_accounts (id) ON DELETE SET NULL,
	error text
);
CREATE INDEX acct_store_notifications_otid_idx ON acct_store_notifications (original_transaction_id);
