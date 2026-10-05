import Foundation

/// A bound device: its account and the bearer token for this device.
public struct AccountAuthResponse: Codable, Sendable, Equatable {
	public var account: AccountSummary
	public var token: String
	public var isNew: Bool
	/// True when signing in folded this device's anonymous account into the one signed in to: reload local data.
	public var merged: Bool?

	public init(account: AccountSummary, token: String, isNew: Bool, merged: Bool? = nil) {
		self.account = account
		self.token = token
		self.isNew = isNew
		self.merged = merged
	}
}

/// `/auth/device` answers `{ "account": null }` for a device no account knows, in apps that only create accounts on a
/// purchase, claim or admin action. That is a normal answer, not an error.
public enum DeviceAuthResponse: Codable, Sendable, Equatable {
	case bound(AccountAuthResponse)
	case noAccount

	private enum CodingKeys: String, CodingKey { case account }

	public init(from decoder: any Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		if try container.decodeNil(forKey: .account) {
			self = .noAccount
		} else {
			self = .bound(try AccountAuthResponse(from: decoder))
		}
	}

	public func encode(to encoder: any Encoder) throws {
		switch self {
		case .bound(let response): try response.encode(to: encoder)
		case .noAccount:
			var container = encoder.container(keyedBy: CodingKeys.self)
			try container.encodeNil(forKey: .account)
		}
	}
}

public struct AccountOKResponse: Codable, Sendable, Equatable {
	public var ok: Bool
}

/// Every non-2xx body: `{ "error": "<code>", "message"?: "…" }`.
public struct AccountErrorResponse: Codable, Sendable, Equatable, Error {
	public var error: AccountErrorCode
	public var message: String?
	/// With `passwordTooShort`: the server's minimum length, for the message to show.
	public var minLength: Int?
}

public enum AccountErrorCode: Codable, Sendable, Hashable {
	case invalidRequest, unauthorized, accountSuspended, purchaseInUse, identityInUse, transactionInvalid, transactionRevoked
	case codeNotFound, codeExpired, rateLimited, verificationUnavailable
	case invalidCredentials, emailInUse, signinUnavailable, passwordTooShort
	/// A code this build doesn't know yet; the server may add codes.
	case other(String)

	static let known: [String: AccountErrorCode] = [
		"invalid_request": .invalidRequest, "unauthorized": .unauthorized, "account_suspended": .accountSuspended,
		"purchase_in_use": .purchaseInUse, "identity_in_use": .identityInUse, "transaction_invalid": .transactionInvalid,
		"transaction_revoked": .transactionRevoked, "code_not_found": .codeNotFound, "code_expired": .codeExpired,
		"rate_limited": .rateLimited, "verification_unavailable": .verificationUnavailable,
		"invalid_credentials": .invalidCredentials, "email_in_use": .emailInUse, "signin_unavailable": .signinUnavailable,
		"password_too_short": .passwordTooShort,
	]

	public var rawValue: String {
		if case .other(let raw) = self { return raw }
		return Self.known.first { $0.value == self }!.key
	}

	public init(from decoder: any Decoder) throws {
		let raw = try decoder.singleValueContainer().decode(String.self)
		self = Self.known[raw] ?? .other(raw)
	}

	public func encode(to encoder: any Encoder) throws {
		var container = encoder.singleValueContainer()
		try container.encode(rawValue)
	}
}
