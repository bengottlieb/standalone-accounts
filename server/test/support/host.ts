import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import type { StoreApi } from '../../src/appstore/store-api.js'
import { AppStoreVerifier } from '../../src/appstore/verify.js'
import type { AcctConfig } from '../../src/core/config.js'
import { resolveToken } from '../../src/core/tokens.js'
import type { AcctDb } from '../../src/db/tables.js'
import { HttpError } from '../../src/http/errors.js'
import { registerAccountAdminRoutes, registerAccountRoutes } from '../../src/routes/register.js'
import type { CheckInOptions } from '../../src/routes/check-in-route.js'
import type { AcctHooks } from '../../src/core/hooks.js'
import type { SignInOptions } from '../../src/signin/options.js'
import { BUNDLE_ID, TEST_APP_APPLE_ID, testRoot } from './storekit.js'

export const TEST_SECRET = 'x'.repeat(32)
export const CONFIG: AcctConfig = {
	secret: TEST_SECRET,
	creation: 'trigger',
	tokenPrefix: 'tst_',
	codePrefix: 'TS',
	maxTokensPerAccount: 10,
	claimCodeDays: 7,
	urlScheme: 'testapp',
}

/** Verifies StoreKit data signed by the test chain instead of Apple's. */
export function testVerifier(o: { environments?: string[]; appAppleId?: number | null; acceptXcode?: boolean } = {}) {
	return new AppStoreVerifier({
		roots: [testRoot()],
		apps: [
			{ bundleId: BUNDLE_ID, appAppleId: o.appAppleId === null ? undefined : (o.appAppleId ?? TEST_APP_APPLE_ID) },
		],
		environments: o.environments ?? ['Sandbox', 'Production'],
		onlineChecks: false,
		acceptXcode: o.acceptXcode,
	})
}

export interface HostOptions {
	config?: Partial<AcctConfig>
	appStore?: AppStoreVerifier
	storeApi?: StoreApi | null
	checkIn?: Partial<CheckInOptions>
	signIn?: SignInOptions
	hooks?: AcctHooks
}

/**
 * A minimal host: its auth hook resolves the library's tokens into `request.account`, and `x-admin: <id>` (with
 * `x-role: viewer` for read-only) stands in for a signed-in admin.
 */
export async function testHost(db: AcctDb, o: HostOptions = {}): Promise<FastifyInstance> {
	const config = { ...CONFIG, ...o.config }
	const app = Fastify({ logger: false })
	app.decorateRequest('account', null)
	app.addHook('onRequest', async (request) => {
		const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1]
		if (!bearer?.startsWith(config.tokenPrefix)) return
		request.account = await resolveToken(db, config.secret, bearer)
		if (!request.account && !request.url.startsWith('/api/accounts/v1/check-in'))
			throw new HttpError(401, 'invalid_token')
	})
	const admin = (request: FastifyRequest) => request.headers['x-admin'] as string | undefined
	await registerAccountRoutes(app, {
		db,
		config,
		appStore: o.appStore ?? testVerifier(),
		authRouteConfig: {},
		signIn: o.signIn,
		hooks: o.hooks,
		checkIn: { protocolVersions: ['v1'], builds: () => null, ...o.checkIn },
	})
	await registerAccountAdminRoutes(app, {
		db,
		config,
		appStore: o.appStore ?? testVerifier(),
		storeApi: o.storeApi ?? null,
		guards: {
			read: async (request) => {
				if (!admin(request)) throw new HttpError(401, 'Not signed in')
			},
			write: async (request) => {
				if (!admin(request)) throw new HttpError(401, 'Not signed in')
				if (request.headers['x-role'] === 'viewer') throw new HttpError(403, 'Admins only')
			},
		},
		userId: (request) => admin(request)!,
	})
	return app
}

export const ADMIN = { 'x-admin': 'admin-1' }
export const VIEWER = { 'x-admin': 'viewer-1', 'x-role': 'viewer' }
