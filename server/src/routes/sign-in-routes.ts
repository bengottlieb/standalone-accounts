import type { FastifyInstance } from 'fastify'
import type { z } from 'zod'
import { verifyIdentity } from '../core/device-identity.js'
import { lockIdentity } from '../core/identity.js'
import { addLink, linkOwner, setLabel, signInWith } from '../core/sign-in.js'
import { HttpError, parse } from '../http/errors.js'
import { jsonSchema, responses } from '../http/schema.js'
import { SignInRejected } from '../signin/apple.js'
import { signInKinds } from '../signin/options.js'
import { appleSignInBody, gameCenterBody } from './contract.js'
import { transactor } from '../core/transaction.js'
import { tags, type AcctRouteOptions } from './options.js'
import { passwordRoutes } from './password-routes.js'
import { responders } from './respond.js'

const unavailable = () => new HttpError(404, 'signin_unavailable')

/** Sign in with Apple and with Game Center: both prove a link (`apple`, `game_center`) and follow `signInWith`. */
export function signInRoutes(app: FastifyInstance, o: AcctRouteOptions) {
	const { db, config, appStore, authRouteConfig, signIn } = o
	const run = transactor(db, o.transaction)
	const { schemas, authResponse } = responders(o)
	const ctx = { db, config, hooks: o.hooks, kinds: signInKinds(signIn) }

	/** Verifies, then signs the device in to whoever owns (`kind`, `value`), attaching it when nobody does. */
	async function withLink(
		request: { body: unknown; log: FastifyInstance['log'] },
		body: { identity: z.infer<typeof appleSignInBody>['identity'] },
		kind: string,
		value: string,
		label: string | undefined,
		name?: string,
		email?: string,
	) {
		const device = await verifyIdentity(appStore, config.secret, body.identity, request.log)
		const result = await run(async (trx, host) => {
			await lockIdentity(trx, `${kind}:${value}`)
			const c = { ...ctx, db: trx, host }
			const owner = await linkOwner(trx, kind, value)
			const signedIn = await signInWith(c, device, owner, (accountId) => addLink(trx, accountId, kind, value), {
				method: kind,
				name,
				email,
			})
			await setLabel(trx, signedIn.accountId, kind, label)
			return signedIn
		})
		return authResponse(result.accountId, device.secretHash, device.deviceName, result.isNew, result.merged)
	}
	const rejected = (error: unknown) => {
		throw error instanceof SignInRejected
			? new HttpError(401, 'invalid_credentials', {}, { message: error.message })
			: error
	}

	app.post(
		'/api/accounts/v1/auth/apple',
		{
			config: authRouteConfig,
			schema: {
				tags,
				summary: 'Sign in with Apple (identity token); signs this device in, folding in its anonymous account',
				operationId: 'signInWithApple',
				security: [],
				body: jsonSchema(appleSignInBody),
				response: responses(schemas.auth, 400, 401, 404, 409, 429),
			},
		},
		async (request) => {
			if (!signIn?.apple) throw unavailable()
			const body = parse(appleSignInBody, request.body)
			const apple = await signIn.apple.verify(body.identityToken).catch(rejected)
			return withLink(request, body, 'apple', apple.sub, apple.email, body.name, apple.email)
		},
	)

	app.post(
		'/api/accounts/v1/auth/game-center',
		{
			config: authRouteConfig,
			schema: {
				tags,
				summary: 'Sign in with Game Center (identity verification signature)',
				operationId: 'signInWithGameCenter',
				security: [],
				body: jsonSchema(gameCenterBody),
				response: responses(schemas.auth, 400, 401, 404, 409, 429),
			},
		},
		async (request) => {
			if (!signIn?.gameCenter) throw unavailable()
			const body = parse(gameCenterBody, request.body)
			const player = await signIn.gameCenter.verify(body).catch(rejected)
			return withLink(request, body, 'game_center', player, body.displayName, body.displayName)
		},
	)

	passwordRoutes(app, o, ctx)
}
