import type { AcctDb } from '../db/tables.js'
import { HttpError } from '../http/errors.js'
import type { AcctConfig } from './config.js'
import { createAccount } from './accounts.js'
import { refreshAccess } from './access.js'
import { recordEvent } from './events.js'
import type { AcctHooks, SignInProfile } from './hooks.js'
import { bindDevice, findAccount, lockIdentity, type DeviceIdentity } from './identity.js'
import { isAnonymous, mergeInto } from './merge.js'

export interface SignInContext {
	db: AcctDb
	config: AcctConfig
	hooks?: AcctHooks
	/** Link kinds that make an account signed in (`signInKinds`). */
	kinds: string[]
	/** The host's handle from its `transaction`, passed to hooks. */
	host?: unknown
}

export interface SignInResult {
	accountId: string
	isNew: boolean
	merged: boolean
}

/**
 * Signs `device` in to the account that owns a proven identity (docs/DESIGN.md "Sign-in"):
 * - nobody owns it: `attach` adds it to the device's account (an anonymous one becomes signed in), or to a new account
 *   when the device has none;
 * - another account owns it and the device's account is anonymous: that account is folded in;
 * - another account owns it and the device's account is signed in: 409 `identity_in_use`.
 * Then the device is bound to the account. Run inside a transaction, holding a lock on the identity.
 */
export async function signInWith(
	ctx: SignInContext,
	device: DeviceIdentity,
	owner: string | null,
	attach: (accountId: string) => Promise<void>,
	profile: Omit<SignInProfile, 'isNew'>,
) {
	const current = (await findAccount(ctx.db, device))?.accountId ?? null
	let accountId: string
	let isNew = false
	let merged = false
	if (owner) {
		if (current && current !== owner) {
			if (!(await isAnonymous(ctx.db, current, ctx.kinds)))
				throw new HttpError(
					409,
					'identity_in_use',
					{},
					{ message: 'This device is signed in to another account. Sign out first.' },
				)
			await mergeInto(ctx.db, current, owner, 'device', ctx.hooks, ctx.host)
			merged = true
		}
		accountId = owner
	} else {
		accountId = current ?? (await createAccount(ctx.db, ctx.config, 'device', profile.method, ctx.hooks, ctx.host)).id
		isNew = !current
		await attach(accountId)
	}
	await bindDevice(ctx.db, accountId, device)
	await recordEvent(ctx.db, accountId, 'signed_in', 'device', { method: profile.method })
	await ctx.hooks?.signedIn?.(ctx.db, accountId, { ...profile, isNew }, ctx.host)
	await refreshAccess(ctx.db, accountId, 'device')
	return { accountId, isNew, merged } satisfies SignInResult
}

/** The account a link (`kind`, `value`) belongs to, if any. */
export async function linkOwner(db: AcctDb, kind: string, value: string) {
	const row = await db
		.selectFrom('acct_links')
		.select('account_id')
		.where('kind', '=', kind)
		.where('value', '=', value)
		.executeTakeFirst()
	return row?.account_id ?? null
}

/** Adds a link to an account; the caller has established nobody else owns it. */
export async function addLink(db: AcctDb, accountId: string, kind: string, value: string) {
	await db
		.insertInto('acct_links')
		.values({ kind, value, account_id: accountId })
		.onConflict((oc) => oc.columns(['kind', 'value']).doNothing())
		.execute()
}

/** Keeps a label for a link (the Apple email, the Game Center name) as a hint admins and the app can show. */
export async function setLabel(db: AcctDb, accountId: string, kind: string, label: string | undefined) {
	if (!label) return
	await db.deleteFrom('acct_hints').where('account_id', '=', accountId).where('kind', '=', `${kind}_label`).execute()
	await db
		.insertInto('acct_hints')
		.values({ account_id: accountId, kind: `${kind}_label`, value: label })
		.execute()
}

/**
 * A host-verified identity (PZLServer's PuzzleAnywhere login) for the signed-in `accountId`, under the same rules:
 * attached when nobody owns it; when another account does, an anonymous `accountId` is folded into it (its tokens move
 * with it, so the caller's token now opens the owner) and a signed-in one gets 409 `identity_in_use`. Run inside a
 * transaction.
 */
export async function claimHostIdentity(ctx: SignInContext, accountId: string, kind: string, value: string) {
	await lockIdentity(ctx.db, `${kind}:${value}`)
	const owner = await linkOwner(ctx.db, kind, value)
	if (!owner || owner === accountId) {
		if (!owner) await addLink(ctx.db, accountId, kind, value)
		return { accountId, merged: false }
	}
	if (!(await isAnonymous(ctx.db, accountId, ctx.kinds))) throw new HttpError(409, 'identity_in_use')
	await mergeInto(ctx.db, accountId, owner, 'device', ctx.hooks, ctx.host)
	return { accountId: owner, merged: true }
}
