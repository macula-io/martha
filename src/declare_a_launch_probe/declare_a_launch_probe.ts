// What one row of the launch probe is (martha#443): its shape, the place it runs in, and the
// builders its rows share. The rows and the runner both import it, so neither imports the other.

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { type Host, type HostSwitches } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'

/** How long one host run may take before the probe gives up on it. */
export const RUN_TIMEOUT_MS = 120_000

export const PROMPT = 'Reply with the single word ok.'
/**
 * A headless run with room for one tool call before the reply (martha#223). At one turn a
 * host that spends it on a tool call exits non-zero, and every row that reads the host's
 * exit — or reading the model's answer — reports that as a failure of the tree under test.
 */
export const HEADLESS_CLAUDE = ['-p', '--max-turns', '3', '--model', 'haiku']

/** One scratch checkout: where its files go and where markers land. */
export interface Place {
  readonly scratch: string
  readonly checkout: string
  marker(name: string): string
}

/** The command line of one run, given the switches a planned launch adds. */
export type Command = (switches: HostSwitches, place: Place) => { readonly command: string; readonly args: readonly string[] }

/** A place for a command that builds nothing from paths: the version banner asks only for the binary's name. */
export const NO_PLACE: Place = { scratch: tmpdir(), checkout: tmpdir(), marker: (name) => join(tmpdir(), name) }

export interface Probe {
  readonly what: string
  readonly host: Host
  readonly command: Command
  /** Config the checkout holds when the owner approves it. Absent for a start by hand. */
  readonly approved?: (place: Place) => void
  /** Config written into the checkout afterwards: by hand, all of it; planned, after approval. */
  readonly planted: (place: Place) => void
  /** Each marker, and whether docs/publish-gate.md says it is started. */
  readonly expected: Readonly<Record<string, boolean>>
  /** Run through `prepareLaunch`, on approved config. */
  readonly planned: boolean
  /** Set in the environment the host inherits, as an owner's shell might. */
  readonly inherited?: Readonly<Record<string, string>>
  /**
   * The owner's user settings, written to a config folder of the probe's own
   * that CLAUDE_CONFIG_DIR names, so the developer's own settings and plugins
   * stay out of the run (martha#121).
   */
  readonly owner_settings?: (place: Place) => string
  /**
   * The owner's own markdown, written under the config folder CLAUDE_CONFIG_DIR
   * names: an agent, skill or command whose frontmatter can carry hooks
   * (martha#146). Each is placed at `<config folder>/<folder>/<name>`.
   */
  readonly owner_markdown?: (place: Place) => readonly OwnerMarkdownFile[]
  /**
   * Run the launcher's own settings gate (hookSettingsOf) before the host, as
   * martha start does. When it refuses, naming every one of these words, the
   * host is not started and GATE_REFUSED is marked; a refusal naming anything
   * else fails the probe. When it does not refuse, GATE_PASSED is marked, which
   * is how a row claims that a file is let through by the gate itself rather than
   * by a host that never got that far (martha#243).
   */
  readonly gate_names?: (place: Place) => readonly string[]
  /**
   * Where a marker lands when it is not the scratch root's own file: a file the host itself writes into a place the
   * gate denies, whose presence or absence is the row's evidence (martha#154).
   */
  readonly markerAt?: (place: Place, name: string) => string
  /**
   * Also require the host itself to have exited cleanly, for a row whose claim is
   * that something did NOT happen: a host that quits on the config before it gets
   * that far would leave the same markers as one that ran and rightly did nothing.
   */
  readonly host_ok?: true
  /**
   * Markers read from what the host printed, for a row whose claim is that the host
   * TRIED something and was refused (martha#154 r=2): a row that only says the file
   * is absent is satisfied by a host that never attempted the write at all. The run
   * is asked for json output, and this reads the refusal out of it.
   */
  readonly from_output?: (place: Place, printed: string) => Readonly<Record<string, boolean>>
}

/** One file of the owner's own markdown, at `<config folder>/<folder>/<name>`. */
export interface OwnerMarkdownFile {
  readonly folder: string
  readonly name: string
  readonly text: string
}

export function put(dir: string, name: string, content: string): void {
  mkdirSync(dirname(join(dir, name)), { recursive: true })
  writeFileSync(join(dir, name), content)
}

/** What Claude Code prints, and only it, when it has no agent by that name (2.1.319). */
const noSuchAgent = (name: string) => `--agent '${name}' not found`

/**
 * Claude Code started as the agent `name`, which is looked up where `owner_markdown`
 * puts it or in the checkout. The markers sit beside the checkout (../ from where
 * the host runs): AGENT_LOADED when the host ran it, AGENT_NOT_FOUND when the host
 * said it has no such agent. A host with no login in its config folder never
 * reaches a model call, so AGENT_LOADED says nothing about whether it loaded.
 */
export const claudeAsTheAgent = (name: string, ...extra: readonly string[]): Command => (switches) => ({
  command: 'sh',
  args: [
    '-c',
    `"$@" 2> ../agent.err && touch ../AGENT_LOADED; grep -qF -e "${noSuchAgent(name)}" ../agent.err && touch ../AGENT_NOT_FOUND; true`,
    'claude-as-agent',
    'claude',
    ...extra,
    '--agent',
    name,
    PROMPT,
    ...switches.args,
  ],
})

export const claude = (...extra: readonly string[]): Command => (switches) => ({
  command: 'claude',
  args: [...extra, ...switches.args],
})

export const OWNER_CONFIG = 'owner-config'
export const ownerSettingsPath = (place: Place) => join(place.scratch, OWNER_CONFIG, USER_SETTINGS_FILE)

/** The switches of a start by hand, and of reading a row's command without starting it: none. */
export const NO_SWITCHES: HostSwitches = { args: [], env: {}, env_dropped: [] }

/** The fewest turns a row may start the model with: one to spend, and one to answer or finish in (martha#223). */
export const ROOM_TO_FINISH = 2

/**
 * The turn budget each row starts the model with, by the row's own words, so a test reads the
 * commands the probe really builds rather than a constant restated beside it (martha#223).
 */
export function turnBudgetsOf(rows: readonly Probe[]): readonly { readonly what: string; readonly maxTurns: number | undefined }[] {
  return rows.map((probe) => {
    const { args } = probe.command(NO_SWITCHES, NO_PLACE)
    const at = args.indexOf('--max-turns')
    return { what: probe.what, maxTurns: at < 0 ? undefined : Number(args[at + 1]) }
  })
}

/** The rows among these that start the model with less room than ROOM_TO_FINISH (martha#223). */
export const rowsWithoutRoomToFinish = (rows: readonly Probe[]) =>
  turnBudgetsOf(rows).filter((row) => row.maxTurns !== undefined && row.maxTurns < ROOM_TO_FINISH)
