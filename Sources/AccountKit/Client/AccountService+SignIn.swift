import Foundation

/// Signing in to an account from another device: Sign in with Apple, email and password, and Game Center. Each binds
/// this device to the account; when `merged` is true, this device's anonymous account was folded in, so reload local
/// data. Each takes the device's current `token`, when it has one, so the server can answer with it again.
extension AccountService {
	/// Signs in with the `identityToken` of an `ASAuthorizationAppleIDCredential`, and the name Apple gives only once.
	public func signInWithApple(identityToken: String, name: String? = nil, token: String? = nil) async throws -> AccountAuthResponse {
		let request = AppleSignInRequest(identity: try await identity.current(includeLinks: true), identityToken: identityToken, name: name)
		return try await call(.signInWithApple, body: request, token: token)
	}

	/// Creates an email-and-password account (or signs in to an existing one, with the right password).
	public func registerPassword(email: String, password: String, token: String? = nil) async throws -> AccountAuthResponse {
		let request = PasswordRequest(identity: try await identity.current(includeLinks: true), email: email, password: password)
		return try await call(.registerPassword, body: request, token: token)
	}

	/// Signs in with an email and password; a wrong pair throws `invalidCredentials`.
	public func signInWithPassword(email: String, password: String, token: String? = nil) async throws -> AccountAuthResponse {
		let request = PasswordRequest(identity: try await identity.current(includeLinks: true), email: email, password: password)
		return try await call(.signInWithPassword, body: request, token: token)
	}

	/// Emails a reset code. Succeeds whether or not the email has an account.
	public func forgotPassword(email: String) async throws {
		let _: AccountOKResponse = try await call(.forgotPassword, body: ForgotPasswordRequest(email: email), token: nil)
	}

	/// Sets a new password with the emailed `code`, signs out every other device and signs this one in.
	public func resetPassword(email: String, code: String, password: String, token: String? = nil) async throws -> AccountAuthResponse {
		let request = ResetPasswordRequest(identity: try await identity.current(includeLinks: true), email: email, code: code, password: password)
		return try await call(.resetPassword, body: request, token: token)
	}

	/// Signs in with the local player's Game Center identity verification signature.
	public func signInWithGameCenter(_ proof: GameCenterProof, token: String? = nil) async throws -> AccountAuthResponse {
		let request = proof.request(identity: try await identity.current(includeLinks: true))
		return try await call(.signInWithGameCenter, body: request, token: token)
	}

	/// Changes (or adds) the signed-in account's email and password. Pass `currentPassword` when it already has one.
	public func setPassword(email: String, password: String, currentPassword: String? = nil, token: String) async throws {
		let request = SetPasswordRequest(email: email, password: password, currentPassword: currentPassword)
		let _: AccountOKResponse = try await call(.setPassword, body: request, token: token)
	}

	/// Removes one way of signing in from the signed-in account, and returns the account as it now stands.
	public func unlink(kind: SignInIdentity.Kind, token: String) async throws -> AccountSummary {
		try await call(.unlinkIdentity, body: UnlinkRequest(kind: kind), token: token)
	}
}
