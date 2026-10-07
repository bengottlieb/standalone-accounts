import type { FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { storePassword } from '../src/core/passwords.js'
import { claimHostIdentity } from '../src/core/sign-in.js'
import { reset, testDb } from './support/db.js'
import { CONFIG, testHost } from './support/host.js'
import { identity } from './support/identity.js'
import { appleToken, gameCenterProof, recordingHooks, testSignIn } from './support/sign-in.js'
import { LIFETIME, signJws, transaction } from './support/storekit.js'

describe('sign-in methods', () => {
	const db = testDb()
	let app: FastifyInstance
	let mailbox: { email: string; code: string }[]
	let calls: string[]

	const host = async (creation: 'trigger' | 'first-launch' = 'first-launch') => {
		const s = testSignIn()
		const r = recordingHooks()
		mailbox = s.mailbox
		calls = r.calls
		app = await testHost(db, { config: { creation }, signIn: s.signIn, hooks: r.hooks })
	}
	beforeEach(async () => {
		await reset(db)
		await host()
	})

	const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
		app.inject({ method: 'POST', url, payload, headers })
	const apple = (id: object, sub: string, email?: string) =>
		post('/api/accounts/v1/auth/apple', { identity: id, identityToken: appleToken(sub, email), name: 'Ben' })
	const password = (path: string, id: object, email: string, pw: string) =>
		post(`/api/accounts/v1/auth/password/${path}`, { identity: id, email, password: pw })
	const launch = async (id: object) => (await post('/api/accounts/v1/auth/device', { identity: id })).json()
	const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

	it('attaches Apple to the device’s anonymous account, then finds it from another device', async () => {
		const phone = identity()
		const first = await launch(phone)
		const signedIn = (await apple(phone, 'apple-1', 'ben@icloud.com')).json()
		expect(signedIn).toMatchObject({
			isNew: false,
			account: { id: first.account.id, identities: [{ kind: 'apple', label: 'ben@icloud.com' }] },
		})
		expect(signedIn.merged).toBeUndefined()
		const tablet = (await apple(identity(), 'apple-1')).json()
		expect(tablet).toMatchObject({ account: { id: first.account.id } })
		expect(calls).toContain(`signed in ${first.account.id} with apple`)
	})

	// Apple sends the name only on the very first sign-in; the account keeps it so apps can show who's signed in.
	it('keeps the name Apple shared on the first sign-in, and later sign-ins without one leave it', async () => {
		const phone = identity()
		await launch(phone)
		const first = (await apple(phone, 'apple-2', 'b@privaterelay.appleid.com')).json()
		expect(first.account.identities).toEqual([{ kind: 'apple', label: 'b@privaterelay.appleid.com', name: 'Ben' }])
		const later = (
			await post('/api/accounts/v1/auth/apple', { identity: identity(), identityToken: appleToken('apple-2') })
		).json()
		expect(later.account.identities).toEqual([{ kind: 'apple', label: 'b@privaterelay.appleid.com', name: 'Ben' }])
	})

	it('folds a device’s anonymous account (and its purchase) into the account it signs in to', async () => {
		const owner = (await apple(identity(), 'apple-2')).json().account.id
		const phone = identity()
		const anonymous = (
			await post('/api/accounts/v1/auth/purchase', {
				identity: phone,
				signedTransactions: [
					signJws(
						transaction({
							type: 'Non-Consumable',
							productId: LIFETIME,
							expiresDate: undefined,
							originalTransactionId: 'bought-first',
						}),
					),
				],
			})
		).json()
		const res = (await apple(phone, 'apple-2')).json()
		expect(res).toMatchObject({
			merged: true,
			account: { id: owner, access: { status: 'active', source: 'purchase' } },
		})
		expect(calls).toContain(`merge ${anonymous.account.id} into ${owner}`)
		expect(await db.selectFrom('acct_accounts').select('id').where('id', '=', anonymous.account.id).execute()).toEqual(
			[],
		)
		expect((await app.inject({ url: '/api/accounts/v1/account', headers: bearer(anonymous.token) })).json().id).toBe(
			owner,
		)
	})

	it('refuses to sign a signed-in device into another account', async () => {
		await apple(identity(), 'apple-3')
		const phone = identity()
		await password('register', phone, 'ben@example.com', 'correct horse')
		expect((await apple(phone, 'apple-3')).json()).toMatchObject({ error: 'identity_in_use' })
	})

	it('creates an account on sign-in in a trigger app, telling the host', async () => {
		await host('trigger')
		const res = (await apple(identity(), 'apple-4')).json()
		expect(res).toMatchObject({ isNew: true, account: { access: { status: 'none' } } })
		expect(calls).toEqual([`created ${res.account.id}`, `signed in ${res.account.id} with apple (new)`])
	})

	it('registers, signs in, and refuses wrong passwords', async () => {
		const made = (await password('register', identity(), 'Ben@Example.com', 'correct horse')).json()
		expect(made.account.identities).toEqual([{ kind: 'password', label: 'ben@example.com' }])
		expect((await password('register', identity(), 'ben@example.com', 'correct horse')).json().account.id).toBe(
			made.account.id,
		)
		expect((await password('register', identity(), 'ben@example.com', 'wrong guess')).json()).toMatchObject({
			error: 'email_in_use',
		})
		expect((await password('signin', identity(), 'ben@example.com', 'wrong guess')).json()).toMatchObject({
			error: 'invalid_credentials',
		})
		expect((await password('signin', identity(), 'nobody@example.com', 'correct horse')).statusCode).toBe(401)
		expect((await password('signin', identity(), 'ben@example.com', 'correct horse')).json().account.id).toBe(
			made.account.id,
		)
	})

	it('checks a password’s length only when one is set, against the host’s minimum', async () => {
		const tooShort = { error: 'password_too_short', minLength: 8 }
		expect((await password('register', identity(), 'ben@example.com', 'abcd')).json()).toEqual(tooShort)
		// A short password from before the policy (or a host's import) still signs in, by either route.
		const made = (await password('register', identity(), 'ben@example.com', 'correct horse')).json()
		await storePassword(db, made.account.id, 'ben@example.com', 'abcd')
		expect((await password('signin', identity(), 'ben@example.com', 'abcd')).statusCode).toBe(200)
		expect((await password('register', identity(), 'ben@example.com', 'abcd')).statusCode).toBe(200)
		// Setting one, by reset or change, is checked; a refused reset leaves its code usable.
		await post('/api/accounts/v1/auth/password/forgot', { email: 'ben@example.com' })
		const resetTo = (pw: string) =>
			post('/api/accounts/v1/auth/password/reset', {
				identity: identity(),
				email: 'ben@example.com',
				code: mailbox[0]!.code,
				password: pw,
			})
		expect((await resetTo('abc')).json()).toEqual(tooShort)
		expect((await resetTo('new horse battery')).statusCode).toBe(200)
		const { token } = (await password('signin', identity(), 'ben@example.com', 'new horse battery')).json()
		const set = await post(
			'/api/accounts/v1/account/password',
			{ email: 'ben@example.com', password: 'abc', currentPassword: 'new horse battery' },
			bearer(token),
		)
		expect(set.json()).toEqual(tooShort)

		// A host can lower the minimum.
		const s = testSignIn()
		app = await testHost(db, { signIn: { ...s.signIn, password: { ...s.signIn.password!, minLength: 4 } } })
		expect((await password('register', identity(), 'short@example.com', 'abcd')).statusCode).toBe(200)
		expect((await password('register', identity(), 'shorter@example.com', 'abc')).json()).toEqual({
			error: 'password_too_short',
			minLength: 4,
		})
	})

	it('resets a forgotten password with a one-time code, signing every other device out', async () => {
		const made = (await password('register', identity(), 'ben@example.com', 'correct horse')).json()
		expect((await post('/api/accounts/v1/auth/password/forgot', { email: 'nobody@example.com' })).json()).toEqual({
			ok: true,
		})
		await post('/api/accounts/v1/auth/password/forgot', { email: 'BEN@example.com' })
		expect(mailbox).toEqual([{ email: 'ben@example.com', code: expect.stringMatching(/^\d{6}$/) }])
		const resetBody = (code: string) => ({
			identity: identity(),
			email: 'ben@example.com',
			code,
			password: 'new horse battery',
		})
		expect((await post('/api/accounts/v1/auth/password/reset', resetBody('000000'))).json()).toMatchObject({
			error: 'code_expired',
		})
		const reset = (await post('/api/accounts/v1/auth/password/reset', resetBody(mailbox[0]!.code))).json()
		expect(reset.account.id).toBe(made.account.id)
		expect((await post('/api/accounts/v1/auth/password/reset', resetBody(mailbox[0]!.code))).statusCode).toBe(410)
		expect((await app.inject({ url: '/api/accounts/v1/account', headers: bearer(made.token) })).statusCode).toBe(401)
		expect((await password('signin', identity(), 'ben@example.com', 'new horse battery')).statusCode).toBe(200)
	})

	it('signs in with Game Center, and rejects a forged or stale proof', async () => {
		const res = await post('/api/accounts/v1/auth/game-center', {
			identity: identity(),
			...gameCenterProof('T:_player'),
			displayName: 'Ben',
		})
		expect(res.json()).toMatchObject({ account: { identities: [{ kind: 'game_center', label: 'Ben' }] } })
		const forged = { ...gameCenterProof('T:_player'), teamPlayerID: 'T:_someone' }
		expect((await post('/api/accounts/v1/auth/game-center', { identity: identity(), ...forged })).json()).toMatchObject(
			{ error: 'invalid_credentials' },
		)
		const stale = gameCenterProof('T:_player', { timestamp: Date.now() - 2 * 3_600_000 })
		expect((await post('/api/accounts/v1/auth/game-center', { identity: identity(), ...stale })).statusCode).toBe(401)
	})

	it('adds and changes a password on the signed-in account, and unlinks methods', async () => {
		const { token } = (await apple(identity(), 'apple-5')).json()
		const set = (body: object) => post('/api/accounts/v1/account/password', body, bearer(token))
		expect((await set({ email: 'ben@example.com', password: 'correct horse' })).json()).toEqual({ ok: true })
		expect((await set({ email: 'ben@example.com', password: 'another one' })).json()).toMatchObject({
			error: 'invalid_credentials',
		})
		expect(
			(await set({ email: 'ben@example.com', password: 'another one', currentPassword: 'correct horse' })).json(),
		).toEqual({ ok: true })
		await password('register', identity(), 'taken@example.com', 'correct horse')
		expect(
			(await set({ email: 'taken@example.com', password: 'x'.repeat(8), currentPassword: 'another one' })).json(),
		).toMatchObject({ error: 'email_in_use' })
		const after = (await post('/api/accounts/v1/account/unlink', { kind: 'apple' }, bearer(token))).json()
		expect(after.identities).toEqual([{ kind: 'password', label: 'ben@example.com' }])
	})

	it('deletes an anonymous account on sign-out in a first-launch app, keeps a signed-in one', async () => {
		const anonymous = await launch(identity())
		await post('/api/accounts/v1/account/signout', {}, bearer(anonymous.token))
		expect(await db.selectFrom('acct_accounts').select('id').where('id', '=', anonymous.account.id).execute()).toEqual(
			[],
		)
		const signedIn = (await apple(identity(), 'apple-6')).json()
		await post('/api/accounts/v1/account/signout', {}, bearer(signedIn.token))
		expect(
			await db.selectFrom('acct_accounts').select('id').where('id', '=', signedIn.account.id).execute(),
		).toHaveLength(1)
	})

	it('answers 404 signin_unavailable for methods the server doesn’t offer', async () => {
		app = await testHost(db)
		expect((await apple(identity(), 'x')).json()).toMatchObject({ error: 'signin_unavailable' })
		expect((await post('/api/accounts/v1/auth/password/forgot', { email: 'a@b.co' })).statusCode).toBe(404)
	})

	it('claims a host-verified identity under the same rules', async () => {
		const ctx = { db, config: CONFIG, kinds: ['apple', 'game_center', 'pa'] }
		const owner = (await apple(identity(), 'apple-7')).json().account.id
		expect(await db.transaction().execute((trx) => claimHostIdentity({ ...ctx, db: trx }, owner, 'pa', 'ben'))).toEqual(
			{ accountId: owner, merged: false },
		)
		const anonymous = (await launch(identity())).account.id
		expect(
			await db.transaction().execute((trx) => claimHostIdentity({ ...ctx, db: trx }, anonymous, 'pa', 'ben')),
		).toEqual({ accountId: owner, merged: true })
		const other = (await apple(identity(), 'apple-8')).json().account.id
		await expect(
			db.transaction().execute((trx) => claimHostIdentity({ ...ctx, db: trx }, other, 'pa', 'ben')),
		).rejects.toMatchObject({ statusCode: 409 })
	})

	it('runs hooks inside the host’s own transaction when it supplies one', async () => {
		const seen: unknown[] = []
		app = await testHost(db, {
			config: { creation: 'first-launch' },
			signIn: testSignIn().signIn,
			transaction: (fn) => db.transaction().execute((trx) => fn(trx, 'host-handle')),
			hooks: {
				accountCreated: async (_db, _id, host) => void seen.push(host),
				signedIn: async (_db, _id, _profile, host) => void seen.push(host),
			},
		})
		await apple(identity(), 'apple-host')
		expect(seen).toEqual(['host-handle', 'host-handle'])
	})

	it('throttles wrong passwords per caller and email', async () => {
		await password('register', identity(), 'guard@example.com', 'correct horse')
		for (let i = 0; i < 5; i++)
			expect((await password('signin', identity(), 'guard@example.com', 'wrong guess')).statusCode).toBe(401)
		const blocked = await password('signin', identity(), 'guard@example.com', 'correct horse')
		expect(blocked.statusCode).toBe(429)
		expect(blocked.json()).toMatchObject({ error: 'rate_limited' })
		expect((await password('signin', identity(), 'other@example.com', 'wrong guess')).statusCode).toBe(401)
	})

	it('tells the host about a password set on an account, a reset, and never takes a Game Center name for an email', async () => {
		const profiles: { email?: string; name?: string; password?: string; method: string }[] = []
		const resets: string[] = []
		const s = testSignIn()
		mailbox = s.mailbox
		app = await testHost(db, {
			config: { creation: 'first-launch' },
			signIn: s.signIn,
			hooks: {
				signedIn: async (_db, _id, profile) => void profiles.push(profile),
				passwordReset: async (_db, id) => void resets.push(id),
			},
		})
		const gc = (
			await post('/api/accounts/v1/auth/game-center', {
				identity: identity(),
				...gameCenterProof('T:_named'),
				displayName: 'Ben',
			})
		).json()
		expect(profiles.at(-1)).toMatchObject({ method: 'game_center', name: 'Ben' })
		expect(profiles.at(-1)?.email).toBeUndefined()
		await post(
			'/api/accounts/v1/account/password',
			{ email: 'Set@Example.com', password: 'correct horse' },
			bearer(gc.token),
		)
		expect(profiles.at(-1)).toMatchObject({ method: 'password', email: 'set@example.com', password: 'correct horse' })
		await post('/api/accounts/v1/auth/password/forgot', { email: 'set@example.com' })
		await post('/api/accounts/v1/auth/password/reset', {
			identity: identity(),
			email: 'set@example.com',
			code: mailbox[0]!.code,
			password: 'new horse battery',
		})
		expect(resets).toEqual([gc.account.id])
	})
})
