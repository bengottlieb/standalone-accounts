import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Kysely, sql } from 'kysely'

/** The library's SQL migrations (`server/migrations`), shipped with the package. */
export const ACCT_MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations')
const LOCK_ID = 7_314_777

/**
 * Applies the library's pending migrations in order, each in its own transaction, recording them in
 * `acct_schema_migrations` (its own ledger, separate from the host's). Run it at boot before any host migration that
 * references `acct_*` tables. Returns the versions applied.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any host database: the migrations are raw SQL
export async function migrateAccounts(db: Kysely<any>, dir = ACCT_MIGRATIONS_DIR): Promise<string[]> {
	const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()
	return db.connection().execute(async (conn) => {
		await sql`SELECT pg_advisory_lock(${LOCK_ID})`.execute(conn)
		try {
			await sql`CREATE TABLE IF NOT EXISTS acct_schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`.execute(
				conn,
			)
			const done = await sql<{ version: string }>`SELECT version FROM acct_schema_migrations`.execute(conn)
			const applied = new Set(done.rows.map((r) => r.version))
			const newlyApplied: string[] = []
			for (const file of files) {
				const version = file.replace(/\.sql$/, '')
				if (applied.has(version)) continue
				const body = await readFile(path.join(dir, file), 'utf8')
				await conn.transaction().execute(async (trx) => {
					await sql.raw(body).execute(trx)
					await sql`INSERT INTO acct_schema_migrations (version) VALUES (${version})`.execute(trx)
				})
				newlyApplied.push(version)
			}
			return newlyApplied
		} finally {
			await sql`SELECT pg_advisory_unlock(${LOCK_ID})`.execute(conn)
		}
	})
}
