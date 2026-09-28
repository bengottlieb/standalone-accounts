import Foundation

/// `POST /api/v1/check-in`: which build is asking. `current(platform:)` fills it from the running app's bundle.
public struct CheckInRequest: Codable, Sendable, Equatable {
	public var bundle: String
	public var version: String
	/// CFBundleVersion as an integer: what the server's minimum build compares against.
	public var build: Int
	public var platform: AccountIdentity.Platform
	public var osVersion: String?
	public var protocolVersion: String

	public init(bundle: String, version: String, build: Int, platform: AccountIdentity.Platform, osVersion: String? = nil, protocolVersion: String = AccountEndpoint.protocolVersion) {
		self.bundle = bundle
		self.version = version
		self.build = build
		self.platform = platform
		self.osVersion = osVersion
		self.protocolVersion = protocolVersion
	}

	public static func current(platform: AccountIdentity.Platform, bundle info: Bundle = .main) -> CheckInRequest {
		let os = ProcessInfo.processInfo.operatingSystemVersion
		return CheckInRequest(
			bundle: info.bundleIdentifier ?? "",
			version: info.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0",
			build: Int(info.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0,
			platform: platform,
			osVersion: "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)"
		)
	}
}

/// Whether this build may carry on, and the server's settings for it.
public struct CheckInResponse: Codable, Sendable, Equatable {
	public enum Update: String, Codable, Sendable {
		/// Below the minimum build: show the update screen and make no other calls.
		case required
		/// A newer build is out; suggest it.
		case recommended
		case none
	}

	public var update: Update
	public var minimumBuild: Int?
	public var recommendedBuild: Int?
	public var message: String?
	public var serverTime: Date
	public var protocolVersions: [String]
	/// The host's own settings (feature flags, maintenance notices), as raw JSON.
	public var config: [String: JSONValue]
}
