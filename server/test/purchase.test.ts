import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { reset, testDb } from './support/db.js'
import { testHost, testVerifier } from './support/host.js'
import { appTransactionJWS, identity } from './support/identity.js'
import { LIFETIME, signJws, STOREKIT_FIXTURES, transaction } from './support/storekit.js'

const fixture = (name: string) => readFileSync(`${STOREKIT_FIXTURES}transactions/${name}.jws`, 'utf8').trim()
const DAY = 86_400_000
const lifetime = (o: Record<string, unknown> = {}) =>
	signJws(
		transaction({
			type: 'Non-Consumable',
			productId: LIFETIME,
			expiresDate: undefined,
			originalTransactionId: 'otid-life',
			...o,
		}),
	)

describe('POST /api/accounts/v1/auth/purchase', () => {
	const db = testDb()
	let app: FastifyInstance

	beforeEach(async () => {
		await reset(db)
		app = await testHost(db)
	})

	const purchase = (jws: string | string[], id: Record<string, unknown> = identity()) =>
		app.inject({
			method: 'POST',
			url: '/api/accounts/v1/auth/purchase',
			payload: { identity: id, signedTransactions: Array.isArray(jws) ? jws : [jws] },
		})
	const row = (otid = '2000000000000001') =>
		db.selectFrom('acct_purchases').selectAll().where('original_transaction_id', '=', otid).executeTakeFirstOrThrow()

	it('creates an account for a subscription, whose token reads the account', async () => {
		const res = await purchase(fixture('active'), identity({ deviceName: ' Ben’s iPhone ' }))
		expect(res.statusCode).toBe(200)
		const { token, account, isNew } = res.json()
		expect(isNew).toBe(true)
		expect(token).toMatch(/^tst_/)
		expect(account).toMatchObject({
			supportID: expect.stringMatching(/^TS-[0-9A-Z]{4}-[0-9A-Z]{4}$/),
			access: { status: 'active', active: true, plan: 'pro', source: 'subscription', environment: 'Sandbox' },
		})
		const me = await app.inject({ url: '/api/accounts/v1/account', headers: { authorization: `Bearer ${token}` } })
		expect(me.json()).toMatchObject({ id: account.id, access: { status: 'active' } })
		expect(await row()).toMatchObject({
			account_id: account.id,
			type: 'subscription',
			bundle_id: 'com.standalone.storekeeper',
		})
		const device = await db.selectFrom('acct_tokens').select('device_name').executeTakeFirstOrThrow()
		expect(device.device_name).toBe('Ben’s iPhone')
	})

	it('gives a one-time purchase access with no expiry until it is refunded', async () => {
		const { account } = (await purchase(lifetime())).json()
		expect(account.access).toEqual({
			status: 'active',
			active: true,
			plan: 'pro',
			source: 'purchase',
			environment: 'Sandbox',
		})
		expect(await row('otid-life')).toMatchObject({ type: 'non_consumable', status: 'active', expires_at: null })
		const refunded = await purchase(lifetime({ revocationDate: Date.now() - 1000, signedDate: Date.now() + 1000 }))
		expect(refunded.json()).toEqual({ error: 'transaction_revoked' })
		const status = await db
			.selectFrom('acct_accounts')
			.select('status')
			.where('id', '=', account.id)
			.executeTakeFirstOrThrow()
		expect(status.status).toBe('revoked')
	})

	it('restores to the owning account from a new device, and finds it after a reinstall by the app transaction', async () => {
		const device = identity({ appTransactionJWS: appTransactionJWS('apptx-1') })
		const first = (await purchase(fixture('active'), device)).json()
		expect((await purchase(fixture('active'))).json()).toMatchObject({
			isNew: false,
			account: { id: first.account.id },
		})
		const reinstall = identity({ appTransactionJWS: appTransactionJWS('apptx-1') })
		const other = signJws(transaction({ originalTransactionId: 'otid-b' }))
		expect((await purchase(other, reinstall)).json().account.id).toBe(first.account.id)
	})

	it('refuses a purchase another account owns, or one whose appAccountToken names another account', async () => {
		const mine = identity()
		const theirs = (await purchase(signJws(transaction({ originalTransactionId: 'otid-theirs' })))).json()
		await purchase(signJws(transaction({ originalTransactionId: 'otid-mine' })), mine)
		const stolen = await purchase(signJws(transaction({ originalTransactionId: 'otid-theirs' })), mine)
		expect(stolen.statusCode).toBe(409)
		expect(stolen.json()).toEqual({ error: 'purchase_in_use' })
		const tagged = signJws(transaction({ originalTransactionId: 'otid-new', appAccountToken: theirs.account.id }))
		expect((await purchase(tagged, mine)).statusCode).toBe(409)
		expect((await purchase(tagged)).json().account.id).toBe(theirs.account.id)
	})

	it('never shortens expires_at, and ignores fields from an older signed transaction', async () => {
		const later = Date.now() + 60 * DAY
		await purchase(signJws(transaction({ originalTransactionId: 'otid-r', expiresDate: later })))
		const older = transaction({
			originalTransactionId: 'otid-r',
			purchaseDate: Date.now() - 40 * DAY,
			expiresDate: Date.now() - 10 * DAY,
		})
		expect((await purchase(signJws(older))).json().account.access).toMatchObject({
			status: 'active',
			expiresAt: new Date(later).toISOString(),
		})
		await purchase(
			signJws(
				transaction({
					originalTransactionId: 'otid-r',
					productId: 'com.standalone.storekeeper.annual',
					signedDate: Date.now() - DAY,
				}),
			),
		)
		expect((await row('otid-r')).product_id).toBe('com.standalone.storekeeper.monthly')
	})

	it('keeps a grace period and a revocation that the transaction predates', async () => {
		const grace = Date.now() + 5 * DAY
		const lapsed = () => signJws(transaction({ originalTransactionId: 'otid-g', expiresDate: Date.now() - DAY }))
		await purchase(lapsed())
		await db
			.updateTable('acct_purchases')
			.set({ status: 'grace', grace_expires_at: new Date(grace) })
			.execute()
		expect((await purchase(lapsed())).json().account.access).toMatchObject({
			status: 'grace',
			expiresAt: new Date(grace).toISOString(),
		})
		await db.updateTable('acct_purchases').set({ status: 'revoked', revoked_at: new Date() }).execute()
		const restore = transaction({ originalTransactionId: 'otid-g', purchaseDate: Date.now() - 2 * DAY })
		expect((await purchase(signJws(restore))).json().account.access.status).toBe('revoked')
		const resubscribe = transaction({ originalTransactionId: 'otid-g', purchaseDate: Date.now() + 1000 })
		expect((await purchase(signJws(resubscribe))).json().account.access.status).toBe('active')
	})

	it('names why an invalid transaction was rejected', async () => {
		const [header, payload, signature] = fixture('active').split('.')
		const tampered = JSON.parse(Buffer.from(payload!, 'base64url').toString())
		tampered.expiresDate = Date.UTC(2199, 0, 1)
		const cases: [string, string][] = [
			[`${header}.${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${signature}`, 'signature'],
			[fixture('untrusted-chain'), 'chain'],
			[fixture('wrong-bundle'), 'bundle_id'],
			[fixture('xcode'), 'environment'],
			[signJws(transaction({ productId: 'com.standalone.storekeeper.sticker-pack' })), 'product'],
			[signJws(transaction({ type: 'Consumable' })), 'type'],
			['garbage', 'malformed'],
		]
		for (const [jws, reason] of cases) {
			const res = await purchase(jws)
			expect(res.statusCode, reason).toBe(422)
			expect(res.json()).toEqual({ error: 'transaction_invalid', reason })
		}
		expect(await db.selectFrom('acct_accounts').select('id').execute()).toEqual([])
	})

	it('accepts Xcode-signed data only when configured to, and Production only with an App Apple ID', async () => {
		app = await testHost(db, { appStore: testVerifier({ acceptXcode: true }) })
		expect((await purchase(fixture('xcode'))).statusCode).toBe(200)
		const production = signJws(transaction({ environment: 'Production', originalTransactionId: 'otid-p' }))
		app = await testHost(db, { appStore: testVerifier({ appAppleId: null }) })
		expect((await purchase(production)).json()).toEqual({ error: 'transaction_invalid', reason: 'environment' })
	})

	it('validates the request', async () => {
		expect((await purchase(fixture('active'), identity({ deviceSecret: 'short' }))).statusCode).toBe(400)
		expect((await purchase([])).statusCode).toBe(400)
	})
})
