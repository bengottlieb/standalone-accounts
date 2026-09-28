import type { z } from 'zod'
import type { FastifyBaseLogger, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import type { AppStoreVerifier } from '../appstore/verify.js'
import type { AcctDb } from '../db/tables.js'
import type { AcctConfig } from '../core/config.js'
import type { IdentityBody } from './contract.js'
import type { StoreApi } from '../appstore/store-api.js'
import type { AdminNames } from '../admin/detail.js'
import type { SearchHook } from '../admin/search.js'
import type { DeviceIdentity } from '../core/identity.js'
import type { AcctHooks } from '../core/hooks.js'
import type { SignInOptions } from '../signin/options.js'

/** What the host hands the account routes. */
export interface AcctRouteOptions {
	db: AcctDb
	config: AcctConfig
	appStore: AppStoreVerifier
	/** Fastify route `config` for the unauthenticated `/auth/*` calls (the host's rate limit). */
	authRouteConfig: Record<string, unknown>
	/** Host fields added to the account in every response (StoreKeeper: plan limits and usage). */
	extras?: { schema: z.ZodObject; load: (accountId: string) => Promise<Record<string, unknown>> }
	/** The host's own per-account data. */
	hooks?: AcctHooks
	/** Which sign-in methods this server offers; the rest answer 404 `signin_unavailable`. */
	signIn?: SignInOptions
}

export const tags = ['account']
export const memberSecurity = [{ memberToken: [] }]

/** Verifies a request's identity block. */
export type IdentityOf = (body: { identity: IdentityBody }, log: FastifyBaseLogger) => Promise<DeviceIdentity>

/** What the host hands the admin routes. */
export interface AcctAdminOptions {
	db: AcctDb
	config: AcctConfig
	appStore: AppStoreVerifier
	/** The App Store Server API, or null when its key isn't configured (refresh and Order ID lookup then answer 503). */
	storeApi: StoreApi | null
	/** Guards: `read` for viewing (viewers too), `write` for changes (admins). */
	guards: { read: preHandlerAsyncHookHandler; write: preHandlerAsyncHookHandler }
	/** The signed-in admin user's id, for the audit log. */
	userId: (request: FastifyRequest) => string
	searchHook?: SearchHook
	adminNames?: AdminNames
	/** Where the admin API lives (default `/api/v1/admin`): `<prefix>/accounts…`, `<prefix>/purchases…`. */
	adminPrefix?: string
	hooks?: AcctHooks
}

export const adminTags = ['admin', 'accounts']
