// The coincidences of check_marthas_names_are_its_own: words its own files spell like a constant held elsewhere, meaning
// something else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never
// run.
//
// Two of them are the point of the slice rather than an accident. The table holds each crew-code name as data, and it
// must hold it as a spelling of its own: a table built from the constants of Martha's own tools would follow a rename
// silently and could no longer say that the old name came back. So the coincidence is declared here, in the one place
// the two spellings are known to mean the same thing, and the table stays an independent statement of the inventory.
// The file kinds are the other kind: `.json` is a kind of file this check reads and, in another slice, the suffix a
// journal is kept under — the same letters, two meanings.

import { CREW_CODE_DECLARATION_DIRECTORY, CREW_CODE_DECLARATION_FILE } from '../declare_crew/declare_crew.ts'
import { GATE_AUDIT_PLACE } from '../audit_the_gate_for_a_member/audit_the_gate_for_a_member.ts'
import { DEPENDENCIES, LOCK } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import { OWN_WRITES_SUFFIX } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { RELAY_JOURNAL_SUFFIX } from '../launch_a_claude_code_member/keep_the_relays_journal.ts'
import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'

/** Why the inventory's own words are spelled by the table rather than imported (martha#468). */
export const THE_INVENTORY_SPELLS_THE_NAME = 'a name crew-code gives something, as #468\'s inventory lists it; the constant of that word is the name Martha gives it until the rename that takes it away, and the table must not follow that rename'

/** Why two file kinds are read by literal. */
export const A_FILE_KIND_IS_NOT_A_JOURNALS_SUFFIX = 'a kind of file this check reads, and in another slice the suffix a journal or the crew\'s own state is kept under: the same letters, two meanings'

/** Why the two names no walk reads are spelled by literal. */
export const A_NAME_NO_WALK_READS = 'a directory and a file this check never reads, and the lock of an installed package: the same words, meaning a package\'s names rather than Martha\'s'

const TABLE = 'check_marthas_names_are_its_own/the_crew_code_names.ts'
const EXCEPTIONS = 'check_marthas_names_are_its_own/the_exceptions.ts'
const JUDGE = 'check_marthas_names_are_its_own/judge_a_tree.ts'
const FINDINGS = 'check_marthas_names_are_its_own/findings_in.ts'

export const COINCIDENCES: readonly Exception[] = [
  { value: RELAY_JOURNAL_SUFFIX, file: FINDINGS, reason: A_FILE_KIND_IS_NOT_A_JOURNALS_SUFFIX },
  { value: OWN_WRITES_SUFFIX, file: FINDINGS, reason: A_FILE_KIND_IS_NOT_A_JOURNALS_SUFFIX },
  { value: DEPENDENCIES, file: JUDGE, reason: A_NAME_NO_WALK_READS },
  { value: LOCK, file: JUDGE, reason: A_NAME_NO_WALK_READS },
  { value: CREW_CODE_DECLARATION_DIRECTORY, file: TABLE, reason: THE_INVENTORY_SPELLS_THE_NAME },
  { value: CREW_CODE_DECLARATION_FILE, file: TABLE, reason: THE_INVENTORY_SPELLS_THE_NAME },
  { value: GATE_AUDIT_PLACE, file: TABLE, reason: THE_INVENTORY_SPELLS_THE_NAME },
  { value: CREW_CODE_DECLARATION_DIRECTORY, file: EXCEPTIONS, reason: THE_INVENTORY_SPELLS_THE_NAME },
  { value: CREW_CODE_DECLARATION_FILE, file: EXCEPTIONS, reason: THE_INVENTORY_SPELLS_THE_NAME },
  { value: GATE_AUDIT_PLACE, file: EXCEPTIONS, reason: THE_INVENTORY_SPELLS_THE_NAME },
]
