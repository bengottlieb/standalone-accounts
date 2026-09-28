import { generateKeyPairSync, sign } from 'node:crypto'
import { gameCenterSignedPayload, gameCenterVerifier } from '../../src/signin/game-center.js'
import { SignInRejected } from '../../src/signin/apple.js'
import type { AcctHooks } from '../../src/core/hooks.js'
import type { SignInOptions } from '../../src/signin/options.js'

/** An Apple identity token for tests: `apple:<sub>:<email>`, accepted by `testSignIn`'s stub verifier. */
export const appleToken = (sub: string, email?: string) => `apple:${sub}:${email ?? ''}`

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

/** A Game Center proof signed with the test key, as GameKit would hand it over. */
export function gameCenterProof(teamPlayerID: string, o: { bundleID?: string; timestamp?: number } = {}) {
	const bundleID = o.bundleID ?? 'com.example.app'
	const timestamp = o.timestamp ?? Date.now()
	const salt = Buffer.from('pepper')
	const signature = sign('sha256', gameCenterSignedPayload(teamPlayerID, bundleID, timestamp, salt), privateKey)
	return {
		teamPlayerID,
		bundleID,
		publicKeyURL: 'https://static.gc.apple.com/public-key/gc-prod-9.cer',
		signature: signature.toString('base64'),
		salt: salt.toString('base64'),
		timestamp,
	}
}

/** Every sign-in method, with a stub Apple verifier, the test Game Center key, and a mailbox for reset codes. */
export function testSignIn() {
	const mailbox: { email: string; code: string }[] = []
	const signIn: SignInOptions = {
		apple: {
			verify: async (token) => {
				const [scheme, sub, email] = token.split(':')
				if (scheme !== 'apple' || !sub) throw new SignInRejected('bad token')
				return { sub, ...(email ? { email } : {}) }
			},
		},
		password: { sendResetCode: async (email, code) => void mailbox.push({ email, code }) },
		gameCenter: { verify: gameCenterVerifier(['com.example.app'], async () => publicKey) },
		hostKinds: ['pa'],
	}
	return { signIn, mailbox }
}

/** Hooks that record what the host was asked to do. */
export function recordingHooks() {
	const calls: string[] = []
	const hooks: AcctHooks = {
		accountCreated: async (_db, id) => void calls.push(`created ${id}`),
		mergeAccounts: async (_db, from, into) => void calls.push(`merge ${from} into ${into}`),
		signedIn: async (_db, id, profile) =>
			void calls.push(`signed in ${id} with ${profile.method}${profile.isNew ? ' (new)' : ''}`),
	}
	return { hooks, calls }
}
