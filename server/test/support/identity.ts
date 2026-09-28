import { randomBytes } from 'node:crypto'
import { BUNDLE_ID, signJws, TEST_APP_APPLE_ID } from './storekit.js'

/** A device's identity block: a fresh secret unless one is given. */
export function identity(o: Record<string, unknown> = {}) {
	return {
		deviceSecret: randomBytes(32).toString('hex'),
		includeLinks: true,
		platform: 'ios',
		appVersion: '1.0 (1)',
		deviceName: 'iPhone',
		...o,
	}
}

/** A signed StoreKit AppTransaction for `appTransactionId` (Sandbox, test chain). */
export function appTransactionJWS(appTransactionId: string, o: Record<string, unknown> = {}) {
	return signJws({
		receiptType: 'Sandbox',
		appAppleId: TEST_APP_APPLE_ID,
		bundleId: BUNDLE_ID,
		applicationVersion: '1',
		receiptCreationDate: Date.now(),
		requestDate: Date.now(),
		originalApplicationVersion: '1',
		originalPurchaseDate: Date.now() - 86_400_000,
		appTransactionId,
		originalPlatform: 'iOS',
		signedDate: Date.now(),
		...o,
	})
}
