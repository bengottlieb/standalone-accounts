import { randomUUID } from 'node:crypto'
import type { ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library'
import { beforeEach, describe, expect, it } from 'vitest'
import { createAccount } from '../src/core/accounts.js'
import { processNotification } from '../src/core/notifications.js'
import { runAccountSweep } from '../src/core/sweep.js'
import { reset, testDb } from './support/db.js'
import { CONFIG } from './support/host.js'
import { LIFETIME, transaction } from './support/storekit.js'

const DAY = 86_400_000

/** A verified notification as the host's endpoint hands it over. */
function notification(type: string, tx: Record<string, unknown>, subtype?: string) {
	return {
		payload: {
			notificationType: type,
			subtype,
			notificationUUID: randomUUID(),
			signedDate: Date.now(),
			data: { environment: 'Sandbox' },
		} as unknown as ResponseBodyV2DecodedPayload,
		transaction: tx as never,
	}
}

describe('App Store notifications', () => {
	const db = testDb()
	beforeEach(() => reset(db))
	const purchase = (otid: string) =>
		db.selectFrom('acct_purchases').selectAll().where('original_transaction_id', '=', otid).executeTakeFirstOrThrow()
	const status = async (id: string) =>
		(await db.selectFrom('acct_accounts').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status

	it('keeps a purchase no account owns unclaimed, and attaches one whose appAccountToken names an account', async () => {
		expect(
			await processNotification(
				db,
				notification('SUBSCRIBED', transaction({ originalTransactionId: 'o1' }), 'INITIAL_BUY'),
			),
		).toMatchObject({ outcome: 'applied' })
		expect(await purchase('o1')).toMatchObject({ account_id: null, status: 'active', type: 'subscription' })
		expect(await db.selectFrom('acct_accounts').select('id').execute()).toEqual([])
		const owner = await createAccount(db, CONFIG, 'system', 'test')
		await processNotification(
			db,
			notification('SUBSCRIBED', transaction({ originalTransactionId: 'o2', appAccountToken: owner.id })),
		)
		expect((await purchase('o2')).account_id).toBe(owner.id)
		expect(await status(owner.id)).toBe('active')
	})

	it('handles one-time purchases: bought, refunded, reversed', async () => {
		const owner = await createAccount(db, CONFIG, 'system', 'test')
		const tx = (o: Record<string, unknown> = {}) =>
			transaction({
				type: 'Non-Consumable',
				productId: LIFETIME,
				expiresDate: undefined,
				originalTransactionId: 'life',
				appAccountToken: owner.id,
				...o,
			})
		await processNotification(db, notification('ONE_TIME_CHARGE', tx()))
		expect(await purchase('life')).toMatchObject({ type: 'non_consumable', status: 'active' })
		expect(await status(owner.id)).toBe('active')
		await processNotification(db, notification('REFUND', tx({ revocationDate: Date.now() })))
		expect(await status(owner.id)).toBe('revoked')
		await processNotification(db, notification('REFUND_REVERSED', tx()))
		expect(await status(owner.id)).toBe('active')
	})

	it('records products no plan lists without a purchase, and flags an unplanned subscription', async () => {
		expect(
			await processNotification(
				db,
				notification(
					'ONE_TIME_CHARGE',
					transaction({ type: 'Non-Consumable', productId: 'pack.7', expiresDate: undefined }),
				),
			),
		).toMatchObject({ outcome: 'recorded' })
		const flagged = await processNotification(
			db,
			notification('SUBSCRIBED', transaction({ productId: 'mystery.sub', originalTransactionId: 'x' })),
		)
		expect(flagged.outcome).toBe('error')
		expect(await db.selectFrom('acct_purchases').select('id').execute()).toEqual([])
	})

	it('processes a notification once', async () => {
		const n = notification('SUBSCRIBED', transaction({ originalTransactionId: 'o3' }))
		await processNotification(db, n)
		expect(await processNotification(db, n)).toEqual({ outcome: 'duplicate' })
	})

	it('sweeps lapsed subscriptions and ended grants, never one-time purchases', async () => {
		const now = new Date()
		const owner = await createAccount(db, CONFIG, 'system', 'test')
		await processNotification(
			db,
			notification(
				'SUBSCRIBED',
				transaction({ originalTransactionId: 'lapsing', appAccountToken: owner.id, expiresDate: Date.now() + 1000 }),
			),
		)
		const buyer = await createAccount(db, CONFIG, 'system', 'test')
		await processNotification(
			db,
			notification(
				'ONE_TIME_CHARGE',
				transaction({
					type: 'Non-Consumable',
					productId: LIFETIME,
					expiresDate: undefined,
					originalTransactionId: 'forever',
					appAccountToken: buyer.id,
				}),
			),
		)
		expect(await runAccountSweep(db, 0, new Date(now.getTime() + 2 * DAY))).toMatchObject({
			expiredActive: 1,
			accessChanged: 1,
		})
		expect(await status(owner.id)).toBe('expired')
		expect(await status(buyer.id)).toBe('active')
	})
})
