import Foundation
import Security

/// The four Security calls a `DeviceKeychainItem` makes, injectable so tests can check the exact query attributes
/// (never synchronizable, `ThisDeviceOnly`) without a real Keychain or entitlements.
public protocol KeychainCalls: Sendable {
	func add(_ attributes: [String: Any]) -> OSStatus
	func update(_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus
	func copyData(_ query: [String: Any]) -> (OSStatus, Data?)
	func delete(_ query: [String: Any]) -> OSStatus
}

/// The real Keychain.
public struct SystemKeychainCalls: KeychainCalls {
	public init() { }

	public func add(_ attributes: [String: Any]) -> OSStatus {
		SecItemAdd(attributes as CFDictionary, nil)
	}

	public func update(_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus {
		SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
	}

	public func copyData(_ query: [String: Any]) -> (OSStatus, Data?) {
		var result: CFTypeRef?
		let status = SecItemCopyMatching(query as CFDictionary, &result)
		return (status, result as? Data)
	}

	public func delete(_ query: [String: Any]) -> OSStatus {
		SecItemDelete(query as CFDictionary)
	}
}

public enum DeviceKeychainError: Error, Equatable, LocalizedError {
	case status(OSStatus)

	public var errorDescription: String? {
		switch self {
		case .status(let status): "The Keychain returned an error (\(status))."
		}
	}
}
