import Foundation

/// A kind of verified link the account holds: what finds it again (`appTransaction`) or signs in to it (`apple`,
/// `gameCenter`). Servers from 0.6.0 list them on `AccountSummary.links`, kinds only, never their values; unverified
/// hints (the iCloud user id) are never listed.
///
/// `Kind` is an open set: a server may add its own kinds, and this build keeps them as unknown raw values.
public struct AccountLink: Codable, Sendable, Equatable {
	public struct Kind: RawRepresentable, Codable, Sendable, Hashable {
		public let rawValue: String
		public init(rawValue: String) { self.rawValue = rawValue }
		/// The App Store `AppTransaction`: per Apple Account per app, so a reinstall finds the account again.
		public static let appTransaction = Kind(rawValue: "app_transaction")
		public static let apple = Kind(rawValue: "apple")
		public static let gameCenter = Kind(rawValue: "game_center")
	}

	public var kind: Kind

	public init(kind: Kind) {
		self.kind = kind
	}
}

/// What became of a link the device sent on an `auth` call (servers from 0.6.0; `AccountAuthResponse.linkResults`).
///
/// An open set: this build keeps an outcome it doesn't know as an unknown raw value. Compare with the constants;
/// `switch` needs a `default`.
public struct LinkOutcome: RawRepresentable, Codable, Sendable, Hashable {
	public let rawValue: String
	public init(rawValue: String) { self.rawValue = rawValue }
	/// Bound to the account by this call.
	public static let bound = LinkOutcome(rawValue: "bound")
	/// Already the account's before this call.
	public static let alreadyBound = LinkOutcome(rawValue: "already_bound")
	/// Another account owns it, and keeps it; the device was bound anyway. Sending it again won't change that.
	public static let ownedByOtherAccount = LinkOutcome(rawValue: "owned_by_other_account")
	/// It did not verify (or verification was unavailable) and was dropped; sending it again later may work.
	public static let rejected = LinkOutcome(rawValue: "rejected")
}
