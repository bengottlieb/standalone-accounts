import Foundation

/// `POST /api/v1/auth/game-center`: the identity verification signature from
/// `GKLocalPlayer.fetchItems(forIdentityVerificationSignature:)`, with `signature` and `salt` base64-encoded. Build it
/// from a `GameCenterProof` rather than by hand.
public struct GameCenterSignInRequest: Codable, Sendable, Equatable {
	public var identity: AccountIdentity
	public var teamPlayerID: String
	public var bundleID: String
	public var publicKeyURL: URL
	public var signature: String
	public var salt: String
	/// Milliseconds since 1970, as Game Center gives it.
	public var timestamp: UInt64
	public var displayName: String?

	public init(identity: AccountIdentity, teamPlayerID: String, bundleID: String, publicKeyURL: URL, signature: String, salt: String, timestamp: UInt64, displayName: String? = nil) {
		self.identity = identity
		self.teamPlayerID = teamPlayerID
		self.bundleID = bundleID
		self.publicKeyURL = publicKeyURL
		self.signature = signature
		self.salt = salt
		self.timestamp = timestamp
		self.displayName = displayName
	}
}
