import Foundation
import Testing
@testable import AccountKit

@Suite struct SignInTests {
	let account = #"{"id":"3f8a2c10-6b4d-4e2a-9f1c-7d5e3b1a0c92","supportID":"PZ-4K7Q-9MPX","createdAt":"2026-09-28T19:04:11Z","access":{"status":"none","active":false}"#

	func service(_ transport: StubTransport) -> AccountService {
		AccountServiceTests().service(transport)
	}

	@Test func mergedFlagDecodes() async throws {
		let transport = StubTransport(body: #"{"account":\#(account)},"token":"t","isNew":false,"merged":true}"#)
		let answer = try await service(transport).signInWithApple(identityToken: "jwt", name: "Ben")
		#expect(answer.merged == true)
		let (endpoint, body, token) = try #require(transport.sent.withLock { $0.first })
		#expect(endpoint == .signInWithApple && token == nil)
		let sent = try AccountJSON.decoder.decode(AppleSignInRequest.self, from: try #require(body))
		#expect(sent.identityToken == "jwt" && sent.name == "Ben" && sent.identity.includeLinks)
		let plain = try AccountJSON.decoder.decode(AccountAuthResponse.self, from: Data(#"{"account":\#(account)},"token":"t","isNew":true}"#.utf8))
		#expect(plain.merged == nil)
	}

	@Test func identitiesDecode() async throws {
		let transport = StubTransport(body: #"\#(account),"identities":[{"kind":"password","label":"ben@example.com"},{"kind":"pa"}]}"#)
		let summary = try await service(transport).unlink(kind: .apple, token: "t")
		#expect(summary.identities == [SignInIdentity(kind: .password, label: "ben@example.com"), SignInIdentity(kind: .init(rawValue: "pa"))])
		let sent = try AccountJSON.decoder.decode(UnlinkRequest.self, from: try #require(transport.sent.withLock { $0.first?.1 }))
		#expect(sent.kind == .apple)
		#expect(try AccountJSON.decoder.decode(AccountSummary.self, from: Data("\(account)}".utf8)).identities == nil)
	}

	@Test func gameCenterProofIsBase64Encoded() async throws {
		let transport = StubTransport(body: #"{"account":\#(account)},"token":"t","isNew":true}"#)
		let proof = GameCenterProof(teamPlayerID: "T:_1", bundleID: "com.standalone.pzl", publicKeyURL: URL(string: "https://static.gc.apple.com/k.cer")!, signature: Data("signature".utf8), salt: Data("salt".utf8), timestamp: 1790625212000)
		_ = try await service(transport).signInWithGameCenter(proof)
		let body = try #require(transport.sent.withLock { $0.first?.1 })
		let sent = try AccountJSON.decoder.decode(GameCenterSignInRequest.self, from: body)
		#expect(sent.signature == "c2lnbmF0dXJl" && sent.salt == "c2FsdA==" && sent.timestamp == 1790625212000)
		#expect(sent.publicKeyURL.absoluteString == "https://static.gc.apple.com/k.cer" && sent.displayName == nil)
		let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
		#expect(json["displayName"] == nil && json["publicKeyURL"] as? String == "https://static.gc.apple.com/k.cer")
	}

	@Test func accountCallsRequireAToken() async throws {
		let transport = StubTransport(body: #"{"ok":true}"#)
		let request = SetPasswordRequest(email: "ben@example.com", password: "correct horse")
		await #expect(throws: AccountServiceError.notSignedIn) { try await service(transport).call(.setPassword, body: request, token: nil) as AccountOKResponse }
		await #expect(throws: AccountServiceError.notSignedIn) { try await service(transport).call(.unlinkIdentity, body: UnlinkRequest(kind: .apple), token: nil) as AccountSummary }
		#expect(transport.sent.withLock { $0.isEmpty })
		try await service(transport).setPassword(email: "ben@example.com", password: "correct horse", token: "skm_x")
		#expect(transport.sent.withLock { $0.map(\.2) } == ["skm_x"])
	}

	@Test func signInErrorCodesAreKnown() {
		#expect(AccountErrorCode.invalidCredentials.rawValue == "invalid_credentials")
		#expect(AccountErrorCode.emailInUse.rawValue == "email_in_use")
		#expect(AccountErrorCode.signinUnavailable.rawValue == "signin_unavailable")
	}
}
