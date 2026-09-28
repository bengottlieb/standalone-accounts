import Foundation
import SharedSettings

/// Written on the first launch this app container sees. Deliberately in UserDefaults: it has to die with the
/// container, which is the whole signal.
struct AccountContainerStampKey: SettingsKey {
	typealias Payload = Bool
	static var defaultValue: Bool { false }
	static var name: String { "accountkit.containerStamp" }
}

/// For apps with `resetOnReinstall` (Peasel): the Keychain outlives the app's container, so a reinstall would walk
/// straight back into the old account on the old secret. A missing stamp means a new container, so the secret is
/// dropped and the verified app transaction (or a sign-in) rejoins the account instead.
public struct ContainerStamp: Sendable {
	let secret: DeviceSecret
	let isProtectedDataAvailable: @Sendable () -> Bool
	let isStamped: @Sendable () -> Bool
	let stamp: @Sendable () -> Void

	/// `isProtectedDataAvailable` must answer honestly on iOS (`UIApplication.shared.isProtectedDataAvailable`): a
	/// silent push before the first unlock reads UserDefaults and the Keychain as empty, which is not a new container.
	public init(secret: DeviceSecret, isProtectedDataAvailable: @escaping @Sendable () -> Bool) {
		self.init(secret: secret, isProtectedDataAvailable: isProtectedDataAvailable, isStamped: { AccountContainerStampKey.sharedValue }, stamp: { AccountContainerStampKey.sharedValue = true })
	}

	init(secret: DeviceSecret, isProtectedDataAvailable: @escaping @Sendable () -> Bool, isStamped: @escaping @Sendable () -> Bool, stamp: @escaping @Sendable () -> Void) {
		self.secret = secret
		self.isProtectedDataAvailable = isProtectedDataAvailable
		self.isStamped = isStamped
		self.stamp = stamp
	}

	/// Drops the device secret when this container is new, and stamps it. Returns whether it was new. Call before
	/// anything reads the secret, at every entry point (app launch, extensions that authenticate).
	@discardableResult public func forgetSecretIfContainerIsNew() throws -> Bool {
		guard isProtectedDataAvailable(), !isStamped() else { return false }
		try secret.forget()
		stamp()
		return true
	}
}
