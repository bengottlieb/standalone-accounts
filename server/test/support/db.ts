import { Kysely, PostgresDialect, sql } from 'kysely'
import pg from 'pg'
import { afterAll } from 'vitest'
import type { AcctDb, AcctTables } from '../../src/db/tables.js'

pg.types.setTypeParser(20, (v) => Number(v))

export const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ?? 'postgres://appoutlet:appoutlet@localhost:5470/accounts_test'

export function createDb(max = 4): AcctDb {
	return new Kysely<AcctTables>({
		dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: TEST_DATABASE_URL, max }) }),
	})
}

/** A database handle closed after the file. */
export function testDb(): AcctDb {
	const db = createDb()
	afterAll(() => db.destroy())
	return db
}

/** Empties every account table but the plans. */
export async function reset(db: AcctDb) {
	await sql`TRUNCATE acct_accounts, acct_purchases, acct_events, acct_store_notifications RESTART IDENTITY CASCADE`.execute(
		db,
	)
}
