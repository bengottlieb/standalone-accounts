import type { FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { reset, testDb } from './support/db.js'
import { ADMIN, testHost } from './support/host.js'
import { appTransactionJWS, identity } from './support/identity.js'
import { signJws, transaction } from './support/storekit.js'

describe('device sign-in, claim codes, sign-out, deletion and check-in', () => {
	const db = testDb()
	let app: FastifyInstance

	beforeEach(async () => {
		await reset(db)
		app = await testHost(db)
	})

	const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
		app.inject({ method: 'POST', url, payload, headers })
	const device = (id: object) => post('/api/accounts/v1/auth/device', { identity: id })
	const buy = (id: object, otid = 'otid-1') =>
		post('/api/accounts/v1/auth/purchase', {
			identity: id,
			signedTransactions: [signJws(transaction({ originalTransactionId: otid }))],
		})
	const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
	const claimCode = async (payload: object = {}) => (await post('/api/v1/admin/accounts', payload, ADMIN)).json()

	it('answers { account: null } for an unknown device, and finds it again after a purchase', async () => {
		const phone = identity()
		expect((await device(phone)).json()).toEqual({ account: null })
		const bought = (await buy(phone)).json()
		expect((await device(phone)).json()).toMatchObject({ isNew: false, account: { id: bought.account.id } })
	})

	it('finds the account by a verified app transaction, never by a forged one or an iCloud id', async () => {
		const bought = (await buy(identity({ appTransactionJWS: appTransactionJWS('apptx-42') }))).json()
		expect((await device(identity({ appTransactionJWS: appTransactionJWS('apptx-42') }))).json().account.id).toBe(
			bought.account.id,
		)
		const [header, , signature] = appTransactionJWS('apptx-other').split('.')
		const forged = `${header}.${Buffer.from(JSON.stringify({ receiptType: 'Sandbox', appTransactionId: 'apptx-42' })).toString('base64url')}.${signature}`
		expect((await device(identity({ appTransactionJWS: forged }))).json()).toEqual({ account: null })
		expect((await device(identity({ icloudUserID: '_icloud' }))).json()).toEqual({ account: null })
	})

	it('creates an account on first launch when configured to', async () => {
		app = await testHost(db, { config: { creation: 'first-launch' } })
		const phone = identity()
		const first = (await device(phone)).json()
		expect(first).toMatchObject({ isNew: true, account: { access: { status: 'none', active: false } } })
		expect((await device(phone)).json()).toMatchObject({ isNew: false, account: { id: first.account.id } })
	})

	it('signs out: the token dies, the secret unbinds, and includeLinks: false keeps the app transaction from rejoining', async () => {
		const phone = identity({ appTransactionJWS: appTransactionJWS('apptx-7') })
		const { token } = (await buy(phone)).json()
		expect((await post('/api/accounts/v1/account/signout', {}, bearer(token))).json()).toEqual({ ok: true })
		expect((await app.inject({ url: '/api/accounts/v1/account', headers: bearer(token) })).statusCode).toBe(401)
		expect((await device({ ...phone, includeLinks: false })).json()).toEqual({ account: null })
		expect((await device(phone)).json().account).not.toBeNull()
	})

	it('binds a device with a claim code, once, to an admin-made account with a grant', async () => {
		const made = await claimCode({ grant: { plan: 'pro', expiresAt: '2099-01-01T00:00:00Z' } })
		expect(made.claim).toMatchObject({
			code: expect.stringMatching(/^TS-/),
			link: `testapp://claim?code=${made.claim.code}`,
		})
		const res = await post('/api/accounts/v1/auth/claim', {
			identity: identity(),
			code: made.claim.code.toLowerCase().replaceAll('-', ' '),
		})
		expect(res.json()).toMatchObject({ account: { id: made.id, access: { status: 'granted', source: 'grant' } } })
		expect((await post('/api/accounts/v1/auth/claim', { identity: identity(), code: made.claim.code })).json()).toEqual(
			{ error: 'code_expired' },
		)
		expect((await post('/api/accounts/v1/auth/claim', { identity: identity(), code: 'TS-XXXX-XXXX' })).json()).toEqual({
			error: 'code_not_found',
		})
	})

	it('refuses a claim from a device that already has an account, without using up the code', async () => {
		const phone = identity()
		await buy(phone)
		const made = await claimCode()
		expect((await post('/api/accounts/v1/auth/claim', { identity: phone, code: made.claim.code })).json()).toEqual({
			error: 'identity_in_use',
		})
		expect(
			(await post('/api/accounts/v1/auth/claim', { identity: identity(), code: made.claim.code })).statusCode,
		).toBe(200)
	})

	it('deletes an account: everything goes, its purchase becomes unclaimed, a tombstone stays', async () => {
		const phone = identity()
		const { token, account } = (await buy(phone)).json()
		const res = await app.inject({ method: 'DELETE', url: '/api/accounts/v1/account', headers: bearer(token) })
		expect(res.json()).toEqual({ ok: true })
		for (const table of ['acct_accounts', 'acct_device_credentials', 'acct_tokens'] as const)
			expect(await db.selectFrom(table).selectAll().execute(), table).toEqual([])
		expect(await db.selectFrom('acct_purchases').select('account_id').execute()).toEqual([{ account_id: null }])
		expect(await db.selectFrom('acct_events').select(['kind', 'data']).execute()).toEqual([
			{ kind: 'deleted', data: {} },
		])
		expect((await buy(phone)).json()).toMatchObject({ isNew: true })
	})

	it('checks in: required, recommended or none, recording the build on the device’s token', async () => {
		app = await testHost(db, {
			checkIn: {
				builds: (bundle) =>
					bundle === 'com.example.app' ? { minimum: 43, recommended: 45, message: 'Update.' } : null,
			},
		})
		const checkIn = (build: number, headers: Record<string, string> = {}, bundle = 'com.example.app') =>
			post(
				'/api/accounts/v1/check-in',
				{ bundle, version: '1.0', build, platform: 'ios', protocolVersion: 'v1' },
				headers,
			)
		expect((await checkIn(42)).json()).toMatchObject({
			update: 'required',
			minimumBuild: 43,
			message: 'Update.',
			protocolVersions: ['v1'],
		})
		expect((await checkIn(44)).json()).toMatchObject({ update: 'recommended', recommendedBuild: 45 })
		expect((await checkIn(1, {}, 'com.example.other')).json()).toMatchObject({ update: 'none', minimumBuild: null })
		const { token } = (await buy(identity())).json()
		await checkIn(45, bearer(token))
		expect(await db.selectFrom('acct_tokens').select(['app_build', 'platform']).executeTakeFirstOrThrow()).toEqual({
			app_build: 45,
			platform: 'ios',
		})
		expect((await checkIn(45, bearer('tst_revoked'))).statusCode).toBe(200)
	})
})
