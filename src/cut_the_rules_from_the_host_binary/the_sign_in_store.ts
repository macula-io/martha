// Where the host keeps the owner's sign-in, as the recorder cuts it from the host binary (martha#602).
//
// A member starts with a config folder of its own, so the owner's user hooks and plugins never load in it, and it
// reaches the owner's sign-in without a copy: the host picks its sign-in store by a variable of its own, apart from
// CLAUDE_CONFIG_DIR. Set and empty, that variable names the default store, which is the owner's: on Linux the
// credentials file under the home's own config folder, on macOS the keychain item without the suffix a config folder
// adds. Unset, the store follows CLAUDE_CONFIG_DIR, where the member would not be signed in.
//
// The variable is cut from the two places the host reads it, never typed here, and both must agree:
//   - the keychain item's name: the variable, read once, is unset or empty when no suffix is added, and only then
//     does an unset CLAUDE_CONFIG_DIR decide it;
//   - the credentials file's folder: the variable, read once, set, gives that folder, and an empty value falls back to
//     the default one.
// A host with another count of either, or two that disagree, fails the recording before a launch could rely on it.

/** The keychain item name's suffix rule: `let e=process.env.<V>,t=e!==void 0?!e:!process.env.CLAUDE_CONFIG_DIR`. */
const KEYCHAIN_RULE = /let ([\w$]+)=process\.env\.([A-Z][A-Z0-9_]*),[\w$]+=\1!==void 0\?!\1:!process\.env\.CLAUDE_CONFIG_DIR\b/g

/** The credentials file's folder rule: `let n=process.env.<V>;if(n!==void 0)return(n||<the default folder>)`. */
const FILE_RULE = /let ([\w$]+)=process\.env\.([A-Z][A-Z0-9_]*);if\(\1!==void 0\)return\(\1\|\|/g

function theOneVariable(text: string, rule: RegExp, what: string): string {
  const found = [...new Set([...text.matchAll(rule)].map((match) => match[2] ?? ''))]
  if (found.length !== 1) {
    throw new Error(`The host names ${String(found.length)} variables for ${what}, not one, so how a member reaches the owner's sign-in cannot be told.`)
  }
  return found[0] ?? ''
}

/** The variable that, set and empty, points the host at the owner's default sign-in store; cut from the host's text. */
export function signInStoreVariableIn(text: string): { readonly sign_in_store_variable: string } {
  const keychain = theOneVariable(text, KEYCHAIN_RULE, "the sign-in keychain item's name")
  const file = theOneVariable(text, FILE_RULE, "the sign-in file's folder")
  if (keychain !== file) {
    throw new Error(`The host picks its sign-in keychain item by ${keychain} and its sign-in file by ${file}, so how a member reaches the owner's sign-in cannot be told.`)
  }
  return { sign_in_store_variable: keychain }
}
