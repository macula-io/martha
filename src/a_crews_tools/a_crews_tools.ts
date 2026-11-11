// The tools a member of a crew can call, and the one place their answers are decided (martha#254).
//
// This exists so the mod that runs in the member's session registers the tools and the launcher answers them: the
// session can draw and post, and nothing that decides anything runs inside it. Every tool here is a name, an
// argument object, and an answer the slice behind it gives — `report_progress` and `see_the_crew` over the dashboard
// rows, `crew_log`, `what_was_sent` and `note_what_became_of_an_act` over the ledger.
//
// The row a member's beat writes is the launcher's own state: the report moves it, and a heartbeat keeps it fresh at
// BEAT_INTERVAL_MS so a pane can tell a working member from a session that has died. The heartbeat runs here, in the
// launcher, and writes the same row the report wrote, so nothing but this slice ever folds a beat in.

import { declareCrew, type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { DocumentStore } from '../host_contract/host_contract.ts'
import {
  CREW_LOG_DESCRIPTION,
  NOTE_WHAT_BECAME_DESCRIPTION,
  type AWorker,
  WHAT_WAS_SENT_DESCRIPTION,
  keepTheMilestone,
  noteWhatBecameOfAnAct,
  theLineAStartingSessionIsHanded,
  whatWasSent,
} from '../keep_the_ledger/keep_the_ledger.ts'
import { ledgerStreamOf, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { REPORT_PROGRESS_DESCRIPTION, takeProgress, type TheCrew } from '../report_progress/report_progress.ts'
import { seeTheCrew, READER_BEAT_MS } from '../see_the_crew/see_the_crew.ts'
import { BEAT_INTERVAL_MS, IDLE, type DashboardRow, type DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'

/** The names the crew's tools are registered under, and the only ones the launcher answers. */
export const CREW_TOOL_NAMES = ['report_progress', 'crew_log', 'what_was_sent', 'note_what_became_of_an_act', 'see_the_crew'] as const
export type CrewToolName = (typeof CREW_TOOL_NAMES)[number]

/**
 * The name the mod asks under for the tools to register (martha#254): the launcher owns their names, their
 * descriptions and their schemas, and the mod holds no copy of any of them, so a description that quotes a constant
 * quotes the one the slice defines.
 */
export const THE_TOOLS_ASK = 'the_crews_tools'

/** A tool as the mod registers it: its name, what it is for, and the schema of what it takes. */
export interface CrewTool {
  readonly name: CrewToolName
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

/** The answer to a tool call: what the slice said, or why the name is not one the crew has. */
export type CoreToolAnswer = { readonly answer: string } | { readonly refused: string }

/** What the tools are given: whose row it is, where the crew's place is, and how the declaration is read. */
export interface CrewToolPlaces {
  readonly member: string
  /** The crew's streams: the ledger and the session records. */
  readonly ledger: LedgerHost
  /** The crew's dashboard rows: one per member, kept by the host (../launch_a_claude_code_member/dashboard_rows_in_state). */
  readonly beats: DashboardStore
  /** The checkout the crew is declared in. */
  readonly root: string
  readonly documents: DocumentStore
}

/** The tools a crew's member can call. */
export interface CrewTools {
  readonly tools: readonly CrewTool[]
  /** Answers a tool call: the member's name is this launch's, the session's is the one the call came from. */
  answer(name: string, args: Readonly<Record<string, unknown>>, session: string): Promise<CoreToolAnswer>
  /** Starts the heartbeat, which keeps this member's row fresh; returns the stop. */
  startBeating(): () => void
  /**
   * The line a session starting on a package is handed, once, at its start (martha#254 design, test 10): every act of
   * the package this member holds that was sent with no outcome recorded, oldest first, or null when it holds no
   * package or nothing of it was left waiting.
   */
  theLineToHandAtStart(): Promise<string | null>
}

/** The schema shared by the tools that name a package, which every one of the ledger's tools does. */
const A_PACKAGE: Readonly<Record<string, unknown>> = { type: 'string', description: 'The work package, owner/repo#n, as the issue is named' }

/** The tools, as the mod registers them. */
export const CREW_TOOLS: readonly CrewTool[] = [
  {
    name: 'report_progress',
    description: REPORT_PROGRESS_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task, short, naming the outcome' },
        step: { type: 'integer', minimum: 0, description: 'Steps completed so far' },
        of: { type: 'integer', minimum: 1, description: 'Total steps, your best current estimate' },
        phase: { type: 'string', enum: ['working', 'reviewing'], description: 'reviewing while you review work, working when you are back at it' },
        waiting_on: { type: 'string', description: "What you now wait on: 'ci', 'owner', 'supervisor', or a crew member's name" },
        waiting_for: { type: 'string', description: 'What you wait for (a HANDOFF, a verdict, a menu, a yes); required when waiting_on names a person' },
        package: A_PACKAGE,
      },
      required: ['task', 'step', 'of'],
    },
  },
  {
    name: 'crew_log',
    description: CREW_LOG_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        package: A_PACKAGE,
        event: { type: 'string', enum: ['checkpoint', 'review_round', 'release', 'fix_after_ship'] },
        note: { type: 'string', description: 'One short line: what happened' },
      },
      required: ['package', 'event', 'note'],
    },
  },
  {
    name: 'what_was_sent',
    description: WHAT_WAS_SENT_DESCRIPTION,
    inputSchema: { type: 'object', properties: { package: A_PACKAGE }, required: ['package'] },
  },
  {
    name: 'note_what_became_of_an_act',
    description: NOTE_WHAT_BECAME_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        package: A_PACKAGE,
        announced_at: { type: 'integer', minimum: 0, description: 'The row the act was announced at, as what_was_sent shows it' },
        succeeded: { type: 'boolean', description: 'Whether the act happened' },
        detail: { type: 'string', description: 'What you found, in one line' },
      },
      required: ['package', 'announced_at', 'succeeded', 'detail'],
    },
  },
  {
    name: 'see_the_crew',
    description: "Every member's row of this crew, in the declaration's order, with what has gone quiet marked.",
    inputSchema: { type: 'object', properties: {} },
  },
]

/** What one place's tools hold between calls: the row as this session last left it, and its session id. */
interface SessionState {
  held: DashboardRow | null
  session: string
}

/** The tools a member can call, over the place its launcher gave it. */
export function crewToolsOver(places: CrewToolPlaces): CrewTools {  const state: SessionState = { held: null, session: '' }
  const handlers = handlersOver(places, state)

  return {
    tools: CREW_TOOLS,
    async answer(name: string, args: Readonly<Record<string, unknown>>, from: string): Promise<CoreToolAnswer> {
      state.session = from
      if (name === THE_TOOLS_ASK) return { answer: JSON.stringify(CREW_TOOLS) }
      const handle = handlers[name as CrewToolName]
      if (handle === undefined) {
        return { refused: `${JSON.stringify(name)} is not a tool this crew registers (they are ${CREW_TOOL_NAMES.join(', ')})` }
      }
      return handle(args)
    },
    startBeating(): () => void {
      const timer = setInterval(() => {
        try {
          writeRow(places, state, rowNow(places, state))
        } catch {
          // A beat the disk would not take is the next beat's business: the row it could not write stays readable.
        }
      }, BEAT_INTERVAL_MS)
      timer.unref()
      return () => clearInterval(timer)
    },
    theLineToHandAtStart: () => theLineToHandAtStart(places, state),
  }
}

/**
 * The line this member's session starts on: what the member's own row says it holds, and every act of that package
 * that was sent with no outcome recorded (martha#254 design line 53, test 10). The row is the member's, so a session
 * that resumes a package reads its predecessor's package and checks what became of what it sent, instead of hoping it
 * asks. Null when the member holds no package, or when nothing of it was left waiting.
 */
async function theLineToHandAtStart(places: CrewToolPlaces, state: SessionState): Promise<string | null> {
  const held = state.held ?? places.beats.read(places.member)
  const package_name = held?.holds ?? ''
  if (package_name === '') return null
  const sent = await whatWasSent(places.ledger, package_name)
  return theLineAStartingSessionIsHanded(package_name, sent.acts)
}

/** What each tool answers, over one place: every tool is one slice's answer, told to the member. */
function handlersOver(places: CrewToolPlaces, state: SessionState): Readonly<Record<CrewToolName, (args: Readonly<Record<string, unknown>>) => Promise<CoreToolAnswer>>> {
  const workerOf = (args: Readonly<Record<string, unknown>>): AWorker => ({ package: textOf(args['package']), member: places.member })
  return {
    report_progress: (args) => reportProgress(places, state, args),
    see_the_crew: () => seeTheCrewOf(places),
    crew_log: async (args) => ({ answer: (await keepTheMilestone(places.ledger, { ...workerOf(args), event: args['event'], note: args['note'] })).told }),
    what_was_sent: async (args) => ({ answer: (await whatWasSent(places.ledger, workerOf(args).package)).told }),
    note_what_became_of_an_act: async (args) => {
      const { announced_at, succeeded, detail } = args
      return { answer: (await noteWhatBecameOfAnAct(places.ledger, { ...workerOf(args), announced_at, succeeded, detail })).told }
    },
  }
}

/**
 * What a member that has reported nothing reads as, until its first report moves its row: `idle`, never `working`
 * (martha#254 test 7, r=1 R2). The heartbeat runs from the launch, before the member has said anything about itself,
 * so a row written with `working` here would make every live member read as working and no live member ever read
 * idle. What the member is doing is only ever the member's own report.
 */
const A_MEMBER_WITH_NO_BEAT = {
  state: IDLE,
  holds: '',
  task: '',
  progress: { step: 0, of: 1 },
  waits: null,
  needs: '',
  host: { model: '', provider: '', contextPercent: null, costUsd: null },
} satisfies Omit<DashboardRow, 'member' | 'session' | 'at'>

/** The row as this session last left it: what a report moves and the heartbeat rewrites. */
function rowNow(places: CrewToolPlaces, state: SessionState): DashboardRow {
  const kept = state.held ?? places.beats.read(places.member)
  return { ...A_MEMBER_WITH_NO_BEAT, ...(kept ?? {}), member: places.member, session: state.session, at: places.ledger.clock.now() }
}

/** Keeps the row, in this process and on disk. */
function writeRow(places: CrewToolPlaces, state: SessionState, row: DashboardRow): void {
  state.held = row
  places.beats.keep(row)
}

/** `report_progress`: the report's own rules move the row, and the member is told what landed. */
async function reportProgress(places: CrewToolPlaces, state: SessionState, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  const declared = await crewOrRefusal(places)
  if ('refused' in declared) return declared
  const before = rowNow(places, state)
  const report = takeProgress(args, declared.crew, { waits: before.waits, holds: before.holds }, places.ledger.clock.now())
  writeRow(places, state, {
    ...before,
    at: places.ledger.clock.now(),
    state: report.taken.state,
    task: report.taken.task,
    progress: report.taken.progress,
    waits: report.taken.waits,
    holds: report.taken.holds,
  })
  return { answer: report.told }
}

/** `see_the_crew`: every member's row, and whether the declaration switches the pane on at a session's start. */
async function seeTheCrewOf(places: CrewToolPlaces): Promise<CoreToolAnswer> {
  const declared = await crewOrRefusal(places)
  if ('refused' in declared) return declared
  const seen = seeTheCrew(declared.settings, beatsOf(places.beats, declared.settings), places.ledger.clock.now())
  // The pane is the host's, and opens by itself only when the declaration switched it on (martha#254): one bit, read
  // from the declaration the launcher already read, so the mod decides nothing on its own. The interval it redraws on
  // is the beat's own, named here and read there, so the pane cannot drift from the beat the rows are written on
  // (part 2 r=2 R1): the host draws a `ui.render` once and caches it until a plugin invalidates it.
  return { answer: JSON.stringify({ ...seen, pane_at_start: declared.settings.house_rules.dashboard, pane_redraw_ms: READER_BEAT_MS }) }
}

/** The declaration, and the crew's names as a report's rules read them; or why it could not be read. */
async function crewOrRefusal(places: CrewToolPlaces): Promise<{ readonly crew: TheCrew; readonly settings: CrewSettings } | { readonly refused: string }> {
  try {
    const settings = await declareCrew(places.documents, places.root)
    return { crew: { owner: settings.owner, members: settings.members.map((member) => member.name) }, settings }
  } catch (error) {
    return { refused: `the crew's declaration could not be read: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** The package an argument names, as the tool's own text; '' when it names none, which the ledger refuses. */
const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Every member's beat, by name, for `seeTheCrew` to lay out in the declaration's order. */
function beatsOf(store: DashboardStore, settings: CrewSettings): Readonly<Record<string, DashboardRow>> {
  const held = store.all()
  const beats: Record<string, DashboardRow> = {}
  for (const member of settings.members) {
    const beat = held[member.name]
    if (beat !== undefined) beats[member.name] = beat
  }
  return beats
}

/** The stream a package's ledger lives in, for a reader that wants the name: one way to build it, in the ledger. */
export const ledgerStreamNameOf = ledgerStreamOf
