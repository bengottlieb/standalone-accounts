import Foundation
@testable import AccountKit

/// One `contract/<version>/fixtures/*.json` file, for the protocol version this build speaks: the same files the
/// server's tests check.
struct ContractFixture {
	let name: String
	let endpoint: String
	let request: Data?
	let status: Int
	let body: Data

	static let directory = URL(filePath: #filePath).deletingLastPathComponent().appending(path: "../../../contract/\(AccountEndpoint.protocolVersion)")

	static func all() throws -> [ContractFixture] {
		let folder = directory.appending(path: "fixtures")
		let names = try FileManager.default.contentsOfDirectory(atPath: folder.path()).filter { $0.hasSuffix(".json") }.sorted()
		return try names.map { try load(folder.appending(path: $0)) }
	}

	static func load(_ url: URL) throws -> ContractFixture {
		let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
		let response = object["response"] as! [String: Any]
		let request = object["request"].flatMap { $0 is NSNull ? nil : $0 }
		return ContractFixture(
			name: url.lastPathComponent,
			endpoint: object["endpoint"] as! String,
			request: try request.map { try JSONSerialization.data(withJSONObject: $0) },
			status: response["status"] as! Int,
			body: try JSONSerialization.data(withJSONObject: response["body"]!, options: .fragmentsAllowed)
		)
	}

	static func openAPI() throws -> [String: Any] {
		try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appending(path: "openapi.json"))) as! [String: Any]
	}
}

/// Whether two JSON documents are the same value, ignoring key order and formatting.
func sameJSON(_ lhs: Data, _ rhs: Data) throws -> Bool {
	let left = try JSONSerialization.jsonObject(with: lhs, options: .fragmentsAllowed) as! NSObject
	let right = try JSONSerialization.jsonObject(with: rhs, options: .fragmentsAllowed) as! NSObject
	return left.isEqual(right)
}
