import type { AcctDb } from '../db/tables.js'

/** How someone signed in, and what the method told us about them. */
export interface SignInProfile {
	method: 'apple' | 'password' | 'game_center' | (string & {})
	/** The name Apple gives on first sign-in, or the Game Center display name. */
	name?: string
	email?: string
	/**
	 * For `password` sign-ins only: the password just checked, for a host that must use it once (PZLServer asks
	 * PuzzleAnywhere whether the same pair is a legacy account). Never store or log it.
	 */
	password?: string
	isNew: boolean
}

/**
 * Where the host keeps its own per-account data (PZLServer's `users` profile). Each runs inside the library's
 * transaction (the host's own, with `transaction`), so a failure rolls the whole change back. `host` is what the host's
 * `transaction` handed over, or undefined.
 */
export interface AcctHooks {
	/** A new account exists: create the host's row for it (its id is `acct_accounts.id`). */
	accountCreated?: (db: AcctDb, accountId: string, host: unknown) => Promise<void>
	/**
	 * An anonymous account is being folded into `intoId`: move the host's data across. The library then moves its
	 * own records and deletes `fromId` (cascading to host rows that reference it).
	 */
	mergeAccounts?: (db: AcctDb, fromId: string, intoId: string, host: unknown) => Promise<void>
	/** Someone signed in to `accountId` with a sign-in method (a nickname from the name, a last-signed-in time). */
	signedIn?: (db: AcctDb, accountId: string, profile: SignInProfile, host: unknown) => Promise<void>
	/** The account's password was reset with an emailed code; the library revoked its device tokens (PZLServer revokes its API tokens too). */
	passwordReset?: (db: AcctDb, accountId: string, host: unknown) => Promise<void>
	/** An account is about to be deleted (by its owner or an admin); throw to refuse (PZLServer keeps admins). */
	accountDeleting?: (db: AcctDb, accountId: string, host: unknown) => Promise<void>
}
