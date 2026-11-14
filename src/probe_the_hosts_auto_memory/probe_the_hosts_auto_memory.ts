// The launch probe's rows about Claude Code's auto-memory (martha#443): whether the host loads a
// project's memory folder, by hand and as Martha starts it, in a plain checkout and in a worktree.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

import { projectFolderFor, projectKeyOf, takeAwayTheOnesThisRunWrote, theProjectFoldersThere } from '../probe_launch_hosts/the_project_folders_a_run_wrote.ts'
import { runTheHost, stopTheProcessesLeftIn } from '../probe_launch_hosts/stop_a_host_that_outlives_the_run.ts'
import { aScratchThisRunMade, leftBehindByARun } from '../probe_launch_hosts/the_scratches_this_run_made.ts'
import {
  CLAUDE_MEMORY_OFF,
  fingerprintOf,
  launchEnvironment,
  prepareLaunch,
  readLaunchState,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { HEADLESS_CLAUDE, PROMPT, put, RUN_TIMEOUT_MS } from '../declare_a_launch_probe/declare_a_launch_probe.ts'
import { memoryTheHostLoadedFor } from './what_the_host_loaded.ts'
import { CLAUDE_CODE } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'

// --- auto-memory (martha#136) ------------------------------------------------
// Claude Code loads `<config dir>/projects/<project key>/memory/` into every
// session of a project, and a session in a git worktree loads the main clone's
// folder. Each run plants a codeword there and starts the host once: the control,
// by hand with memory on, must be seen loading it, so a run that shows nothing
// proves the off switch and not a loader that never ran. Martha's planned launch
// must show nothing, even when the owner's environment says memory on, and must
// leave the folder holding exactly what was planted. The folder is the owner's real
// one, removed after.
//
// What was loaded is read from the host's own record of the session (martha#223),
// not from an answer: the transcript quotes each file the host read in. Asking the
// model used to be the row, and the model sometimes spent every turn it was given
// without answering — one run in five, whatever the budget — so a tree where
// nothing was wrong went red.

const MEMORY_INDEX = 'MEMORY.md'
const MEMORY_NOTE = 'codeword.md'

/** The record the host writes its session into: a transcript, one json line per entry. */
const SESSION_RECORD = '.jsonl'

/** Every file under `dir`, relative, sorted. */
function filesUnder(dir: string): string[] {
  return existsSync(dir) ? (readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath.slice(dir.length), entry.name).replace(/^\//, '')).sort()) : []
}

/** The environment with the off switch unset: memory on, as the host defaults. */
function memoryOn(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const name of Object.keys(CLAUDE_MEMORY_OFF)) env[name] = undefined
  return env
}

/**
 * The session records the host has written in the project folders given, by path. Only the
 * folders a run's own checkouts key are ever passed (martha#223 r=2): the owner's projects root
 * holds every session on the machine, and a transcript some other session started there is not
 * this run's record — reading the whole root once made a Martha arm that wrote nothing read
 * `no, as claimed` as soon as a neighbour started a session.
 */
export function theRecordsIn(folders: readonly (string | undefined)[]): readonly string[] {
  return folders
    .flatMap((folder) => (folder !== undefined && existsSync(folder) ? readdirSync(folder).map((name) => join(folder, name)) : []))
    .filter((path) => path.endsWith(SESSION_RECORD))
    .sort()
}

/**
 * What one memory run showed: whether the host recorded reading the codeword in, or why there
 * was no record to read (martha#223). The record is written when the session starts, so a run
 * whose model spent every turn still answers this row; a run that wrote no record at all is
 * named, never read as "the codeword was not loaded".
 *
 * The record is looked for in the project folders this run's own checkouts key — the folder it
 * started the host in, and the main clone's for a worktree, which is where the host keeps a
 * worktree session — and only in the files that appear while this run is the one running.
 */
function theCodewordWasLoaded(
  scratch: string,
  start: string,
  main: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  codeword: string,
  pid_file: string,
): boolean | string {
  // Read before the host starts, so the folder it writes is one this run can name and take away.
  const before = theProjectFoldersThere(env)
  const ourFolders = [start, main].map((folder) => projectFolderFor(env, folder))
  const recordsBefore = new Set(theRecordsIn(ourFolders))
  try {
    const run = runTheHost('claude', [...HEADLESS_CLAUDE, PROMPT, ...args], {
      cwd: start,
      env,
      timeout_ms: RUN_TIMEOUT_MS,
      pid_file,
    })
    if (run.error !== undefined) return `could not run: ${run.error}`
    const written = theRecordsIn(ourFolders).filter((path) => !recordsBefore.has(path))
    if (written.length === 0) return 'the host wrote no session record in its own project folder, so there is nothing to read'
    const record = written.map((path) => readFileSync(path, 'utf8')).join('\n')
    return memoryTheHostLoadedFor(record, start).some((file) => file.text.includes(codeword))
  } finally {
    // The scratch itself goes when the whole memory probe is done; its folders go with each run.
    stopTheProcessesLeftIn(scratch)
    leftBehindByARun.push(...takeAwayTheOnesThisRunWrote(before, projectKeyOf(scratch)))
  }
}

/** A checkout to start in, and the folder whose memory the host loads for it: its own, or the main clone's for a worktree. */
function memoryPlace(scratch: string, worktree: boolean): { readonly start: string; readonly main: string } {
  const main = join(scratch, 'checkout')
  mkdirSync(main)
  spawnSync('git', ['init', '-q', '.'], { cwd: main })
  spawnSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@invalid', 'commit', '-q', '--allow-empty', '-m', 'start'], { cwd: main })
  if (!worktree) return { start: main, main }
  const start = join(scratch, 'worktree')
  spawnSync('git', ['worktree', 'add', '-q', start], { cwd: main })
  return { start, main }
}

/** One line of the memory probe: what was asked, what was seen (or why it could not run), and what docs/publish-gate.md claims. */
type MemoryLine = readonly [line: string, seen: boolean | string, claimed: boolean]

/** Plants the codeword in the memory folder the host loads for the run, then runs the control and Martha's launch. */
function memoryLines(scratch: string, memory: string, main: string, start: string, codeword: string): readonly MemoryLine[] {
  const folder = join(memory, 'memory')
  put(folder, MEMORY_INDEX, `- [codeword](${MEMORY_NOTE}) - the codeword is ${codeword}\n`)
  put(folder, MEMORY_NOTE, `---\nname: codeword\ndescription: the codeword\n---\nThe codeword is ${codeword}.\n`)
  const planted = filesUnder(folder)

  const where = { host: CLAUDE_CODE, launch_dir: start, stop_dir: scratch }
  const prepared = prepareLaunch({ ...where, snapshot_root: join(scratch, 'snapshots'), approved_fingerprints: [fingerprintOf(readLaunchState(where, thisMachine))] }, thisMachine)
  if (!prepared.allow) return [['prepareLaunch allows the launch', prepared.refusal, true]]
  // Both runs pass the same switches; only the environment differs, so the control isolates the off switch.
  const forcedOn = Object.fromEntries(Object.keys(CLAUDE_MEMORY_OFF).map((name) => [name, '0']))
  const group = (at: number) => join(scratch, `host-group-${at}`)
  return [
    ['by hand, memory on: the host recorded reading the codeword in', theCodewordWasLoaded(scratch, start, main, prepared.switches.args, memoryOn(), codeword, group(1)), true],
    ["as Martha starts it, the owner's environment saying memory on: the host recorded reading the codeword in", theCodewordWasLoaded(scratch, start, main, prepared.switches.args, launchEnvironment({ ...process.env, ...forcedOn }, prepared.switches), codeword, group(2)), false],
    ['the memory folder holds exactly what was planted', JSON.stringify(filesUnder(folder)) === JSON.stringify(planted), true],
  ]
}

const yesNo = (value: boolean) => (value ? 'yes' : 'no')

/** Takes away each folder named, skipping the ones the config dir could not tell. */
function takeAwayTheFoldersOf(...folders: readonly (string | undefined)[]): void {
  for (const folder of folders) if (folder !== undefined) rmSync(folder, { recursive: true, force: true })
}

/** Runs the memory probe in a plain checkout or a worktree; each line against its claim, a mismatch failing the run. */
export function reportMemoryProbe(worktree: boolean): void {
  const what = `Claude Code auto-memory, ${worktree ? "a worktree loading its main clone's folder" : 'a plain checkout'}`
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'martha-probe-')))
  aScratchThisRunMade(scratch)
  const { start, main } = memoryPlace(scratch, worktree)
  const memory = projectFolderFor(process.env, main)
  try {
    const lines: readonly MemoryLine[] =
      memory === undefined
        ? [["the owner's config dir can be told", 'it cannot', true]]
        : memoryLines(scratch, memory, main, start, `ZEBRA${randomBytes(4).toString('hex')}`)
    if (lines.some(([, seen, claimed]) => seen !== claimed)) process.exitCode = 1
    for (const [line, seen, claimed] of lines) {
      console.log(`${what}: ${line} ${typeof seen === 'string' ? seen : yesNo(seen)}, ${seen === claimed ? 'as claimed' : `CLAIMED ${yesNo(claimed)}`}`)
    }
  } finally {
    stopTheProcessesLeftIn(scratch)
    // The folders this probe made for itself: the one it plants the codeword in, and a
    // worktree's own. They are made before a run reads what is there, so a run's own
    // read-back would count them as already there; the probe made them, so it takes them.
    takeAwayTheFoldersOf(memory, projectFolderFor(process.env, start))
    rmSync(scratch, { recursive: true, force: true })
  }
}
