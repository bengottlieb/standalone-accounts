import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { z } from 'zod'
import { HttpError, parse } from '../http/errors.js'
import { jsonSchema, okBody, responses } from '../http/schema.js'
import { refreshFromApple } from '../admin/refresh.js'
import { createClaimCode } from '../core/claim.js'
import { recordEvent } from '../core/events.js'
import { addGrant, liftSuspensions, revokeGrant, suspend } from '../core/overrides.js'
import * as s from './admin-schemas.js'
import { transactor } from '../core/transaction.js'
import { adminTags as tags, type AcctAdminOptions } from './options.js'

/** Admin actions on one account. Each is written to its timeline with the admin who took it. */
export function adminActionRoutes(app: FastifyInstance, o: AcctAdminOptions) {
	const { db, config, guards } = o
	const inTransaction = transactor(db, o.transaction)
	const BASE = `${o.adminPrefix ?? '/api/v1/admin'}/accounts/:id`

	/** Registers a POST/DELETE action on an existing account, run in a transaction with the acting admin. */
	function action<B extends z.ZodType, R extends z.ZodType>(
		method: 'post' | 'delete',
		path: string,
		meta: { operationId: string; summary: string; body?: B; response: R; params?: z.ZodType; errors?: number[] },
		run: (ctx: {
			trx: typeof db
			accountId: string
			body: z.infer<B>
			params: Record<string, string>
			by: string
			actor: `admin:${string}`
			host: unknown
		}) => Promise<unknown>,
	) {
		app[method](
			`${BASE}${path}`,
			{
				preHandler: guards.write,
				schema: {
					tags,
					summary: meta.summary,
					operationId: meta.operationId,
					...(meta.body ? { body: jsonSchema(meta.body) } : {}),
					response: responses(meta.response, 400, 401, 403, 404, ...(meta.errors ?? [])),
				},
			},
			async (request: FastifyRequest) => {
				const params = parse(meta.params ?? s.idParams, request.params) as Record<string, string>
				const body = meta.body ? parse(meta.body, request.body) : undefined
				const by = o.userId(request)
				return inTransaction(async (trx, host) => {
					const exists = await trx
						.selectFrom('acct_accounts')
						.select('id')
						.where('id', '=', params.id!)
						.forUpdate()
						.executeTakeFirst()
					if (!exists) throw new HttpError(404, 'account_not_found')
					return run({ trx, accountId: params.id!, body: body as z.infer<B>, params, by, actor: `admin:${by}`, host })
				})
			},
		)
	}

	action(
		'post',
		'/grants',
		{
			operationId: 'addGrant',
			summary: 'Give the account access (a plan) until a date, or indefinitely',
			body: s.grantBody,
			response: s.idResponse,
		},
		async (c) => {
			const plan = await c.trx.selectFrom('acct_plans').select('id').where('id', '=', c.body.plan).executeTakeFirst()
			if (!plan) throw new HttpError(400, 'unknown_plan')
			return {
				id: await addGrant(
					c.trx,
					c.accountId,
					{ planId: c.body.plan, source: c.body.source, expiresAt: c.body.expiresAt, note: c.body.note },
					c.actor,
					c.by,
					o.hooks,
					c.host,
				),
			}
		},
	)

	action(
		'delete',
		'/grants/:grantId',
		{ operationId: 'revokeGrant', summary: 'End a grant now', response: okBody, params: s.grantParams },
		async (c) => {
			if (!(await revokeGrant(c.trx, c.accountId, c.params.grantId!, c.actor, o.hooks, c.host)))
				throw new HttpError(404, 'grant_not_found')
			return { ok: true as const }
		},
	)

	action(
		'post',
		'/suspensions',
		{
			operationId: 'suspendAccount',
			summary: 'Suspend the account (overrides any subscription or grant) until lifted or `endsAt`',
			body: s.suspendBody,
			response: s.idResponse,
		},
		async (c) => ({
			id: await suspend(
				c.trx,
				c.accountId,
				{ reason: c.body.reason, endsAt: c.body.endsAt },
				c.actor,
				c.by,
				o.hooks,
				c.host,
			),
		}),
	)

	action(
		'delete',
		'/suspensions',
		{ operationId: 'liftSuspension', summary: 'Lift the account’s suspension', response: okBody },
		async (c) => {
			if (!(await liftSuspensions(c.trx, c.accountId, c.actor, o.hooks, c.host)))
				throw new HttpError(404, 'not_suspended')
			return { ok: true as const }
		},
	)

	action(
		'post',
		'/claim-codes',
		{
			operationId: 'createClaimCode',
			summary: 'A new one-time code (and deep link) that binds a device to this account',
			response: s.claimCodeResponse,
		},
		async (c) => {
			const claim = await createClaimCode(c.trx, config, c.accountId, c.actor, c.by)
			return { ...claim, link: `${config.urlScheme}://claim?code=${claim.code}` }
		},
	)

	action(
		'post',
		'/notes',
		{
			operationId: 'addAccountNote',
			summary: 'Add a support note to the account’s timeline',
			body: s.noteBody,
			response: okBody,
		},
		async (c) => {
			await recordEvent(c.trx, c.accountId, 'note', c.actor, { text: c.body.text })
			return { ok: true as const }
		},
	)

	action(
		'post',
		'/tickets',
		{
			operationId: 'linkAccountTicket',
			summary: 'Link a support ticket (URL or id) to the account',
			body: s.ticketBody,
			response: okBody,
		},
		async (c) => {
			await recordEvent(c.trx, c.accountId, 'ticket', c.actor, { ticket: c.body.ticket })
			return { ok: true as const }
		},
	)

	action(
		'post',
		'/refresh',
		{
			operationId: 'refreshAccountFromApple',
			summary:
				'Replace the account’s subscriptions with Apple’s current state (503 without an App Store Server API key)',
			response: s.refreshResponse,
			errors: [503],
		},
		async (c) => ({
			subscriptions: await refreshFromApple(c.trx, o.storeApi, o.appStore, c.accountId, c.actor, o.hooks, c.host),
		}),
	)
}
