import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { versions } from '../src/contract/versions.js';

// Writes contract/<version>/openapi.json from the Zod schemas, so no document can drift from what the server enforces.
const schema = (type: z.ZodType) => z.toJSONSchema(type, { target: 'openapi-3.0' });

for (const [version, { endpoints, error }] of Object.entries(versions)) {
	const errorResponse = { description: 'Error', content: { 'application/json': { schema: schema(error) } } };
	const paths: Record<string, Record<string, unknown>> = {};
	for (const [operationId, endpoint] of Object.entries(endpoints)) {
		paths[endpoint.path] ??= {};
		paths[endpoint.path]![endpoint.method] = {
			operationId,
			...(endpoint.bearer ? { security: [{ bearer: [] }] } : {}),
			...(endpoint.request ? { requestBody: { required: true, content: { 'application/json': { schema: schema(endpoint.request) } } } } : {}),
			responses: { '200': { description: 'OK', content: { 'application/json': { schema: schema(endpoint.response) } } }, default: errorResponse },
		};
	}
	const document = {
		openapi: '3.0.3',
		info: { title: `Standalone accounts ${version}`, version: process.env.npm_package_version ?? '0.0.0' },
		components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
		paths,
	};
	writeFileSync(join(import.meta.dirname, `../../contract/${version}/openapi.json`), JSON.stringify(document, null, '\t') + '\n');
}
