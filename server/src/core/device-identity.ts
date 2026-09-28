import type { FastifyBaseLogger } from 'fastify'
import { SignedDataInvalid, VerificationUnavailable, type AppStoreVerifier } from '../appstore/verify.js'
import type { IdentityBody } from '../routes/contract.js'
import { keyedHash } from './ids.js'
import type { DeviceIdentity } from './identity.js'

/**
 * Turns a request's identity block into a `DeviceIdentity`: the secret hashed, and the app transaction verified
 * against Apple's chain. An app transaction that doesn't verify, or that the device withheld (`includeLinks: false`
 * after a sign-out), is dropped rather than failing the request: the device secret still works.
 */
export async function verifyIdentity(
	verifier: AppStoreVerifier,
	secret: string,
	body: IdentityBody,
	log: FastifyBaseLogger,
): Promise<DeviceIdentity> {
	let appTransactionId: string | null = null
	if (body.includeLinks && body.appTransactionJWS) {
		try {
			appTransactionId = (await verifier.appTransaction(body.appTransactionJWS)).appTransactionId ?? null
		} catch (error) {
			if (!(error instanceof SignedDataInvalid) && !(error instanceof VerificationUnavailable)) throw error
			log.info(
				{ reason: error instanceof SignedDataInvalid ? error.reason : 'unavailable' },
				'ignoring unverifiable app transaction',
			)
		}
	}
	return {
		secretHash: keyedHash(secret, body.deviceSecret),
		appTransactionId,
		icloudUserID: body.includeLinks ? (body.icloudUserID ?? null) : null,
		platform: body.platform,
		appVersion: body.appVersion,
		deviceName: body.deviceName?.trim() || null,
	}
}
