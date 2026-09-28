-- Sign-in methods (docs/DESIGN.md "Sign-in"). Apple and Game Center are acct_links (kinds `apple`, `game_center`);
-- email and password live here. One email per account, one account per email.

CREATE TABLE acct_passwords (
	account_id uuid PRIMARY KEY REFERENCES acct_accounts (id) ON DELETE CASCADE,
	email text NOT NULL UNIQUE, -- lowercased and trimmed
	password_hash text NOT NULL, -- bcrypt
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

-- Emailed reset codes, stored as keyed hashes: one hour, one use; setting a password spends every open code.
CREATE TABLE acct_password_resets (
	code_hash text PRIMARY KEY,
	account_id uuid NOT NULL REFERENCES acct_accounts (id) ON DELETE CASCADE,
	expires_at timestamptz NOT NULL,
	used_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acct_password_resets_account_idx ON acct_password_resets (account_id);
