import Foundation

/// What `GKLocalPlayer.fetchItems(forIdentityVerificationSignature:)` returns, plus the player's ids. The app calls
/// Game Center itself and passes the raw values here, so AccountKit doesn't link GameKit.
public struct GameCenterProof: Sendable, Equatable {
	public var teamPlayerID: String
	public var bundleID: String
	public var publicKeyURL: URL
	public var signature: Data
	public var salt: Data
	/// Milliseconds since 1970, as Game Center gives it.
	public var timestamp: UInt64
	public var displayName: String?

	public init(teamPlayerID: String, bundleID: String, publicKeyURL: URL, signature: Data, salt: Data, timestamp: UInt64, displayName: String? = nil) {
		self.teamPlayerID = teamPlayerID
		self.bundleID = bundleID
		self.publicKeyURL = publicKeyURL
		self.signature = signature
		self.salt = salt
		self.timestamp = timestamp
		self.displayName = displayName
	}

	/// The wire request, with `signature` and `salt` base64-encoded.
	func request(identity: AccountIdentity) -> GameCenterSignInRequest {
		GameCenterSignInRequest(identity: identity, teamPlayerID: teamPlayerID, bundleID: bundleID, publicKeyURL: publicKeyURL, signature: signature.base64EncodedString(), salt: salt.base64EncodedString(), timestamp: timestamp, displayName: displayName)
	}
}
