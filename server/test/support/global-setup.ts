import { sql } from 'kysely'
import { migrateAccounts } from '../../src/db/migrate.js'
import { createDb } from './db.js'
import { ANNUAL, LIFETIME, MONTHLY } from './storekit.js'

/** Recreates the schema once per run and seeds the `pro` plan with a subscription pair and a one-time unlock. */
export default async function setup() {
	const db = createDb(1)
	await sql`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`.execute(db)
	await migrateAccounts(db)
	await db
		.insertInto('acct_plans')
		.values({
			id: 'pro',
			name: 'Pro',
			product_ids: [MONTHLY, ANNUAL, LIFETIME],
			limits: JSON.stringify({ things: 50 }),
		})
		.execute()
	await db.destroy()
}
