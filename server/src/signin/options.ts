import type { AppleIdentity } from './apple.js'
import type { GameCenterProof } from './game-center.js'

/**
 * The sign-in methods a server offers (docs/DESIGN.md "Sign-in"). A method left out answers 404
 * `signin_unavailable`. Verifiers are built by `appleVerifier` and `gameCenterVerifier`; tests pass their own.
 */
export interface SignInOptions {
	apple?: { verify: (identityToken: string) => Promise<AppleIdentity> }
	password?: {
		/** Emails a reset code (six digits, one hour, one use). The host owns mail delivery. */
		sendResetCode: (email: string, code: string) => Promise<void>
		/** The shortest new password (register, reset, change); default 8. Sign-in never checks length. */
		minLength?: number
	}
	gameCenter?: { verify: (proof: GameCenterProof) => Promise<string> }
	/** Host-verified link kinds that count as a way to sign in (PZLServer: `pa`), so their accounts aren't anonymous. */
	hostKinds?: string[]
}

/** The link kinds (beyond passwords) that make an account signed in rather than anonymous. */
export function signInKinds(options: SignInOptions | undefined) {
	return ['apple', 'game_center', ...(options?.hostKinds ?? [])]
}
