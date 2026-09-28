import type { FastifyInstance, FastifyRequest } from 'fastify'
import { HttpError } from '../http/errors.js'
import { okBody, responses } from '../http/schema.js'
import { deleteAccount } from '../core/accounts.js'
import { recordEvent } from '../core/events.js'
import { isAnonymous } from '../core/merge.js'
import { signInKinds } from '../signin/options.js'
import { identityRoutes } from './identity-routes.js'
import { revokeToken } from '../core/tokens.js'
import { transactor } from '../core/transaction.js'
import { memberSecurity, tags, type AcctRouteOptions } from './options.js'
import { responders } from './respond.js'

/** Any signed-in device, whatever its access: these are the calls a lapsed or suspended account still has. */
async function signedIn(request: FastifyRequest) {
	if (!request.account) throw new HttpError(401, 'Not signed in')
}

/** `/api/accounts/v1/account`: the calling device's account, sign-out, and deletion. */
export function acctAccountRoutes(app: FastifyInstance, o: AcctRouteOptions) {
	const { db } = o
	const run = transactor(db, o.transaction)
	const { schemas, summary } = responders(o)

	app.get(
		'/api/accounts/v1/account',
		{
			preHandler: signedIn,
			schema: {
				tags,
				summary: 'Your account: effective access, plus plan limits and usage (answers whatever the access)',
				operationId: 'account',
				security: memberSecurity,
				response: responses(schemas.account, 401, 403),
			},
		},
		async (request) => summary(request.account!.id),
	)

	app.post(
		'/api/accounts/v1/account/signout',
		{
			preHandler: signedIn,
			schema: {
				tags,
				summary: `Sign this device out: revokes its token and unbinds its device secret (in first-launch apps an anonymous account is deleted). Send \`includeLinks: false\` afterwards.`,
				operationId: 'signOut',
				security: memberSecurity,
				response: responses(okBody, 401, 403),
			},
		},
		async (request) => {
			const account = request.account!
			await run(async (trx, host) => {
				// An anonymous account in a first-launch app can never be reached again once its device leaves: it goes.
				if (o.config.creation === 'first-launch' && (await isAnonymous(trx, account.id, signInKinds(o.signIn))))
					return deleteAccount(trx, account.id, 'device', o.hooks, host)
				await revokeToken(trx, account.tokenId)
				if (account.credentialHash)
					await trx.deleteFrom('acct_device_credentials').where('secret_hash', '=', account.credentialHash).execute()
				await recordEvent(trx, account.id, 'signed_out', 'device')
			})
			return { ok: true as const }
		},
	)

	identityRoutes(app, o)

	app.delete(
		'/api/accounts/v1/account',
		{
			preHandler: signedIn,
			schema: {
				tags,
				summary:
					'Delete your account and everything in it. Does not cancel an App Store subscription: the app says so and ' +
					'offers Manage Subscriptions first. A later purchase restore starts a fresh account.',
				operationId: 'deleteAccount',
				security: memberSecurity,
				response: responses(okBody, 401, 403),
			},
		},
		async (request) => {
			const accountId = request.account!.id
			await run((trx, host) => deleteAccount(trx, accountId, 'device', o.hooks, host))
			request.log.info({ accountId }, 'account deleted by its owner')
			return { ok: true as const }
		},
	)
}
