import Foundation

/// `operation`'s result, or nil once `timeout` passes. The deadline is real: an operation that ignores cancellation
/// (CloudKit, StoreKit) is left running rather than awaited.
func withDeadline<T: Sendable>(_ timeout: Duration, _ operation: @escaping @Sendable () async -> T?) async -> T? {
	let (stream, continuation) = AsyncStream<T?>.makeStream()
	let work = Task {
		continuation.yield(await operation())
		continuation.finish()
	}
	let timer = Task {
		try? await Task.sleep(for: timeout)
		continuation.yield(nil)
		continuation.finish()
	}
	var result: T?
	for await value in stream {
		result = value
		break
	}
	work.cancel()
	timer.cancel()
	return result
}
