import Foundation

/// Every account call, with its method and path exactly as `contract/openapi.json` has them. The case names are the
/// OpenAPI operation ids and the `endpoint` field of `contract/fixtures`.
public enum AccountEndpoint: String, CaseIterable, Sendable {
	case authDevice, authPurchase, authClaim, account, signOut, deleteAccount

	public enum Method: String, Sendable {
		case get = "GET", post = "POST", delete = "DELETE"
	}

	public var method: Method {
		switch self {
		case .authDevice, .authPurchase, .authClaim, .signOut: .post
		case .account: .get
		case .deleteAccount: .delete
		}
	}

	public var path: String {
		switch self {
		case .authDevice: "/api/v1/auth/device"
		case .authPurchase: "/api/v1/auth/purchase"
		case .authClaim: "/api/v1/auth/claim"
		case .account, .deleteAccount: "/api/v1/account"
		case .signOut: "/api/v1/account/signout"
		}
	}

	/// Whether the call sends this device's bearer token. The `auth` calls prove identity with the device secret instead.
	public var requiresToken: Bool {
		switch self {
		case .authDevice, .authPurchase, .authClaim: false
		case .account, .signOut, .deleteAccount: true
		}
	}
}
