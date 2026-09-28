import Foundation
import Security

/// One generic-password item that belongs to this device only: never synchronizable (iCloud Keychain can't copy it to
/// another device) and readable after first unlock (background pushes and extensions can use it while locked). With
/// an access group, extensions in that group can read it too. SharedSettings' keychain keys can't express either
/// attribute, hence this type.
public struct DeviceKeychainItem: Sendable {
	public let service: String
	public let account: String
	public let accessGroup: String?
	let calls: any KeychainCalls

	public init(service: String, account: String, accessGroup: String? = nil, calls: any KeychainCalls = SystemKeychainCalls()) {
		self.service = service
		self.account = account
		self.accessGroup = accessGroup
		self.calls = calls
	}

	func query(accessGroup: String?) -> [String: Any] {
		var query: [String: Any] = [
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: service,
			kSecAttrAccount as String: account,
			kSecUseDataProtectionKeychain as String: true,
			kSecAttrSynchronizable as String: kCFBooleanFalse!,
		]
		if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
		return query
	}

	public func read() throws -> Data? {
		try withGroupFallback { group in
			var query = query(accessGroup: group)
			query[kSecReturnData as String] = true
			query[kSecMatchLimit as String] = kSecMatchLimitOne
			let (status, data) = calls.copyData(query)
			if status == errSecItemNotFound { return (errSecSuccess, nil) }
			return (status, data)
		}
	}

	/// Adds the item, or replaces the value of an existing one.
	public func write(_ data: Data) throws {
		try withGroupFallback { group -> (OSStatus, Void) in
			let update = calls.update(query(accessGroup: group), [kSecValueData as String: data])
			guard update == errSecItemNotFound else { return (update, ()) }
			var add = query(accessGroup: group)
			add[kSecValueData as String] = data
			add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
			return (calls.add(add), ())
		}
	}

	public func delete() throws {
		try withGroupFallback { group -> (OSStatus, Void) in
			let status = calls.delete(query(accessGroup: group))
			return (status == errSecItemNotFound ? errSecSuccess : status, ())
		}
	}

	/// Unsigned builds (CI, `CODE_SIGNING_ALLOWED=NO` simulator runs) lack the keychain-access-groups entitlement; there
	/// the item falls back to the app's default group, so the app works without extension access.
	private func withGroupFallback<T>(_ body: (String?) -> (OSStatus, T)) throws -> T {
		var (status, value) = body(accessGroup)
		if status == errSecMissingEntitlement, accessGroup != nil { (status, value) = body(nil) }
		guard status == errSecSuccess else { throw DeviceKeychainError.status(status) }
		return value
	}
}
