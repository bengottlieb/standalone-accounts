import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { z, ZodError } from 'zod'

export class HttpError extends Error {
	constructor(
		readonly statusCode: number,
		message: string,
		readonly headers: Record<string, string> = {},
		/** Extra fields merged into the `{error}` JSON body. */
		readonly body: Record<string, unknown> = {},
	) {
		super(message)
	}
}

/** Validates input with zod, turning failures into 400s. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
	return schema.parse(data)
}

type Failure = Partial<FastifyError> & { headers?: Record<string, string>; body?: Record<string, unknown> }

/**
 * The account routes' error bodies (`contract/v1`): `{ error, …fields }`, and `{ error: 'invalid_request', issues }`
 * for bad input. It also formats errors the host's hooks throw on these routes (a rejected token), by duck type.
 */
export function acctErrorHandler(error: Failure, request: FastifyRequest, reply: FastifyReply) {
	if (error instanceof ZodError)
		return reply.status(400).send({
			error: 'invalid_request',
			issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
		})
	const status = error.statusCode
	// Deliberate errors keep their status (503 `verification_unavailable`); anything else 5xx is a failure.
	if (status && (status < 500 || error instanceof HttpError))
		return reply
			.status(status)
			.headers(error.headers ?? {})
			.send({ error: error.message, ...(error.body ?? {}) })
	request.log.error({ err: error }, 'request failed')
	return reply.status(500).send({ error: 'internal_error' })
}
