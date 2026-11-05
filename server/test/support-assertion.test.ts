import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose'
import { beforeEach, describe, expect, it } from 'vitest'
import { SupportAssertionResponse } from '../src/contract/v1/schemas.js'
import { reset, testDb } from './support/db.js'
import { testHost } from './support/host.js'
import { identity } from './support/identity.js'

// AppSupport's assertion contract: ES256 with `kid`; iss = app id, aud = appsupport, sub = account id, exp ≤ 5 min.
describe('support assertion', () => {
	const db = testDb()
	const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
	const supportAssertion = {
		appId: 'pzl',
		privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
		keyId: 'pzl-2026-10',
	}
	const url = '/api/v1/support/assertion'
	let app: FastifyInstance

	beforeEach(async () => {
		await reset(db)
		app = await testHost(db, { config: { creation: 'first-launch' }, supportAssertion })
	})

	const anonymousAccount = async () =>
		(
			await app.inject({ method: 'POST', url: '/api/accounts/v1/auth/device', payload: { identity: identity() } })
		).json() as { token: string; account: { id: string } }

	it('signs a five-minute ES256 assertion of an anonymous account that verifies with the public JWK', async () => {
		const { token, account } = await anonymousAccount()
		const before = Math.floor(Date.now() / 1000)
		const res = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` } })
		expect(res.statusCode).toBe(200)
		const { assertion, expiresAt } = SupportAssertionResponse.parse(res.json())

		const jwk = { ...publicKey.export({ format: 'jwk' }), kid: supportAssertion.keyId }
		const { payload, protectedHeader } = await jwtVerify(assertion, await importJWK(jwk, 'ES256'), {
			algorithms: ['ES256'],
			issuer: 'pzl',
			audience: 'appsupport',
		})
		expect(protectedHeader).toEqual({ alg: 'ES256', kid: 'pzl-2026-10' })
		expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'jti', 'sub'])
		expect(payload.sub).toBe(account.id.toLowerCase())
		expect(payload.sub).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
		expect(payload.iat).toBeGreaterThanOrEqual(before)
		expect(payload.exp! - payload.iat!).toBe(300)
		expect(new Date(expiresAt).getTime()).toBe(payload.exp! * 1000)
		expect(payload.jti).toEqual(expect.any(String))
	})

	it('gives every assertion its own jti', async () => {
		const { token } = await anonymousAccount()
		const jti = async () => {
			const { assertion } = (
				await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` } })
			).json()
			expect(decodeProtectedHeader(assertion).kid).toBe('pzl-2026-10')
			return JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString()).jti
		}
		expect(await jti()).not.toBe(await jti())
	})

	it('refuses a caller with no account', async () => {
		const res = await app.inject({ method: 'POST', url })
		const fixture = join(import.meta.dirname, '../../contract/v1/fixtures/support-assertion.unauthorized.json')
		const { response } = JSON.parse(readFileSync(fixture, 'utf8'))
		expect(res.statusCode).toBe(response.status)
		expect(res.json()).toEqual(response.body)
	})

	it('is not there when the host configures no key', async () => {
		const plain = await testHost(db, { config: { creation: 'first-launch' } })
		const { token } = (
			await plain.inject({ method: 'POST', url: '/api/accounts/v1/auth/device', payload: { identity: identity() } })
		).json()
		const res = await plain.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` } })
		expect(res.statusCode).toBe(404)
	})
})
