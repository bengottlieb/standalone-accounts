import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

// Sign in with Apple: an identity token verified against Apple's published keys. The account key is the token's
// stable `sub`; the email claim may be absent or a private-relay address and is only a label.

const APPLE_ISSUER = 'https://appleid.apple.com'
const APPLE_KEYS = new URL('https://appleid.apple.com/auth/keys')

export interface AppleIdentity {
	sub: string
	email?: string
}

export class SignInRejected extends Error {}

/** Verifies identity tokens for `audiences` (the apps' bundle ids). `getKey` is injectable for tests. */
export function appleVerifier(audiences: string[], getKey: JWTVerifyGetKey = createRemoteJWKSet(APPLE_KEYS)) {
	return async (identityToken: string): Promise<AppleIdentity> => {
		let payload
		try {
			;({ payload } = await jwtVerify(identityToken, getKey, { issuer: APPLE_ISSUER, audience: audiences }))
		} catch (error) {
			throw new SignInRejected(error instanceof Error ? error.message : 'invalid identity token')
		}
		if (typeof payload.sub !== 'string' || !payload.sub) throw new SignInRejected('identity token has no subject')
		return { sub: payload.sub, ...(typeof payload.email === 'string' ? { email: payload.email } : {}) }
	}
}
