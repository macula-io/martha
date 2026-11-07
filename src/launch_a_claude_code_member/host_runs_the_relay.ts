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

import { execFile } from 'node:child_process'
import type { StdioOptions } from 'node:child_process'
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { isatty } from 'node:tty'

import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'

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

/** The variable that makes the host ask again whatever its record says (named in the host's own message). */
export const HOST_IGNORES_ITS_TRUST_RECORD = 'CLAUDE_CODE_IGNORE_PERSISTED_TRUST'

/**
 * Whether the host's own record says it trusts `folder` already, so it will not
 * ask. Read one way only: true only for the exact folder, by its path or its
 * real path, marked with the value true. A record that is missing, unreadable,
 * does not parse, trusts only a folder above, or a host told to ignore its
 * record, is false: the owner may still be asked, and keeps the long deadline.
 * A wrong true only stops a member sooner.
 */
export function hostTrustsTheFolder(env: Readonly<Record<string, string | undefined>>, folder: string): boolean {
  const ignored = env[HOST_IGNORES_ITS_TRUST_RECORD]
  if (ignored !== undefined && ignored !== '') return false
  const configDir = env.CLAUDE_CONFIG_DIR ?? env.HOME ?? homedir()
  if (!isAbsolute(configDir)) return false
  try {
    const record: unknown = JSON.parse(readFileSync(join(configDir, HOST_TRUST_RECORD_FILE), 'utf8'))
    const projects = isRecord(record) && isRecord(record.projects) ? record.projects : {}
    const named = (path: string): boolean => {
      const project = Object.hasOwn(projects, path) ? projects[path] : undefined
      return isRecord(project) && project.hasTrustDialogAccepted === true
    }
    return named(folder) || named(realpathSync(folder))
  } catch {
    return false
  }
}

/** The host's answers fit in this; a longer one is no answer the launcher reads. */
const HOST_ANSWER_MAX_BYTES = 4 * 1024 * 1024

/** Why a launch starts nothing: its command names no file the launcher can run. */
export const notACommandThisLauncherCanRun = (command: string): string => `${command} is not a command this launcher can run.`

const isRunnableFile = (path: string): boolean => {
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
export async function refusalToLoadTheRelay(binary: string, pluginDir: string, env: NodeJS.ProcessEnv, cwd: string): Promise<string | undefined> {
  const does = `${binary} does not load Martha's relay (${pluginDir}), so the member's gates would be off`
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
