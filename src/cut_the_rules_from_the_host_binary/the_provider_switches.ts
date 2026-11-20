// The variables that switch the host off its own API, onto a gateway or a cloud provider, as the recorder cuts them
// from the host binary (martha#916 r=4).
//
// The host picks the provider it bills through in one function (`ve` in 2.1.329):
//
//   function ve(){if(Po()||v7e()||Sre())return"gateway";return s.CLAUDE_CODE_USE_BEDROCK?"bedrock":...:"firstParty"}
//
// Any one of these switches set in a member's environment takes the member off the owner's sign-in and off the
// launcher's key alike (seen live on 2.1.329: a planted CLAUDE_CODE_USE_BEDROCK turned a subscription member's banner
// to "Amazon Bedrock"; CLAUDE_CODE_USE_GATEWAY with a base URL and a token turned a key member's to "Cloud gateway").
// So no billed member is given any of them, and the names are cut from the host, never typed here:
//   - the cloud providers: the chain that tests one variable per provider, in turn, and falls back to the host's own
//     API, `firstParty`;
//   - the gateway: `Po()` is the gateway sign-in, which the environment fills only where one variable gates the
//     hand-off of a base URL and a token (`if(!s.CLAUDE_CODE_USE_GATEWAY)return!1;let e=s.ANTHROPIC_BASE_URL,n=
//     s.ANTHROPIC_AUTH_TOKEN||...`). `v7e()` is set only by the `claude gateway` subcommand and `Sre()` reads the
//     machine's managed settings: neither reads the environment, so neither has a variable to cut.
// A host with no such chain or gate, or two that name different variables, fails the recording before a launch could
// rely on it.

/** The host's own API, the provider the chain falls back to when no cloud provider's variable is set. */
const THE_HOSTS_OWN_API = 'firstParty'

/** The environment object a test reads, and the variable it reads on it. */
const ENVIRONMENT = String.raw`[\w$]+`
const VARIABLE = String.raw`[A-Z][A-Z0-9_]*`

/** One test of the chain, `<env>.<VARIABLE>?"<provider>":`, capturing the environment and the variable. */
const ONE_TEST = String.raw`(${ENVIRONMENT})\.(${VARIABLE})\?"\w+":`

/** The whole chain: one test or more, then the fallback to the host's own API. */
const THE_CHAIN = new RegExp(String.raw`return (?:${ENVIRONMENT}\.${VARIABLE}\?"\w+":)+"${THE_HOSTS_OWN_API}"`, 'g')

/** The gate of the gateway's hand-off: the switch, and then the base URL and the token read on the same environment. */
const THE_GATEWAY_GATE = new RegExp(
  String.raw`if\(!(${ENVIRONMENT})\.(${VARIABLE})\)return!1;let ${ENVIRONMENT}=\1\.ANTHROPIC_BASE_URL,${ENVIRONMENT}=\1\.ANTHROPIC_AUTH_TOKEN\|\|`,
  'g',
)

/** The variables one chain tests, in its order, each on the same environment object as the first. */
function variablesOf(chain: string): readonly string[] {
  const tests = [...chain.matchAll(new RegExp(ONE_TEST, 'g'))]
  const environments = new Set(tests.map((one) => one[1]))
  if (environments.size !== 1) {
    throw new Error(`The host's provider choice reads ${String(environments.size)} environments, not one, so which variables move a member off its billing cannot be told.`)
  }
  return tests.map((one) => one[2] ?? '')
}

/** The one value `found` holds, or a refusal naming how many it holds. */
function theOne(found: readonly string[], what: string): string {
  const distinct = [...new Set(found)]
  if (distinct.length !== 1) {
    throw new Error(`The host names ${String(distinct.length)} ${what}, not one, so which variables move a member off its billing cannot be told.`)
  }
  return distinct[0] ?? ''
}

/** The variables any one of which switches the host off its own API: the gateway's, then the cloud providers' in order. */
export function providerSwitchVariablesIn(text: string): { readonly provider_switch_variables: readonly string[] } {
  const gateway = theOne([...text.matchAll(THE_GATEWAY_GATE)].map((match) => match[2] ?? ''), 'gateway switches')
  const chain = theOne([...text.matchAll(THE_CHAIN)].map((match) => variablesOf(match[0]).join(',')), 'provider choices')
  return { provider_switch_variables: [gateway, ...chain.split(',')] }
}
