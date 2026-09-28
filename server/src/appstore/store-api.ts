import { readFileSync } from 'node:fs'
import { AppStoreServerAPIClient, Environment } from '@apple/app-store-server-library'

/** One subscription's latest state from Apple's `getAllSubscriptionStatuses`. */
export interface AppleSubscriptionStatus {
	originalTransactionId: string
	/** 1 active, 2 expired, 3 billing retry, 4 grace period, 5 revoked. */
	status: number
	signedTransactionInfo?: string
	signedRenewalInfo?: string
}

/** The App Store Server API calls the admin tools need; tests inject a fake. */
export interface StoreApi {
	statuses(environment: 'Production' | 'Sandbox', originalTransactionId: string): Promise<AppleSubscriptionStatus[]>
	/** The signed transactions in a customer's order (the `M…` Order ID on their receipt); empty when unknown. */
	lookUpOrder(orderId: string): Promise<string[]>
}

export interface StoreApiCredentials {
	issuerId: string
	keyId: string
	/** Path to the App Store Connect API in-app purchase key (.p8). */
	keyPath: string
	bundleId: string
}

/** The real API. Order IDs only exist in Production, so lookups go there. */
export function appStoreServerApi(c: StoreApiCredentials): StoreApi {
	const key = readFileSync(c.keyPath, 'utf8')
	const clients = {
		Production: new AppStoreServerAPIClient(key, c.keyId, c.issuerId, c.bundleId, Environment.PRODUCTION),
		Sandbox: new AppStoreServerAPIClient(key, c.keyId, c.issuerId, c.bundleId, Environment.SANDBOX),
	}
	return {
		async statuses(environment, originalTransactionId) {
			const response = await clients[environment].getAllSubscriptionStatuses(originalTransactionId)
			return (response.data ?? []).flatMap((group) =>
				(group.lastTransactions ?? []).map((t) => ({
					originalTransactionId: t.originalTransactionId ?? originalTransactionId,
					status: Number(t.status),
					signedTransactionInfo: t.signedTransactionInfo,
					signedRenewalInfo: t.signedRenewalInfo,
				})),
			)
		},
		async lookUpOrder(orderId) {
			const response = await clients.Production.lookUpOrderId(orderId)
			return Number(response.status) === 0 ? (response.signedTransactions ?? []) : []
		},
	}
}
