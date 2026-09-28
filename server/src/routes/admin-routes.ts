import type { FastifyInstance } from 'fastify'
import { HttpError, parse } from '../http/errors.js'
import { jsonSchema, okBody, responses } from '../http/schema.js'
import { refreshAccess } from '../core/access.js'
import { createAccount, deleteAccount } from '../core/accounts.js'
import { accountDetail } from '../admin/detail.js'
import { listAccounts } from '../admin/list.js'
import { searchAccounts } from '../admin/search.js'
import { createClaimCode } from '../core/claim.js'
import { recordEvent } from '../core/events.js'
import { addGrant } from '../core/overrides.js'
import * as s from './admin-schemas.js'
import { adminActionRoutes } from './admin-action-routes.js'
import { adminTags as tags, type AcctAdminOptions } from './options.js'

/** The admin API over accounts: browse and search, detail, create, delete, and unclaimed purchases. */
export function acctAdminRoutes(app: FastifyInstance, o: AcctAdminOptions) {
	const { db, config, guards } = o
	const BASE = `${o.adminPrefix ?? '/api/v1/admin'}/accounts`
	const PURCHASES = `${o.adminPrefix ?? '/api/v1/admin'}/purchases`
	const actor = (userId: string) => `admin:${userId}` as const

	app.get(
		BASE,
		{
			preHandler: guards.read,
			schema: {
				tags,
				summary:
					'Accounts, newest first. `q` recognizes what was pasted: an account id or prefix, Support ID, claim code, Apple ' +
					'Order ID, original transaction or app transaction id, device id; otherwise it searches device names and tracked apps.',
				operationId: 'listAccounts',
				querystring: jsonSchema(s.listQuery),
				response: responses(s.listResponse, 400, 401, 403),
			},
		},
		async (request) => {
			const { q, ...filters } = parse(s.listQuery, request.query)
			const ids = q ? await searchAccounts(db, config, o.storeApi, o.appStore, q, o.searchHook) : undefined
			return listAccounts(db, { ...filters, ids })
		},
	)

	app.get(
		`${BASE}/:id`,
		{
			preHandler: guards.read,
			schema: {
				tags,
				summary: 'One account in full: access, purchases, grants, links, devices, tokens and its timeline',
				operationId: 'getAccountDetail',
				response: responses(s.detailResponse, 401, 403, 404),
			},
		},
		async (request) => {
			const detail = await accountDetail(db, parse(s.idParams, request.params).id, o.adminNames)
			if (!detail) throw new HttpError(404, 'account_not_found')
			return detail
		},
	)

	app.post(
		BASE,
		{
			preHandler: guards.write,
			schema: {
				tags,
				summary: 'Create an account (optionally with a grant) and a claim code to bind it to someone’s device',
				operationId: 'createAccount',
				body: jsonSchema(s.createBody),
				response: responses(s.createResponse, 400, 401, 403),
			},
		},
		async (request) => {
			const body = parse(s.createBody, request.body)
			const by = o.userId(request)
			return db.transaction().execute(async (trx) => {
				const account = await createAccount(trx, config, actor(by), 'admin')
				if (body.note) await recordEvent(trx, account.id, 'note', actor(by), { text: body.note })
				if (body.grant)
					await addGrant(
						trx,
						account.id,
						{
							planId: body.grant.plan,
							source: body.grant.source,
							expiresAt: body.grant.expiresAt,
							note: body.grant.note,
						},
						actor(by),
						by,
					)
				const claim = await createClaimCode(trx, config, account.id, actor(by), by)
				return {
					id: account.id,
					supportId: account.support_id,
					claim: { ...claim, link: `${config.urlScheme}://claim?code=${claim.code}` },
				}
			})
		},
	)

	app.delete(
		`${BASE}/:id`,
		{
			preHandler: guards.write,
			schema: {
				tags,
				summary: 'Delete an account and everything in it (its purchases become unclaimed)',
				operationId: 'deleteAccountAdmin',
				response: responses(okBody, 401, 403, 404),
			},
		},
		async (request) => {
			const { id } = parse(s.idParams, request.params)
			const deleted = await db.transaction().execute((trx) => deleteAccount(trx, id, actor(o.userId(request))))
			if (!deleted) throw new HttpError(404, 'account_not_found')
			return { ok: true as const }
		},
	)

	app.get(
		`${PURCHASES}/unclaimed`,
		{
			preHandler: guards.read,
			schema: {
				tags,
				summary: 'Purchases Apple told us about that no account has claimed',
				operationId: 'listUnclaimedPurchases',
				response: responses(s.unclaimedResponse, 401, 403),
			},
		},
		async () => {
			const rows = await db
				.selectFrom('acct_purchases')
				.selectAll()
				.where('account_id', 'is', null)
				.orderBy('created_at', 'desc')
				.limit(500)
				.execute()
			return {
				purchases: rows.map((r) => ({
					id: r.id,
					type: r.type,
					originalTransactionId: r.original_transaction_id,
					environment: r.environment,
					productId: r.product_id,
					status: r.status,
					expiresAt: r.expires_at,
					createdAt: r.created_at,
				})),
			}
		},
	)

	app.post(
		`${PURCHASES}/:id/attach`,
		{
			preHandler: guards.write,
			schema: {
				tags,
				summary: 'Attach an unclaimed purchase to an account',
				operationId: 'attachPurchase',
				body: jsonSchema(s.attachBody),
				response: responses(okBody, 400, 401, 403, 404, 409),
			},
		},
		async (request) => {
			const { id } = parse(s.idParams, request.params)
			const { accountId } = parse(s.attachBody, request.body)
			await db.transaction().execute(async (trx) => {
				const sub = await trx
					.selectFrom('acct_purchases')
					.select(['account_id', 'original_transaction_id'])
					.where('id', '=', id)
					.forUpdate()
					.executeTakeFirst()
				if (!sub) throw new HttpError(404, 'purchase_not_found')
				if (sub.account_id) throw new HttpError(409, 'purchase_in_use')
				const account = await trx
					.selectFrom('acct_accounts')
					.select('id')
					.where('id', '=', accountId)
					.executeTakeFirst()
				if (!account) throw new HttpError(404, 'account_not_found')
				await trx
					.updateTable('acct_purchases')
					.set({ account_id: accountId, updated_at: new Date() })
					.where('id', '=', id)
					.execute()
				await recordEvent(trx, accountId, 'purchase_attached', actor(o.userId(request)), {
					originalTransactionId: sub.original_transaction_id,
				})
				await refreshAccess(trx, accountId, actor(o.userId(request)))
			})
			return { ok: true as const }
		},
	)

	adminActionRoutes(app, o)
}
