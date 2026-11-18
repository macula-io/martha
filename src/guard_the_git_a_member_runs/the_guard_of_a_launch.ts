// The `git` a launch puts first on its member's PATH, the clone's reference-transaction hook beside it, and the misses
// both leave for the launcher to read (martha#562, seams b and c; how the shim fails open is the Supervisor's ruling of
// 2026-11-17, comment 6962868584).
//
// This exists so a member's git meets the workspace guard wherever it runs, and not only through the shell tool the
// relay answers: a script, an alias or a `!` command reaches git with no tool call to read, so a program of the
// launch's own stands in front of the real git and judges the call itself.
//
// The launch makes these inside its own relay directory, which is removed whole when the member stops:
//
//   - `git-guard/git`, a shell shim that runs the judge with the launch's own node, put first on the member's PATH;
//   - `git-guard/guard.json`, what the judge is given: the real git a call is handed to, the misses file, and Martha's
//     own git settings, so the shim recognises Martha's own runs without spelling the settings a second time;
//   - `git-guard/src/...`, the judge and the two protocols it speaks with, each kept at the place it has in this tree so
//     the judge's two imports resolve in the copy exactly as they do here;
//   - `git-guard/git-hooks/reference-transaction`, the hook seam (c) runs, which git is pointed at by `core.hooksPath`.
//
// The shim never writes the member's row. The row is one file written whole, and a second writer on a timeout path is
// both a torn write and a second process started exactly when the machine is already too slow to answer. So a miss —
// a judge that timed out, or an answer it could not read — appends one line to `git-misses` beside the socket, which
// is the one write a shell can make with no reader able to see half a line as a line. The launcher reads that file on
// the tick it already keeps, skips a partial last line until it is whole, and folds the misses it has not folded yet
// into the member's row, which is the launcher's own write.

import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync, type Stats } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

import { MARTHAS_OWN_GIT_SETTINGS } from '../run_marthas_own_git/run_marthas_own_git.ts'
import type { TheHooksALaunchRuns } from '../refuse_code_a_checkout_runs_itself/refuse_code_a_checkout_runs_itself.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theRowWithTheLine, type DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { theMissesLine } from '../guard_workspace/guard_workspace.ts'

/** The folder inside a launch's relay directory that holds the shim, the judge and what the judge is given. */
export const THE_GUARD_DIRECTORY_NAME = 'git-guard'

/** The folder inside it that holds the hook git is pointed at for a member's runs. */
export const THE_HOOKS_DIRECTORY_NAME = 'git-hooks'

/** The name on the member's PATH, and the name of the hook: what git's own words call them. */
export const THE_SHIM_NAME = 'git'
const THE_HOOK_NAME = 'reference-transaction'

/** The judge, the guard's protocol and the relay's: the three files of this tree the launch carries. */
const THE_JUDGE_NAME = 'judge_a_git_call.ts'
const THE_GUARD_PROTOCOL_NAME = 'guard_protocol.ts'
const THE_PROTOCOL_NAME = 'relay_protocol.ts'

/** Where each stands in this tree and in the copy: the one import each file has resolves from either (see the header). */
const THE_TREES_ROOT_NAME = 'src'
const THE_JUDGES_PLACE_IN_THE_TREE = `guard_the_git_a_member_runs/${THE_JUDGE_NAME}`
const THE_GUARD_PROTOCOLS_PLACE_IN_THE_TREE = `guard_the_git_a_member_runs/${THE_GUARD_PROTOCOL_NAME}`
const THE_PROTOCOLS_PLACE_IN_THE_TREE = `claude_code_relay/hooks/${THE_PROTOCOL_NAME}`

/** The file the judge is given, written beside the judge itself, which reads it as `./guard.json`. */
const THE_CONFIG_NAME = 'guard.json'

/** The misses file, beside the relay socket, inside the launch's own relay directory. */
export const MISSES_FILE_NAME = 'git-misses'

/** Only the owner may enter the guard's folders, and nobody may write what the launch put there. */
export const THE_GUARD_DIRECTORY_MODE = 0o500

/** A folder while the launch is still filling it. */
const THE_GUARD_WHILE_BEING_WRITTEN = 0o700

/** The owner may read the judge, the protocol and the config; nothing anyone runs may write them. */
export const THE_GUARD_FILE_MODE = 0o400

/** The owner may run the shim and the hook; nobody may write them. */
export const THE_SHIM_MODE = 0o500

/** What the judge is given, written by the launch from the values this tree defines and nothing restated by hand. */
export interface TheGuardsConfig {
  /** The real git a call it may run is handed to, resolved once at the launch. */
  readonly real_git: string
  /** The file a miss is appended to, one line each. */
  readonly misses: string
  /** Martha's own git settings, as git names them: a run carrying them is Martha's own and is not judged. */
  readonly settings: readonly (readonly [string, string])[]
}

/** What a launch made for its guard: the folder the shim stands in, the hooks folder git is pointed at, and the misses. */
export interface TheGitGuard {
  /** The folder first on the member's PATH, which holds the shim and the judge. */
  readonly directory: string
  /** The hooks folder `core.hooksPath` names, which holds the one hook the launch runs of its own: `reference-transaction`. */
  readonly hooks: TheHooksALaunchRuns
  /** The file the judge appends its misses to. */
  readonly misses: string
}

export type TheGuardsMaking = TheGitGuard | { readonly refusal: string }

const REFUSED = 'The member is not started: its git guard could not be placed'

/** This slice's own folder, where the judge is checked in. */
const THE_GUARD_SOURCE = fileURLToPath(new URL('.', import.meta.url))

/** The relay's hooks folder, where the protocol is checked in. */
const THE_PROTOCOL_SOURCE = fileURLToPath(new URL(`../claude_code_relay/hooks/${THE_PROTOCOL_NAME}`, import.meta.url))

/** Where the misses a launch could not judge are appended, in the launch's own relay directory. */
export const theMissesFileIn = (relayDirectory: string): string => join(relayDirectory, MISSES_FILE_NAME)

/**
 * The real git on this machine, found on the member's inherited PATH: the program the shim hands a call it allows to.
 * A path that is a link is followed, since a machine may install git behind one; undefined when nothing on the PATH is
 * a program to run.
 */
export function theRealGitOnThisMachine(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  for (const directory of (env['PATH'] ?? '').split(delimiter)) {
    if (directory === '') continue
    const candidate = join(directory, THE_SHIM_NAME)
    const found = statOrUndefined(candidate)
    if (found?.isFile() === true && (found.mode & 0o111) !== 0) return candidate
  }
  return undefined
}

/**
 * Places the guard inside `relayDirectory`, which the launch has just made: the shim, the judge, the config and the
 * hook, each readable by its owner and writable by nobody. `node` is what the shim runs the judge with, and `realGit`
 * is the program a judged call is handed to. A launch whose guard cannot be placed is not started, since a member whose
 * git silently lost its guard is a member the crew's layout does not hold.
 */
export function putTheGuardIn(relayDirectory: string, node: string, realGit: string): TheGuardsMaking {
  const directory = join(relayDirectory, THE_GUARD_DIRECTORY_NAME)
  const hooks = join(directory, THE_HOOKS_DIRECTORY_NAME)
  const misses = theMissesFileIn(relayDirectory)
  const judge = join(directory, THE_TREES_ROOT_NAME, THE_JUDGES_PLACE_IN_THE_TREE)
  try {
    writeTheGuard(directory, hooks, judge, node, realGit, misses)
  } catch (error) {
    removeTheTree(directory)
    return { refusal: `${REFUSED}: ${directory} could not be written (${codeOf(error)}).` }
  }
  return { directory, hooks: { directory: hooks }, misses }
}

/**
 * The guard a launch places inside the directory it has just made, or why the member is not started (martha#562): the
 * real git a judged call is handed to is found on the member's inherited PATH, and a launch that finds none starts
 * nothing, since a member whose git silently lost its guard is a member the crew's layout does not hold.
 */
export function theGuardOfTheLaunch(
  relayDirectory: string,
  node: string,
  inherited: Readonly<Record<string, string | undefined>>,
): TheGuardsMaking {
  const realGit = theRealGitOnThisMachine(inherited)
  return realGit === undefined
    ? { refusal: `The member is not started: its git guard found no git on ${inherited['PATH'] ?? 'a PATH it was given'}.` }
    : putTheGuardIn(relayDirectory, node, realGit)
}

/** Everything under `directory`, written whole, then closed to every write. */
function writeTheGuard(directory: string, hooks: string, judge: string, node: string, realGit: string, misses: string): void {
  const config: TheGuardsConfig = { real_git: realGit, misses, settings: MARTHAS_OWN_GIT_SETTINGS }
  const folders = carryTheJudgesFiles(directory, judge)
  mkdirSync(hooks, { mode: THE_GUARD_WHILE_BEING_WRITTEN })
  writeFileSync(join(dirname(judge), THE_CONFIG_NAME), `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: THE_GUARD_FILE_MODE })
  writeFileSync(join(directory, THE_SHIM_NAME), theShimFor(THE_SHIM_NAME, node, judge), { flag: 'wx', mode: THE_SHIM_MODE })
  writeFileSync(join(hooks, THE_HOOK_NAME), theShimFor(THE_HOOK_NAME, node, judge), { flag: 'wx', mode: THE_SHIM_MODE })
  // The guard's folders are closed to every write once what they hold is written, deepest first.
  const written = [...folders, hooks, directory]
  for (const folder of written.sort((one, other) => other.length - one.length)) chmodSync(folder, THE_GUARD_DIRECTORY_MODE)
}

/** The judge and the two protocols, each at the place it has in this tree, so the imports resolve in the copy. */
function carryTheJudgesFiles(directory: string, judge: string): readonly string[] {
  const places: readonly (readonly [string, string])[] = [
    [join(THE_GUARD_SOURCE, THE_JUDGE_NAME), judge],
    [join(THE_GUARD_SOURCE, THE_GUARD_PROTOCOL_NAME), join(directory, THE_TREES_ROOT_NAME, THE_GUARD_PROTOCOLS_PLACE_IN_THE_TREE)],
    [THE_PROTOCOL_SOURCE, join(directory, THE_TREES_ROOT_NAME, THE_PROTOCOLS_PLACE_IN_THE_TREE)],
  ]
  const folders: string[] = []
  for (const [from, to] of places) {
    folders.push(...foldersBetween(directory, dirname(to)))
    mkdirSync(dirname(to), { recursive: true, mode: THE_GUARD_WHILE_BEING_WRITTEN })
    writeFileSync(to, readFileSync(from), { flag: 'wx', mode: THE_GUARD_FILE_MODE })
  }
  return folders
}

/** Every folder under `stop` that `folder` stands at or in, the deepest last; `stop` itself is not among them. */
function foldersBetween(stop: string, folder: string): readonly string[] {
  const inside: string[] = []
  for (let at = folder; at !== stop && at.startsWith(`${stop}/`); at = dirname(at)) inside.unshift(at)
  return inside
}

/**
 * The shell script the member's git and the clone's hook are: the launch's own node, the judge, and the mode, then the
 * words the caller handed it unchanged. A shell script rather than a shebang on the judge, because the node a launch
 * runs on can stand anywhere, and a script's first line is the one place a path with no length limit is safe.
 */
export function theShimFor(mode: string, node: string, judge: string): string {
  return [
    '#!/bin/sh',
    `# Martha's git guard (martha#562): the judge decides, and the real git runs what it allows.`,
    `exec ${singleQuoted(node)} ${singleQuoted(judge)} ${singleQuoted(mode)} "$@"`,
    '',
  ].join('\n')
}

/** One word as a shell reads it as itself: in single quotes, the quote it holds ended and started again. */
const singleQuoted = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`

/**
 * The member's environment with the guard's folder first on its PATH, so every git the shell, a script or a tool start
 * meets the shim. A member given no PATH at all is given the guard's folder alone, which is honest: nothing else was
 * on it to keep.
 */
export function thePathWithTheGuardFirst(env: Readonly<Record<string, string>>, guardDirectory: string): Readonly<Record<string, string>> {
  const before = env['PATH']
  return { ...env, PATH: before === undefined || before === '' ? guardDirectory : `${guardDirectory}${delimiter}${before}` }
}

/** How many misses have been folded into the row, and the line the fold wrote there: the launcher's own memory of both. */
export interface TheFoldedMisses {
  /** The characters of the misses file folded so far; nothing before this is read again. */
  readonly cursor: number
  /** The line this fold last put in the member's row, which is this writer's own to write over. */
  readonly wrote: string | null
}

/** A launch that has folded nothing yet. */
export const NOTHING_FOLDED_YET: TheFoldedMisses = { cursor: 0, wrote: null }

/** Where a fold writes: the member's row, its own store, and the moment the fold is a beat of. */
export interface TheRowTheMissesGoIn {
  readonly beats: DashboardStore
  readonly member: string
  readonly at: number
}

/**
 * The misses written since the last fold, folded into the member's row, on the launcher's own tick (martha#562). The
 * file is read whole and only the part past `cursor` is taken; a last line with no newline after it is a miss still
 * being written, so it waits for the tick that finds its end. The row keeps one line for what needs the owner, so a
 * line another writer put there is left alone and these misses wait for a tick that can take it. Nothing already
 * folded is folded twice: the cursor moves only once the row has taken the line.
 */
export function foldTheMisses(the: { readonly misses: string; readonly folded: TheFoldedMisses }, into: TheRowTheMissesGoIn): TheFoldedMisses {
  const written = readOrNothing(the.misses)
  const whole = written.slice(0, written.lastIndexOf('\n') + 1)
  if (whole.length <= the.folded.cursor) return the.folded
  const lines = whole.slice(the.folded.cursor).split('\n').filter((line) => line.trim() !== '')
  if (lines.length === 0) return { ...the.folded, cursor: whole.length }
  const line = theMissesLine(lines)
  const kept = into.beats.change(into.member, (held) => (held === null ? null : theRowWithTheLine(held, { wrote: the.folded.wrote, line, at: into.at })))
  return kept.kept ? { cursor: whole.length, wrote: line } : the.folded
}

/**
 * The tick's work: the misses a member's git guard left, folded into the member's row, which is this launcher's own
 * write (martha#562, the ruling on seam b). The caller keeps what this returns and calls it on its own tick.
 */
export function aFolderOfTheMisses(misses: string, member: string, beats: DashboardStore): () => void {
  let folded = NOTHING_FOLDED_YET
  return () => {
    folded = foldTheMisses({ misses, folded }, { beats, member, at: Date.now() })
  }
}

/** The file's text, or none when there is no file: a member that never missed leaves none. */
function readOrNothing(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function statOrUndefined(path: string): Stats | undefined {
  try {
    return statSync(path)
  } catch {
    return undefined
  }
}

function codeOf(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? String(error)
}
