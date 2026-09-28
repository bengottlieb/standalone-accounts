import CloudKit
import Foundation
import StoreKit

/// Builds the identity block: the device secret, plus whichever links resolve within `linkTimeout`. Launch never waits
/// on the App Store or iCloud; a link that hasn't answered by then is left out.
public struct IdentityCollector: Sendable {
	public let secret: DeviceSecret
	public let platform: AccountIdentity.Platform
	public let appVersion: String
	public let deviceName: String?
	/// The CloudKit container whose user record id is sent as a hint. Nil sends none.
	public let cloudKitContainerID: String?
	public let linkTimeout: Duration

	public init(secret: DeviceSecret, platform: AccountIdentity.Platform, appVersion: String, deviceName: String? = nil, cloudKitContainerID: String? = nil, linkTimeout: Duration = .seconds(3)) {
		self.secret = secret
		self.platform = platform
		self.appVersion = appVersion
		self.deviceName = deviceName
		self.cloudKitContainerID = cloudKitContainerID
		self.linkTimeout = linkTimeout
	}

	/// With `includeLinks: false` (after a sign-out) only the secret goes, so the app transaction can't rejoin.
	public func current(includeLinks: Bool = true) async throws -> AccountIdentity {
		let deviceSecret = try secret.current()
		guard includeLinks else {
			return AccountIdentity(deviceSecret: deviceSecret, includeLinks: false, platform: platform, appVersion: appVersion, deviceName: deviceName)
		}
		async let jws = withDeadline(linkTimeout) { await Self.appTransactionJWS() }
		async let icloud = withDeadline(linkTimeout) { [cloudKitContainerID] in await Self.icloudUserID(containerID: cloudKitContainerID) }
		return AccountIdentity(deviceSecret: deviceSecret, appTransactionJWS: await jws, icloudUserID: await icloud, includeLinks: true, platform: platform, appVersion: appVersion, deviceName: deviceName)
	}

	/// Sent whether or not StoreKit could verify it locally: the server verifies it against Apple's chain and drops
	/// the link if it doesn't hold up (Xcode-signed ones outside development, for instance).
	static func appTransactionJWS() async -> String? {
		guard let result = try? await AppTransaction.shared else { return nil }
		return result.jwsRepresentation
	}

	static func icloudUserID(containerID: String?) async -> String? {
		guard let containerID else { return nil }
		let container = CKContainer(identifier: containerID)
		guard (try? await container.accountStatus()) == .available else { return nil }
		return try? await container.userRecordID().recordName
	}
}
