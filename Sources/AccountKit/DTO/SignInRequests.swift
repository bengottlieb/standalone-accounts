import Foundation

/// `POST /api/v1/auth/apple`: Sign in with Apple, with the identity token from `ASAuthorizationAppleIDCredential` and
/// the name Apple gives only on the first authorization.
public struct AppleSignInRequest: Codable, Sendable, Equatable {
	public var identity: AccountIdentity
	public var identityToken: String
	public var name: String?

	public init(identity: AccountIdentity, identityToken: String, name: String? = nil) {
		self.identity = identity
		self.identityToken = identityToken
		self.name = name
	}
}

/// `POST /api/v1/auth/password/register` and `/signin`: email and password. Registering an email that already has an
/// account signs in to it when the password is right.
public struct PasswordRequest: Codable, Sendable, Equatable {
	public var identity: AccountIdentity
	public var email: String
	/// At least 8 characters.
	public var password: String

	public init(identity: AccountIdentity, email: String, password: String) {
		self.identity = identity
		self.email = email
		self.password = password
	}
}

/// `POST /api/v1/auth/password/forgot`: asks for a reset code by email. The server answers `ok` whether or not the
/// email has an account.
public struct ForgotPasswordRequest: Codable, Sendable, Equatable {
	public var email: String

	public init(email: String) {
		self.email = email
	}
}

/// `POST /api/v1/auth/password/reset`: sets a new password with the emailed code, revokes every other token and signs
/// this device in.
public struct ResetPasswordRequest: Codable, Sendable, Equatable {
	public var identity: AccountIdentity
	public var email: String
	public var code: String
	public var password: String

	public init(identity: AccountIdentity, email: String, code: String, password: String) {
		self.identity = identity
		self.email = email
		self.code = code
		self.password = password
	}
}
