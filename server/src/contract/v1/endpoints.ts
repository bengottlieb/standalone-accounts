import type { z } from 'zod';
import * as s from './schemas.js';

type Endpoint = {
	method: 'get' | 'post' | 'delete';
	path: string;
	/** Requires the device's bearer token (`checkIn` takes one optionally). */
	bearer: boolean;
	request: z.ZodType | null;
	response: z.ZodType;
};

// Mirrors AccountKit's AccountEndpoint; the fixture tests on both sides key off these names.
export const endpoints = {
	checkIn: { method: 'post', path: '/api/v1/check-in', bearer: false, request: s.CheckInRequest, response: s.CheckInResponse },
	authDevice: { method: 'post', path: '/api/v1/auth/device', bearer: false, request: s.DeviceAuthRequest, response: s.DeviceAuthResponse },
	authPurchase: { method: 'post', path: '/api/v1/auth/purchase', bearer: false, request: s.PurchaseAuthRequest, response: s.AuthResponse },
	authClaim: { method: 'post', path: '/api/v1/auth/claim', bearer: false, request: s.ClaimRequest, response: s.AuthResponse },
	account: { method: 'get', path: '/api/v1/account', bearer: true, request: null, response: s.AccountSummary },
	signOut: { method: 'post', path: '/api/v1/account/signout', bearer: true, request: null, response: s.OKResponse },
	deleteAccount: { method: 'delete', path: '/api/v1/account', bearer: true, request: null, response: s.OKResponse },
} as const satisfies Record<string, Endpoint>;

export type EndpointName = keyof typeof endpoints;
