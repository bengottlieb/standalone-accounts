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

/// Effective access: a suspension overrides everything, then any live subscription or grant.
public struct AccountAccess: Codable, Sendable, Equatable {
	public enum Status: String, Codable, Sendable {
		case active, grace, granted, expired, revoked, suspended, none
	}

	public enum Source: String, Codable, Sendable {
		case subscription, grant
	}

	public enum Environment: String, Codable, Sendable {
		case production = "Production", sandbox = "Sandbox", xcode = "Xcode"
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
