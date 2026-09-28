import { createPrivateKey, randomUUID, sign, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Signs StoreKit-style JWS (ES256 with an x5c chain) using the throwaway certificate chains that
 * `server/scripts/make-storekit-fixtures.ts` generates. `trusted` chains to `root.cer`, which tests inject in place
 * of Apple's root; `untrusted` chains to a root the verifier doesn't know.
 */
export const STOREKIT_FIXTURES = fileURLToPath(new URL('../fixtures/storekit/', import.meta.url))
export const BUNDLE_ID = 'com.standalone.storekeeper'
export const MONTHLY = 'com.standalone.storekeeper.monthly'
export const ANNUAL = 'com.standalone.storekeeper.annual'
/** A one-time (non-consumable) purchase the test plan lists. */
export const LIFETIME = 'com.standalone.storekeeper.lifetime'
export const TEST_APP_APPLE_ID = 1234567890
export type ChainName = 'trusted' | 'untrusted'

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url')

function derOf(pem: string) {
	return new X509Certificate(pem).raw.toString('base64')
}

export function testRoot(): Buffer {
	return readFileSync(`${STOREKIT_FIXTURES}chain/root.cer`)
}

export function signJws(payload: object, chain: ChainName = 'trusted', dir = STOREKIT_FIXTURES): string {
	const file = (name: string) => readFileSync(`${dir}chain/${chain}-${name}.pem`, 'utf8')
	const x5c = [derOf(file('leaf')), derOf(file('intermediate')), derOf(file('root'))]
	const signingInput = `${b64url(JSON.stringify({ alg: 'ES256', x5c }))}.${b64url(JSON.stringify(payload))}`
	const signature = sign('sha256', Buffer.from(signingInput), {
		key: createPrivateKey(file('leaf-key')),
		dsaEncoding: 'ieee-p1363',
	})
	return `${signingInput}.${b64url(signature)}`
}

let seq = 1000

/** A decoded StoreKit 2 transaction for the Pro monthly subscription; override any field. */
export function transaction(o: Record<string, unknown> = {}) {
	const now = Date.now()
	const id = String(++seq)
	return {
		transactionId: id,
		originalTransactionId: '2000000000000001',
		webOrderLineItemId: id,
		bundleId: BUNDLE_ID,
		productId: MONTHLY,
		subscriptionGroupIdentifier: '21000001',
		purchaseDate: now - 86_400_000,
		originalPurchaseDate: now - 86_400_000,
		expiresDate: now + 29 * 86_400_000,
		quantity: 1,
		type: 'Auto-Renewable Subscription',
		inAppOwnershipType: 'PURCHASED',
		signedDate: now,
		environment: 'Sandbox',
		transactionReason: 'PURCHASE',
		storefront: 'USA',
		storefrontId: '143441',
		price: 4990,
		currency: 'USD',
		...o,
	}
}

/** Decoded renewal info matching `transaction()`; override any field. */
export function renewalInfo(o: Record<string, unknown> = {}) {
	const now = Date.now()
	return {
		originalTransactionId: '2000000000000001',
		autoRenewProductId: MONTHLY,
		productId: MONTHLY,
		autoRenewStatus: 1,
		isInBillingRetryPeriod: false,
		signedDate: now,
		environment: 'Sandbox',
		recentSubscriptionStartDate: now - 86_400_000,
		renewalDate: now + 29 * 86_400_000,
		...o,
	}
}

export interface NotificationParts {
	subtype?: string
	uuid?: string
	signedDate?: number
	transaction?: object | null
	renewalInfo?: object | null
	environment?: string
	bundleId?: string
	appAppleId?: number
	chain?: ChainName
}

/** A signed App Store Server Notification V2 body (`{signedPayload}`) with signed transaction and renewal info. */
export function signedNotification(type: string, p: NotificationParts = {}) {
	const chain = p.chain ?? 'trusted'
	const tx = p.transaction === undefined ? transaction() : p.transaction
	const renewal = p.renewalInfo === undefined ? renewalInfo() : p.renewalInfo
	const payload = {
		notificationType: type,
		...(p.subtype ? { subtype: p.subtype } : {}),
		notificationUUID: p.uuid ?? randomUUID(),
		version: '2.0',
		signedDate: p.signedDate ?? Date.now(),
		data: {
			appAppleId: p.appAppleId ?? TEST_APP_APPLE_ID,
			bundleId: p.bundleId ?? BUNDLE_ID,
			bundleVersion: '1',
			environment: p.environment ?? 'Sandbox',
			...(tx ? { signedTransactionInfo: signJws(tx, chain) } : {}),
			...(renewal ? { signedRenewalInfo: signJws(renewal, chain) } : {}),
			status: 1,
		},
	}
	return { signedPayload: signJws(payload, chain) }
}
