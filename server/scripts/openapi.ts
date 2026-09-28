import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { endpoints } from '../src/contract/endpoints.js';
import { ErrorResponse } from '../src/contract/schemas.js';

// Writes contract/openapi.json from the Zod schemas, so the document can't drift from what the server enforces.
const schema = (type: z.ZodType) => z.toJSONSchema(type, { target: 'openapi-3.0' });
const error = { description: 'Error', content: { 'application/json': { schema: schema(ErrorResponse) } } };

const paths: Record<string, Record<string, unknown>> = {};
for (const [operationId, endpoint] of Object.entries(endpoints)) {
	paths[endpoint.path] ??= {};
	paths[endpoint.path]![endpoint.method] = {
		operationId,
		...(endpoint.bearer ? { security: [{ bearer: [] }] } : {}),
		...(endpoint.request ? { requestBody: { required: true, content: { 'application/json': { schema: schema(endpoint.request) } } } } : {}),
		responses: { '200': { description: 'OK', content: { 'application/json': { schema: schema(endpoint.response) } } }, default: error },
	};
}

const document = {
	openapi: '3.0.3',
	info: { title: 'Standalone accounts', version: process.env.npm_package_version ?? '0.0.0' },
	components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
	paths,
};
writeFileSync(join(import.meta.dirname, '../../contract/openapi.json'), JSON.stringify(document, null, '\t') + '\n');
