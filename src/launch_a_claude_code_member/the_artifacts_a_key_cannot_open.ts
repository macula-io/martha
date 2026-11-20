// The Artifact tools a member billed by an API key cannot run (martha#957 gap 13, crew-code's #85).
//
// The Artifact tools need the claude.ai login. A member billed by the key (martha#916) is handed the key and no sign-in:
// its own config folder holds none, and the sign-in store variable is taken out. So an Artifact call there fails on the
// login it lacks, and the host's own error names no way forward. The call is refused first instead, with a line that
// names the way: the one line that hands the read or the publish to the Supervisor, who has the login (../read_a_crew_line).
// A member billed by the subscription carries the login, and nothing is refused.
//
// The billing is the launch's own (../launch_a_claude_code_member), never a provider's name: a declaration names its
// providers freely (Raf's names his `anthropic_acc`), so a name could not tell which member has the login.

import { BILLED_BY_API_KEY, type Billing } from '../declare_crew/declare_crew.ts'
import { ARTIFACT_LINES } from '../read_a_crew_line/crew_lines.ts'

/** The host's tools that need the claude.ai login, by the names it calls them. */
export const ARTIFACT_TOOLS: readonly string[] = ['Artifact', 'ArtifactComments', 'ArtifactData']

/** The way an Artifact goes instead: one line to the Supervisor, in either of its two forms. */
export const theArtifactRoute = (): string =>
  `Send the Supervisor one line instead: \`${ARTIFACT_LINES.read}\` to have the page saved at that file, or ` +
  `\`${ARTIFACT_LINES.publish}\` (add url=<artifact link> to update a page) to have the file published.`

/** Why a call of `tool` is not run for a member billed by `billing`, or undefined when it runs. */
export function theArtifactRefusal(billing: Billing, tool: string): string | undefined {
  if (billing !== BILLED_BY_API_KEY || !ARTIFACT_TOOLS.includes(tool)) return undefined
  return `Not run: Artifacts need the claude.ai login, which a member billed by ${BILLED_BY_API_KEY} does not carry. ${theArtifactRoute()}`
}
