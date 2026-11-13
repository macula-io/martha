// The host runs Martha's relay, or the member does not start (#104).
//
// This exists so a member never runs with its gates silently off. The relay is
// a hooks module, and the host reads a hooks module before it runs it: a module
// the host refuses is left out whole, and the member then runs with nothing
// answering its prompts and tool calls (martha#104: `$.env.get` was given a
// constant where the host takes only a literal name).
//
// Before a launch starts its member, the launcher:
//
//   1. Resolves the host's command once, to the file it runs, as `type -P` does:
//      the first executable file of that name on the member's PATH, or the path
//      it names. The member, the load check and the version check all run that
//      one file, so the check judges the binary that runs, even when an update
//      moves the command's link in between.
//   2. Asks that binary whether it loads the relay: `<host> plugin validate
//      --json <relay dir>`, the host's own loader. Anything but `success: true`
//      refuses the launch, naming the relay's folder and the host's first error.
//      A check that cannot be run or read refuses too.
//   3. Reads the binary's version. A version other than the one Martha's adapter
//      was recorded from (../claude_code_host/recorded_claude_code_host.json) is
//      told to the owner in one line and refuses nothing: the load check judges
//      the binary itself, and a prompt origin the recording does not know is
//      already taken as cross_session (../name_the_source_of_a_prompt).
//
// What no check before the start can see (hooks turned off for the session by
// managed settings, say) the launcher's backstop catches after it: a member
// whose relay does not report its session's start in time is stopped
// (launch_a_claude_code_member.ts). How long is in time depends on whether an
// owner can answer the host. In a folder it has not been told to trust, the
// host first asks whether to trust it, and runs no hook, the relay's included,
// until the owner answers: on Claude Code 2.1.318 the relay reported the start
// about a second after the answer, and nothing in the 45 s the question was
// left open (martha#104 r=1, a live probe). A member with no owner at a
// terminal cannot be asked, so a missing report means the gates are off. Nor
// is a member asked whose folder the host's own record already trusts
// (hostTrustsTheFolder), so after a folder's first start the short deadline
// holds there too.

import { execFile, spawn } from 'node:child_process'
import type { StdioOptions } from 'node:child_process'
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { isatty } from 'node:tty'

import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FIELD, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'

/**
 * How long one question to the host may take. The load check reads the relay's
 * few files and the version check prints a line; past this the host is taken to
 * be unable to answer, and the launch is refused.
 */
export const HOST_ANSWER_TIMEOUT_MS = 30_000

/**
 * How long a member no owner can answer for has to report its session's start
 * before it is stopped. The host reports it as it starts, within a second or
 * two; past this it is taken not to run the relay.
 */
export const SESSION_START_DEADLINE_MS = 30_000

/**
 * How long a member whose owner can answer the host has to report its
 * session's start before it is stopped. The host may first ask the owner
 * whether to trust the folder, and runs no hook until the answer, so this is
 * long enough to read that question and the folder before answering. It is
 * also how long a member whose host runs no hooks at all goes ungated with
 * its owner at the terminal, so it is minutes, not hours.
 */
export const TRUST_ANSWER_DEADLINE_MS = 600_000

/** Whether an owner can answer the host's questions: the member is given the launcher's input, and that is a terminal. */
export const ownerCanAnswerTheHost = (stdio: StdioOptions): boolean => stdio === 'inherit' && isatty(0)

/**
 * The file in which Claude Code records the folders it trusts, in the folder
 * CLAUDE_CONFIG_DIR names, else the home folder. The host's own refusal for an
 * untrusted folder tells the owner to set `projects[<folder>].hasTrustDialogAccepted:
 * true` in it, and on 2.1.318 its trust answer was written there under the
 * folder's own path, for a plain folder and a git checkout's root alike
 * (martha#104 r=2, live probes).
 */
export const HOST_TRUST_RECORD_FILE = '.claude.json'

/**
 * Whether the host's own record says it trusts `folder` already, so it will not
 * ask. Read one way only: true only for the exact folder, by its path or its
 * real path, marked with the value true. A record that is missing, unreadable,
 * does not parse, trusts only a folder above, or a host told to ignore its
 * record, is false: the owner may still be asked, and keeps the long deadline.
 * A wrong true only stops a member sooner.
 *
 * "Told to ignore its record" is both ways the recorded host's own trust
 * predicate takes (`Hde(){return RUo()}`, the same function as the hook exit):
 * the variable of its environment, or, from 2.1.323, one of the arguments the
 * owner passes to it — read as the exact token the host tests, so a longer
 * argument is not it. Both names come from the recording (martha#332 r=3).
 */
/**
 * The folder the host keeps `.claude.json` in: the one `CLAUDE_CONFIG_DIR` names, else the home folder (martha#104).
 */
export function theHostsConfigDirectory(env: Readonly<Record<string, string | undefined>>): string {
  return env.CLAUDE_CONFIG_DIR ?? env.HOME ?? homedir()
}

/**
 * The folder the host keeps its settings files in — `settings.json`, which its `/model` command saves the owner's
 * default into (martha#359): the one `CLAUDE_CONFIG_DIR` names, else `.claude` under the home folder. It is not
 * `theHostsConfigDirectory`: a host with no `CLAUDE_CONFIG_DIR` keeps `.claude.json` in the home folder and its
 * settings one level down, and both spellings come from the recording rather than from a guess.
 */
export function theHostsSettingsDirectory(env: Readonly<Record<string, string | undefined>>): string {
  return env.CLAUDE_CONFIG_DIR ?? join(env.HOME ?? homedir(), CONFIG_UNDER_THE_HOME)
}

/** The folder the host's settings live in, under a home folder that names no config of its own. */
const CONFIG_UNDER_THE_HOME = '.claude'

export function hostTrustsTheFolder(
  env: Readonly<Record<string, string | undefined>>,
  folder: string,
  ownersArguments: readonly string[],
): boolean {
  if (toldToIgnoreItsRecord(env, ownersArguments)) return false
  const configDir = theHostsConfigDirectory(env)
  if (!isAbsolute(configDir)) return false
  try {
    const projects = projectsIn(JSON.parse(readFileSync(join(configDir, HOST_TRUST_RECORD_FILE), 'utf8')))
    return trustedIn(projects, folder) || trustedIn(projects, realpathSync(folder))
  } catch {
    return false
  }
}

/**
 * Whether the host was told to ignore its record: a variable of its environment that the recording names is set, or
 * one of its arguments is an argument the recording names. Both lists are the recorded host's own, never a name typed
 * here, so a host that adds or renames a way in is read from the recording that passed the drift check.
 */
function toldToIgnoreItsRecord(env: Readonly<Record<string, string | undefined>>, ownersArguments: readonly string[]): boolean {
  const { variables, flags } = CLAUDE_CODE_HOOK_SWITCHES.outside_a_terminal
  const set = variables.some((name) => {
    const value = env[name]
    return value !== undefined && value !== ''
  })
  return set || flags.some((flag) => ownersArguments.includes(flag))
}

/** The `projects` of the host's record; none when the record has no such object. */
const projectsIn = (record: unknown): Readonly<Record<string, unknown>> => (isRecord(record) && isRecord(record.projects) ? record.projects : {})

/** Whether the record marks exactly this path trusted, with the value true. */
function trustedIn(projects: Readonly<Record<string, unknown>>, path: string): boolean {
  const project = Object.hasOwn(projects, path) ? projects[path] : undefined
  return isRecord(project) && project.hasTrustDialogAccepted === true
}

/** The host's answers fit in this; a longer one is no answer the launcher reads. */
const HOST_ANSWER_MAX_BYTES = 4 * 1024 * 1024

/** Why a launch starts nothing: its command names no file the launcher can run. */
export const notACommandThisLauncherCanRun = (command: string): string => `${command} is not a command this launcher can run.`

/** Whether `path` is a file this user can run: what a PATH lookup answers with, and never a folder (martha#304). */
export const isRunnableFile = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * The file a command runs, resolved once: a command with a slash is that path
 * (from `cwd`), any other is the first runnable file of that name in an
 * absolute entry of `path`. An empty or relative entry is skipped: from the
 * launch folder it names a folder under the checkout, where whoever writes the
 * checkout could plant a `claude` that the load check and the member would run
 * (martha#104 r=1). Links are followed to the file itself.
 */
export function resolvedHostCommand(command: string, path: string | undefined, cwd: string): { readonly binary: string } | { readonly refusal: string } {
  const candidates = command.includes('/')
    ? [isAbsolute(command) ? command : resolve(cwd, command)]
    : (path ?? '').split(delimiter).filter((entry) => isAbsolute(entry)).map((entry) => join(entry, command))
  const found = candidates.find(isRunnableFile)
  if (found === undefined) return { refusal: notACommandThisLauncherCanRun(command) }
  return { binary: realpathSync(found) }
}

interface Ran {
  readonly status: number | null
  readonly stdout: string
  readonly failure: string | undefined
}

/** Runs the host once with `args`; never rejects. */
function ranHost(binary: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): Promise<Ran> {
  return new Promise((done) => {
    execFile(binary, args, { env, cwd, timeout: HOST_ANSWER_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: HOST_ANSWER_MAX_BYTES, encoding: 'utf8' }, (error, stdout) => {
      if (error === null) return done({ status: 0, stdout, failure: undefined })
      const failed = error as NodeJS.ErrnoException & { code?: unknown; killed?: boolean; signal?: string | null }
      if (failed.killed === true) return done({ status: null, stdout, failure: `it did not answer within ${HOST_ANSWER_TIMEOUT_MS} ms` })
      if (typeof failed.code === 'number') return done({ status: failed.code, stdout, failure: undefined })
      return done({ status: null, stdout, failure: failed.signal ? `it ended on ${failed.signal}` : `it could not be run (${String(failed.code ?? failed.message)})` })
    })
  })
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The messages of a validator section's `errors`, in order. */
const errorsIn = (section: unknown): string[] =>
  isRecord(section) && Array.isArray(section.errors)
    ? section.errors.flatMap((error) => (isRecord(error) && typeof error.message === 'string' && error.message !== '' ? [error.message] : []))
    : []

/**
 * The first error of the host's validation report (`plugin validate --json`):
 * the manifest's, then each content file's, then the refusal it gives for the
 * plugin as a whole; undefined when it names none.
 */
export function firstValidatorError(report: unknown): string | undefined {
  if (!isRecord(report)) return undefined
  const contents = Array.isArray(report.contents) ? report.contents : []
  const named = [...errorsIn(report.manifest), ...contents.flatMap(errorsIn)]
  if (named[0] !== undefined) return named[0]
  return typeof report.digestRefusal === 'string' && report.digestRefusal !== '' ? report.digestRefusal : undefined
}

/** Why the host at `binary` would not load the relay at `pluginDir`, or undefined when it loads it. */
export async function refusalToLoadTheRelay(
  binary: string,
  pluginDir: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
  copiedFrom?: string,
): Promise<string | undefined> {
  // A launch's copy is gone once the launch is refused; the owner is told the installed folder it was made from (#117).
  const named = copiedFrom === undefined ? pluginDir : `${pluginDir}, this launch's copy of ${copiedFrom}`
  const does = `${binary} does not load Martha's relay (${named}), so the member's gates would be off`
  const ran = await ranHost(binary, ['plugin', 'validate', '--json', pluginDir], env, cwd)
  if (ran.failure !== undefined) return `${does}: asked whether it does, ${ran.failure}.`
  let report: unknown
  try {
    report = JSON.parse(ran.stdout)
  } catch {
    return `${does}: its answer to plugin validate is not the JSON report it gives (exit ${ran.status}).`
  }
  if (isRecord(report) && report.success === true && ran.status === 0) return undefined
  return `${does}: ${firstValidatorError(report) ?? `it gives no reason (exit ${ran.status})`}`
}

/** The version a host's `--version` prints first, as `2.1.319 (Claude Code)`; undefined when it prints none. */
export const versionIn = (printed: string): string | undefined => /^\s*(\d+\.\d+\.\d+)(?=\s|$)/.exec(printed)?.[1]

/**
 * The line the owner is told when the host at `binary` is not the version
 * Martha's adapter was recorded from, or cannot say which it is; undefined when
 * it is that version.
 */
export async function hostVersionLine(binary: string, env: NodeJS.ProcessEnv, cwd: string, recorded: string = RECORDED_HOST.host_version): Promise<string | undefined> {
  const ran = await ranHost(binary, ['--version'], env, cwd)
  const version = ran.failure === undefined && ran.status === 0 ? versionIn(ran.stdout) : undefined
  if (version === recorded) return undefined
  const which = version === undefined ? 'a version it does not say' : `version ${version}`
  return `The host at ${binary} is ${which}; Martha's record of the host is of version ${recorded}. It loads Martha's relay, so the member starts.`
}

/**
 * The switches a host answers its session init under (martha#154): print mode, stream-json in and out, verbose,
 * and no session record written. Asking for the init runs no turn and starts no model call. What it does otherwise is
 * not to be assumed: on 2.1.321 it starts an MCP server named by `--mcp-config` and runs a user settings file's
 * SessionStart hook (probed, martha#154 r=2), so `initQuestionArgs` takes that switch away and turns hooks off.
 */
export const SESSION_INIT_ARGS = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'] as const

/** The switch that names a file of tool servers for the host to start. The init question is asked without it. */
export const MCP_CONFIG_SWITCH = '--mcp-config'

/**
 * The arguments the session-init question is asked with (martha#154 r=2): the switches the member's host starts on,
 * less `--mcp-config` and the file it names, plus a settings file that turns every hook off, plus the question's own
 * switches.
 *
 * The question has to read the same settings the member will read, because a settings file's `env` block may move the
 * config dir, and with it the folder the host lists the owner's styles from. Those same settings can name a
 * SessionStart hook, and `--mcp-config` names a server the host starts before it answers -- and both run with the
 * launcher's environment, before the launch has placed the recorded server tree (#65, #73). So the question is asked
 * with `--strict-mcp-config` and no server file, and with hooks turned off by the key the recording names.
 */
export function initQuestionArgs(switches: readonly string[], hooksOffSettings: string): string[] {
  return [...withoutTheServerFile(switches), '--settings', hooksOffSettings, ...SESSION_INIT_ARGS]
}

/** The one control request the init question writes: the engine's `initialize`, which answers with the session's init. */
const INITIALIZE_REQUEST = JSON.stringify({ type: 'control_request', request_id: 'martha-session-init', request: { subtype: 'initialize' } })

/** The session init one line of the host's output carries, or undefined when the line is not one. */
function initOf(line: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const message: unknown = JSON.parse(line)
    const response = isRecord(message) && isRecord(message.response) ? message.response : undefined
    return response !== undefined && isRecord(response.response) ? response.response : undefined
  } catch {
    return undefined
  }
}

/** The session-init response a host printed, or undefined when no line is one. */
export function initResponseIn(printed: string): Readonly<Record<string, unknown>> | undefined {
  for (const line of printed.split('\n')) {
    const init = line.includes('control_response') ? initOf(line) : undefined
    if (init !== undefined) return init
  }
  return undefined
}

/**
 * The folder the host at `binary` reports for the user-level output styles, from its own session init, run with the
 * switches the member's host is started with so the settings env blocks that move it are applied (martha#154); or
 * why the launch is refused. A host that reports no such field does not start a member: the folder is not guessed
 * from our own reading of the config dir, which is the answer the design refuses.
 */
export async function outputStylesDirTheHostReports(
  binary: string,
  switches: readonly string[],
  hooksOffSettings: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
  field: string = CLAUDE_CODE_OUTPUT_STYLES_FIELD,
): Promise<{ readonly dir: string } | { readonly refusal: string }> {
  const runs = `${binary} does not report the folder it lists the owner's user output styles from, so a member is not started: it could write there and reach a later session`
  const printed = await askedForItsInit(binary, initQuestionArgs(switches, hooksOffSettings), env, cwd)
  if ('failure' in printed) return { refusal: `${runs} (asked for its session init, ${printed.failure}).` }
  const init = initResponseIn(printed.stdout)
  if (init === undefined) return { refusal: `${runs} (its answer to the session init is no init response).` }
  const dir = init[field]
  if (typeof dir !== 'string' || dir.trim() === '') return { refusal: `${runs}: its session init reports no ${field} field.` }
  return { dir }
}

/** What the host printed while it was asked a question, on both streams. */
export interface WhatTheHostPrinted {
  readonly stdout: string
  /** What it said about its own settings, which the host writes here and not on the stream that answers (#226). */
  readonly stderr: string
}

/** A question put to the host over stream-json: the request line, and what counts as the whole answer. */
interface HostQuestion {
  readonly ask: string
  /** Whether what it printed holds the whole answer. A question that says so is stopped there, the host ended with it. */
  readonly answered: (printed: WhatTheHostPrinted) => boolean
}

/**
 * Asks the host one question and returns everything it printed on both streams, or why it could not be asked. The host
 * is detached, so it leads its own process group and everything it started is in that group, and the group is killed
 * once the question is over (martha#154 r=2).
 */
async function askedTheHost(binary: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string, question: HostQuestion): Promise<WhatTheHostPrinted | { readonly failure: string }> {
  return new Promise((done) => {
    const child = spawn(binary, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    let printed: WhatTheHostPrinted = { stdout: '', stderr: '' }
    let settled = false
    /** Ends the question: the host and everything it started, by group, so nothing is left running. */
    const stopHost = (): void => {
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // The group is already gone, or was never made: the host itself is all that is left.
        child.kill('SIGKILL')
      }
    }
    const finish = (answer: WhatTheHostPrinted | { readonly failure: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stopHost()
      done(answer)
    }
    const timer = setTimeout(() => finish({ failure: `it did not answer within ${HOST_ANSWER_TIMEOUT_MS} ms` }), HOST_ANSWER_TIMEOUT_MS)
    const said = (): void => {
      // The answer is one line; a question that has it is closed and the host stopped as soon as it is read.
      if (question.answered(printed)) finish(printed)
    }
    child.stdout?.on('data', (chunk: Buffer | string) => {
      printed = { ...printed, stdout: printed.stdout + chunk.toString() }
      said()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      printed = { ...printed, stderr: printed.stderr + chunk.toString() }
    })
    child.once('error', (error) => finish({ failure: `it could not be run (${String((error as NodeJS.ErrnoException).code ?? error.message)})` }))
    child.once('close', () => finish(question.answered(printed) || printed.stdout !== '' || printed.stderr !== '' ? printed : { failure: 'it ended without a word' }))
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(question.ask)
  })
}

/** The host's answer to the init question: what it printed, or why it could not be asked. */
async function askedForItsInit(binary: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): Promise<WhatTheHostPrinted | { readonly failure: string }> {
  return askedTheHost(binary, args, env, cwd, { ask: `${INITIALIZE_REQUEST}\n`, answered: (printed) => initResponseIn(printed.stdout) !== undefined })
}

/** The switches the host is asked in print mode with when no turn is wanted: it reads its settings, then asks for input. */
const PRINT_MODE = '--print'

/** The switch that refuses a tool server file, so a question names none and starts none. */
const STRICT_NO_SERVER_FILE = '--strict-mcp-config'

/** The switches `switches` holds, less a tool server file and the file it names (martha#154 r=2). */
export function withoutTheServerFile(switches: readonly string[]): string[] {
  return switches.filter((arg, at) => arg !== MCP_CONFIG_SWITCH && !arg.startsWith(`${MCP_CONFIG_SWITCH}=`) && switches[at - 1] !== MCP_CONFIG_SWITCH)
}

/**
 * The switches the host is asked about the rules with (martha#226): print mode, no tool server file, the launch's own
 * switches less `--mcp-config`, and the settings file last so it is the one the host reads.
 *
 * Print mode with no prompt ends at once, after the host has read its settings, on its own complaint that no input was
 * given. That is the run in which it says which rules its file permission checks never match: it asks for no turn and
 * reaches no model, so the question costs one host start and nothing else.
 */
export function ruleQuestionArgs(switches: readonly string[], settings: string): string[] {
  return [PRINT_MODE, ...withoutTheServerFile(switches), STRICT_NO_SERVER_FILE, '--settings', settings]
}

/**
 * Everything the host printed when it read `settings` — the standard error it writes what it makes of those settings on
 * included — or why it could not be asked (martha#226).
 *
 * The question is print mode with no prompt: the host reads the rules, says which of them it can never match, and ends
 * on its own. Nothing it starts is left behind, and nothing of the owner's runs: the settings file turns every hook off
 * and names no tool server.
 */
export async function whatTheHostSaysWithTheseSettings(
  binary: string,
  switches: readonly string[],
  settings: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<WhatTheHostPrinted | { readonly failure: string }> {
  return askedTheHost(binary, ruleQuestionArgs(switches, settings), env, cwd, { ask: '', answered: () => false })
}
