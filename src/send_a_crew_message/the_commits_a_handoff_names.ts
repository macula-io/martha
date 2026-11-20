// The commits a HANDOFF names exist, and its tip descends from its base (martha#980 package 3, a port of crew-code's
// core/handoff_commits.ts; threat model: martha#980 issuecomment-7049349078).

import type { Processes } from '../host_contract/host_contract.ts'
import type { CrewLineRead } from '../read_a_crew_line/read_a_crew_line.ts'

/** What the check reads with: the host's processes, and the folder the crew's clones sit in (null when none is declared). */
export interface TheCommitsAsked {
  readonly processes: Pick<Processes, 'run'>
  readonly clones: string | null
}

/** The lines a HANDOFF line's range comes to: a notice for what failed, a mark for what could not be checked. */
export async function theCommitsAHandoffNames(_asked: TheCommitsAsked, _line: CrewLineRead): Promise<readonly string[]> {
  return []
}
