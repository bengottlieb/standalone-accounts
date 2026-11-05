import Foundation

/// `POST /api/v1/support/assertion`: a short-lived token that identifies this account to AppSupport.
public struct SupportAssertionResponse: Codable, Sendable, Equatable {
	public var assertion: String
	public var expiresAt: Date

	public init(assertion: String, expiresAt: Date) {
		self.assertion = assertion
		self.expiresAt = expiresAt
	}
}
