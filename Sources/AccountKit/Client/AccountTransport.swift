import Foundation

/// How AccountKit reaches the server. Each app already has a Convey-based client with its own base URL, logging and
/// error reporting; it conforms to this instead of AccountKit carrying a second networking stack.
public protocol AccountTransport: Sendable {
	/// Sends `body` (already encoded with `AccountJSON.encoder`, nil for bodyless calls) to `endpoint`, with
	/// `Authorization: Bearer <token>` when `token` is set, and returns the status and raw body. Throws only when
	/// there was no HTTP answer at all.
	func send(_ endpoint: AccountEndpoint, body: Data?, token: String?) async throws -> AccountTransportResponse
}

public struct AccountTransportResponse: Sendable {
	public var status: Int
	public var body: Data

	public init(status: Int, body: Data) {
		self.status = status
		self.body = body
	}
}

public enum AccountServiceError: Error, Equatable {
	/// The server answered with an error body.
	case server(status: Int, AccountErrorResponse)
	/// A non-2xx whose body wasn't the error shape (a proxy page, an empty 502).
	case unexpected(status: Int)
	/// A call that needs a token, made without one.
	case notSignedIn

	public var code: AccountErrorCode? {
		if case .server(_, let response) = self { return response.error }
		return nil
	}
}
