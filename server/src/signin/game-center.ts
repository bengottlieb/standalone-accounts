import { verify as verifySignature, X509Certificate, type KeyObject } from 'node:crypto'
import { SignInRejected } from './apple.js'

// Game Center: GameKit's `fetchItems(forIdentityVerificationSignature:)` gives the app Apple's signature over the
// team-scoped player id, the bundle id, a timestamp and a salt, plus the URL of the certificate that verifies it.
// Apple's recipe: teamPlayerID ‖ bundleID ‖ timestamp (UInt64 big-endian, milliseconds) ‖ salt, SHA-256 with RSA.
// The certificate must come from an apple.com host over TLS; it is not walked up to Apple's root (a known gap).

export interface GameCenterProof {
	teamPlayerID: string
	bundleID: string
	publicKeyURL: string
	/** base64 */
	signature: string
	/** base64 */
	salt: string
	/** Milliseconds since the epoch, as GameKit reports it. */
	timestamp: number
}

/** Fetches the public key a proof names; injectable so tests can sign their own. */
export type GameCenterKeyFetcher = (url: URL) => Promise<KeyObject>

const MAX_AGE_MS = 60 * 60 * 1000
const KEY_CACHE_MS = 24 * 60 * 60 * 1000

/** Downloads the DER certificate, checks its dates, and keeps its key for a day. */
export function gameCenterKeyFetcher(fetchImpl: typeof fetch = fetch): GameCenterKeyFetcher {
	const cache = new Map<string, { key: KeyObject; at: number }>()
	return async (url) => {
		const cached = cache.get(url.href)
		if (cached && Date.now() - cached.at < KEY_CACHE_MS) return cached.key
		const response = await fetchImpl(url)
		if (!response.ok) throw new SignInRejected(`public key fetch failed with ${response.status}`)
		const certificate = new X509Certificate(Buffer.from(await response.arrayBuffer()))
		const now = new Date()
		if (new Date(certificate.validFrom) > now || new Date(certificate.validTo) < now)
			throw new SignInRejected('public key certificate is not currently valid')
		cache.set(url.href, { key: certificate.publicKey, at: Date.now() })
		return certificate.publicKey
	}
}

/** The bytes Apple signed, in the order it signed them. */
export function gameCenterSignedPayload(teamPlayerID: string, bundleID: string, timestamp: number, salt: Buffer) {
	const time = Buffer.alloc(8)
	time.writeBigUInt64BE(BigInt(timestamp))
	return Buffer.concat([Buffer.from(teamPlayerID, 'utf8'), Buffer.from(bundleID, 'utf8'), time, salt])
}

/** Verifies proofs for `bundleIds`; returns the team-scoped player id (the same across a team's apps). */
export function gameCenterVerifier(bundleIds: string[], fetchKey = gameCenterKeyFetcher(), now = () => Date.now()) {
	return async (proof: GameCenterProof): Promise<string> => {
		if (!bundleIds.includes(proof.bundleID)) throw new SignInRejected('Game Center proof is for a different app')
		let url: URL
		try {
			url = new URL(proof.publicKeyURL)
		} catch {
			throw new SignInRejected('public key URL is malformed')
		}
		const host = url.hostname.toLowerCase()
		if (url.protocol !== 'https:' || (host !== 'apple.com' && !host.endsWith('.apple.com')))
			throw new SignInRejected('public key URL is not Apple’s')
		// A value too small to be milliseconds is read as seconds for the freshness check only.
		const age = now() - (proof.timestamp < 1e12 ? proof.timestamp * 1000 : proof.timestamp)
		if (age > MAX_AGE_MS || age < -5 * 60 * 1000) throw new SignInRejected('Game Center proof has expired')
		const key = await fetchKey(url).catch((error: unknown) => {
			throw error instanceof SignInRejected ? error : new SignInRejected('public key could not be fetched')
		})
		const payload = gameCenterSignedPayload(
			proof.teamPlayerID,
			proof.bundleID,
			proof.timestamp,
			Buffer.from(proof.salt, 'base64'),
		)
		let valid = false
		try {
			valid = verifySignature('sha256', payload, key, Buffer.from(proof.signature, 'base64'))
		} catch {
			valid = false
		}
		if (!valid) throw new SignInRejected('Game Center signature did not verify')
		return proof.teamPlayerID
	}
}
