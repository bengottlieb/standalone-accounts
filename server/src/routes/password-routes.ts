import type { FastifyInstance } from 'fastify'
import { verifyIdentity } from '../core/device-identity.js'
import { lockIdentity } from '../core/identity.js'
import {
	createResetCode,
	normalizeEmail,
	passwordAccount,
	passwordMatches,
	spendResetCode,
	storePassword,
} from '../core/passwords.js'
import { signInWith, type SignInContext } from '../core/sign-in.js'
import { revokeAllTokens } from '../core/tokens.js'
import { HttpError, parse } from '../http/errors.js'
import { jsonSchema, okBody, responses } from '../http/schema.js'
import { forgotPasswordBody, passwordBody, resetPasswordBody } from './contract.js'
import { tags, type AcctRouteOptions } from './options.js'
import { responders } from './respond.js'

/** Email and password: register (or sign in with the right password), sign in, forgot, reset. */
export function passwordRoutes(app: FastifyInstance, o: AcctRouteOptions, ctx: SignInContext) {
	const { db, config, appStore, authRouteConfig, signIn } = o
	const { schemas, authResponse } = responders(o)
	const available = () => {
		if (!signIn?.password) throw new HttpError(404, 'signin_unavailable')
		return signIn.password
	}
	const route = (
		path: string,
		operationId: string,
		summary: string,
		body: Parameters<typeof jsonSchema>[0],
		ok: Parameters<typeof responses>[0] = schemas.auth,
	) => ({
		path: `/api/accounts/v1/auth/password/${path}`,
		options: {
			config: authRouteConfig,
			schema: {
				tags,
				summary,
				operationId,
				security: [],
				body: jsonSchema(body),
				response: responses(ok, 400, 401, 404, 409, 410, 429),
			},
		},
	})

	/** Signs the device in to the email's account (checked by `check`), or attaches the email to the device's account. */
	async function signInByEmail(request: { body: unknown; log: FastifyInstance['log'] }, register: boolean) {
		available()
		const body = parse(passwordBody, request.body)
		const device = await verifyIdentity(appStore, config.secret, body.identity, request.log)
		const result = await db.transaction().execute(async (trx) => {
			await lockIdentity(trx, `password:${normalizeEmail(body.email)}`)
			const existing = await passwordAccount(trx, body.email)
			if (existing && !(await passwordMatches(existing.password_hash, body.password)))
				throw register ? new HttpError(409, 'email_in_use') : new HttpError(401, 'invalid_credentials')
			if (!existing && !register) throw new HttpError(401, 'invalid_credentials')
			return signInWith(
				{ ...ctx, db: trx },
				device,
				existing?.account_id ?? null,
				(accountId) => storePassword(trx, accountId, body.email, body.password),
				{ method: 'password', email: normalizeEmail(body.email) },
			)
		})
		return authResponse(result.accountId, device.secretHash, device.deviceName, result.isNew, result.merged)
	}

	const register = route(
		'register',
		'registerPassword',
		'Register an email and password (an existing one with the right password signs in)',
		passwordBody,
	)
	app.post(register.path, register.options, (request) => signInByEmail(request, true))
	const signin = route('signin', 'signInWithPassword', 'Sign in with an email and password', passwordBody)
	app.post(signin.path, signin.options, (request) => signInByEmail(request, false))

	const forgot = route('forgot', 'forgotPassword', 'Email a reset code (always answers ok)', forgotPasswordBody, okBody)
	app.post(forgot.path, forgot.options, async (request) => {
		const password = available()
		const { email } = parse(forgotPasswordBody, request.body)
		const account = await passwordAccount(db, email)
		if (account)
			await password.sendResetCode(account.email, await createResetCode(db, config.secret, account.account_id))
		return { ok: true as const }
	})

	const reset = route(
		'reset',
		'resetPassword',
		'Set a new password with an emailed code; revokes every token and signs this device in',
		resetPasswordBody,
	)
	app.post(reset.path, reset.options, async (request) => {
		available()
		const body = parse(resetPasswordBody, request.body)
		const device = await verifyIdentity(appStore, config.secret, body.identity, request.log)
		const result = await db.transaction().execute(async (trx) => {
			const account = await passwordAccount(trx, body.email)
			if (!account) throw new HttpError(410, 'code_expired')
			await spendResetCode(trx, config.secret, account.account_id, body.code)
			await storePassword(trx, account.account_id, account.email, body.password)
			await revokeAllTokens(trx, account.account_id)
			return signInWith({ ...ctx, db: trx }, device, account.account_id, async () => {}, {
				method: 'password',
				email: account.email,
			})
		})
		return authResponse(result.accountId, device.secretHash, device.deviceName, result.isNew, result.merged)
	})
}
