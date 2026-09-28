import type { FastifyInstance } from 'fastify'
import { acctErrorHandler } from '../http/errors.js'
import { acctAccountRoutes } from './account-routes.js'
import { acctAdminRoutes } from './admin-routes.js'
import { acctAuthRoutes } from './auth-routes.js'
import { checkInRoute, type CheckInOptions } from './check-in-route.js'
import type { AcctAdminOptions, AcctRouteOptions } from './options.js'

/**
 * Mounts the device-facing protocol (`/api/accounts/v1/…`: check-in, auth, account) in its own scope, so its error
 * bodies follow the contract whatever the host's error handler does. The host's hooks still run first: its auth hook
 * must set `request.account` from `resolveToken` for tokens starting with `config.tokenPrefix`.
 */
export async function registerAccountRoutes(
	app: FastifyInstance,
	options: AcctRouteOptions & { checkIn: CheckInOptions },
) {
	await app.register(async (scope) => {
		scope.setErrorHandler(acctErrorHandler)
		acctAuthRoutes(scope, options)
		acctAccountRoutes(scope, options)
		checkInRoute(scope, options, options.checkIn)
	})
}

/** Mounts the admin API (`/api/v1/admin/accounts…`, `/api/v1/admin/purchases…`) behind the host's guards. */
export async function registerAccountAdminRoutes(app: FastifyInstance, options: AcctAdminOptions) {
	await app.register(async (scope) => {
		scope.setErrorHandler(acctErrorHandler)
		acctAdminRoutes(scope, options)
	})
}
