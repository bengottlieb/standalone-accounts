import Foundation
import Testing
@testable import AccountKit

/// AccountKit against the shared contract: every fixture's request round-trips through its DTO unchanged, every
/// response decodes, and every endpoint matches the generated OpenAPI document.
@Suite struct ContractTests {
	@Test func everyEndpointHasAFixture() throws {
		let covered = Set(try ContractFixture.all().map(\.endpoint))
		#expect(covered == Set(AccountEndpoint.allCases.map(\.rawValue)))
	}

	@Test(arguments: try ContractFixture.all().map(\.name))
	func fixture(named name: String) throws {
		let fixture = try ContractFixture.load(ContractFixture.directory.appending(path: "fixtures/\(name)"))
		let endpoint = try #require(AccountEndpoint(rawValue: fixture.endpoint))
		try checkRequest(fixture, endpoint)
		guard (200..<300).contains(fixture.status) else {
			_ = try AccountJSON.decoder.decode(AccountErrorResponse.self, from: fixture.body)
			return
		}
		try checkResponse(fixture, endpoint)
	}

	func checkRequest(_ fixture: ContractFixture, _ endpoint: AccountEndpoint) throws {
		guard let request = fixture.request else {
			#expect([.account, .signOut, .deleteAccount].contains(endpoint))
			return
		}
		let encoded: Data = switch endpoint {
		case .checkIn: try roundTrip(CheckInRequest.self, request)
		case .authDevice: try roundTrip(DeviceAuthRequest.self, request)
		case .authPurchase: try roundTrip(PurchaseAuthRequest.self, request)
		case .authClaim: try roundTrip(ClaimRequest.self, request)
		case .signInWithApple: try roundTrip(AppleSignInRequest.self, request)
		case .registerPassword, .signInWithPassword: try roundTrip(PasswordRequest.self, request)
		case .forgotPassword: try roundTrip(ForgotPasswordRequest.self, request)
		case .resetPassword: try roundTrip(ResetPasswordRequest.self, request)
		case .signInWithGameCenter: try roundTrip(GameCenterSignInRequest.self, request)
		case .setPassword: try roundTrip(SetPasswordRequest.self, request)
		case .unlinkIdentity: try roundTrip(UnlinkRequest.self, request)
		case .account, .signOut, .deleteAccount: Data()
		}
		#expect(try sameJSON(encoded, request), "\(fixture.name) request changed in a round trip")
	}

	func checkResponse(_ fixture: ContractFixture, _ endpoint: AccountEndpoint) throws {
		let encoded: Data = switch endpoint {
		case .checkIn: try roundTrip(CheckInResponse.self, fixture.body)
		case .authDevice: try roundTrip(DeviceAuthResponse.self, fixture.body)
		case .authPurchase, .authClaim, .signInWithApple, .registerPassword, .signInWithPassword, .resetPassword, .signInWithGameCenter: try roundTrip(AccountAuthResponse.self, fixture.body)
		case .account, .unlinkIdentity: try roundTrip(AccountSummary.self, fixture.body)
		case .signOut, .deleteAccount, .forgotPassword, .setPassword: try roundTrip(AccountOKResponse.self, fixture.body)
		}
		#expect(try sameJSON(encoded, fixture.body), "\(fixture.name) response changed in a round trip")
	}

	func roundTrip<T: Codable>(_ type: T.Type, _ data: Data) throws -> Data {
		try AccountJSON.encoder.encode(AccountJSON.decoder.decode(type, from: data))
	}

	@Test func endpointsMatchOpenAPI() throws {
		let paths = try #require(try ContractFixture.openAPI()["paths"] as? [String: [String: Any]])
		for endpoint in AccountEndpoint.allCases {
			let operation = paths[endpoint.path]?[endpoint.method.rawValue.lowercased()] as? [String: Any]
			#expect(operation?["operationId"] as? String == endpoint.rawValue, "\(endpoint) isn't \(endpoint.method.rawValue) \(endpoint.path)")
			#expect((operation?["security"] != nil) == endpoint.requiresToken, "\(endpoint) token requirement differs")
		}
	}

	@Test func unknownAccessValuesDecode() throws {
		let json = #"{"status":"paused","active":false,"source":"family","environment":"Staging"}"#
		let access = try AccountJSON.decoder.decode(AccountAccess.self, from: Data(json.utf8))
		#expect(access.status.rawValue == "paused" && access.source?.rawValue == "family" && access.environment?.rawValue == "Staging")
		#expect(try AccountJSON.decoder.decode(AccountAccess.self, from: Data(#"{"status":"active","active":true}"#.utf8)).status == .active)
	}
}
