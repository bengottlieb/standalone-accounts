import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpError, parse } from '../http/errors.js'
import { jsonSchema, responses } from '../http/schema.js'
import { refreshAccess } from '../core/access.js'
import { createAccount } from '../core/accounts.js'
import { purchaseAuthBody } from './contract.js'
import { recordEvent } from '../core/events.js'
import { bindDevice, findAccount, lockIdentity } from '../core/identity.js'
import { purchaseOwner, verifyPurchases } from '../core/verify-purchases.js'
import { applyTransaction, revokePurchase } from '../core/purchases.js'
import { tags, type AcctRouteOptions, type IdentityOf } from './options.js'
import { responders } from './respond.js'

const invalidBody = z.object({ error: z.literal('transaction_invalid'), reason: z.string() })

/**
 * `POST /api/accounts/v1/auth/purchase`: attaches verified subscriptions to the device's account, the account that already
 * owns them, or a new one, and binds the device. Refunded transactions are recorded and answered 403.
 */
export function purchaseRoute(app: FastifyInstance, o: AcctRouteOptions, identityOf: IdentityOf) {
	const { db, config, appStore, authRouteConfig } = o
	const { schemas, authResponse } = responders(o)

	app.post(
		'/api/accounts/v1/auth/purchase',
		{
			config: authRouteConfig,
			schema: {
				tags,
				summary:
					"Attach StoreKit 2 signed subscription transactions (`Transaction.jwsRepresentation`) to this device's account " +
					'(or the account that owns them, or a new one) and get a device token. Expired subscriptions attach too.',
				operationId: 'authPurchase',
				security: [],
				body: jsonSchema(purchaseAuthBody),
				response: responses(schemas.auth, 400, 403, 409, [422, invalidBody], 429, 503),
			},
		},
		async (request) => {
			const body = parse(purchaseAuthBody, request.body)
			const identity = await identityOf(body, request.log)
			const verified = await verifyPurchases(db, appStore, body.signedTransactions).catch((error: unknown) => {
				if (error instanceof HttpError && error.statusCode === 422)
					request.log.warn({ reason: error.body.reason }, 'purchase rejected')
				throw error
			})
			const revoked = verified.filter((p) => p.revokedAt)
			for (const p of revoked) {
				const owner = await revokePurchase(db, p.tx.originalTransactionId, p.revokedAt!)
				if (owner) await refreshAccess(db, owner, 'apple')
			}
			const purchases = verified.filter((p) => !p.revokedAt)
			if (!purchases.length) {
				request.log.warn(
					{ originalTransactionIds: revoked.map((p) => p.tx.originalTransactionId) },
					'purchase of a revoked transaction',
				)
				throw new HttpError(403, 'transaction_revoked')
			}

			const bound = await db.transaction().execute(async (trx) => {
				const keys = purchases.map((p) => `original_transaction:${p.tx.originalTransactionId}`)
				if (identity.appTransactionId) keys.push(`app_transaction:${identity.appTransactionId}`)
				for (const key of keys.sort()) await lockIdentity(trx, key)
				const found = await findAccount(trx, identity)
				const owner = await purchaseOwner(trx, purchases, found?.accountId ?? null)
				const accountId = found?.accountId ?? owner ?? (await createAccount(trx, config, 'device', 'purchase')).id
				for (const p of purchases) {
					await applyTransaction(trx, p.tx, p.planId, accountId)
					if (!owner)
						await recordEvent(trx, accountId, 'purchase_attached', 'device', {
							originalTransactionId: p.tx.originalTransactionId,
							productId: p.tx.productId,
							environment: p.tx.environment,
						})
				}
				await bindDevice(trx, accountId, identity)
				await refreshAccess(trx, accountId, 'device')
				return { accountId, isNew: !found && !owner }
			})
			request.log.info({ accountId: bound.accountId, isNew: bound.isNew }, 'purchase attached')
			return authResponse(bound.accountId, identity.secretHash, identity.deviceName, bound.isNew)
		},
	)
}
