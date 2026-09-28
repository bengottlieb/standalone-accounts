import Foundation

/// Every account call, with its method and path exactly as `contract/v1/openapi.json` has them. The case names are the
/// OpenAPI operation ids and the `endpoint` field of `contract/v1/fixtures`.
public enum AccountEndpoint: String, CaseIterable, Sendable {
	case checkIn, authDevice, authPurchase, authClaim, account, signOut, deleteAccount
	case signInWithApple, registerPassword, signInWithPassword, forgotPassword, resetPassword, signInWithGameCenter
	case setPassword, unlinkIdentity

	/// The protocol version this build speaks. Servers keep serving it after they add newer ones (`contract/README.md`).
	public static let protocolVersion = "v1"

	public enum Method: String, Sendable {
		case get = "GET", post = "POST", delete = "DELETE"
	}

	public var method: Method {
		switch self {
		case .checkIn, .authDevice, .authPurchase, .authClaim, .signOut: .post
		case .signInWithApple, .registerPassword, .signInWithPassword, .forgotPassword, .resetPassword, .signInWithGameCenter: .post
		case .setPassword, .unlinkIdentity: .post
		case .account: .get
		case .deleteAccount: .delete
		}
	}

	public var path: String {
		"/api/accounts/\(Self.protocolVersion)" + relativePath
	}

	var relativePath: String {
		switch self {
		case .checkIn: "/check-in"
		case .authDevice: "/auth/device"
		case .authPurchase: "/auth/purchase"
		case .authClaim: "/auth/claim"
		case .account, .deleteAccount: "/account"
		case .signOut: "/account/signout"
		case .signInWithApple: "/auth/apple"
		case .registerPassword: "/auth/password/register"
		case .signInWithPassword: "/auth/password/signin"
		case .forgotPassword: "/auth/password/forgot"
		case .resetPassword: "/auth/password/reset"
		case .signInWithGameCenter: "/auth/game-center"
		case .setPassword: "/account/password"
		case .unlinkIdentity: "/account/unlink"
		}
	}

	/// Whether the call needs this device's bearer token. The `auth` calls prove identity with the device secret instead;
	/// `checkIn` sends the token when there is one.
	public var requiresToken: Bool {
		switch self {
		case .checkIn, .authDevice, .authPurchase, .authClaim: false
		case .signInWithApple, .registerPassword, .signInWithPassword, .forgotPassword, .resetPassword, .signInWithGameCenter: false
		case .account, .signOut, .deleteAccount, .setPassword, .unlinkIdentity: true
		}
	}
}
