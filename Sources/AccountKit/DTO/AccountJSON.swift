import Foundation

/// The coders for the account protocol: ISO 8601 dates, with or without fractional seconds.
public enum AccountJSON {
	public static var encoder: JSONEncoder {
		let encoder = JSONEncoder()
		encoder.dateEncodingStrategy = .custom { date, encoder in
			var container = encoder.singleValueContainer()
			try container.encode(date.formatted(.iso8601))
		}
		return encoder
	}

	public static var decoder: JSONDecoder {
		let decoder = JSONDecoder()
		decoder.dateDecodingStrategy = .custom { decoder in
			let container = try decoder.singleValueContainer()
			let string = try container.decode(String.self)
			if let date = try? Date(string, strategy: .iso8601) { return date }
			if let date = try? Date(string, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) { return date }
			throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not an ISO 8601 date: \(string)")
		}
		return decoder
	}
}
