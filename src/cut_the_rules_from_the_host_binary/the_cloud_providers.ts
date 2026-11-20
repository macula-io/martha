// The variables that move the host off its own API onto a cloud provider, as the recorder cuts them from the host
// binary (martha#916 r=4).
//
// The host picks the provider it bills through in one place: a chain that tests one variable per cloud provider, in
// turn, and falls back to its own API, `firstParty`, when none is set. Any one of them set in a member's environment
// takes the member off the owner's sign-in and off the launcher's key alike (seen live on 2.1.329: a planted
// CLAUDE_CODE_USE_BEDROCK turned a subscription member's banner to "Amazon Bedrock"). So no billed member is given
// any of them, and the names are cut from that chain, never typed here: a host that adds a provider adds its name.
//
// The chain, as 2.1.329 spells it: `return s.CLAUDE_CODE_USE_BEDROCK?"bedrock":s.CLAUDE_CODE_USE_FOUNDRY?"foundry":
// ...:s.CLAUDE_CODE_USE_VERTEX?"vertex":"firstParty"`. A host with no such chain, or two that name different
// variables, fails the recording before a launch could rely on it.

/** The host's own API, the provider the chain falls back to when no cloud provider's variable is set. */
const THE_HOSTS_OWN_API = 'firstParty'

/** The environment object a test reads, and the variable it reads on it. */
const ENVIRONMENT = String.raw`[\w$]+`
const VARIABLE = String.raw`[A-Z][A-Z0-9_]*`

/** One test of the chain, `<env>.<VARIABLE>?"<provider>":`, capturing the environment and the variable. */
const ONE_TEST = String.raw`(${ENVIRONMENT})\.(${VARIABLE})\?"\w+":`

/** The whole chain: one test or more, then the fallback to the host's own API. */
const THE_CHAIN = new RegExp(String.raw`return (?:${ENVIRONMENT}\.${VARIABLE}\?"\w+":)+"${THE_HOSTS_OWN_API}"`, 'g')

/** The variables one chain tests, in its order, each on the same environment object as the first. */
function variablesOf(chain: string): readonly string[] {
  const tests = [...chain.matchAll(new RegExp(ONE_TEST, 'g'))]
  const environments = new Set(tests.map((one) => one[1]))
  if (environments.size !== 1) {
    throw new Error(`The host's provider choice reads ${String(environments.size)} environments, not one, so which variables move a member off its billing cannot be told.`)
  }
  return tests.map((one) => one[2] ?? '')
}

/** The variables any one of which moves the host onto a cloud provider; cut from the host's text. */
export function cloudProviderVariablesIn(text: string): { readonly cloud_provider_variables: readonly string[] } {
  const chains = [...new Set([...text.matchAll(THE_CHAIN)].map((match) => variablesOf(match[0]).join(',')))]
  if (chains.length !== 1) {
    throw new Error(`The host names ${String(chains.length)} provider choices, not one, so which variables move a member off its billing cannot be told.`)
  }
  return { cloud_provider_variables: (chains[0] ?? '').split(',') }
}
