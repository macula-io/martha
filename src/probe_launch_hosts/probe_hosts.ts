// What each host starts, on the two ways it can be started: by hand in a fresh
// checkout, and the way Martha starts it (`prepareLaunch`). This is the evidence
// behind the launched rows' residuals and the table in docs/publish-gate.md.
//
// Every probe states what docs/publish-gate.md claims it sees, and the run exits
// non-zero when a host does anything else, so a host upgrade that flips a
// result cannot pass unnoticed.
//
// Run it by hand after a host upgrade: `npm run probe:launch`. It is not part of
// `npm test`: it needs both coding tools installed, and the headless probes make
// one small model call each. Every probe works in its own scratch directory,
// whose config only touches marker files there, and removes it.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  projectKeyOf,
  takeAwayTheOnesThisRunWrote,
  theLeftoverRow,
  theProjectFoldersThere,
  type ProjectFoldersBefore,
} from './the_project_folders_a_run_wrote.ts'
import { runTheHost, stopTheProcessesLeftIn } from './stop_a_host_that_outlives_the_run.ts'
import { aScratchThisRunMade, leftBehindByARun, whatThisRunLeftAtTheEnd } from './the_scratches_this_run_made.ts'
import {
  fingerprintOf,
  launchEnvironment,
  prepareLaunch,
  readLaunchState,
  type HostSwitches,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { PLUGIN_DIRS_VARIABLE } from '../claude_code_host/hooks_and_plugins_the_owner_declares.ts'
import { USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'
import { printedText } from '../probe_the_owners_own_folders/the_write_the_host_was_refused.ts'
import { hookSettingsOf } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { absencesWithoutAHostProof, judgeRow, type RowClaims } from './an_absence_row_proves_the_host_ran.ts'
import { NO_PLACE, ownerSettingsPath, put, RUN_TIMEOUT_MS, type Place, type Probe } from '../declare_a_launch_probe/declare_a_launch_probe.ts'
import { PROBES } from '../probe_a_checkouts_own_config/probe_a_checkouts_own_config.ts'
import {
  HOST_KEY_PROBES,
  MARKDOWN_HOOK_PROBES,
  OWNER_PROBES,
  SPELLINGS_WITHOUT_A_PROBE,
  SWITCH_PROBES,
  SWITCHES_WITHOUT_A_PROBE,
} from '../probe_the_owners_hooks/probe_the_owners_hooks.ts'
import { OWNER_SCOPE_PROBES, SYNCED_PROBES, TRASH_PROBE } from '../probe_the_owners_own_folders/probe_the_owners_own_folders.ts'
import { reportMemoryProbe } from '../probe_the_hosts_auto_memory/probe_the_hosts_auto_memory.ts'

function version(command: string): string {
  const run = spawnSync(command, ['--version'], { encoding: 'utf8' })
  return run.error === undefined ? run.stdout.trim().split('\n')[0] ?? '' : `not installed (${run.error.message})`
}

const NO_SWITCHES: HostSwitches = { args: [], env: {}, env_dropped: [] }

/** The environment a probe's host inherits: the owner's own config folder when it has one, and no plugin folder from the developer's shell. */
function environmentOf(probe: Probe, place: Place): Record<string, string | undefined> {
  if (probe.owner_settings === undefined && probe.owner_markdown === undefined) return { ...process.env, ...probe.inherited }
  const config = dirname(ownerSettingsPath(place))
  if (probe.owner_settings !== undefined) put(config, USER_SETTINGS_FILE, probe.owner_settings(place))
  for (const file of probe.owner_markdown?.(place) ?? []) put(join(config, file.folder), file.name, file.text)
  const { [PLUGIN_DIRS_VARIABLE]: _developers, ...rest } = process.env
  return { ...rest, CLAUDE_CONFIG_DIR: config, ...probe.inherited }
}

/** The launcher's settings gate on this planned launch: undefined when it passes, else its refusal. */
function gateRefusal(probe: Probe, inherited: Record<string, string | undefined>, prepared: Extract<ReturnType<typeof prepareLaunch>, { readonly allow: true }>): string | undefined {
  if (probe.gate_names === undefined) return undefined
  const gate = hookSettingsOf(launchEnvironment(inherited, prepared.switches), [], prepared)
  return typeof gate === 'string' ? gate : undefined
}

/** The switches to start with, or why the planned launch was refused. */
function switchesFor(probe: Probe, place: Place, inherited: Record<string, string | undefined> = {}): HostSwitches | string | { readonly gate: string } {
  if (!probe.planned) {
    probe.planted(place)
    return NO_SWITCHES
  }
  probe.approved?.(place)
  const where = { host: probe.host, launch_dir: place.checkout, stop_dir: place.scratch }
  const prepared = prepareLaunch({
    ...where,
    snapshot_root: join(place.scratch, 'snapshots'),
    approved_fingerprints: [fingerprintOf(readLaunchState(where, thisMachine))],
  }, thisMachine)
  if (!prepared.allow) return prepared.refusal
  const gate = gateRefusal(probe, inherited, prepared)
  if (gate !== undefined) return { gate }
  probe.planted(place)
  return prepared.switches
}

/** Removes the folders this run wrote, and keeps the ones it could not, to be named in the last row. */
function takeAwayTheProjectFoldersOf(before: ProjectFoldersBefore, scratch: string): void {
  // Nothing of the run may still be working in the scratch when its folders are read back.
  stopTheProcessesLeftIn(scratch)
  leftBehindByARun.push(...takeAwayTheOnesThisRunWrote(before, projectKeyOf(scratch)))
  rmSync(scratch, { recursive: true, force: true })
}

/** Where one marker lands: the scratch root's own file, unless the row says the host itself writes it (martha#154). */
const markerPath = (probe: Probe, place: Place, name: string): string => (probe.markerAt === undefined ? place.marker(name) : probe.markerAt(place, name))

/** What one run left: each marker and whether it was started, and the host's own exit status. */
interface RunResult {
  readonly markers: Readonly<Record<string, boolean>>
  /** The host's exit status, or null when the launcher's gate refused it and no host ran. */
  readonly status: number | null
  /** How many times the host was made before this result stood; absent or 1 means once. */
  readonly attempts?: number
}

/**
 * How many times a row whose claim rests on the host's clean exit is made before its result
 * stands (martha#223). A host that spent every turn it was given, or the model service failing,
 * is not evidence about the tree: on one live run in five a row read `the host exited CLAIMED
 * cleanly but exited 1` on an unchanged tree. A row that is really wrong is wrong in every
 * attempt and is still reported.
 */
const ATTEMPTS_FOR_A_CLEAN_EXIT = 3

/**
 * Whether to make this run again instead of judging it (martha#223): only when the host's exit
 * is the attempt's **only** red. A row whose marker already came out wrong is this row's answer
 * and stands at once — a write that got through and then exited 1 is an intermittent failure of
 * the deny rules, which is the defect these rows exist to find, and making it again in a fresh
 * scratch would hide it.
 */
export function onlyTheExitFailed(probe: RowClaims, run: RunResult | string): boolean {
  if (probe.host_ok !== true || typeof run === 'string') return false
  const failed = judgeRow(probe, run).filter((line) => line.failed)
  return failed.length === 1 && failed[0]?.about === 'the exit'
}

/** A run, with how many times the host was made before this result stood. */
const afterAttempts = (run: RunResult | string, attempts: number): RunResult | string => (typeof run === 'string' ? run : { ...run, attempts })

/** One probe's row, made again only while the host's exit is the only thing that failed. */
function runProbe(probe: Probe): RunResult | string {
  for (let attempt = 1; attempt < ATTEMPTS_FOR_A_CLEAN_EXIT; attempt += 1) {
    const run = oneRunOfAProbe(probe)
    if (!onlyTheExitFailed(probe, run)) return afterAttempts(run, attempt)
  }
  return afterAttempts(oneRunOfAProbe(probe), ATTEMPTS_FOR_A_CLEAN_EXIT)
}

/** One run of a probe's host, in a scratch of its own. */
function oneRunOfAProbe(probe: Probe): RunResult | string {
  // A fresh directory each time: OpenCode's background service caches config per directory.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'martha-probe-')))
  const checkout = join(scratch, 'checkout')
  aScratchThisRunMade(scratch)
  let before: ProjectFoldersBefore | undefined
  try {
    mkdirSync(checkout)
    spawnSync('git', ['init', '-q', '.'], { cwd: checkout })
    const place: Place = { scratch, checkout, marker: (name) => join(scratch, name) }

    const inherited = environmentOf(probe, place)
    const switches = switchesFor(probe, place, inherited)
    if (typeof switches === 'string') return `refused by prepareLaunch: ${switches}`
    if ('gate' in switches) return aRunTheGateRefused(probe, place, switches.gate)

    const { command, args } = probe.command(switches, place)
    // Read the project folders of the config dir this host will use, not of the developer's own.
    const host_env = launchEnvironment(inherited, switches)
    before = theProjectFoldersThere(host_env)
    const run = runTheHost(command, args, {
      cwd: checkout,
      env: host_env,
      timeout_ms: RUN_TIMEOUT_MS,
      pid_file: join(scratch, 'host-group'),
    })
    if (run.error !== undefined) return `could not run: ${run.error}`
    spawnSync('sleep', ['1'])
    const printed = printedText(run.stdout)
    return {
      markers: {
        ...Object.fromEntries(Object.keys(probe.expected).map((name) => [name, existsSync(markerPath(probe, place, name))])),
        ...(probe.from_output?.(place, printed) ?? {}),
        // The gate was asked and did not refuse, which only a row that names the gate can claim. It is written at the
        // gate step, before any host runs, so a row whose claim is that a file gets through does not rest on the host
        // (martha#243) — and it comes last, because GATE_PASSED is one of the row's markers and a file of that name is
        // never written: read first, it would always be overwritten as not started (martha#243 r=1).
        ...(probe.gate_names === undefined ? {} : { GATE_PASSED: true }),
      },
      status: run.status,
    }
  } finally {
    // On the failure paths too: a run that threw still wrote its folders.
    if (before === undefined) rmSync(scratch, { recursive: true, force: true })
    else takeAwayTheProjectFoldersOf(before, scratch)
  }
}

/**
 * The run a settings-gate refusal leaves: a failure for a row that needs the host to have run, whose claim is about what
 * the host would have tried, and the refusal's own markers for the others (martha#154 r=2).
 */
function aRunTheGateRefused(probe: Probe, place: Place, refusal: string): RunResult | string {
  if (probe.host_ok === true) return `the launcher's own settings gate refused this run (${refusal}), so the host never ran and the row proves nothing`
  const seen = gateSeen(probe, place, refusal)
  return typeof seen === 'string' ? seen : { markers: seen, status: null }
}

/** The markers of a run the launcher's gate refused: nothing started, and GATE_REFUSED when the refusal names what the probe planted. */
function gateSeen(probe: Probe, place: Place, refusal: string): Readonly<Record<string, boolean>> | string {
  const names = probe.gate_names?.(place) ?? []
  if (!names.every((name) => refusal.includes(name))) return `refused by the settings gate, not naming ${names.join(', ')}: ${refusal}`
  return Object.fromEntries(Object.keys(probe.expected).map((name) => [name, name === 'GATE_REFUSED']))
}

/** Runs one probe and prints each marker against its claim; a probe that cannot run, or a marker that differs, fails the run. */
function reportProbe(probe: Probe): void {
  const run = runProbe(probe)
  if (typeof run === 'string') {
    console.log(`${probe.what}: ${run}`)
    process.exitCode = 1
    return
  }
  for (const line of judgeRow(probe, run)) {
    if (line.failed) process.exitCode = 1
    console.log(line.text)
  }
  // A row that needed the host made again reads differently from one that did not (martha#223).
  if (run.attempts !== undefined && run.attempts > 1) console.log(`${probe.what}: the host was made ${run.attempts} times before this result stood`)
}

/** Every row this run reports; the absence check reads the same list the run does, so a test can judge the real rows. */
export const ALL_PROBES: readonly Probe[] = [
  ...PROBES,
  ...OWNER_PROBES,
  ...SWITCH_PROBES,
  ...MARKDOWN_HOOK_PROBES,
  ...HOST_KEY_PROBES,
  TRASH_PROBE,
  ...SYNCED_PROBES,
  ...OWNER_SCOPE_PROBES,
]

/**
 * The turn budget each row starts the model with, by the row's own words, so a test reads the
 * commands the probe really builds rather than a constant restated beside it (martha#223).
 */
export function turnBudgets(): readonly { readonly what: string; readonly maxTurns: number | undefined }[] {
  return ALL_PROBES.map((probe) => {
    const { args } = probe.command(NO_SWITCHES, NO_PLACE)
    const at = args.indexOf('--max-turns')
    return { what: probe.what, maxTurns: at < 0 ? undefined : Number(args[at + 1]) }
  })
}

/** Everything the run does once its rows exist. A test imports the rows, so none of this may run on import. */
/**
 * The rows a run reports: all of them, or those whose words hold the text in
 * MARTHA_PROBE_ROWS (martha#243). It is how a change runs its own rows without
 * the ones that touch the developer's own home; the run says how many it left
 * out, so a filtered run cannot pass for a whole one.
 */
const SELECTED_ROWS = process.env.MARTHA_PROBE_ROWS
const selected = (rows: readonly Probe[]): readonly Probe[] =>
  SELECTED_ROWS === undefined || SELECTED_ROWS === '' ? rows : rows.filter((row) => row.what.includes(SELECTED_ROWS))

/** Reports the rows this run was asked for, says how many it left out, and leaves the memory rows out of a filtered run. */
function reportSelected(rows: readonly Probe[]): void {
  const whole = rows.length === ALL_PROBES.length
  if (!whole) console.log(`this run reports ${rows.length} of ${ALL_PROBES.length} rows, those whose words hold ${JSON.stringify(SELECTED_ROWS)}`)
  for (const probe of rows) reportProbe(probe)
  for (const worktree of whole ? [false, true] : []) reportMemoryProbe(worktree)
}

function main(): void {
  for (const command of new Set(PROBES.map((probe) => probe.command(NO_SWITCHES, NO_PLACE).command))) {
    console.log(`${command}: ${version(command)}`)
  }
  if (SPELLINGS_WITHOUT_A_PROBE.length > 0) {
    console.error(`no probe row for the spelling rule(s): ${SPELLINGS_WITHOUT_A_PROBE.join(', ')}`)
    process.exitCode = 1
  }
  if (SWITCHES_WITHOUT_A_PROBE.length > 0) {
    console.error(`the recorded host names no key to plant, so nothing probes: ${SWITCHES_WITHOUT_A_PROBE.join(', ')}`)
    process.exitCode = 1
  }
  const unproven = absencesWithoutAHostProof(ALL_PROBES)
  if (unproven.length > 0) {
    console.error(`a row whose claim is an absence proves nothing that the host ran, so a host that never ran would pass it: ${unproven.join(' | ')}`)
    process.exitCode = 1
  }
  const startedWith = theProjectFoldersThere(process.env)
  reportSelected(selected(ALL_PROBES))

  const leftBehind = whatThisRunLeftAtTheEnd(startedWith)
  if (leftBehind.length > 0) process.exitCode = 1
  console.log(theLeftoverRow(leftBehind))
}

if (import.meta.main) main()
