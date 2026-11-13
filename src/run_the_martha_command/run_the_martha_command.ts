// The `martha` command a stranger types (martha#98): `martha init`, `martha approve`, `martha start <member>`,
// `martha todo` (martha#316), `martha install`, and `martha --version`.
//
// This exists so a person who installed Martha gets a solo crew running without writing code or knowing its
// internals. It is the one place that reads the machine's environment, and only to find places: the project
// (the git top of the working directory), the owner's home, Martha's state root ($XDG_STATE_HOME/martha, else
// ~/.local/state/martha) and the root of the relay sockets ($XDG_RUNTIME_DIR, else /tmp, in a directory of
// this user's own). Every act is a slice of its own that takes those places as arguments.
//
// What it says: a refusal, and every line an act tells the owner, goes to stderr prefixed `martha:`, as
// martha-install does. Every line it shows has its terminal controls written out as escapes first (shownSafely),
// since a path, a member's name or a kept approval may hold bytes a terminal would act on. An error no act
// expected is shown the same way, as one refused line, never as Node's own trace. `--version` prints the release's version on stdout; `init` prints the members it
// declared; `start` prints one line naming the member and its pid once it is up, then holds the terminal until
// the member ends, and ends the way the member did. Exit 0 is done, 1 refused, 2 not a way the command is used.

import { spawnSync, type StdioOptions } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { constants } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { isatty } from 'node:tty'

import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { approveConfig, NOTHING_TO_APPROVE, type OwnersTerminal } from '../approve_a_checkouts_config/approve_a_checkouts_config.ts'
import { installThePinnedInstaller } from '../install_the_pinned_installer/install_the_pinned_installer.ts'
import { declareCrew } from '../declare_crew/declare_crew.ts'
import { declareSoloCrew } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { crewRowsDirectory, crewStateDirectory, openState, STATE_ROOT_NAME, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { OWNER_TODO_STREAM, theListForTheTerminal, theOpenRows } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { crewFilesDirectory, handoverStampsIn } from '../crew_files_directory/crew_files_directory.ts'
import type { TheDeclaration } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { wakeAMember } from '../wake_a_member/wake_a_member.ts'
import { launcherPlacesOf, startMember } from '../start_a_member/start_a_member.ts'
import type { MemberStarted } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { keepCommandShapes, pinOwnerKey, SIGNATURE_SUFFIX } from '../keep_what_the_owner_signed/keep_what_the_owner_signed.ts'
import { askTheLauncherToRun } from '../run_an_owner_signed_command/ask_the_launcher_to_run.ts'

/** The command ended as asked. */
export const EXIT_DONE = 0
/** The command refused, and said why. */
export const EXIT_REFUSED = 1
/** The command was not used in a way it knows. */
export const EXIT_USAGE = 2

/** The line `martha start` prints once the member is up: its name and its pid. */
export const startedLine = (member: string, pid: number | string): string => `${member} started, pid ${pid}`

/** How the command is used. */
export const USAGE =
  'usage: martha init | martha approve | martha todo | martha start <member> [-- <claude arguments>] | martha wake <member> | martha run <shape> | martha install [<version>] [--downgrade] [--digest sha256:<hex>] | martha pin-key <public key file> | martha keep-shapes <signed list> | martha --version'

/** Why an owner's act is refused where no owner is at the keyboard. */
export const OWNERS_ACT_NEEDS_A_TERMINAL = 'only the owner, at a terminal, pins a key or keeps a signed list, and this is no terminal.'

/** What starts every line Martha shows the owner on stderr. */
export const SAID_BY = 'martha:'

/** The host the owner has installed, found on their PATH. */
const CLAUDE = 'claude'

const documents = { read: (path: string) => readFile(path, 'utf8') }

/** Where the command reads and writes, and what it says. */
export interface CommandIo {
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly stdio: StdioOptions
  readonly terminal: OwnersTerminal
  out(line: string): void
  err(line: string): void
  /** Writes bytes to stdout as they are: a signed run's output, which must reach the host unchanged (martha#129). */
  outBytes(bytes: Buffer): void
}

/** The places every act needs. */
interface Places {
  readonly root: string
  readonly home: string
  readonly state: MarthaState
}

const tellOwnerOn = (io: CommandIo) => (line: string): void => io.err(`${SAID_BY} ${line}`)

function refused(io: CommandIo, why: string): number {
  tellOwnerOn(io)(why)
  return EXIT_REFUSED
}

const absolute = (path: string | undefined): string | undefined => (path !== undefined && isAbsolute(path) ? path : undefined)

/** git's answer in `cwd`, or undefined when git gave none. */
function gitSays(cwd: string, ...args: string[]): string | undefined {
  const run = spawnSync('git', marthasOwnGitArgs(args), { cwd, encoding: 'utf8' })
  const said = run.status === 0 ? run.stdout.trim() : ''
  return said === '' ? undefined : said
}

/** The project, the home and the state the acts work in; or why there are none. */
function placesOf(io: CommandIo): Places | string {
  const home = absolute(io.env['HOME'])
  if (home === undefined) return 'HOME is not set to an absolute path, so Martha cannot tell where your home is.'
  const root = gitSays(io.cwd, 'rev-parse', '--show-toplevel')
  if (root === undefined) return `${io.cwd} is not inside a git checkout. Run martha in the checkout your crew works in.`
  const state_root = join(absolute(io.env['XDG_STATE_HOME']) ?? join(home, '.local', 'state'), STATE_ROOT_NAME)
  const state = openState(state_root, root)
  return 'refusal' in state ? state.refusal : { root, home, state }
}

/** The root of the release this command is part of: its package.json, and the pin that release carries. */
const releaseTree = (): string => join(import.meta.dirname, '..', '..')

/** The version of the release this command is part of. */
function version(): string {
  const manifest = JSON.parse(readFileSync(join(releaseTree(), 'package.json'), 'utf8')) as { version?: unknown }
  return String(manifest.version)
}

async function init(io: CommandIo, places: Places): Promise<number> {
  const owner = gitSays(places.root, 'config', 'user.name') ?? null
  const declared = await declareSoloCrew({ root: places.root, owner, state: places.state, documents })
  if (!declared.declared) return refused(io, declared.refusal)
  io.out(`Declared a solo crew in ${declared.declaration}: ${declared.settings.members.map((member) => member.name).join(', ')}.`)
  return EXIT_DONE
}

async function approve(io: CommandIo, places: Places): Promise<number> {
  const tellOwner = tellOwnerOn(io)
  const outcome = await approveConfig({ ...places, terminal: io.terminal, documents, tellOwner, now: () => new Date() })
  if (outcome.kind === 'refused') return refused(io, outcome.refusal)
  io.out(outcome.kind === 'nothing' ? NOTHING_TO_APPROVE : `Approved: fingerprint ${outcome.fingerprint}.`)
  return EXIT_DONE
}

/**
 * `martha todo` (martha#316): the owner's to-do list, every command in full under what it does, for a crew that never
 * turned the pane on. It reads the crew's rows and writes nothing.
 */
async function todo(io: CommandIo, places: Places): Promise<number> {
  const rows = crewRowsDirectory(places.state.state_root, places.root)
  if ('refusal' in rows) return refused(io, rows.refusal)
  const open = theOpenRows(await rowStreamsDirectory(rows.path).read(OWNER_TODO_STREAM))
  for (const line of theListForTheTerminal(open, Date.now())) io.out(line)
  return EXIT_DONE
}

/** The exit status of a member that ended: its own, or 128 plus the signal that ended it, as a shell reports one. */
function exitOf(stopped: { readonly exit_code: number | null; readonly signal: string | null }): number {
  if (stopped.exit_code !== null) return stopped.exit_code
  const signal = constants.signals[stopped.signal as keyof typeof constants.signals]
  return signal === undefined ? EXIT_REFUSED : 128 + signal
}

async function start(io: CommandIo, places: Places, member: string, args: readonly string[]): Promise<number> {
  const started = await startingTheMember(io, places, member, args)
  if (!started.started) return EXIT_REFUSED
  io.out(startedLine(member, started.pid))
  return exitOf(await started.stopped)
}

/**
 * `martha wake <member>` (martha#255 part 2): the member unparked and started from its newest handover. Every refusal
 * is told to the owner before anything is started, and the member holds the terminal afterwards exactly as `martha
 * start` does, so the two verbs end the same way.
 */
async function wake(io: CommandIo, places: Places, member: string): Promise<number> {
  const crew = crewStateDirectory(places.state.state_root, places.root)
  if ('refusal' in crew) return refused(io, crew.refusal)
  const declaration = await theDeclarationsOf(places)
  if (typeof declaration === 'string') return refused(io, declaration)
  let running: MemberStarted | undefined
  const woken = await wakeAMember(
    { stores: { crew: crewFilesDirectory(crew.path) }, stamps: handoverStampsIn(crew.path) },
    { member, declaration, at: new Date() },
    async (asking) => {
      const started = await startingTheMember(io, places, asking.member, [], asking.prompt)
      running = started
      return started.started ? { started: true } : { started: false, refusal: started.refusal }
    },
  )
  if ('refusal' in woken) return woken.told_by_the_start === true ? EXIT_REFUSED : refused(io, woken.refusal)
  io.out(`${woken.member} woken from ${woken.handover.file}`)
  if (woken.park.kind === 'could_not_be_cleared') tellOwnerOn(io)(`${woken.member} is running, but its park could not be cleared: ${woken.park.refusal}`)
  return running !== undefined && running.started ? exitOf(await running.stopped) : EXIT_DONE
}

/** The declaration as parking and waking read it; or why it could not be read. */
async function theDeclarationsOf(places: Places): Promise<TheDeclaration | string> {
  try {
    const settings = await declareCrew(documents, places.root)
    return { members: settings.members.map((member) => ({ name: member.name, role: member.role })), mode: { may: settings.mode.may } }
  } catch (error) {
    return `the crew's declaration could not be read: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * The member started on this project, its refusal told to the owner in the words the launcher gives: `prompt` is
 * Martha's own, and is added after the owner's arguments rather than passing the switch rule they pass.
 */
async function startingTheMember(
  io: CommandIo,
  places: Places,
  member: string,
  args: readonly string[],
  prompt?: string,
): Promise<MemberStarted> {
  const runtime = absolute(io.env['XDG_RUNTIME_DIR']) ?? '/tmp'
  const launcher = launcherPlacesOf(places.state, join(runtime, `martha-${process.getuid?.()}`), places.root)
  if ('refusal' in launcher) {
    tellOwnerOn(io)(launcher.refusal)
    return { started: false, refusal: launcher.refusal }
  }
  return startMember({
    ...places,
    member,
    args,
    is_terminal: io.terminal.is_terminal,
    places: launcher,
    command: CLAUDE,
    inherited: io.env,
    stdio: io.stdio,
    documents,
    tellOwner: tellOwnerOn(io),
    ...(prompt === undefined ? {} : { initial_prompt: prompt }),
  })
}

/**
 * `martha install`: the installer this release pins, run with the words typed here unchanged (martha#84). It runs
 * before any place is read, so an installed machine with no checkout can still upgrade.
 */
function install(io: CommandIo, args: readonly string[]): number {
  const outcome = installThePinnedInstaller({ args, tree: releaseTree(), env: io.env, stdio: io.stdio })
  return 'refusal' in outcome ? refused(io, outcome.refusal) : outcome.status
}

/** `martha run <shape>`: the launcher's run of a shape the owner signed, its output on stdout as is, its status. */
async function run(io: CommandIo, name: string): Promise<number> {
  const heard = await askTheLauncherToRun(io.env, name)
  if (!heard.ran) return refused(io, heard.why)
  io.outBytes(Buffer.from(heard.output, 'base64'))
  return heard.status
}

/** A file the owner names, read; or why it cannot be. */
async function readNamed(io: CommandIo, path: string): Promise<string | { readonly refusal: string }> {
  try {
    return await readFile(resolve(io.cwd, path), 'utf8')
  } catch (error) {
    return { refusal: `${path} could not be read (${(error as NodeJS.ErrnoException).code ?? String(error)}).` }
  }
}

/** `martha pin-key <file>`: the owner's hardware key, pinned for this project. */
async function pinKey(io: CommandIo, places: Places, path: string): Promise<number> {
  if (!io.terminal.is_terminal) return refused(io, OWNERS_ACT_NEEDS_A_TERMINAL)
  const line = await readNamed(io, path)
  if (typeof line !== 'string') return refused(io, line.refusal)
  const pinned = pinOwnerKey(places.state, line)
  if (pinned !== undefined) return refused(io, pinned.refusal)
  io.out(`Pinned your key for ${places.root}.`)
  return EXIT_DONE
}

/** `martha keep-shapes <file>`: the list the owner signed (the file and the file's .sig), kept when it opens. */
async function keepShapes(io: CommandIo, places: Places, path: string): Promise<number> {
  if (!io.terminal.is_terminal) return refused(io, OWNERS_ACT_NEEDS_A_TERMINAL)
  const document = await readNamed(io, path)
  if (typeof document !== 'string') return refused(io, document.refusal)
  const signature = await readNamed(io, `${path}${SIGNATURE_SUFFIX}`)
  if (typeof signature !== 'string') return refused(io, signature.refusal)
  const kept = keepCommandShapes(places.state, Buffer.from(document, 'utf8'), signature, new Date())
  if (!kept.trusted) return refused(io, kept.why)
  io.out(`Kept epoch ${kept.epoch}: base ${kept.base.branch} of ${kept.base.remote_url}; shapes ${kept.shapes.map((shape) => shape.name).join(', ')}.`)
  return EXIT_DONE
}

/** The act asked for, with its arguments, or undefined when the words are no way the command is used. */
const ACTS_ALONE: readonly string[] = ['init', 'approve', 'todo', '--version']
/** The acts that take exactly one argument (martha#129). */
const ACTS_OF_ONE: readonly string[] = ['run', 'pin-key', 'keep-shapes', 'wake']
/** The switches `martha install` passes through to the installer; any other is no way the command is used. */
const INSTALL_SWITCHES: readonly string[] = ['--downgrade', '-h', '--help']
/** The switch that takes the next word as its value. */
const INSTALL_SWITCH_OF_A_VALUE = '--digest'

type Asked = { readonly act: string; readonly member?: string; readonly args: readonly string[] }

function actOf(argv: readonly string[]): Asked | undefined {
  const [act] = argv
  if (act === undefined) return undefined
  if (ACTS_ALONE.includes(act)) return argv.length === 1 ? { act, args: [] } : undefined
  if (ACTS_OF_ONE.includes(act)) return actOfOne(act, argv)
  if (act === 'install') return installOf(act, argv)
  return act === 'start' ? startOf(act, argv) : undefined
}

/** `install [<version>] [--downgrade] [--digest sha256:<hex>]`: one version at most, and no other switch. */
function installOf(act: string, argv: readonly string[]): Asked | undefined {
  const words = argv.slice(1)
  let hasVersion = false
  for (let at = 0; at < words.length; at++) {
    const word = words[at] ?? ''
    if (word === INSTALL_SWITCH_OF_A_VALUE) at++
    else if (INSTALL_SWITCHES.includes(word)) continue
    else if (word.startsWith('-') || hasVersion) return undefined
    else hasVersion = true
  }
  return { act, args: words }
}

/** `start <member> [-- <claude arguments>]`. */
function startOf(act: string, argv: readonly string[]): Asked | undefined {
  const [, member, separator, ...rest] = argv
  if (member === undefined || member.startsWith('-')) return undefined
  if (separator === undefined) return { act, member, args: [] }
  return separator === '--' ? { act, member, args: rest } : undefined
}

/** An act of one argument: exactly one, and not empty. */
function actOfOne(act: string, argv: readonly string[]): Asked | undefined {
  const argument = argv[1]
  return argv.length === 2 && argument !== undefined && argument !== '' ? { act, args: [argument] } : undefined
}

/**
 * What a terminal would act on rather than show: C0 and C1 controls, DEL, the bidirectional marks (left-to-right,
 * right-to-left, the Arabic letter mark), overrides and isolates, and the line and paragraph separators.
 */
const TERMINAL_CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu

/** `line` with every terminal control written out as an escape, so nothing Martha shows can move, erase or reorder what the owner reads. */
export function shownSafely(line: string): string {
  return line.replace(TERMINAL_CONTROL, (control) => {
    const code = control.codePointAt(0)!
    return code <= 0xff ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`
  })
}

/** The io with every line it shows escaped: a path, a member's name or a kept approval may hold anything. */
const showingSafely = (io: CommandIo): CommandIo => ({
  ...io,
  out: (line) => io.out(shownSafely(line)),
  err: (line) => io.err(shownSafely(line)),
})

/** Runs the command `argv` names; resolves to the status it ends with. */
export async function runMarthaCommand(argv: readonly string[], unescaped: CommandIo): Promise<number> {
  const io = showingSafely(unescaped)
  try {
    return await runAct(argv, io)
  } catch (error) {
    // An error nothing expected still reaches the owner as one escaped line of Martha's, never as Node's own trace.
    return refused(io, error instanceof Error ? error.message : String(error))
  }
}

/** The act `argv` names, run with an io that shows every line safely. */
async function runAct(argv: readonly string[], io: CommandIo): Promise<number> {
  const asked = actOf(argv)
  if (asked === undefined) {
    io.err(USAGE)
    return EXIT_USAGE
  }
  return actOfPlaces(asked, io)
}

/** The acts that need no place: a version, a shape the launcher runs, and an install, which must work with no checkout. */
async function actOfPlaces(asked: Asked, io: CommandIo): Promise<number> {
  if (asked.act === '--version') {
    io.out(version())
    return EXIT_DONE
  }
  if (asked.act === 'run') return run(io, asked.args[0]!)
  if (asked.act === 'install') return install(io, asked.args)
  const places = placesOf(io)
  return typeof places === 'string' ? refused(io, places) : actIn(asked, places, io)
}

/** The acts that work inside a project: the owner's two, and the four that read or start a member. */
async function actIn(asked: Asked, places: Places, io: CommandIo): Promise<number> {
  if (asked.act === 'pin-key') return pinKey(io, places, asked.args[0]!)
  if (asked.act === 'keep-shapes') return keepShapes(io, places, asked.args[0]!)
  if (asked.act === 'init') return init(io, places)
  if (asked.act === 'approve') return approve(io, places)
  if (asked.act === 'todo') return todo(io, places)
  if (asked.act === 'wake') return wake(io, places, asked.args[0]!)
  return start(io, places, asked.member!, asked.args)
}

/** The owner's terminal on this process's standard input; questions are asked on stderr. */
export const terminalOfThisProcess: OwnersTerminal = {
  is_terminal: isatty(0),
  ask: async (question) => {
    const asking = createInterface({ input: process.stdin, output: process.stderr })
    try {
      return await asking.question(question)
    } finally {
      asking.close()
    }
  },
}

/** This process's own io: its working directory, environment, terminal and standard streams. */
export const ioOfThisProcess: CommandIo = {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  terminal: terminalOfThisProcess,
  out: (line) => void process.stdout.write(`${line}\n`),
  outBytes: (bytes) => void process.stdout.write(bytes),
  err: (line) => void process.stderr.write(`${line}\n`),
}
