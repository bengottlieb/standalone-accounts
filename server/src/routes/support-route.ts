import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { importPKCS8, SignJWT } from 'jose'
import { z } from 'zod'
import { HttpError } from '../http/errors.js'
import { dateTime, responses } from '../http/schema.js'
import { memberSecurity } from './options.js'

/** The host's AppSupport signing key (AppSupport's docs/DESIGN.md "Assertion contract"). */
export interface SupportAssertionOptions {
	/** This app's id at AppSupport (`pzl`): the assertion's `iss`. */
	appId: string
	/** The ES256 (P-256) private key, PEM PKCS#8. AppSupport holds the public half as a JWK under `keyId`. */
	privateKey: string
	/** The `kid` header, naming the key so keys can rotate. */
	keyId: string
}

/** AppSupport accepts at most five minutes. */
const LIFETIME_SECONDS = 300

const assertionBody = z.object({ assertion: z.string(), expiresAt: dateTime })

/**
 * `POST /api/v1/support/assertion`: a short-lived JWT that identifies the calling account to AppSupport. Any signed-in
 * account gets one, anonymous ones included, so feedback works before sign-in. AppSupport never calls back here.
 */
export async function supportAssertionRoute(app: FastifyInstance, o: SupportAssertionOptions) {
	const key = await importPKCS8(o.privateKey, 'ES256')
	app.post(
		'/api/v1/support/assertion',
		{
			schema: {
				tags: ['support'],
				summary: 'A five-minute assertion of this account for AppSupport',
				operationId: 'supportAssertion',
				security: memberSecurity,
				response: responses(assertionBody, 401),
			},
		},
		async (request) => {
			if (!request.account) throw new HttpError(401, 'Not signed in')
			const issuedAt = Math.floor(Date.now() / 1000)
			const expiresAt = issuedAt + LIFETIME_SECONDS
			const assertion = await new SignJWT()
				.setProtectedHeader({ alg: 'ES256', kid: o.keyId })
				.setIssuer(o.appId)
				.setAudience('appsupport')
				.setSubject(request.account.id.toLowerCase())
				.setIssuedAt(issuedAt)
				.setExpirationTime(expiresAt)
				.setJti(randomUUID())
				.sign(key)
			return { assertion, expiresAt: new Date(expiresAt * 1000) }
		},
	)
}
