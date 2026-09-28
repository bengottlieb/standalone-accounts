import { createHmac, randomBytes, randomInt } from 'node:crypto'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
// No 0/O or 1/I/L: people read these aloud and type them.
const READABLE = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/** Secrets (tokens, device secrets, claim codes) are stored only as keyed hashes. */
export function keyedHash(secret: string, value: string): string {
	return createHmac('sha256', secret).update(value).digest('hex')
}

/** `prefix` followed by 43 base62 characters (~256 bits). */
export function generateToken(prefix: string): string {
	return prefix + Array.from(randomBytes(43), (b) => BASE62[b % 62]).join('')
}

function readable(length: number) {
	return Array.from({ length }, () => READABLE[randomInt(READABLE.length)]).join('')
}

/** `SK-7F3K-Q9PD`: the shape of Support IDs and claim codes (~40 bits). */
export function generateCode(prefix: string): string {
	return `${prefix}-${readable(4)}-${readable(4)}`
}

/** A code as someone typed it: case, spaces and missing dashes don't matter. */
export function normalizeCode(input: string): string {
	const compact = input.toUpperCase().replace(/[^0-9A-Z]/g, '')
	return compact.length === 10 ? `${compact.slice(0, 2)}-${compact.slice(2, 6)}-${compact.slice(6)}` : compact
}
