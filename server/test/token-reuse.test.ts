import type { FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { reset, testDb } from './support/db.js'
import { testHost } from './support/host.js'
import { appTransactionJWS, identity } from './support/identity.js'
import { appleToken, gameCenterProof, testSignIn } from './support/sign-in.js'
import { signJws, transaction } from './support/storekit.js'

// The `/auth/*` calls answer with the caller's current token, rather than minting another, while it is still this
// device's and the account's; sign-out takes every token of the device with it.
describe('token reuse and sign-out', () => {
	const db = testDb()
	let app: FastifyInstance
	let mailbox: { email: string; code: string }[]

	beforeEach(async () => {
		await reset(db)
		const signIn = testSignIn()
		mailbox = signIn.mailbox
		app = await testHost(db, { config: { creation: 'first-launch' }, signIn: signIn.signIn })
	})

	const post = (url: string, payload: object, token?: string) =>
		app.inject({ method: 'POST', url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} })
	const device = async (id: object, token?: string) =>
		(await post('/api/accounts/v1/auth/device', { identity: id }, token)).json()
	const buy = async (id: object, token?: string) =>
		(
			await post(
				'/api/accounts/v1/auth/purchase',
				{ identity: id, signedTransactions: [signJws(transaction({ originalTransactionId: 'otid-1' }))] },
				token,
			)
		).json()
	const gameCenter = async (id: object, player: string, token?: string) =>
		(await post('/api/accounts/v1/auth/game-center', { identity: id, ...gameCenterProof(player) }, token)).json()
	const apple = async (id: object, sub: string, token?: string) =>
		(await post('/api/accounts/v1/auth/apple', { identity: id, identityToken: appleToken(sub) }, token)).json()
	const tokenCount = async () =>
		Number(
			(
				await db
					.selectFrom('acct_tokens')
					.select((eb) => eb.fn.countAll().as('n'))
					.executeTakeFirstOrThrow()
			).n,
		)
	const accountOf = async (token: string) =>
		app.inject({ url: '/api/accounts/v1/account', headers: { authorization: `Bearer ${token}` } })

	it('answers auth/device, auth/purchase and auth/game-center with the token the device presents', async () => {
		const phone = identity()
		const first = await device(phone)
		const count = await tokenCount()

		const again = await device(phone, first.token)
		const bought = await buy(phone, first.token)
		const played = await gameCenter(phone, 'T:_player', first.token)
		for (const answer of [again, bought, played])
			expect(answer).toMatchObject({ token: first.token, account: { id: first.account.id } })
		expect(await tokenCount()).toBe(count)
	})

	it('issues a new token, as before, when no bearer comes', async () => {
		const phone = identity()
		const first = await device(phone)
		const bought = await buy(phone)
		expect(bought.account.id).toBe(first.account.id)
		expect(bought.token).not.toBe(first.token)
		expect(await tokenCount()).toBe(2)
	})

	it('ignores a bearer of another device: a new token for the caller, and the other device keeps its own', async () => {
		const shared = appTransactionJWS('apptx-1')
		const phone = identity({ appTransactionJWS: shared })
		const tablet = identity({ appTransactionJWS: shared })
		const mine = await device(phone)
		const theirs = await device(identity())
		const tablets = await device(tablet)
		expect(tablets.account.id).toBe(mine.account.id)

		// Same account, another device's credential.
		const reply = await device(phone, tablets.token)
		expect(reply.token).not.toBe(tablets.token)
		expect(reply.account.id).toBe(mine.account.id)
		// Another account altogether: no way into it.
		const other = await buy(phone, theirs.token)
		expect(other.token).not.toBe(theirs.token)
		expect(other.account.id).toBe(mine.account.id)
		expect((await accountOf(theirs.token)).json().id).toBe(theirs.account.id)
		expect((await accountOf(tablets.token)).json().id).toBe(mine.account.id)
	})

	it('issues a new token for a stale bearer rather than refusing the call', async () => {
		const phone = identity({ appTransactionJWS: appTransactionJWS('apptx-2') })
		const first = await buy(phone)
		await post('/api/accounts/v1/account/signout', {}, first.token)
		const back = await post('/api/accounts/v1/auth/device', { identity: phone }, first.token)
		expect(back.statusCode).toBe(200)
		expect(back.json().token).not.toBe(first.token)
	})

	it('keeps the token through a merge, which moves it to the account signed in to', async () => {
		const owner = await apple(identity(), 'sub-1')
		const phone = identity()
		const anonymous = await device(phone)
		const count = await tokenCount()

		const signedIn = await apple(phone, 'sub-1', anonymous.token)
		expect(signedIn).toMatchObject({ merged: true, token: anonymous.token, account: { id: owner.account.id } })
		expect(await tokenCount()).toBe(count)
		expect((await accountOf(anonymous.token)).json().id).toBe(owner.account.id)
	})

	it('issues a fresh token on a password reset, which revokes the presented one', async () => {
		const phone = identity()
		const registered = (
			await post('/api/accounts/v1/auth/password/register', {
				identity: phone,
				email: 'a@example.com',
				password: 'correct horse',
			})
		).json()
		await post('/api/accounts/v1/auth/password/forgot', { email: 'a@example.com' })
		const reset = await post(
			'/api/accounts/v1/auth/password/reset',
			{ identity: phone, email: 'a@example.com', code: mailbox[0]!.code, password: 'battery staple' },
			registered.token,
		)
		expect(reset.statusCode).toBe(200)
		expect(reset.json().token).not.toBe(registered.token)
		expect((await accountOf(registered.token)).statusCode).toBe(401)
	})

	it('signs out every token of the device and none of another device’s', async () => {
		app = await testHost(db)
		const shared = appTransactionJWS('apptx-3')
		const phone = identity({ appTransactionJWS: shared })
		const first = await buy(phone)
		const second = await device(phone)
		const tablet = await device(identity({ appTransactionJWS: shared }))
		expect(second.token).not.toBe(first.token)
		expect(tablet.account.id).toBe(first.account.id)

		expect((await post('/api/accounts/v1/account/signout', {}, first.token)).json()).toEqual({ ok: true })
		expect((await accountOf(first.token)).statusCode).toBe(401)
		expect((await accountOf(second.token)).statusCode).toBe(401)
		expect((await accountOf(tablet.token)).json().id).toBe(first.account.id)
	})
})
