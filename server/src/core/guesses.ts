import { HttpError } from '../http/errors.js'

/**
 * Wrong-password guesses per caller and email: after `limit` in `windowMs`, further tries answer 429 `rate_limited`
 * until the window ends, whatever the password. In memory, per process, like the host's own rate limits.
 */
export function guessLimiter(limit = 5, windowMs = 15 * 60 * 1000) {
	const misses = new Map<string, { count: number; resetAt: number }>()
	const entry = (key: string, now: number) => {
		const current = misses.get(key)
		if (current && current.resetAt > now) return current
		const fresh = { count: 0, resetAt: now + windowMs }
		misses.set(key, fresh)
		return fresh
	}
	return {
		/** Throws 429 when this caller has used up its guesses at this email. */
		check(key: string, now = Date.now()) {
			const current = entry(key, now)
			if (current.count >= limit)
				throw new HttpError(429, 'rate_limited', { 'retry-after': String(Math.ceil((current.resetAt - now) / 1000)) })
		},
		miss(key: string, now = Date.now()) {
			entry(key, now).count++
			if (misses.size > 10_000) for (const [k, v] of misses) if (v.resetAt <= now) misses.delete(k)
		},
	}
}
