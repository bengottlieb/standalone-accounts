import type { FastifyInstance } from 'fastify'
import { parse } from '../http/errors.js'
import { jsonSchema, responses } from '../http/schema.js'
import { checkInBody, checkInResponseSchema } from './contract.js'
import { tags, type AcctRouteOptions } from './options.js'

/** The builds a host serves for one app: below `minimum` must update, below `recommended` may. */
export interface BuildPolicy {
	minimum: number | null
	recommended?: number
	message?: string
}

export interface CheckInOptions {
	/** The policy for a bundle id, or null for an app this server doesn't know (it's told nothing needs updating). */
	builds: (bundle: string) => BuildPolicy | null
	/** The host's settings for this build (feature flags, maintenance notices). */
	config?: (request: { bundle: string; build: number }) => Record<string, unknown>
	/** Protocol versions this server serves, oldest first. */
	protocolVersions: string[]
}

/**
 * `POST /api/accounts/v1/check-in`: which build is asking, and whether it must update. Needs no account; with a valid bearer
 * token the build is recorded on that device's token (an invalid one is ignored, so check-in always answers).
 */
export function checkInRoute(app: FastifyInstance, { db }: AcctRouteOptions, o: CheckInOptions) {
	app.post(
		'/api/accounts/v1/check-in',
		{
			schema: {
				tags,
				summary:
					'Check in at launch, on foreground and every few hours: whether this build must or should update, plus settings',
				operationId: 'checkIn',
				security: [],
				body: jsonSchema(checkInBody),
				response: responses(checkInResponseSchema, 400),
			},
		},
		async (request) => {
			const body = parse(checkInBody, request.body)
			const policy = o.builds(body.bundle)
			const minimum = policy?.minimum ?? null
			const update =
				minimum !== null && body.build < minimum
					? 'required'
					: policy?.recommended && body.build < policy.recommended
						? 'recommended'
						: 'none'
			if (request.account) {
				await db
					.updateTable('acct_tokens')
					.set({
						platform: body.platform,
						app_version: body.version,
						app_build: body.build,
						os_version: body.osVersion ?? null,
						checked_in_at: new Date(),
					})
					.where('id', '=', request.account.tokenId)
					.execute()
			}
			return {
				update,
				minimumBuild: minimum,
				...(policy?.recommended ? { recommendedBuild: policy.recommended } : {}),
				...(update !== 'none' && policy?.message ? { message: policy.message } : {}),
				serverTime: new Date(),
				protocolVersions: o.protocolVersions,
				config: o.config?.({ bundle: body.bundle, build: body.build }) ?? {},
			}
		},
	)
}
