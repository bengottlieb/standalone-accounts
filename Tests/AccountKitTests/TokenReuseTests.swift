import Foundation
import Testing
@testable import AccountKit

/// The `auth` calls send the device's current token when the app passes one, so the server can answer with it again
/// rather than minting another; without one they send none, as before.
@Suite struct TokenReuseTests {
	static let authAnswer = #"{"account":{"id":"7d3c1a52-8e2b-4f60-9a1d-3c5e7b9d0f12","supportID":"SK-7D3C-1A52","createdAt":"2026-09-28T19:04:11Z","access":{"status":"none","active":false}},"token":"skm_kept","isNew":false}"#

	func service(_ transport: StubTransport) -> AccountService {
		let secret = DeviceSecret(item: DeviceKeychainItem(service: "test", account: "device-secret", calls: MemoryKeychain()))
		return AccountService(transport: transport, identity: IdentityCollector(secret: secret, platform: .macos, appVersion: "1.0 (1)"))
	}

	@Test func authCallsSendTheCurrentToken() async throws {
		let transport = StubTransport(body: Self.authAnswer)
		let accounts = service(transport)
		let proof = GameCenterProof(teamPlayerID: "T:_p", bundleID: "com.example.app", publicKeyURL: URL(string: "https://static.gc.apple.com/k.cer")!, signature: Data([1]), salt: Data([2]), timestamp: 1)
		_ = try await accounts.authenticateDevice(token: "skm_kept")
		_ = try await accounts.purchase(["jws"], token: "skm_kept")
		_ = try await accounts.claim(code: "SK-1", token: "skm_kept")
		_ = try await accounts.signInWithApple(identityToken: "id", token: "skm_kept")
		_ = try await accounts.registerPassword(email: "a@example.com", password: "pw", token: "skm_kept")
		_ = try await accounts.signInWithPassword(email: "a@example.com", password: "pw", token: "skm_kept")
		_ = try await accounts.resetPassword(email: "a@example.com", code: "123456", password: "pw", token: "skm_kept")
		let answer = try await accounts.signInWithGameCenter(proof, token: "skm_kept")
		#expect(answer.token == "skm_kept")

		let sent = transport.sent.withLock { $0.map { ($0.0, $0.2) } }
		#expect(sent.map(\.0) == [.authDevice, .authPurchase, .authClaim, .signInWithApple, .registerPassword, .signInWithPassword, .resetPassword, .signInWithGameCenter])
		#expect(sent.allSatisfy { $0.1 == "skm_kept" && $0.0.acceptsToken })
	}

	@Test func authCallsSendNoTokenWithoutOne() async throws {
		let transport = StubTransport(body: Self.authAnswer)
		_ = try await service(transport).purchase(["jws"])
		_ = try await service(transport).authenticateDevice()
		#expect(transport.sent.withLock { $0.map(\.2) } == [nil, nil])
	}
}
