import Foundation

/// One way to sign in to the account. `label` is what to show: the email for `password`, the Apple email hint if any;
/// `name` is the name Apple shared, for `apple`.
///
/// `Kind` is an open set: a server may add its own kinds, and this build keeps them as unknown raw values.
public struct SignInIdentity: Codable, Sendable, Equatable {
	public struct Kind: RawRepresentable, Codable, Sendable, Hashable {
		public let rawValue: String
		public init(rawValue: String) { self.rawValue = rawValue }
		public static let apple = Kind(rawValue: "apple")
		public static let password = Kind(rawValue: "password")
		public static let gameCenter = Kind(rawValue: "game_center")
	}

	public var kind: Kind
	public var label: String?
	/// For `apple`, the name Apple shared on the first sign-in, if any (servers from 0.4.2 send it).
	public var name: String?

	public init(kind: Kind, label: String? = nil, name: String? = nil) {
		self.kind = kind
		self.label = label
		self.name = name
	}
}

/// `POST /api/v1/account/password`: changes (or, for an account without one, adds) the signed-in account's email and
/// password. `currentPassword` is needed when the account already has one.
public struct SetPasswordRequest: Codable, Sendable, Equatable {
	public var email: String
	public var password: String
	public var currentPassword: String?

	public init(email: String, password: String, currentPassword: String? = nil) {
		self.email = email
		self.password = password
		self.currentPassword = currentPassword
	}
}

/// `POST /api/v1/account/unlink`: removes one way of signing in from the signed-in account.
public struct UnlinkRequest: Codable, Sendable, Equatable {
	public var kind: SignInIdentity.Kind

	public init(kind: SignInIdentity.Kind) {
		self.kind = kind
	}
}
