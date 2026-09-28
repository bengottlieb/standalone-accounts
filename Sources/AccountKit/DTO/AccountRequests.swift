import Foundation

/// `POST /api/v1/auth/device`: find this device's account (or create one, in `first-launch` apps).
public struct DeviceAuthRequest: Codable, Sendable, Equatable {
	public var identity: AccountIdentity

	public init(identity: AccountIdentity) {
		self.identity = identity
	}
}

/// `POST /api/v1/auth/purchase`: attach signed transactions (`Transaction.jwsRepresentation`) and return their account,
/// creating it if none owns them yet.
public struct PurchaseAuthRequest: Codable, Sendable, Equatable {
	public var identity: AccountIdentity
	public var signedTransactions: [String]

	public init(identity: AccountIdentity, signedTransactions: [String]) {
		self.identity = identity
		self.signedTransactions = signedTransactions
	}
}

/// `POST /api/v1/auth/claim`: join the account an admin created, with the one-time code they sent.
public struct ClaimRequest: Codable, Sendable, Equatable {
	public var identity: AccountIdentity
	public var code: String

	public init(identity: AccountIdentity, code: String) {
		self.identity = identity
		self.code = code
	}
}
