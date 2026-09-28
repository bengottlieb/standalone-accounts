import Foundation

/// The account as the app sees it. `id` is not a credential; `supportID` is what the user reads to support.
public struct AccountSummary: Codable, Sendable, Equatable, Identifiable {
	public var id: UUID
	public var supportID: String
	public var createdAt: Date
	public var access: AccountAccess

	public init(id: UUID, supportID: String, createdAt: Date, access: AccountAccess) {
		self.id = id
		self.supportID = supportID
		self.createdAt = createdAt
		self.access = access
	}

	private enum CodingKeys: String, CodingKey { case id, supportID, createdAt, access }

	/// The id is written in lowercase, as the server sends it (Swift's `UUID` encodes uppercase), so a cached summary is
	/// byte-for-byte the wire format.
	public func encode(to encoder: any Encoder) throws {
		var container = encoder.container(keyedBy: CodingKeys.self)
		try container.encode(id.uuidString.lowercased(), forKey: .id)
		try container.encode(supportID, forKey: .supportID)
		try container.encode(createdAt, forKey: .createdAt)
		try container.encode(access, forKey: .access)
	}
}

/// Effective access: a suspension overrides everything, then a live purchase or subscription, then a grant.
///
/// `Status`, `Source` and `Environment` are open sets: a server may add values within the protocol version, and this
/// build keeps them (as unknown raw values) rather than failing to decode. Compare with the constants; `switch` needs a
/// `default`.
public struct AccountAccess: Codable, Sendable, Equatable {
	public struct Status: RawRepresentable, Codable, Sendable, Hashable {
		public let rawValue: String
		public init(rawValue: String) { self.rawValue = rawValue }
		public static let active = Status(rawValue: "active")
		public static let grace = Status(rawValue: "grace")
		public static let granted = Status(rawValue: "granted")
		public static let expired = Status(rawValue: "expired")
		public static let revoked = Status(rawValue: "revoked")
		public static let suspended = Status(rawValue: "suspended")
		public static let none = Status(rawValue: "none")
	}

	public struct Source: RawRepresentable, Codable, Sendable, Hashable {
		public let rawValue: String
		public init(rawValue: String) { self.rawValue = rawValue }
		public static let subscription = Source(rawValue: "subscription")
		/// A one-time (non-consumable) purchase: no expiry, until refunded.
		public static let purchase = Source(rawValue: "purchase")
		public static let grant = Source(rawValue: "grant")
	}

	public struct Environment: RawRepresentable, Codable, Sendable, Hashable {
		public let rawValue: String
		public init(rawValue: String) { self.rawValue = rawValue }
		public static let production = Environment(rawValue: "Production")
		public static let sandbox = Environment(rawValue: "Sandbox")
		public static let xcode = Environment(rawValue: "Xcode")
	}

	public var status: Status
	public var active: Bool
	public var plan: String?
	public var source: Source?
	public var environment: Environment?
	public var expiresAt: Date?
	public var willRenew: Bool?

	public init(status: Status, active: Bool, plan: String? = nil, source: Source? = nil, environment: Environment? = nil, expiresAt: Date? = nil, willRenew: Bool? = nil) {
		self.status = status
		self.active = active
		self.plan = plan
		self.source = source
		self.environment = environment
		self.expiresAt = expiresAt
		self.willRenew = willRenew
	}
}
