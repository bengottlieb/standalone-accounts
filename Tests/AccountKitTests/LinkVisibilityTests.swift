import Foundation
import Testing
@testable import AccountKit

/// Servers from 0.6.0 list the account's link kinds on the summary and say what became of each link an `auth` call
/// sent; older servers send neither, and their replies still decode.
@Suite struct LinkVisibilityTests {
	func body(_ name: String) throws -> Data {
		try ContractFixture.load(ContractFixture.directory.appending(path: "fixtures/\(name)")).body
	}

	func bound(_ name: String) throws -> AccountAuthResponse {
		guard case .bound(let response) = try AccountJSON.decoder.decode(DeviceAuthResponse.self, from: body(name)) else {
			Issue.record("\(name) has no account")
			throw CancellationError()
		}
		return response
	}

	@Test func summaryListsLinkKinds() throws {
		let summary = try AccountJSON.decoder.decode(AccountSummary.self, from: body("account.links.json"))
		#expect(summary.links == [AccountLink(kind: .appTransaction), AccountLink(kind: .gameCenter)])
	}

	@Test func authReplySaysWhatBecameOfTheLink() throws {
		#expect(try bound("auth-device.link-bound.json").linkResult(for: .appTransaction) == .bound)
		#expect(try bound("auth-device.link-already-bound.json").linkResult(for: .appTransaction) == .alreadyBound)
		let conflict = try bound("auth-device.link-owned-by-other.json")
		#expect(conflict.linkResult(for: .appTransaction) == .ownedByOtherAccount)
		#expect(conflict.account.links == [])
		#expect(try bound("auth-device.link-rejected.json").linkResult(for: .appTransaction) == .rejected)
	}

	@Test func olderRepliesDecodeWithoutLinks() throws {
		let response = try bound("auth-device.known.json")
		#expect(response.linkResults == nil && response.linkResult(for: .appTransaction) == nil)
		#expect(response.account.links == nil)
		let summary = try AccountJSON.decoder.decode(AccountSummary.self, from: body("account.get.json"))
		#expect(summary.links == nil)
	}

	@Test func unknownKindsAndOutcomesDecode() throws {
		let json = #"{"account":{"id":"3f8a2c10-6b4d-4e2a-9f1c-7d5e3b1a0c92","supportID":"PZ-4K7Q-9MPX","createdAt":"2026-10-13T19:04:11Z","access":{"status":"none","active":false},"links":[{"kind":"pa"}]},"token":"t","isNew":false,"linkResults":{"app_transaction":"pending","pa":"bound"}}"#
		let response = try AccountJSON.decoder.decode(AccountAuthResponse.self, from: Data(json.utf8))
		#expect(response.account.links?.first?.kind.rawValue == "pa")
		#expect(response.linkResult(for: .appTransaction)?.rawValue == "pending")
		#expect(response.linkResult(for: AccountLink.Kind(rawValue: "pa")) == .bound)
	}
}
