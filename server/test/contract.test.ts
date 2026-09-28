import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { versions } from '../src/contract/versions.js'

type Fixture = { endpoint: string; request: unknown; response: { status: number; body: unknown } }

const root = join(import.meta.dirname, '../../contract')
const load = (version: string) =>
	readdirSync(join(root, version, 'fixtures'))
		.filter((name) => name.endsWith('.json'))
		.map((name) => [name, JSON.parse(readFileSync(join(root, version, 'fixtures', name), 'utf8')) as Fixture] as const)

it('has a contract directory for exactly the versions served', () => {
	const dirs = readdirSync(root).filter((d) => existsSync(join(root, d, 'fixtures')))
	expect(dirs.sort()).toEqual(Object.keys(versions).sort())
})

describe.each(Object.entries(versions))('contract %s', (version, { endpoints, error }) => {
	const fixtures = load(version)

	it('has fixtures for every endpoint', () => {
		const covered = new Set(fixtures.map(([, fixture]) => fixture.endpoint))
		expect([...covered].sort()).toEqual(Object.keys(endpoints).sort())
	})

	it('serves every endpoint under /api/accounts/<version>/', () => {
		for (const endpoint of Object.values(endpoints))
			expect(endpoint.path.startsWith(`/api/accounts/${version}/`)).toBe(true)
	})

	it.each(fixtures)('%s matches its endpoint', (_, fixture) => {
		const endpoint = endpoints[fixture.endpoint as keyof typeof endpoints]
		expect(endpoint).toBeDefined()
		if (endpoint.request) endpoint.request.parse(fixture.request)
		else expect(fixture.request).toBeNull()

		const { status, body } = fixture.response
		if (status >= 200 && status < 300) endpoint.response.parse(body)
		else error.parse(body)
	})
})
