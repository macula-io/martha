// The watch one Claude Code launch keeps over the crew tools it served (martha#658): which of its sessions still hold
// them, read from each session's transcript, and which calls each session made, for the beat to count. A host adapter:
// it knows how Claude Code names a served tool and which relay events carry what, and nothing else.
//
// It hears the relay's events through the journal the launch already keeps (../keep_the_relays_journal), which is handed
// every event's body before the launcher answers it. That gives the journal a second job, said here and in the PR: the
// relay's answers are not changed by it, and it reads only three things from the bodies it is handed:
//   - a session start's id and `transcript_path`, which open that session's transcript under every bound of
//     ../read_one_file_held_by_its_descriptor, and the session a refresh started from, as the crew answers it then;
//   - a main turn's prompt, counted as one turn of that session;
//   - a shell call's command, handed whole to the beat, which reads only its git pushes and merges.
//
// A transcript the host has not written yet is opened again on the next beat, so a session is held as soon as its
// first tool delta is there. A transcript that moved under its name is let go for good: that session reads unknown.

import type { ServedToolsHeld } from '../host_contract/host_contract.ts'
import { NOTHING_RECORDED } from '../hold_a_session_to_its_served_tools/hold_a_session_to_its_served_tools.ts'
import type { ACallInASession, TheServedToolsWatch } from '../keep_a_members_crew_tools_window/heed_the_crew_tools.ts'
import type { RelayJournal } from '../keep_the_relays_journal/keep_the_relays_journal.ts'
import { letTheTranscriptGo, readTheNewLines, type AHeldTranscript } from '../read_one_file_held_by_its_descriptor/read_one_file_held_by_its_descriptor.ts'
import { openTheClaudeCodeTranscript, servedToolsHeldAfterTheLine } from '../read_what_claude_code_records_of_its_tools/read_what_claude_code_records_of_its_tools.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CREW_TOOL_NAMES } from '../a_crews_tools/a_crews_tools.ts'
import { RELAY_PLUGIN_DIR } from '../ask_the_host_what_it_loads/what_the_host_loads.ts'
import { CLAUDE_CODE_SHELL_TOOL, MCP_NAME_PREFIX, MCP_NAME_SEPARATOR } from '../claude_code_host/claude_code_host.ts'
import { RELAY_MANIFEST } from '../serve_the_relay_to_a_launch/relay_copy.ts'

/** What the watch is given by the launch: the member's own config folder as its real path, the launch's user, and the crew. */
export interface TheWatchedLaunch {
  readonly config_dir: string
  readonly uid: number
  /** The names the host gives the tools this launch served, in the host's own form. */
  readonly served: ReadonlySet<string>
  /** The session a refresh started from, as the crew answers it while that session starts; null when none. */
  readonly askThePredecessor: (session_id: string) => Promise<string | null>
}

/** The most calls held for the beat to take: a launch whose beat stopped keeps no more than this. */
export const MOST_CALLS_HELD = 10_000

/** One session as the watch keeps it. */
interface AWatchedSession {
  readonly transcript_path: string
  held: AHeldTranscript | undefined
  /** Set once the transcript moved under its name: the session reads unknown from then on. */
  gone: boolean
  fact: ServedToolsHeld
  predecessor: string | null
}

/** The names Claude Code gives the tools a plugin of `plugin` serves, from their own names. */
export const theServedNames = (plugin: string, own: readonly string[]): ReadonlySet<string> => new Set(own.map((name) => `${MCP_NAME_PREFIX}${plugin}${MCP_NAME_SEPARATOR}${name}`))

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value)
const textIn = (body: unknown, field: string): string | undefined => (isRecord(body) && typeof body[field] === 'string' && body[field] !== '' ? body[field] : undefined)

/**
 * A launch's watch: the fact and calls the beat reads, and the journal that hears the relay's events. A transcript is
 * held open for as long as its session reads it, and the launcher's process lets it go when the launch ends.
 */
export function watchTheCrewToolsOf(launch: TheWatchedLaunch) {
  const sessions = new Map<string, AWatchedSession>()
  const calls: ACallInASession[] = []

  const opened = (session_id: string, session: AWatchedSession): AHeldTranscript | undefined => {
    if (session.held !== undefined || session.gone) return session.held
    const held = openTheClaudeCodeTranscript({ config_dir: launch.config_dir, session_id, transcript_path: session.transcript_path, uid: launch.uid })
    session.held = 'refused' in held ? undefined : held
    return session.held
  }

  const factOf = (session_id: string): ServedToolsHeld => {
    const session = sessions.get(session_id)
    const held = session === undefined ? undefined : opened(session_id, session)
    if (session === undefined || held === undefined) return session?.fact ?? NOTHING_RECORDED
    const read = readTheNewLines(held)
    if ('moved' in read) {
      letTheTranscriptGo(held)
      Object.assign(session, { held: undefined, gone: true, fact: NOTHING_RECORDED })
      return session.fact
    }
    session.fact = read.lines.reduce((fact, line) => servedToolsHeldAfterTheLine(fact, line, launch.served, Date.now()), session.fact)
    return session.fact
  }

  const started = (body: unknown): void => {
    const session_id = textIn(body, 'session_id')
    const transcript_path = textIn(body, 'transcript_path')
    if (session_id === undefined || transcript_path === undefined || sessions.has(session_id)) return
    const session: AWatchedSession = { transcript_path, held: undefined, gone: false, fact: NOTHING_RECORDED, predecessor: null }
    sessions.set(session_id, session)
    launch.askThePredecessor(session_id).then((predecessor) => void (session.predecessor = predecessor), () => undefined)
  }

  const heard = (event: string, body: unknown): void => {
    if (event === 'session_started') return started(body)
    const session = textIn(body, 'session_id')
    if (session === undefined || calls.length >= MOST_CALLS_HELD) return
    if (event === 'prompt_submitted') calls.push({ session, call: { turn: true } })
    const call = isRecord(body) ? body['call'] : undefined
    const shell = textIn(call, 'command')
    if (event === 'tool_called' && textIn(call, 'tool') === CLAUDE_CODE_SHELL_TOOL && shell !== undefined) calls.push({ session, call: { shell } })
  }

  const watch: TheServedToolsWatch = { factOf, predecessorOf: (id) => sessions.get(id)?.predecessor ?? null, takeTheCalls: () => calls.splice(0) }
  return {
    watch,
    /** The launch's journal, hearing every event it is handed before it writes it, and answering exactly as before. */
    journalOver: (journal: RelayJournal): RelayJournal => ({
      received: (event, body) => {
        // What the watch hears never changes what the launcher answers: a body it cannot read is left to the launcher.
        try {
          heard(event, body)
        } catch {
          // Nothing heard: the relay's answer goes on as before.
        }
        return journal.received(event, body)
      },
      noted: (event, why, id) => journal.noted(event, why, id),
      notedWhatItCouldNotFinish: (event, why, id) => journal.notedWhatItCouldNotFinish(event, why, id),
    }),
  }
}

/**
 * The watch of a launch on this machine: the launch's own user, and the crew's tools under the name the relay's own
 * manifest gives the plugin that serves them, so no plugin name is written here.
 */
export function watchTheCrewToolsServedBy(config_dir: string, askThePredecessor: TheWatchedLaunch['askThePredecessor']) {
  const plugin = (JSON.parse(readFileSync(join(RELAY_PLUGIN_DIR, RELAY_MANIFEST), 'utf8')) as { readonly name: string }).name
  return watchTheCrewToolsOf({ config_dir, uid: process.getuid?.() ?? -1, served: theServedNames(plugin, CREW_TOOL_NAMES), askThePredecessor })
}
