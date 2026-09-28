import { readdirSync, readFileSync } from 'node:fs'
import {
	Environment,
	SignedDataVerifier,
	type AppTransaction,
	VerificationException,
	VerificationStatus,
	type JWSRenewalInfoDecodedPayload,
	type JWSTransactionDecodedPayload,
	type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library'

/** Apple Root CA - G3 (and any other roots dropped in server/certs), from https://www.apple.com/certificateauthority/. */
export const APPLE_CERTS_DIR = new URL('../../certs/', import.meta.url)

export function loadAppleRoots(dir = APPLE_CERTS_DIR): Buffer[] {
	return readdirSync(dir)
		.filter((f) => f.endsWith('.cer'))
		.map((f) => readFileSync(new URL(f, dir)))
}

export type InvalidReason = 'signature' | 'chain' | 'bundle_id' | 'environment' | 'product' | 'type' | 'malformed'

/** Signed data that isn't a genuine App Store signature for this app. */
export class SignedDataInvalid extends Error {
	constructor(
		readonly reason: InvalidReason,
		/** Decoded without verification, for logging only. */
		readonly originalTransactionId?: string,
	) {
		super(`signed data invalid: ${reason}`)
	}
}

/** Verification couldn't finish (the OCSP revocation check failed to reach Apple); the caller should retry later. */
export class VerificationUnavailable extends Error {}

/** One app whose signed data this server accepts. */
export interface VerifiedApp {
	bundleId: string
	/** Required to accept Production data; without it Production is rejected as a wrong environment. */
	appAppleId?: number
}

export interface VerifierOptions {
	roots: Buffer[]
	/** Every app this server serves (PZLServer: Peasel and Crosswords). */
	apps: VerifiedApp[]
	environments: string[]
	onlineChecks: boolean
	/** Accept Xcode-signed data (StoreKit testing in Xcode), which no Apple chain verifies. Development only. */
	acceptXcode?: boolean
}

type Unverified = Record<string, unknown> & { data?: Record<string, unknown> }

/** Decodes a JWS payload without verifying it, to pick the verifier and to log. Null when it isn't a JWS. */
export function unverifiedPayload(jws: string): Unverified | null {
	const parts = jws.split('.')
	if (parts.length !== 3) return null
	try {
		const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as unknown
		return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Unverified) : null
	} catch {
		return null
	}
}

function reasonFor(error: unknown): InvalidReason {
	if (!(error instanceof VerificationException)) return 'malformed'
	switch (error.status) {
		case VerificationStatus.INVALID_APP_IDENTIFIER:
			return 'bundle_id'
		case VerificationStatus.INVALID_ENVIRONMENT:
			return 'environment'
		case VerificationStatus.FAILURE:
			return 'malformed'
		case VerificationStatus.VERIFICATION_FAILURE:
			// The library wraps jsonwebtoken's signature failure; a failed chain check has no cause.
			return (error.cause as Error | undefined)?.name === 'JsonWebTokenError' ? 'signature' : 'chain'
		default:
			return 'chain'
	}
}

/**
 * Verifies App Store signed data (StoreKit 2 transactions, renewal info, server notifications) with Apple's
 * SignedDataVerifier: the x5c chain must reach a trusted root with Apple's marker OIDs, the ES256 signature must match
 * the leaf, and the bundle id (plus the App Apple ID for Production notifications) and environment must be one of the
 * server's apps.
 */
export class AppStoreVerifier {
	/** Keyed `environment bundleId`. */
	private readonly verifiers = new Map<string, SignedDataVerifier>()
	private readonly acceptXcode: boolean
	private readonly bundleIds: string[]

	constructor(opts: VerifierOptions) {
		this.acceptXcode = opts.acceptXcode ?? false
		this.bundleIds = opts.apps.map((a) => a.bundleId)
		for (const app of opts.apps) {
			for (const env of opts.environments) {
				if (env === Environment.SANDBOX)
					this.verifiers.set(
						`${env} ${app.bundleId}`,
						new SignedDataVerifier(opts.roots, opts.onlineChecks, Environment.SANDBOX, app.bundleId),
					)
				if (env === Environment.PRODUCTION && app.appAppleId !== undefined)
					this.verifiers.set(
						`${env} ${app.bundleId}`,
						new SignedDataVerifier(opts.roots, opts.onlineChecks, Environment.PRODUCTION, app.bundleId, app.appAppleId),
					)
			}
		}
	}

	/** Environments this server accepts for any app (Production only for apps with an App Apple ID). */
	get environments() {
		return [...new Set([...this.verifiers.keys()].map((k) => k.split(' ')[0]!))]
	}

	transaction(jws: string): Promise<JWSTransactionDecodedPayload> {
		return this.verify(
			jws,
			(p) => p.environment,
			(v) => v.verifyAndDecodeTransaction(jws),
		)
	}

	renewalInfo(jws: string): Promise<JWSRenewalInfoDecodedPayload> {
		return this.verify(
			jws,
			(p) => p.environment,
			(v) => v.verifyAndDecodeRenewalInfo(jws),
		)
	}

	/** A StoreKit `AppTransaction.jwsRepresentation`: its `appTransactionId` identifies the Apple Account in this app. */
	appTransaction(jws: string): Promise<AppTransaction> {
		return this.verify(
			jws,
			(p) => p.receiptType,
			(v) => v.verifyAndDecodeAppTransaction(jws),
		)
	}

	notification(jws: string): Promise<ResponseBodyV2DecodedPayload> {
		return this.verify(
			jws,
			(p) => p.data?.environment ?? (p.summary as { environment?: unknown } | undefined)?.environment,
			(v) => v.verifyAndDecodeNotification(jws),
		)
	}

	private async verify<T>(
		jws: string,
		environmentOf: (p: Unverified) => unknown,
		run: (v: SignedDataVerifier) => Promise<T>,
	): Promise<T> {
		const payload = unverifiedPayload(jws)
		const otid = (payload?.originalTransactionId ?? undefined) as string | undefined
		if (!payload) throw new SignedDataInvalid('malformed')
		const environment = environmentOf(payload)
		if (environment === Environment.XCODE && this.acceptXcode) return payload as T
		// Renewal info names no app; any of ours verifies its signature.
		const bundle = (payload.bundleId ?? payload.data?.bundleId ?? this.bundleIds[0]) as string
		if (!this.bundleIds.includes(bundle)) throw new SignedDataInvalid('bundle_id', otid)
		const verifier = typeof environment === 'string' ? this.verifiers.get(`${environment} ${bundle}`) : undefined
		if (!verifier) throw new SignedDataInvalid('environment', otid)
		try {
			return await run(verifier)
		} catch (error) {
			if (error instanceof VerificationException && error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE)
				throw new VerificationUnavailable('App Store revocation check unavailable', { cause: error })
			throw new SignedDataInvalid(reasonFor(error), otid)
		}
	}
}
