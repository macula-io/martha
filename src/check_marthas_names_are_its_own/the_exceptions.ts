// The places a crew-code name is allowed to stand in Martha, each with why and with what removes it (martha#468).
//
// The inventory of #468 is a table of names Martha and crew-code both give something; the check fails on each of them.
// Until a name is renamed, the places that still spell it are excused here — one entry per file and name, so a new file
// cannot take a name under the cover of an old exception, and an exception that excuses nothing is itself a finding,
// because a list that has stopped matching the tree says nothing true about it.
//
// `removed_by` is the package's PR that takes the entry away, or STAYS for a place no rename will ever remove: the
// refusal that recognises crew-code's declaration to say so, the check's own table and planted cases, or a test that
// proves Martha refuses or ignores a peer program's own tool. A literal that is Martha's own is not a STAYS: the family
// catches it by shape, and a name of Martha's in crew-code's shape moves like any other.

/** An exception that no rename will remove: the place must name a crew-code name. */
export const STAYS = 'stays'

/** One place a crew-code name is allowed to stand. */
export interface DeclaredException {
  /** The file, relative to the repository. */
  readonly path: string
  /** The name it spells, as ../the_crew_code_names.ts holds it. */
  readonly text: string
  /** Why it stands there. */
  readonly reason: string
  /** The PR that takes this entry away, or STAYS. */
  readonly removed_by: string
}

/** Every place a crew-code name may stand, until the rename that takes it away. */
export const EXCEPTIONS: readonly DeclaredException[] = [
  { path: 'src/answer_a_tool_call/answer_a_tool_call.node-test.ts', text: 'mcp__crew__crew_mail_send', reason: "a peer program's own tool call, which this test proves Martha does not answer", removed_by: STAYS },
  { path: 'src/check_marthas_names_are_its_own/check_marthas_names_are_its_own.node-test.ts', text: 'crew_channel_taken/', reason: "the check's own planted case, which must spell the name to prove the check finds it", removed_by: STAYS },
  { path: 'src/check_marthas_names_are_its_own/check_marthas_names_are_its_own.node-test.ts', text: 'crew_other', reason: "the check's own planted case, which must spell the name to prove the check finds it", removed_by: STAYS },
  { path: 'src/check_marthas_names_are_its_own/check_marthas_names_are_its_own.node-test.ts', text: 'crew_roster', reason: "the check's own planted case, which must spell the name to prove the check finds it", removed_by: STAYS },
  { path: 'src/declare_crew/declare_crew.ts', text: '.crew', reason: "the refusal that tells a person their checkout still holds crew-code's declaration names this file", removed_by: STAYS },
  { path: 'src/declare_crew/declare_crew.ts', text: 'crew.json', reason: "the refusal that tells a person their checkout still holds crew-code's declaration names this file", removed_by: STAYS },
  { path: 'src/read_a_room_through_its_gate/read_a_room_through_its_gate.node-test.ts', text: 'mcp__crew__crew_mail_read', reason: "a peer program's own tool call, which this test proves Martha does not answer", removed_by: STAYS },
  { path: 'src/refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.node-test.ts', text: 'crew_restart', reason: "a tool crew-code's host really registers, which this test proves Martha refuses like any other name that executes", removed_by: STAYS },
]
