// The `file_a_friction_note` tool (martha#318): a member files what it hit as an issue in a repository the crew declared.
//
// The note, its title and body, and the refusals are ./friction_note's, with no I/O; this runs gh and keeps the crew's
// own index of the notes it filed. Nothing is sent at all when a note is refused: where it may land and what it may say
// are decided before gh runs, so the note a member believes in is the one that exists, and a refused one leaves no issue
// behind.

import {
  DECLARATION_DIRECTORY,
  DECLARATION_FILE,
  sameMemberName,
  type CrewSettings,
} from '../declare_crew/declare_crew.ts'
import {
  FRICTION_KINDS,
  FRICTION_LABEL,
  FRICTION_LABEL_COLOUR,
  FRICTION_LABEL_DESCRIPTION,
  THE_NOTES_FILE,
  theFiledIssueIn,
  theNoteIn,
  theNotesIn,
  theNotesRefusalIn,
  theNotesText,
  theNotesTitle,
  theNotesWith,
  theNotesBody,
  type FrictionNote,
} from './friction_note.ts'
import { join } from 'node:path'
import type { CrewStore, Processes } from '../host_contract/host_contract.ts'
import { todayOf } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { theNudgesGoTo } from '../nudge_the_supervisor/nudge_the_supervisor.ts'

/** The tool's name, as the crew's tools are named. */
export const FILE_A_FRICTION_NOTE = 'file_a_friction_note'

/** The place in the crew's store the index of filed notes is kept in. */
export const FRICTION_PLACE = 'friction'

/** What `file_a_friction_note` takes: the repository, the kind, and the three answers. */
export const FILE_A_FRICTION_NOTE_TOOL = {
  name: FILE_A_FRICTION_NOTE,
  description:
    'File what you hit with a tool as a friction note. It becomes an issue in a repository the crew declares, labelled ' +
    `"${FRICTION_LABEL}", opening with a Purpose line. Say what you tried, what the tool did and what you needed; it is ` +
    'refused when it carries a home path, a private address, an email outside the declared domains, a hex id, a token ' +
    'or a lab hostname.',
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'The repository the note lands in, "org/name", one the crew declares' },
      kind: { type: 'string', enum: [...FRICTION_KINDS], description: `What kind of need this is (${FRICTION_KINDS[0]} if you name none)` },
      tried: { type: 'string', description: 'What you tried, in a few sentences' },
      did: { type: 'string', description: 'What the tool did' },
      need: { type: 'string', description: 'What you needed: the issue title and the Purpose line, so it is one line' },
    },
    required: ['repo', 'tried', 'did', 'need'],
  },
} as const

/** What a filing is handed: this launch's places and the one declaration it reads. */
export interface TheFilingAsked {
  readonly member: string
  readonly settings: CrewSettings
  readonly root: string
  readonly crew: CrewStore
  /** The processes gh runs through, when this launch holds any: a launcher does, a session's own tools do not. */
  readonly processes?: Processes
  readonly now: number
}

/** What a filing answers: the line the member is told, or why nothing was sent. */
type AFilingAnswer = { readonly answer: string } | { readonly refused: string }

/** What a note that is not one is told: the shape it must have. */
const THE_NOTE_REFUSAL =
  'Not filed: name the repository the note lands in as "org/name", say what you tried, what the tool did and what you needed, ' +
  `and name a kind if you like (${FRICTION_KINDS.join(', ')}). A note is three short paragraphs, not a design.`

/** What a launch without processes is told when it files: gh cannot run where nothing may. */
const NO_RUNNING_PLACE = 'Not filed: this launch holds no processes, so gh cannot run and nothing was sent.'

/** Why gh is said to have failed: its own last line of error, or that it could not run at all. */
const ghProblem = (ran: { readonly stderr: string } | null): string =>
  ran === null ? 'gh could not run' : (ran.stderr.trim().split('\n').filter(Boolean).at(-1) ?? 'gh refused it')

/** A gh that says the label is missing is the first note in a repository, and only that: any other refusal is reported. */
const LABEL_MISSING = /label[^\n]*not found|not found[^\n]*label/i

/** What a run made: the issue it named, or why nothing the crew can point at was made. */
type AFiling = { readonly ok: true; readonly issue: number } | { readonly ok: false; readonly refused: string }

export async function fileAFrictionNote(asked: TheFilingAsked, args: Readonly<Record<string, unknown>>): Promise<AFilingAnswer> {
  const note = theNoteIn(args, {
    member: asked.member,
    supervisor: theNudgesGoTo(asked.settings).some((name) => sameMemberName(name, asked.member)),
    day: todayOf(asked.now),
  })
  if (note === null) return { refused: THE_NOTE_REFUSAL }
  const declaration = join(DECLARATION_DIRECTORY, DECLARATION_FILE)
  const problem = theNotesRefusalIn(note, { repos: asked.settings.friction_repos, public_emails: asked.settings.public_emails }, declaration)
  if (problem !== '') return { refused: problem }
  if (asked.processes === undefined) return { refused: NO_RUNNING_PLACE }
  const filed = await fileTheNote(asked, note)
  if (!filed.ok) return { refused: filed.refused }
  // The issue is the note; the index is the crew's own record of it, and a store that would not keep it loses a
  // record, never the note.
  keepTheFiledNote(asked, note, filed.issue)
  return { answer: `Filed ${note.repo}#${filed.issue}: ${theNotesTitle(note)}.` }
}

/** One gh run, with its output; null when it could not start at all. */
const runGh = async (asked: TheFilingAsked, argv: readonly string[]): Promise<{ readonly exit_code: number | null; readonly stdout: string; readonly stderr: string } | null> =>
  asked.processes === undefined ? null : asked.processes.run({ command: argv[0] ?? '', args: argv.slice(1), cwd: asked.root }).catch(() => null)

/** The issue a run made, or why nothing the crew can point at was made. */
const theFilingIn = (ran: { readonly exit_code: number | null; readonly stdout: string; readonly stderr: string } | null, note: FrictionNote): AFiling => {
  if (ran === null || ran.exit_code !== 0) return { ok: false, refused: `Not filed in ${note.repo}: ${ghProblem(ran)}. Nothing was written; fix that and call again.` }
  const issue = theFiledIssueIn(ran.stdout)
  if (issue !== null) return { ok: true, issue }
  return {
    ok: false,
    refused: `Not filed in ${note.repo}: gh answered without naming the issue it made, so check that repository's issues before calling again. The note may have landed.`,
  }
}

/**
 * The issue a note becomes: `gh issue create` in the repository the note names, under the `friction` label. The first
 * use in a repository meets a label nobody created, so that one failure is answered by creating the label and asking
 * again — once, and only when gh said the label was missing, so any other refusal is reported as it stands.
 */
async function fileTheNote(asked: TheFilingAsked, note: FrictionNote): Promise<AFiling> {
  const argv = ['gh', 'issue', 'create', '-R', note.repo, '-l', FRICTION_LABEL, '-t', theNotesTitle(note), '--body', theNotesBody(note)]
  const first = await runGh(asked, argv)
  if (first === null || first.exit_code === 0 || !LABEL_MISSING.test(first.stderr)) return theFilingIn(first, note)
  const made = await runGh(asked, ['gh', 'label', 'create', FRICTION_LABEL, '-R', note.repo, '-c', FRICTION_LABEL_COLOUR, '-d', FRICTION_LABEL_DESCRIPTION])
  if (made === null || made.exit_code !== 0) {
    return { ok: false, refused: `Not filed in ${note.repo}: the label ${FRICTION_LABEL} could not be created (${ghProblem(made)}). Nothing was written; fix that and call again.` }
  }
  return theFilingIn(await runGh(asked, argv), note)
}

/** The note added to the crew's index, best effort: a store that would not keep it changes no answer to the member. */
function keepTheFiledNote(asked: TheFilingAsked, note: FrictionNote, issue: number): void {
  const place = asked.crew.place(FRICTION_PLACE)
  if ('refusal' in place) return
  const held = place.read(THE_NOTES_FILE)
  const notes = held === undefined || 'refusal' in held ? theNotesIn(undefined) : theNotesIn(held.text)
  const added = theNotesWith(notes, { ...note, issue })
  place.keep(THE_NOTES_FILE, theNotesText(added))
}
