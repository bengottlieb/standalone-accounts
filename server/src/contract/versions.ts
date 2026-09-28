import { endpoints as v1Endpoints } from './v1/endpoints.js'
import { ErrorResponse as v1Error } from './v1/schemas.js'

/**
 * Every protocol version a server built on this library still serves, oldest first. A version leaves only when no
 * supported app build speaks it; until then its fixtures (contract/<version>/fixtures) must keep passing.
 */
export const versions = {
	v1: { endpoints: v1Endpoints, error: v1Error },
} as const
export type ProtocolVersion = keyof typeof versions
