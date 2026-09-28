/** Per-app settings of the account framework (docs/DESIGN.md "Per-app settings"). */
export interface AcctConfig {
	/** Keys the HMACs that store tokens, device secrets and claim codes. */
	secret: string
	/** `trigger`: accounts only from a purchase, claim code or admin. `first-launch`: every device gets one. */
	creation: 'trigger' | 'first-launch'
	/** Bearer tokens start with this (`skm_`), which is how the auth hook tells them from API keys. */
	tokenPrefix: string
	/** Two capital letters in front of Support IDs and claim codes (`SK`). */
	codePrefix: string
	maxTokensPerAccount: number
	claimCodeDays: number
	/** The app's URL scheme; claim links are `<scheme>://claim?code=…`. */
	urlScheme: string
}
