import Foundation
import Synchronization
import Testing
@testable import AccountKit

/// Answers every call with one canned response and records what was sent.
final class StubTransport: AccountTransport {
	let status: Int
	let body: String
	let sent = Mutex<[(AccountEndpoint, Data?, String?)]>([])

	init(status: Int = 200, body: String) {
		self.status = status
		self.body = body
	}

	func send(_ endpoint: AccountEndpoint, body: Data?, token: String?) async throws -> AccountTransportResponse {
		sent.withLock { $0.append((endpoint, body, token)) }
		return AccountTransportResponse(status: status, body: Data(self.body.utf8))
	}
}

@Suite struct AccountServiceTests {
	func service(_ transport: StubTransport) -> AccountService {
		let secret = DeviceSecret(item: DeviceKeychainItem(service: "test", account: "device-secret", calls: MemoryKeychain()))
		return AccountService(transport: transport, identity: IdentityCollector(secret: secret, platform: .macos, appVersion: "1.0 (1)"))
	}

	@Test func unknownDeviceIsNoAccountNotAnError() async throws {
		let transport = StubTransport(body: #"{"account":null}"#)
		#expect(try await service(transport).authenticateDevice(includeLinks: false) == .noAccount)
		let (endpoint, body, token) = try #require(transport.sent.withLock { $0.first })
		#expect(endpoint == .authDevice && token == nil)
		let sent = try AccountJSON.decoder.decode(DeviceAuthRequest.self, from: try #require(body))
		#expect(!sent.identity.includeLinks && sent.identity.appTransactionJWS == nil)
	}

	@Test func errorBodiesBecomeTypedErrors() async throws {
		let transport = StubTransport(status: 409, body: #"{"error":"purchase_in_use","message":"no"}"#)
		let error = await #expect(throws: AccountServiceError.self) { try await service(transport).purchase(["jws"]) }
		#expect(error?.code == .purchaseInUse)
	}

	@Test func unknownErrorCodesSurvive() async throws {
		let transport = StubTransport(status: 400, body: #"{"error":"brand_new_code"}"#)
		let error = await #expect(throws: AccountServiceError.self) { try await service(transport).claim(code: "SK-1") }
		#expect(error?.code == .other("brand_new_code"))
	}

	@Test func nonJSONFailuresAreUnexpected() async throws {
		let transport = StubTransport(status: 502, body: "<html>")
		await #expect(throws: AccountServiceError.unexpected(status: 502)) { try await service(transport).account(token: "t") }
	}

	@Test func tokenCallsRequireAToken() async throws {
		let transport = StubTransport(body: #"{"ok":true}"#)
		await #expect(throws: AccountServiceError.notSignedIn) { try await service(transport).call(.signOut, body: Optional<DeviceAuthRequest>.none, token: nil) as AccountOKResponse }
		try await service(transport).signOut(token: "skm_x")
		#expect(transport.sent.withLock { $0.map(\.2) } == ["skm_x"])
	}
}
