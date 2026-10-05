import type { FastifyInstance, FastifyRequest } from 'fastify'
import { recordEvent } from '../core/events.js'
import { checkNewPassword, normalizeEmail, passwordAccount, passwordMatches, storePassword } from '../core/passwords.js'
import { HttpError, parse } from '../http/errors.js'
import { jsonSchema, okBody, passwordBadRequest, responses } from '../http/schema.js'
import { signInKinds } from '../signin/options.js'
import { setPasswordBody, unlinkBody } from './contract.js'
import { transactor } from '../core/transaction.js'
import { memberSecurity, tags, type AcctRouteOptions } from './options.js'
import { responders } from './respond.js'

async function signedIn(request: FastifyRequest) {
	if (!request.account) throw new HttpError(401, 'Not signed in')
}

/** The signed-in account's ways in: set or change its email and password, or remove a sign-in method. */
export function identityRoutes(app: FastifyInstance, o: AcctRouteOptions) {
	const { db } = o
	const run = transactor(db, o.transaction)
	const { schemas, summary } = responders(o)

	app.post(
		'/api/accounts/v1/account/password',
		{
			preHandler: signedIn,
			schema: {
				tags,
				summary: 'Add an email and password to your account, or change them (with the current password)',
				operationId: 'setPassword',
				security: memberSecurity,
				body: jsonSchema(setPasswordBody),
				response: responses(okBody, passwordBadRequest, 401, 404, 409),
			},
		},
		async (request) => {
			if (!o.signIn?.password) throw new HttpError(404, 'signin_unavailable')
			const body = parse(setPasswordBody, request.body)
			checkNewPassword(body.password, o.signIn.password.minLength)
			const accountId = request.account!.id
			await run(async (trx, host) => {
				const current = await trx
					.selectFrom('acct_passwords')
					.select(['account_id', 'password_hash'])
					.where('account_id', '=', accountId)
					.executeTakeFirst()
				const legacy = o.signIn?.password?.verifyLegacy
				if (
					current &&
					!(body.currentPassword && (await passwordMatches(current.password_hash, body.currentPassword, legacy)))
				)
					throw new HttpError(401, 'invalid_credentials')
				const owner = await passwordAccount(trx, body.email)
				if (owner && owner.account_id !== accountId) throw new HttpError(409, 'email_in_use')
				await storePassword(trx, accountId, body.email, body.password)
				await recordEvent(trx, accountId, 'password_changed', 'device')
				// The host hears of it as a password sign-in (PZLServer records the email, adopts a legacy identity).
				await o.hooks?.signedIn?.(
					trx,
					accountId,
					{ method: 'password', email: normalizeEmail(body.email), password: body.password, isNew: false },
					host,
				)
			})
			return { ok: true as const }
		},
	)

	app.post(
		'/api/accounts/v1/account/unlink',
		{
			preHandler: signedIn,
			schema: {
				tags,
				summary: 'Remove one way of signing in (apple, game_center, password, …) from your account',
				operationId: 'unlinkIdentity',
				security: memberSecurity,
				body: jsonSchema(unlinkBody),
				response: responses(schemas.account, 400, 401),
			},
		},
		async (request) => {
			const { kind } = parse(unlinkBody, request.body)
			const accountId = request.account!.id
			await run(async (trx, host) => {
				if (kind === 'password') await trx.deleteFrom('acct_passwords').where('account_id', '=', accountId).execute()
				else if (signInKinds(o.signIn).includes(kind))
					await trx.deleteFrom('acct_links').where('account_id', '=', accountId).where('kind', '=', kind).execute()
				await recordEvent(trx, accountId, 'unlinked', 'device', { kind })
			})
			return summary(accountId)
		},
	)
}
