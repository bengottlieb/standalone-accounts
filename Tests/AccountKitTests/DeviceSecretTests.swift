import Foundation
import Security
import Synchronization
import Testing
@testable import AccountKit

@Suite struct DeviceSecretTests {
	let keychain = MemoryKeychain()
	var secret: DeviceSecret { DeviceSecret(item: DeviceKeychainItem(service: "test", account: "device-secret", calls: keychain)) }

	@Test func mintsOnceThenReuses() throws {
		#expect(try secret.existing() == nil)
		let first = try secret.current()
		#expect(DeviceSecret.isWellFormed(first))
		#expect(try secret.current() == first)
		#expect(try secret.existing() == first)
	}

	@Test func staysOnThisDevice() throws {
		_ = try secret.current()
		let attributes = try #require(keychain.added.first)
		#expect(attributes[kSecAttrAccessible as String] == "\(kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)")
		#expect(attributes[kSecAttrSynchronizable as String] == "0")
	}

	@Test func forgettingMintsANewOne() throws {
		let first = try secret.current()
		try secret.forget()
		#expect(try secret.existing() == nil)
		#expect(try secret.current() != first)
	}

	@Test func ignoresMalformedValues() throws {
		try DeviceKeychainItem(service: "test", account: "device-secret", calls: keychain).write(Data("ABC".utf8))
		#expect(try secret.existing() == nil)
		#expect(DeviceSecret.isWellFormed(try secret.current()))
	}

	@Test func containerStampDropsTheSecretOnceOnANewContainer() throws {
		let stamped = Mutex(false)
		let stamp = ContainerStamp(secret: secret, isProtectedDataAvailable: { true }, isStamped: { stamped.withLock { $0 } }, stamp: { stamped.withLock { $0 = true } })
		let old = try secret.current()
		#expect(try stamp.forgetSecretIfContainerIsNew())
		#expect(try secret.existing() == nil)
		let fresh = try secret.current()
		#expect(fresh != old)
		#expect(try !stamp.forgetSecretIfContainerIsNew())
		#expect(try secret.existing() == fresh)
	}

	@Test func containerStampWaitsForProtectedData() throws {
		let stamp = ContainerStamp(secret: secret, isProtectedDataAvailable: { false }, isStamped: { false }, stamp: { Issue.record("stamped while locked") })
		let old = try secret.current()
		#expect(try !stamp.forgetSecretIfContainerIsNew())
		#expect(try secret.existing() == old)
	}
}
