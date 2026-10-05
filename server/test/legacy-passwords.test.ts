import { beforeEach, describe, expect, it } from 'vitest'
import { createAccount } from '../src/core/accounts.js'
import { checkEmailPassword, passwordAccount } from '../src/core/passwords.js'
import { reset, testDb } from './support/db.js'
import { CONFIG, testHost } from './support/host.js'
import { identity } from './support/identity.js'
import { testSignIn } from './support/sign-in.js'

/** A stand-in for a host's old hash format: `legacy:<password>`. */
const LEGACY = 'legacy:open sesame'
const legacyCheck = async (hash: string, password: string) => hash === `legacy:${password}`

// A host that moves its own users onto these accounts imports their old hashes; each moves to bcrypt when next used.
describe('imported password hashes', () => {
	const db = testDb()
	let accountId: string

	beforeEach(async () => {
		await reset(db)
		accountId = (await createAccount(db, CONFIG, 'system', 'import')).id
		await db
			.insertInto('acct_passwords')
			.values({ account_id: accountId, email: 'ann@example.com', password_hash: LEGACY })
			.execute()
	})
	const hash = async () => (await passwordAccount(db, 'ann@example.com'))!.password_hash

	it('signs a host in with a legacy hash through its check, re-saving it as bcrypt', async () => {
		expect(await checkEmailPassword(db, 'ann@example.com', 'open sesame')).toBeNull()
		expect(await checkEmailPassword(db, 'ann@example.com', 'wrong', legacyCheck)).toBeNull()
		expect(await hash()).toBe(LEGACY)
		expect(await checkEmailPassword(db, ' Ann@Example.com ', 'open sesame', legacyCheck)).toBe(accountId)
		expect(await hash()).toMatch(/^\$2[aby]\$/)
		// Once re-saved, no legacy check is needed.
		expect(await checkEmailPassword(db, 'ann@example.com', 'open sesame')).toBe(accountId)
	})

	it('signs a device in with a legacy hash when the host passes its check', async () => {
		const s = testSignIn()
		const app = await testHost(db, {
			signIn: { ...s.signIn, password: { ...s.signIn.password!, verifyLegacy: legacyCheck } },
		})
		const signIn = (password: string) =>
			app.inject({
				method: 'POST',
				url: '/api/accounts/v1/auth/password/signin',
				payload: { identity: identity(), email: 'ann@example.com', password },
			})
		expect((await signIn('wrong')).statusCode).toBe(401)
		const res = await signIn('open sesame')
		expect(res.statusCode).toBe(200)
		expect(res.json().account.id).toBe(accountId)
		expect(await hash()).toMatch(/^\$2[aby]\$/)
	})
})
