import type { AcctDb } from '../db/tables.js'

/**
 * Runs `fn` in a transaction the host opens, so the host's own writes in hooks share it. `trx` is the library's
 * handle on that transaction; `host` is whatever the host wants its hooks to get back (PZLServer: a Drizzle handle
 * on the same connection). Without it the library opens its own Kysely transaction and hooks get `undefined`.
 */
export type HostTransaction = <T>(fn: (trx: AcctDb, host: unknown) => Promise<T>) => Promise<T>

export function transactor(db: AcctDb, host?: HostTransaction) {
	return <T>(fn: (trx: AcctDb, host: unknown) => Promise<T>): Promise<T> =>
		host ? host(fn) : db.transaction().execute((trx) => fn(trx, undefined))
}
