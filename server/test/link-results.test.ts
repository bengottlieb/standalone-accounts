import type { FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { v1 } from '../src/index.js'
import { reset, testDb } from './support/db.js'
import { ADMIN, testHost } from './support/host.js'
import { appTransactionJWS, identity } from './support/identity.js'
import { appleToken, testSignIn } from './support/sign-in.js'
import { signJws, transaction } from './support/storekit.js'

// A client can't otherwise tell whether the app transaction it sent landed: the server drops one that doesn't verify,
// and leaves one another account owns where it is. The summary lists the kinds of link the account holds, and every
// auth reply says what became of each link the device sent (0.6.0).
describe('link visibility', () => {
	const db = testDb()
	let app: FastifyInstance

	beforeEach(async () => {
		await reset(db)
		app = await testHost(db, { config: { creation: 'first-launch' }, signIn: testSignIn().signIn })
	})

	const post = (url: string, payload: object, token?: string) =>
		app.inject({ method: 'POST', url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} })
	const device = async (id: object, token?: string) => {
		const body = (await post('/api/accounts/v1/auth/device', { identity: id }, token)).json()
		v1.DeviceAuthResponse.parse(body)
		return body
	}
	const summary = async (token: string) => {
		const body = (
			await app.inject({ url: '/api/accounts/v1/account', headers: { authorization: `Bearer ${token}` } })
		).json()
		v1.AccountSummary.parse(body)
		return body
	}
	const withApp = (appTransactionId: string, o: Record<string, unknown> = {}) =>
		identity({ appTransactionJWS: appTransactionJWS(appTransactionId), ...o })
	const forged = (appTransactionId: string) => {
		const [header, , signature] = appTransactionJWS('apptx-other').split('.')
		const payload = Buffer.from(JSON.stringify({ receiptType: 'Sandbox', appTransactionId })).toString('base64url')
		return `${header}.${payload}.${signature}`
	}

	it('lists the kinds of verified link an account holds, never their values or the iCloud hint', async () => {
		const bare = await device(identity({ icloudUserID: '_icloud-hint' }))
		expect(bare.account.links).toEqual([])
		expect((await summary(bare.token)).links).toEqual([])

		const linked = await device(withApp('apptx-1', { icloudUserID: '_icloud-hint' }))
		expect(linked.account.links).toEqual([{ kind: 'app_transaction' }])
		const read = await summary(linked.token)
		expect(read.links).toEqual([{ kind: 'app_transaction' }])
		expect(JSON.stringify(read)).not.toMatch(/apptx-1|_icloud-hint/)

		const apple = (
			await post('/api/accounts/v1/auth/apple', { identity: withApp('apptx-1'), identityToken: appleToken('sub-1') })
		).json()
		expect(apple.account.links).toEqual([{ kind: 'app_transaction' }, { kind: 'apple' }])
	})

	it('says a fresh link was bound and a re-sent one already was, on the same account and token', async () => {
		const phone = withApp('apptx-1')
		const first = await device(phone)
		expect(first).toMatchObject({ isNew: true, linkResults: { app_transaction: 'bound' } })
		const again = await device(phone, first.token)
		expect(again).toMatchObject({
			isNew: false,
			token: first.token,
			account: { id: first.account.id },
			linkResults: { app_transaction: 'already_bound' },
		})
	})

	it('binds a link a later launch sends to the account created without it (a missed first-launch deadline)', async () => {
		const secret = identity().deviceSecret
		const first = await device(identity({ deviceSecret: secret }))
		expect(first.linkResults).toBeUndefined()
		const later = await device(withApp('apptx-late', { deviceSecret: secret }), first.token)
		expect(later).toMatchObject({
			account: { id: first.account.id, links: [{ kind: 'app_transaction' }] },
			token: first.token,
			linkResults: { app_transaction: 'bound' },
		})
	})

	it('reports a link another account owns, leaving it there and logging the conflict', async () => {
		const owner = await device(withApp('apptx-1'))
		const secret = identity().deviceSecret
		const other = await device(identity({ deviceSecret: secret }))
		const res = await device(withApp('apptx-1', { deviceSecret: secret }), other.token)
		expect(res).toMatchObject({
			account: { id: other.account.id, links: [] },
			linkResults: { app_transaction: 'owned_by_other_account' },
		})
		expect((await summary(owner.token)).links).toEqual([{ kind: 'app_transaction' }])
		const conflict = await db
			.selectFrom('acct_events')
			.select(['account_id', 'data'])
			.where('kind', '=', 'link_conflict')
			.executeTakeFirstOrThrow()
		expect(conflict).toEqual({
			account_id: other.account.id,
			data: { kind: 'app_transaction', ownedBy: owner.account.id },
		})
	})

	it('reports an app transaction that does not verify as rejected, forged or from another chain', async () => {
		const res = await device(identity({ appTransactionJWS: forged('apptx-1') }))
		expect(res).toMatchObject({ isNew: true, account: { links: [] }, linkResults: { app_transaction: 'rejected' } })
		const untrusted = signJws(
			JSON.parse(Buffer.from(appTransactionJWS('apptx-2').split('.')[1]!, 'base64url').toString()),
			'untrusted',
		)
		expect((await device(identity({ appTransactionJWS: untrusted }))).linkResults).toEqual({
			app_transaction: 'rejected',
		})
	})

	it('reports nothing for links the device withheld or never sent', async () => {
		expect((await device(identity())).linkResults).toBeUndefined()
		expect((await device(withApp('apptx-1', { includeLinks: false }))).linkResults).toBeUndefined()
		expect((await device(identity({ icloudUserID: '_icloud' }))).linkResults).toBeUndefined()
	})

	it('reports link results on the purchase, sign-in and claim calls too', async () => {
		const bought = (
			await post('/api/accounts/v1/auth/purchase', {
				identity: withApp('apptx-buy'),
				signedTransactions: [signJws(transaction({ originalTransactionId: 'otid-1' }))],
			})
		).json()
		expect(bought.linkResults).toEqual({ app_transaction: 'bound' })

		const apple = (
			await post('/api/accounts/v1/auth/apple', { identity: withApp('apptx-buy'), identityToken: appleToken('sub-2') })
		).json()
		expect(apple).toMatchObject({
			account: { id: bought.account.id },
			linkResults: { app_transaction: 'already_bound' },
		})

		const registered = (
			await post('/api/accounts/v1/auth/password/register', {
				identity: identity({ appTransactionJWS: forged('apptx-x') }),
				email: 'ben@example.com',
				password: 'horse battery',
			})
		).json()
		expect(registered.linkResults).toEqual({ app_transaction: 'rejected' })

		const claim = (
			await app.inject({ method: 'POST', url: '/api/v1/admin/accounts', payload: {}, headers: ADMIN })
		).json()
		const claimed = (
			await post('/api/accounts/v1/auth/claim', { identity: withApp('apptx-claim'), code: claim.claim.code })
		).json()
		expect(claimed).toMatchObject({ account: { id: claim.id }, linkResults: { app_transaction: 'bound' } })
	})
})
