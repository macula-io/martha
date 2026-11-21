// The note a member is given after a call that wrote one of the crew's briefs and left it breaking the owner-item rule
// (martha#999 package 2b, gap 7 of martha#957). Ported from crew-code (macula-sponsors 6f353d51, hooks/register.tsx):
//
// - A shell write (noteShellBrief and shellBriefNote, :4015-4050): the paths the command writes into, the word after a
//   `>` or `>>` or the file given to `tee`, read as names; only a brief dated on one of the UTC days from two back to one
//   ahead counts, since the writer names it by its own local date. A path the command only names proves nothing, so a
//   brief another member wrote while the command ran is never noted.
// - A file tool's write: the Supervisor's ruling on martha#999 (issuecomment-7049600393, applying DECIDED 2026-11-20
//   "Yes, list then cut (Recommended)") makes crew-code's refusal before the write a note after it, as the shell's is.
//   So the brief is read once the write landed, on both hosts, and no call's content argument is trusted for it.
//
// The note rides back on the launcher's answer to the ran call and reaches the model after the tool's result, as
// crew-code's withNote does (:3597). A brief is named by its file alone and read from the crew's own briefs place
// (./read_a_members_brief.ts), where Martha keeps every brief; a call that writes a file of that name elsewhere is read
// against the crew's copy, a missed or a stale note, never a refused call. crew-code's mtime test (a brief this command
// named but did not change) has no stat in the crew store, so a brief the command only might have written is read as
// it stands: what the note says of it is still true of the file.

import { basename } from 'node:path'

import type { CrewPlace, HostFileTools, Refused } from '../host_contract/host_contract.ts'
import { briefDatedOn, briefProblems, isBriefPath } from './owner_items.ts'

/** A ran call, as the launcher hears it, and what judging it needs: the host's own tool names and the crew's briefs. */
export interface ACallThatMayWriteABrief {
  readonly tool: string
  readonly input: Readonly<Record<string, unknown>>
  readonly file_tools: HostFileTools
  /** The host's shell tool, whose `command` argument is the line it ran. */
  readonly shell_tool: string
  /** The crew's briefs place, or why it cannot be used: read only once the call wrote a brief. */
  readonly briefs: () => CrewPlace | Refused
  /** The owner when the crew's owner-items rule is on, else undefined: read only once the call wrote a brief. */
  readonly owner_items: () => Promise<string | undefined>
  /** When the call was answered, in milliseconds since the Unix epoch. */
  readonly now: number
}

const DAY_MS = 24 * 3600_000
/** The UTC days a writer's local today or yesterday falls on, whatever its zone (crew-code #95 review r=2). */
const LOCAL_DAY_SPAN = [1, 0, -1, -2]
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** The paths a shell line writes into: the word after a `>` or `>>`, or the file given to `tee` (crew-code #268). */
const shellWriteTargets = (command: string): string[] =>
  [...command.matchAll(/(?:>>?|\btee(?:\s+-[a-z]+)*)\s*["']?([^\s"';|&)]+)/g)].map((match) => match[1] ?? '')

/** The brief names a call wrote into, by its file alone. */
function theBriefsWritten(call: ACallThatMayWriteABrief): readonly string[] {
  if (call.tool === call.shell_tool) {
    const command = call.input['command']
    if (typeof command !== 'string') return []
    const days = LOCAL_DAY_SPAN.map((shift) => dayOf(call.now + shift * DAY_MS))
    return shellWriteTargets(command).map((target) => basename(target)).filter((name) => briefDatedOn(name, days))
  }
  const argument = call.file_tools.own_writes[call.tool]
  if (argument === undefined || !call.file_tools.writing_tools.includes(call.tool)) return []
  const named = call.input[argument]
  return typeof named === 'string' && isBriefPath(named) ? [basename(named)] : []
}

/** The note to give after `call`, or '' when it wrote no brief that breaks the rule. */
export async function theNoteAfterABriefWrite(call: ACallThatMayWriteABrief): Promise<string> {
  const names = [...new Set(theBriefsWritten(call))]
  if (names.length === 0) return ''
  const owner = await call.owner_items()
  const briefs = owner === undefined ? undefined : call.briefs()
  if (owner === undefined || briefs === undefined || 'refusal' in briefs) return ''
  const found = names.flatMap((name) => {
    const read = briefs.read(name)
    if (read === undefined || 'refusal' in read) return []
    const problems = briefProblems(read.text, owner)
    return problems === '' ? [] : [`${name}: ${problems}.`]
  })
  return found.length === 0
    ? ''
    : ['Crew: the brief this command wrote breaks the owner-item rule, so fix the file now:', ...found, 'Until it is fixed, a member reads an unmarked line as an IDEA.'].join(' ')
}
