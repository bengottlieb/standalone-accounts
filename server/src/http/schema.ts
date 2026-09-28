import { z } from 'zod'
import { HttpError } from './errors.js'

/** Converts a zod schema to JSON Schema for route docs; zod still does the real validation in handlers. */
export function jsonSchema(schema: z.ZodType) {
	const json = nullableTypes(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })) as Record<string, unknown>
	delete json.$schema
	return json
}

/**
 * `x.nullable()` becomes `anyOf: [x, {type: 'null'}]`, and Fastify's type coercion turns a null request value into
 * `""` or `0` against the first branch. As `type: [x, 'null']` a null matches and is left alone.
 */
function nullableTypes(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(nullableTypes)
	if (!node || typeof node !== 'object') return node
	const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, nullableTypes(v)])) as Record<string, unknown>
	const anyOf = out.anyOf as Record<string, unknown>[] | undefined
	if (anyOf?.length === 2 && anyOf[1]!.type === 'null' && typeof anyOf[0]!.type === 'string') {
		delete out.anyOf
		return { ...out, ...anyOf[0], type: [anyOf[0]!.type, 'null'] }
	}
	return out
}

/**
 * Converts a zod schema to a JSON Schema for a route's `response`. Fastify serializes with it, so it must list every
 * field the handler returns (unlisted ones are dropped). Objects stay open (no `additionalProperties: false`) so clients
 * can tolerate new fields.
 */
export function responseSchema(schema: z.ZodType) {
	const json = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) as Record<string, unknown>
	delete json.$schema
	return openObjects(json) as Record<string, unknown>
}

function openObjects(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(openObjects)
	if (!node || typeof node !== 'object') return node
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'additionalProperties' && value === false) continue
		if (key === 'propertyNames') continue
		out[key] = openObjects(value)
	}
	return out
}

/** A timestamp in a response: handlers return `Date`s and Fastify serializes them as ISO strings. */
export const dateTime = z.string().meta({ format: 'date-time' })
export const errorBody = z.object({ error: z.string() })
export const invalidRequestBody = z.object({
	error: z.literal('invalid_request'),
	issues: z.array(z.object({ path: z.string(), message: z.string() })),
})
export const okBody = z.object({ ok: z.literal(true) })

/** 402 from member routes: no live access (lapsed, refunded or never subscribed). Data is kept; subscribing restores it. */
export const subscriptionInactiveBody = z.object({
	error: z.literal('subscription_inactive'),
	status: z.enum(['expired', 'revoked', 'none']),
})
/** 409 when an action would pass a plan limit. */
export const limitExceededBody = z.object({
	error: z.literal('limit_exceeded'),
	limit: z.string(),
	max: z.number().int(),
	used: z.number().int(),
})

const errorJson = responseSchema(errorBody)
const sharedErrors: Record<number, Record<string, unknown>> = {
	// A 400 is either a zod failure in the handler or a plain message (Fastify's schema validation, HttpError).
	400: responseSchema(z.union([invalidRequestBody, errorBody])),
	402: responseSchema(subscriptionInactiveBody),
}

/**
 * A route's `response` map: the 200 body plus an error body for each listed status: the shared one for that status,
 * or `[status, schema]` for a route-specific body. Error bodies with extra fields need their own schema, since Fastify
 * drops fields the schema doesn't list.
 */
export function responses(ok: z.ZodType, ...errors: (number | [number, z.ZodType])[]) {
	return {
		200: responseSchema(ok),
		...Object.fromEntries(
			errors.map((e) =>
				typeof e === 'number' ? [e, sharedErrors[e] ?? errorJson] : [e[0], responseSchema(z.union([e[1], errorBody]))],
			),
		),
	}
}

export const isoDate = z.coerce.date()
export const appId = z.coerce.number().int().positive()
export const platform = z.enum(['iphone', 'ipad', 'mac', 'appletv', 'watch', 'vision'])
export const chartType = z.enum(['free', 'paid', 'grossing'])
export const storefront = z
	.string()
	.length(2)
	.transform((s) => s.toLowerCase())

/** Routes open to admin/viewer users (session or API key) and to StoreKeeper members. */
export const readerSecurity: Record<string, string[]>[] = [{ apiKey: [] }, { memberToken: [] }]

const DAY_MS = 86_400_000

/**
 * A query with `from`/`to` (ISO 8601; date-only allowed) resolved to a window: `to` defaults to now and `from` to
 * `defaultDays` before `to`. `from` after `to`, or a span over `maxDays`, is a 400 `invalid_range`.
 */
export function dateRange<T extends z.ZodRawShape>(defaultDays: number, maxDays: number, shape?: T) {
	const span = Number.isFinite(maxDays) ? ` The range may span at most ${maxDays} days.` : ''
	return z
		.object({
			...(shape as T),
			from: isoDate.optional().meta({ description: `Start (default: ${defaultDays} days before \`to\`).${span}` }),
			to: isoDate.optional().meta({ description: 'End (default: now)' }),
		})
		.transform((q) => {
			const given = q as { from?: Date; to?: Date }
			const to = given.to ?? new Date()
			const from = given.from ?? new Date(to.getTime() - defaultDays * DAY_MS)
			if (from > to || to.getTime() - from.getTime() > maxDays * DAY_MS) throw new HttpError(400, 'invalid_range')
			return { ...q, from, to }
		})
}
