import Foundation
import Security
import Synchronization
@testable import AccountKit

/// An in-memory Keychain keyed by service + account that records every add, for checking item attributes.
final class MemoryKeychain: KeychainCalls {
	private let state = Mutex<(items: [String: Data], added: [[String: String]])>(([:], []))

	var added: [[String: String]] { state.withLock { $0.added } }

	private func key(_ query: [String: Any]) -> String {
		"\(query[kSecAttrService as String] ?? "")/\(query[kSecAttrAccount as String] ?? "")"
	}

	func add(_ attributes: [String: Any]) -> OSStatus {
		state.withLock {
			$0.items[key(attributes)] = attributes[kSecValueData as String] as? Data
			$0.added.append(attributes.compactMapValues { "\($0)" })
		}
		return errSecSuccess
	}

	func update(_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus {
		state.withLock {
			guard $0.items[key(query)] != nil else { return errSecItemNotFound }
			$0.items[key(query)] = attributes[kSecValueData as String] as? Data
			return errSecSuccess
		}
	}

	func copyData(_ query: [String: Any]) -> (OSStatus, Data?) {
		state.withLock {
			guard let data = $0.items[key(query)] else { return (errSecItemNotFound, nil) }
			return (errSecSuccess, data)
		}
	}

	func delete(_ query: [String: Any]) -> OSStatus {
		state.withLock { $0.items.removeValue(forKey: key(query)) == nil ? errSecItemNotFound : errSecSuccess }
	}
}
