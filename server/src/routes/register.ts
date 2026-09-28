import type { FastifyInstance } from 'fastify'

/** Any host's Fastify instance, whatever its server or type provider (PZLServer uses Zod's). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastify = FastifyInstance<any, any, any, any, any>
import { acctErrorHandler } from '../http/errors.js'
import { acctAccountRoutes } from './account-routes.js'
import { acctAdminRoutes } from './admin-routes.js'
import { acctAuthRoutes } from './auth-routes.js'
import { signInRoutes } from './sign-in-routes.js'
import { checkInRoute, type CheckInOptions } from './check-in-route.js'
import type { AcctAdminOptions, AcctRouteOptions } from './options.js'

/**
 * The library's routes behave the same under any host: their error bodies follow the contract, every input is
 * validated with Zod in the handler (the JSON schemas on routes only document), and responses are plain JSON. So a host
 * with its own validator or serializer (PZLServer's Zod type provider) doesn't reinterpret them.
 */
function ownScope(scope: FastifyInstance) {
	scope.setErrorHandler(acctErrorHandler)
	scope.setValidatorCompiler(() => (value: unknown) => ({ value }))
	scope.setSerializerCompiler(() => (data: unknown) => JSON.stringify(data))
}

/**
 * Mounts the device-facing protocol (`/api/accounts/v1/…`: check-in, auth, account) in its own scope, so its error
 * bodies follow the contract whatever the host's error handler does. The host's hooks still run first: its auth hook
 * must set `request.account` from `resolveToken` for tokens starting with `config.tokenPrefix`.
 */
export async function registerAccountRoutes(
	app: FastifyInstance,
	options: AcctRouteOptions & { checkIn: CheckInOptions },
) {
	await app.register(async (scope: FastifyInstance) => {
		ownScope(scope)
		acctAuthRoutes(scope, options)
		signInRoutes(scope, options)
		acctAccountRoutes(scope, options)
		checkInRoute(scope, options, options.checkIn)
	})
}

/** Mounts the admin API (`/api/v1/admin/accounts…`, `/api/v1/admin/purchases…`) behind the host's guards. */
export async function registerAccountAdminRoutes(app: AnyFastify, options: AcctAdminOptions) {
	await app.register(async (scope: FastifyInstance) => {
		ownScope(scope)
		acctAdminRoutes(scope, options)
	})
}
