import Foundation
import Security

/// This device's credential: 32 CSPRNG bytes as 64 lowercase hex characters, in a `ThisDeviceOnly` Keychain item. The
/// server keeps only its hash. It finds the account this device was bound to; it never creates one.
public struct DeviceSecret: Sendable {
	let item: DeviceKeychainItem

	public init(item: DeviceKeychainItem) {
		self.item = item
	}

	/// The stored secret, if there is a well-formed one. Doesn't mint: use this to name a credential to revoke.
	public func existing() throws -> String? {
		guard let data = try item.read(), let secret = String(data: data, encoding: .utf8), Self.isWellFormed(secret) else { return nil }
		return secret
	}

	/// The stored secret, minted and stored on first use.
	public func current() throws -> String {
		if let existing = try existing() { return existing }
		let secret = Self.generate()
		try item.write(Data(secret.utf8))
		return secret
	}

	/// Drops the secret, so the next `current()` mints a new one: this device no longer proves any account.
	public func forget() throws {
		try item.delete()
	}

	static func generate() -> String {
		var bytes = [UInt8](repeating: 0, count: 32)
		let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
		precondition(status == errSecSuccess, "SecRandomCopyBytes failed (\(status))")
		return bytes.map { String(format: "%02x", $0) }.joined()
	}

	static func isWellFormed(_ secret: String) -> Bool {
		secret.count == 64 && secret.allSatisfy { $0.isHexDigit && !$0.isUppercase }
	}
}
