import type { FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from '../src/appstore/store-api.js'
import { effectiveAccess } from '../src/core/access.js'
import type { AccessChange } from '../src/core/hooks.js'
import { storePassword } from '../src/core/passwords.js'
import { issueToken } from '../src/core/tokens.js'
import { reset, testDb } from './support/db.js'
import { ADMIN, CONFIG, testHost, VIEWER } from './support/host.js'
import { identity } from './support/identity.js'
import { LIFETIME, renewalInfo, signJws, transaction } from './support/storekit.js'

const DAY = 86_400_000

describe('admin accounts API', () => {
	const db = testDb()
	let app: FastifyInstance
	const apple: StoreApi & { orders: Record<string, string[]>; status: number } = {
		orders: {},
		status: 1,
		statuses: async (_env, otid) => [
			{
				originalTransactionId: otid,
				status: apple.status,
				signedTransactionInfo: signJws(
					transaction({ originalTransactionId: otid, expiresDate: Date.now() + 90 * DAY }),
				),
				signedRenewalInfo: signJws(renewalInfo({ originalTransactionId: otid, autoRenewStatus: 0 })),
			},
		],
		lookUpOrder: async (orderId) => apple.orders[orderId] ?? [],
	}

	beforeEach(async () => {
		await reset(db)
		app = await testHost(db, { storeApi: apple })
	})

	const get = (url: string, headers: Record<string, string> = ADMIN) => app.inject({ url, headers })
	const post = (url: string, payload: object = {}, headers: Record<string, string> = ADMIN) =>
		app.inject({ method: 'POST', url, payload, headers })
	const del = (url: string, headers: Record<string, string> = ADMIN) => app.inject({ method: 'DELETE', url, headers })
	const buy = async (jws: string, id = identity()) =>
		(await post('/api/accounts/v1/auth/purchase', { identity: id, signedTransactions: [jws] }, {})).json()
	const ids = async (url: string) => (await get(url)).json().accounts.map((a: { id: string }) => a.id)
	const member = async (accountId: string) => ({
		authorization: `Bearer ${(await issueToken(db, CONFIG, accountId, 'x')).token}`,
	})

	it('lists accounts newest first with filters and keyset pages', async () => {
		const first = await buy(signJws(transaction({ originalTransactionId: 'a', expiresDate: Date.now() - DAY })))
		const second = await buy(signJws(transaction({ originalTransactionId: 'b', environment: 'Sandbox' })))
		expect(await ids('/api/v1/admin/accounts')).toEqual([second.account.id, first.account.id])
		expect(await ids('/api/v1/admin/accounts?status=expired')).toEqual([first.account.id])
		const page = (await get('/api/v1/admin/accounts?limit=1')).json()
		expect((await get(`/api/v1/admin/accounts?limit=1&cursor=${page.nextCursor}`)).json()).toMatchObject({
			accounts: [{ id: first.account.id }],
			nextCursor: null,
		})
	})

	it('finds an account by Support ID, id prefix, transaction id, Order ID and device name', async () => {
		const { account } = await buy(
			signJws(transaction({ originalTransactionId: '2000000000000777' })),
			identity({ deviceName: 'Ben’s MacBook' }),
		)
		expect(await ids(`/api/v1/admin/accounts?q=${account.supportID.toLowerCase().replaceAll('-', '')}`)).toEqual([
			account.id,
		])
		expect(await ids(`/api/v1/admin/accounts?q=${account.id.slice(0, 8)}`)).toEqual([account.id])
		expect(await ids('/api/v1/admin/accounts?q=2000000000000777')).toEqual([account.id])
		expect(await ids('/api/v1/admin/accounts?q=macbook')).toEqual([account.id])
		apple.orders.MABC1234XY = [signJws(transaction({ originalTransactionId: '2000000000000777' }))]
		expect(await ids('/api/v1/admin/accounts?q=MABC1234XY')).toEqual([account.id])
		await storePassword(db, account.id, 'Ben@Example.com', 'correct horse')
		expect(await ids('/api/v1/admin/accounts?q=ben@example.com')).toEqual([account.id])
		expect(await ids('/api/v1/admin/accounts?q=BEN@EXAMPLE.COM')).toEqual([account.id])
		expect(await ids('/api/v1/admin/accounts?q=example.com')).toEqual([account.id])
	})

	it('shows an account in full, one-time purchases included, without secrets', async () => {
		const { account } = await buy(
			signJws(transaction({ type: 'Non-Consumable', productId: LIFETIME, expiresDate: undefined })),
		)
		const body = (await get(`/api/v1/admin/accounts/${account.id}`)).json()
		expect(body).toMatchObject({
			account: { status: 'active', source: 'purchase' },
			purchases: [{ type: 'non_consumable', productId: LIFETIME, status: 'active', expiresAt: null }],
		})
		expect(JSON.stringify(body)).not.toMatch(/hash|secret/)
	})

	/** AppOutlet pushes the app on every change; a recompute that changes nothing must stay quiet. */
	it('tells the host’s accessChanged hook about each change, in the change’s transaction', async () => {
		const changes: AccessChange[] = []
		const hosts: unknown[] = []
		app = await testHost(db, {
			storeApi: apple,
			transaction: (fn) => db.transaction().execute((trx) => fn(trx, 'host-handle')),
			hooks: { accessChanged: async (_db, _id, change, host) => void (changes.push(change), hosts.push(host)) },
		})
		const made = (await post('/api/v1/admin/accounts', {})).json()
		await post(`/api/v1/admin/accounts/${made.id}/notes`, { text: 'press' })
		expect(changes).toEqual([])
		await post(`/api/v1/admin/accounts/${made.id}/grants`, { note: 'press' })
		expect(changes).toMatchObject([
			{ from: 'none', to: 'granted', plan: 'pro', expiresAt: null, actor: 'admin:admin-1' },
		])
		await post(`/api/v1/admin/accounts/${made.id}/grants`, { note: 'again' })
		expect(changes).toHaveLength(1)
		await post(`/api/v1/admin/accounts/${made.id}/suspensions`, { reason: 'abuse' })
		await del(`/api/v1/admin/accounts/${made.id}/suspensions`)
		expect(changes.slice(1)).toMatchObject([
			{ from: 'granted', to: 'suspended', plan: null },
			{ from: 'suspended', to: 'granted', plan: 'pro' },
		])
		expect(hosts).toEqual(['host-handle', 'host-handle', 'host-handle'])
	})

	it('grants and suspends, with the admin on the timeline', async () => {
		const made = (await post('/api/v1/admin/accounts', {})).json()
		const headers = await member(made.id)
		const grant = (await post(`/api/v1/admin/accounts/${made.id}/grants`, { note: 'press' })).json()
		expect((await app.inject({ url: '/api/accounts/v1/account', headers })).json().access).toMatchObject({
			status: 'granted',
		})
		await post(`/api/v1/admin/accounts/${made.id}/suspensions`, { reason: 'abuse' })
		expect((await app.inject({ url: '/api/accounts/v1/account', headers })).json().access).toEqual({
			status: 'suspended',
			active: false,
		})
		expect((await del(`/api/v1/admin/accounts/${made.id}/suspensions`)).json()).toEqual({ ok: true })
		expect((await del(`/api/v1/admin/accounts/${made.id}/grants/${grant.id}`)).json()).toEqual({ ok: true })
		const detail = (await get(`/api/v1/admin/accounts/${made.id}`)).json()
		expect(detail.account.status).toBe('none')
		expect(detail.events.find((e: { kind: string }) => e.kind === 'grant_added')).toMatchObject({
			actor: 'admin:admin-1',
		})
	})

	it('takes effect at once when the app clock runs behind the database’s', async () => {
		const made = (await post('/api/v1/admin/accounts', {})).json()
		vi.useFakeTimers({ toFake: ['Date'], now: Date.now() - 5000 })
		try {
			await post(`/api/v1/admin/accounts/${made.id}/grants`, {})
			expect((await get(`/api/v1/admin/accounts/${made.id}`)).json().account.status).toBe('granted')
			await post(`/api/v1/admin/accounts/${made.id}/suspensions`, { reason: 'abuse' })
			expect((await get(`/api/v1/admin/accounts/${made.id}`)).json().account.status).toBe('suspended')
		} finally {
			vi.useRealTimers()
		}
	})

	it('refreshes subscriptions from Apple, and says so when it has no key', async () => {
		const { account } = await buy(
			signJws(transaction({ originalTransactionId: 'otid-r', expiresDate: Date.now() - DAY })),
		)
		apple.status = 4
		expect((await post(`/api/v1/admin/accounts/${account.id}/refresh`)).json()).toEqual({ subscriptions: 1 })
		expect((await get(`/api/v1/admin/accounts/${account.id}`)).json().account.status).toBe('grace')
		app = await testHost(db, { storeApi: null })
		expect((await post(`/api/v1/admin/accounts/${account.id}/refresh`)).json()).toEqual({
			error: 'appstore_api_unconfigured',
		})
	})

	it('lists unclaimed purchases and attaches one', async () => {
		const made = (await post('/api/v1/admin/accounts', {})).json()
		await db
			.insertInto('acct_purchases')
			.values({
				type: 'subscription',
				bundle_id: 'b',
				original_transaction_id: 'orphan',
				environment: 'Sandbox',
				plan_id: 'pro',
				product_id: 'p',
				status: 'active',
			})
			.execute()
		const { purchases } = (await get('/api/v1/admin/purchases/unclaimed')).json()
		expect(purchases).toMatchObject([{ originalTransactionId: 'orphan', type: 'subscription' }])
		expect((await post(`/api/v1/admin/purchases/${purchases[0].id}/attach`, { accountId: made.id })).json()).toEqual({
			ok: true,
		})
		expect((await get(`/api/v1/admin/accounts/${made.id}`)).json().account.status).toBe('active')
	})

	it('lets viewers read but not act, and keeps strangers out', async () => {
		const made = (await post('/api/v1/admin/accounts', {})).json()
		expect((await get(`/api/v1/admin/accounts/${made.id}`, VIEWER)).statusCode).toBe(200)
		expect((await post(`/api/v1/admin/accounts/${made.id}/notes`, { text: 'x' }, VIEWER)).statusCode).toBe(403)
		expect((await get('/api/v1/admin/accounts', {})).statusCode).toBe(401)
	})
})

describe('effective access', () => {
	const now = new Date('2026-09-28T12:00:00Z')
	const at = (days: number) => new Date(now.getTime() + days * DAY)
	const sub = (status: 'active' | 'grace' | 'expired' | 'revoked', expires: number | null, type = 'subscription') =>
		({
			type,
			status,
			expires_at: expires === null ? null : at(expires),
			grace_expires_at: status === 'grace' ? at(3) : null,
			plan_id: 'pro',
			environment: 'Sandbox',
			auto_renew: true,
		}) as never
	const grant = (o: { expires?: number | null; revoked?: boolean; starts?: number } = {}) =>
		({
			plan_id: 'pro',
			starts_at: at(o.starts ?? -1),
			expires_at: o.expires === null ? null : at(o.expires ?? 10),
			revoked_at: o.revoked ? at(-1) : null,
		}) as never

	it('ranks suspension, active purchases, grace, grant, then the lapsed state', () => {
		expect(effectiveAccess([sub('active', 5)], [grant()], true, now).status).toBe('suspended')
		expect(effectiveAccess([sub('active', 5), sub('active', null, 'non_consumable')], [], false, now)).toMatchObject({
			status: 'active',
			access_source: 'purchase',
			access_expires_at: null,
		})
		expect(effectiveAccess([sub('expired', -5), sub('active', 5)], [grant()], false, now)).toMatchObject({
			status: 'active',
			access_source: 'subscription',
		})
		expect(effectiveAccess([sub('grace', -1)], [grant()], false, now)).toMatchObject({
			status: 'grace',
			access_expires_at: at(3),
		})
		expect(effectiveAccess([sub('expired', -5)], [grant({ expires: null })], false, now)).toMatchObject({
			status: 'granted',
		})
		expect(
			effectiveAccess(
				[sub('revoked', -5)],
				[grant({ revoked: true }), grant({ expires: -1 }), grant({ starts: 1 })],
				false,
				now,
			).status,
		).toBe('revoked')
		expect(effectiveAccess([], [], false, now)).toMatchObject({ status: 'none', plan_id: null })
	})
})
