import type { z } from 'zod'
import * as s from './schemas.js'

type Endpoint = {
	method: 'get' | 'post' | 'delete'
	path: string
	/** Requires the device's bearer token (`checkIn` takes one optionally). */
	bearer: boolean
	request: z.ZodType | null
	response: z.ZodType
}

// Mirrors AccountKit's AccountEndpoint; the fixture tests on both sides key off these names.
export const endpoints = {
	checkIn: {
		method: 'post',
		path: '/api/accounts/v1/check-in',
		bearer: false,
		request: s.CheckInRequest,
		response: s.CheckInResponse,
	},
	authDevice: {
		method: 'post',
		path: '/api/accounts/v1/auth/device',
		bearer: false,
		request: s.DeviceAuthRequest,
		response: s.DeviceAuthResponse,
	},
	authPurchase: {
		method: 'post',
		path: '/api/accounts/v1/auth/purchase',
		bearer: false,
		request: s.PurchaseAuthRequest,
		response: s.AuthResponse,
	},
	authClaim: {
		method: 'post',
		path: '/api/accounts/v1/auth/claim',
		bearer: false,
		request: s.ClaimRequest,
		response: s.AuthResponse,
	},
	account: { method: 'get', path: '/api/accounts/v1/account', bearer: true, request: null, response: s.AccountSummary },
	signOut: {
		method: 'post',
		path: '/api/accounts/v1/account/signout',
		bearer: true,
		request: null,
		response: s.OKResponse,
	},
	deleteAccount: {
		method: 'delete',
		path: '/api/accounts/v1/account',
		bearer: true,
		request: null,
		response: s.OKResponse,
	},
	signInWithApple: {
		method: 'post',
		path: '/api/accounts/v1/auth/apple',
		bearer: false,
		request: s.AppleSignInRequest,
		response: s.AuthResponse,
	},
	registerPassword: {
		method: 'post',
		path: '/api/accounts/v1/auth/password/register',
		bearer: false,
		request: s.PasswordRequest,
		response: s.AuthResponse,
	},
	signInWithPassword: {
		method: 'post',
		path: '/api/accounts/v1/auth/password/signin',
		bearer: false,
		request: s.PasswordRequest,
		response: s.AuthResponse,
	},
	forgotPassword: {
		method: 'post',
		path: '/api/accounts/v1/auth/password/forgot',
		bearer: false,
		request: s.ForgotPasswordRequest,
		response: s.OKResponse,
	},
	resetPassword: {
		method: 'post',
		path: '/api/accounts/v1/auth/password/reset',
		bearer: false,
		request: s.ResetPasswordRequest,
		response: s.AuthResponse,
	},
	signInWithGameCenter: {
		method: 'post',
		path: '/api/accounts/v1/auth/game-center',
		bearer: false,
		request: s.GameCenterSignInRequest,
		response: s.AuthResponse,
	},
	setPassword: {
		method: 'post',
		path: '/api/accounts/v1/account/password',
		bearer: true,
		request: s.SetPasswordRequest,
		response: s.OKResponse,
	},
	unlinkIdentity: {
		method: 'post',
		path: '/api/accounts/v1/account/unlink',
		bearer: true,
		request: s.UnlinkRequest,
		response: s.AccountSummary,
	},
} as const satisfies Record<string, Endpoint>

export type EndpointName = keyof typeof endpoints
