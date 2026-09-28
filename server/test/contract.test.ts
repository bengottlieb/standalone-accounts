import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { endpoints, type EndpointName } from '../src/contract/endpoints.js';
import { ErrorResponse } from '../src/contract/schemas.js';

type Fixture = { endpoint: EndpointName; request: unknown; response: { status: number; body: unknown } };

const dir = join(import.meta.dirname, '../../contract/fixtures');
const fixtures = readdirSync(dir)
	.filter((name) => name.endsWith('.json'))
	.map((name) => [name, JSON.parse(readFileSync(join(dir, name), 'utf8')) as Fixture] as const);

describe('contract fixtures', () => {
	it('exist for every endpoint', () => {
		const covered = new Set(fixtures.map(([, fixture]) => fixture.endpoint));
		expect([...covered].sort()).toEqual(Object.keys(endpoints).sort());
	});

	it.each(fixtures)('%s matches its endpoint', (_, fixture) => {
		const endpoint = endpoints[fixture.endpoint];
		expect(endpoint).toBeDefined();
		if (endpoint.request) endpoint.request.parse(fixture.request);
		else expect(fixture.request).toBeNull();

		const { status, body } = fixture.response;
		if (status >= 200 && status < 300) endpoint.response.parse(body);
		else ErrorResponse.parse(body);
	});
});
