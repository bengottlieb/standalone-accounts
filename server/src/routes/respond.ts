import { accountSummarySchema, authResponseSchema, deviceAuthResponseSchema } from './contract.js'
import { accountSummary } from '../core/summary.js'
import { issueToken } from '../core/tokens.js'
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

	/** Issues this device a token for the account and returns the auth response. Call after the binding committed. */
	async function authResponse(
		accountId: string,
		credentialHash: string,
		deviceName: string | null,
		isNew: boolean,
		merged = false,
	) {
		const { token } = await issueToken(db, config, accountId, deviceName, credentialHash)
		return { account: await summary(accountId), token, isNew, ...(merged ? { merged } : {}) }
	}

	return { schemas, summary, authResponse }
}
