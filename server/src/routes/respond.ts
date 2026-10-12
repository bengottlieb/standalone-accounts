import { accountSummarySchema, authResponseSchema, deviceAuthResponseSchema } from './contract.js'
import { accountSummary } from '../core/summary.js'
import { issueToken, reusableToken } from '../core/tokens.js'
import { signInKinds } from '../signin/options.js'
import type { AcctRouteOptions } from './options.js'

/** The account summary plus the host's extras, and the schemas that document them. */
export function responders({ db, config, extras, signIn }: AcctRouteOptions) {
	const kinds = signInKinds(signIn)
	const account = extras ? accountSummarySchema.extend(extras.schema.shape) : accountSummarySchema
	const auth = authResponseSchema.extend({ account })
	const schemas = {
		account,
		auth,
		device: extras ? deviceAuthResponseSchema.options[1].or(auth) : deviceAuthResponseSchema,
	}

	async function summary(accountId: string) {
		return { ...(await accountSummary(db, accountId, kinds)), ...(extras ? await extras.load(accountId) : {}) }
	}

	/**
	 * The auth response with this device's token for the account: the `presented` bearer when it is live, this device's
	 * (same credential) and already the account's, else a newly issued one. Call after the binding committed.
	 */
	async function authResponse(
		accountId: string,
		credentialHash: string,
		deviceName: string | null,
		isNew: boolean,
		merged = false,
		presented: string | null = null,
	) {
		const token =
			(presented && (await reusableToken(db, config, presented, accountId, credentialHash, deviceName))) ||
			(await issueToken(db, config, accountId, deviceName, credentialHash)).token
		return { account: await summary(accountId), token, isNew, ...(merged ? { merged } : {}) }
	}

	return { schemas, summary, authResponse }
}

/** The bearer token a request presents, if any: on `/auth/*`, the caller's current token, offered for reuse. */
export function presentedToken(request: { headers: { authorization?: string } }) {
	return /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1] ?? null
}
