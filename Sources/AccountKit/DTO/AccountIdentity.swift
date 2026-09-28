import Foundation

/// What a device presents on every call that can bind it to an account. The device secret is the credential; the
/// rest are links (`appTransactionJWS`, verified by the server) and hints (`icloudUserID`, never matched).
public struct AccountIdentity: Codable, Sendable, Equatable {
	public enum Platform: String, Codable, Sendable {
		case ios, ipados, macos, visionos, watchos, tvos
	}

	/// 64 lowercase hex characters.
	public var deviceSecret: String
	public var appTransactionJWS: String?
	public var icloudUserID: String?
	/// False after a sign-out, so this device's app transaction can't pull it back into the account it left.
	public var includeLinks: Bool
	public var platform: Platform
	public var appVersion: String
	public var deviceName: String?

	public init(deviceSecret: String, appTransactionJWS: String? = nil, icloudUserID: String? = nil, includeLinks: Bool = true, platform: Platform, appVersion: String, deviceName: String? = nil) {
		self.deviceSecret = deviceSecret
		self.appTransactionJWS = appTransactionJWS
		self.icloudUserID = icloudUserID
		self.includeLinks = includeLinks
		self.platform = platform
		self.appVersion = appVersion
		self.deviceName = deviceName
	}
}
