import type { FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { reset, testDb } from './support/db.js'
import { testHost } from './support/host.js'
import { appTransactionJWS, identity } from './support/identity.js'
import { appleToken, recordingHooks, testSignIn } from './support/sign-in.js'

// A device that lost its session (a reinstall, a host migration) lands on a fresh anonymous account while its app
// transaction still names the account it came from. A sign-in method nobody owns yet belongs on that account.
describe('signing in from an anonymous account whose app transaction belongs to another', () => {
	const db = testDb()
	let app: FastifyInstance
	beforeEach(async () => {
		await reset(db)
		app = await testHost(db, { config: { creation: 'first-launch' }, signIn: testSignIn().signIn, hooks: recordingHooks().hooks })
	})

	const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload })
	const apple = (id: object, sub: string) =>
		post('/api/accounts/v1/auth/apple', { identity: id, identityToken: appleToken(sub), name: 'Ben' })
	const launch = async (id: object) => (await post('/api/accounts/v1/auth/device', { identity: id })).json()
	const withApp = (o: Record<string, unknown> = {}) => identity({ appTransactionJWS: appTransactionJWS('apptx-ben'), ...o })

	/** The original account: email and password, owning the app transaction; then a device that lost its session. */
	const original = async () => {
		const res = await post('/api/accounts/v1/auth/password/register', { identity: withApp(), email: 'ben@example.com', password: 'horse battery' })
		const phone = withApp({ includeLinks: false })
		const anonymous = (await launch(phone)).account.id
		return { owner: res.json().account.id as string, anonymous, secret: phone.deviceSecret as string }
	}

	it('attaches the new method to the app transaction’s account and folds the anonymous one in', async () => {
		const { owner, anonymous, secret } = await original()
		expect(anonymous).not.toBe(owner)
		const res = (await apple(withApp({ deviceSecret: secret }), 'apple-ben')).json()
		expect(res).toMatchObject({ merged: true, account: { id: owner, identities: expect.arrayContaining([expect.objectContaining({ kind: 'apple' })]) } })
		expect(await db.selectFrom('acct_accounts').select('id').where('id', '=', anonymous).execute()).toEqual([])
		expect((await apple(identity(), 'apple-ben')).json().account.id).toBe(owner)
	})

	it('leaves the method on the anonymous account when the owner already has one of that kind', async () => {
		const { owner, anonymous, secret } = await original()
		await apple(withApp(), 'apple-first')
		const res = (await apple(withApp({ deviceSecret: secret }), 'apple-second')).json()
		expect(res.account.id).toBe(anonymous)
		expect(res.account.id).not.toBe(owner)
	})

	it('ignores the app transaction the device withholds', async () => {
		const { anonymous, secret } = await original()
		const res = (await apple(withApp({ deviceSecret: secret, includeLinks: false }), 'apple-ben')).json()
		expect(res.account.id).toBe(anonymous)
	})
})
