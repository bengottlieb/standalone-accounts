import type { FastifyInstance } from 'fastify'
import { HttpError, parse } from '../http/errors.js'
import { jsonSchema, responses } from '../http/schema.js'
import { refreshAccess } from '../core/access.js'
import { createAccount } from '../core/accounts.js'
import { redeemClaimCode } from '../core/claim.js'
import { claimBody, deviceAuthBody } from './contract.js'
import { verifyIdentity } from '../core/device-identity.js'
import { recordEvent } from '../core/events.js'
import { bindDevice, findAccount, lockIdentity, type DeviceIdentity } from '../core/identity.js'
import { purchaseRoute } from './purchase-route.js'
import { responders } from './respond.js'
import { transactor } from '../core/transaction.js'
import { tags, type AcctRouteOptions, type IdentityOf } from './options.js'

/** `/api/accounts/v1/auth/*`: the calls that bind a device to an account by proving an identity (no token). */
export function acctAuthRoutes(app: FastifyInstance, o: AcctRouteOptions) {
	const { db, config, appStore, authRouteConfig } = o
	const run = transactor(db, o.transaction)
	const { schemas, authResponse } = responders(o)
	const identityOf: IdentityOf = (body, log) => verifyIdentity(appStore, config.secret, body.identity, log)

	app.post(
		'/api/accounts/v1/auth/device',
		{
			config: authRouteConfig,
			schema: {
				tags,
				summary: `This device's account and a token for it. With ACCOUNT_CREATION=trigger an unknown device gets \`{ "account": null }\`.`,
				operationId: 'authDevice',
				security: [],
				body: jsonSchema(deviceAuthBody),
				response: responses(schemas.device, 400, 429),
			},
		},
		async (request) => {
			const identity = await identityOf(parse(deviceAuthBody, request.body), request.log)
			const bound = await run(async (trx, host) => {
				if (identity.appTransactionId) await lockIdentity(trx, `app_transaction:${identity.appTransactionId}`)
				const found = await findAccount(trx, identity)
				if (!found && config.creation === 'trigger') return null
				const accountId =
					found?.accountId ?? (await createAccount(trx, config, 'device', 'first-launch', o.hooks, host)).id
				await bindDevice(trx, accountId, identity)
				return { accountId, isNew: !found }
			})
			if (!bound) return { account: null }
			return authResponse(bound.accountId, identity.secretHash, identity.deviceName, bound.isNew)
		},
	)

	purchaseRoute(app, o, identityOf)

	app.post(
		'/api/accounts/v1/auth/claim',
		{
			config: authRouteConfig,
			schema: {
				tags,
				summary: 'Join the account an admin created, with its one-time claim code',
				operationId: 'authClaim',
				security: [],
				body: jsonSchema(claimBody),
				response: responses(schemas.auth, 400, 404, 409, 410, 429),
			},
		},
		async (request) => {
			const body = parse(claimBody, request.body)
			const identity: DeviceIdentity = await identityOf(body, request.log)
			const accountId = await run(async (trx, host) => {
				const claimed = await redeemClaimCode(trx, config, body.code)
				const found = await findAccount(trx, identity)
				if (found && found.accountId !== claimed) throw new HttpError(409, 'identity_in_use')
				await bindDevice(trx, claimed, identity, { strict: true })
				await recordEvent(trx, claimed, 'claimed', 'device', { platform: identity.platform })
				await refreshAccess(trx, claimed, 'device')
				return claimed
			})
			return authResponse(accountId, identity.secretHash, identity.deviceName, false)
		},
	)
}
