import Foundation

/// The account calls, with identity gathering built in. Holds no state: the app stores the token it gets back.
public struct AccountService: Sendable {
	public let transport: any AccountTransport
	public let identity: IdentityCollector

	public init(transport: any AccountTransport, identity: IdentityCollector) {
		self.transport = transport
		self.identity = identity
	}

	/// This device's account, or `.noAccount` in apps that create accounts only on a purchase or claim.
	public func authenticateDevice(includeLinks: Bool = true) async throws -> DeviceAuthResponse {
		let request = DeviceAuthRequest(identity: try await identity.current(includeLinks: includeLinks))
		return try await call(.authDevice, body: request, token: nil)
	}

	/// Attaches `signedTransactions` (`Transaction.jwsRepresentation`) and returns their account.
	public func purchase(_ signedTransactions: [String]) async throws -> AccountAuthResponse {
		let request = PurchaseAuthRequest(identity: try await identity.current(includeLinks: true), signedTransactions: signedTransactions)
		return try await call(.authPurchase, body: request, token: nil)
	}

	/// Joins the account an admin created, with the code (or the `code` of a `claim` deep link) they sent.
	public func claim(code: String) async throws -> AccountAuthResponse {
		let request = ClaimRequest(identity: try await identity.current(includeLinks: true), code: code)
		return try await call(.authClaim, body: request, token: nil)
	}

	public func account(token: String) async throws -> AccountSummary {
		try await call(.account, body: Optional<DeviceAuthRequest>.none, token: token)
	}

	/// Revokes the token and unlinks this device. Send `includeLinks: false` on later `authenticateDevice` calls.
	public func signOut(token: String) async throws {
		let _: AccountOKResponse = try await call(.signOut, body: Optional<DeviceAuthRequest>.none, token: token)
	}

	/// Deletes the account and everything in it. Warn first that this doesn't cancel an App Store subscription.
	public func deleteAccount(token: String) async throws {
		let _: AccountOKResponse = try await call(.deleteAccount, body: Optional<DeviceAuthRequest>.none, token: token)
	}

	func call<Body: Encodable, Response: Decodable>(_ endpoint: AccountEndpoint, body: Body?, token: String?) async throws -> Response {
		if endpoint.requiresToken, token == nil { throw AccountServiceError.notSignedIn }
		let data = try body.map { try AccountJSON.encoder.encode($0) }
		let response = try await transport.send(endpoint, body: data, token: token)
		guard (200..<300).contains(response.status) else {
			guard let error = try? AccountJSON.decoder.decode(AccountErrorResponse.self, from: response.body) else {
				throw AccountServiceError.unexpected(status: response.status)
			}
			throw AccountServiceError.server(status: response.status, error)
		}
		return try AccountJSON.decoder.decode(Response.self, from: response.body)
	}
}
