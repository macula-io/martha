// A signed command, run on a copy of the bytes just verified, in a sandbox (martha#129, design steps 3.3 to 3.6,
// gated: "Yes to all three", question 1).
//
// The run directory holds two folders: `tree`, the checkout's verified files and the installed packages, with
// `node_modules/.bin` rebuilt from the base lock; and `home`, empty but for two empty npm config files. There is
// no `.git`, no ignored file, nothing the check did not read. bubblewrap shows the run only:
//   - `tree` read-write at RUN_TREE, its working directory; `home` read-write at RUN_HOME;
//   - an empty /tmp, a fresh /proc and /dev;
//   - the toolchain read-only: the install of the node running the launcher (its npm included, an nvm install
//     too), and the system directories the loader and /bin/sh need (SYSTEM_DIRECTORIES). A system directory
//     this user can write is refused, so the sandbox is never built on one;
//   - no network, and no other namespace shared. `..` above RUN_TREE is the sandbox root, which holds nothing else.
// The environment is built from nothing: HOME, PATH (the node install's bin, then /usr/bin and /bin), and npm's
// settings that keep it to the run (empty user and global config, its cache in the run's home, scripts off, /bin/sh
// as the script shell). No variable of the launcher's reaches the run, so no token does.
//
// stdout and stderr share ONE pipe, so the bytes keep the order the run wrote them in: the argv runs under a fixed
// `/bin/sh -c 'exec "$@" 2>&1'`, which passes the signed argv on as arguments and parses none of it. A run that
// outlasts RUN_DEADLINE_MS is killed, and its status is then not one the result shape records.

import { spawn, spawnSync } from 'node:child_process'
import { accessSync, chmodSync, constants as fs, type Stats, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { constants as os } from 'node:os'
import { dirname, join } from 'node:path'

import type { BinLink } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import { OWN_WRITE_MODES } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import type { PackageFile } from './read_the_checkout_once.ts'

/** Where the run sees its copy of the tree, and its home. */
export const RUN_TREE = '/work'
export const RUN_HOME = '/home'
/** The system directories the sandbox shows, read-only. */
export const SYSTEM_DIRECTORIES = ['/usr', '/lib', '/lib64', '/bin'] as const
/** How long a run may take before it is killed. */
export const RUN_DEADLINE_MS = 30 * 60 * 1000
/** The sandbox the run goes through. */
export const SANDBOX = 'bwrap'
const SHELL = '/bin/sh'
const MERGE_STDERR_INTO_STDOUT = 'exec "$@" 2>&1'
const EMPTY_NPM_CONFIG = '.npmrc'
/** npm refuses one file as both its user and its global config, so the global one is a second empty file. */
const EMPTY_NPM_GLOBAL_CONFIG = '.npmrc-global'
const NPM_CACHE = '.npm'
const [, EXECUTABLE_MODE] = OWN_WRITE_MODES
const FILE_MODE = 0o644
const EXECUTABLE_FILE_MODE = 0o755

/** One file of the verified tree to write: its path, its git mode, and the bytes read. */
export interface FileToWrite {
  readonly path: string
  readonly mode: string
  readonly bytes: Buffer
}

/** What the run directory is built from. */
export interface RunCopy {
  readonly files: readonly FileToWrite[]
  readonly packages: readonly PackageFile[]
  readonly bin_links: readonly BinLink[]
}

/** How a run ended: its merged output, and its status as a shell reports one. */
export interface RunEnded {
  readonly output: Buffer
  readonly status: number
}

/** A run directory: tree and home, written from the verified bytes; or why a .bin link cannot point at a copied file. */
export function buildTheRunDirectory(parent: string, copy: RunCopy): { readonly root: string; readonly tree: string; readonly home: string } | string {
  const root = mkdtempSync(join(parent, 'run-'))
  const tree = join(root, 'tree')
  const home = join(root, 'home')
  mkdirSync(tree, { mode: 0o700 })
  mkdirSync(join(home, NPM_CACHE), { recursive: true, mode: 0o700 })
  writeFileSync(join(home, EMPTY_NPM_CONFIG), '')
  writeFileSync(join(home, EMPTY_NPM_GLOBAL_CONFIG), '')
  for (const file of copy.files) writeInto(tree, file.path, file.bytes, file.mode === EXECUTABLE_MODE)
  for (const file of copy.packages) writeInto(tree, file.path, file.bytes, file.executable)
  const copied = new Set(copy.packages.map((file) => file.path))
  const unlinked = copy.bin_links.find((link) => !copied.has(link.target))
  if (unlinked !== undefined) {
    rmSync(root, { recursive: true, force: true })
    return `${unlinked.link} would point at ${unlinked.target}, which is not a file of its package`
  }
  for (const link of copy.bin_links) linkBin(tree, link)
  return { root, tree, home }
}

function writeInto(tree: string, path: string, bytes: Buffer, executable: boolean): void {
  mkdirSync(dirname(join(tree, path)), { recursive: true })
  writeFileSync(join(tree, path), bytes, { mode: executable ? EXECUTABLE_FILE_MODE : FILE_MODE })
}

/** A .bin link, relative, pointing inside its package; its target made executable, as npm does. */
function linkBin(tree: string, link: BinLink): void {
  mkdirSync(dirname(join(tree, link.link)), { recursive: true })
  symlinkSync(link.points_at, join(tree, link.link))
  chmodSync(join(tree, link.target), EXECUTABLE_FILE_MODE)
}

/** The node install the launcher runs on: the folder above its bin. */
export function nodeInstall(): { readonly root: string; readonly bin: string } {
  const bin = dirname(realpathSync(process.execPath))
  return { root: dirname(bin), bin }
}

/** Whether this user may write `path`. */
function writableByThisUser(path: string): boolean {
  try {
    accessSync(path, fs.W_OK)
    return true
  } catch {
    return false
  }
}

/** bubblewrap's arguments for the system directories: a bind for a directory, the same link for a link. */
function systemBinds(): readonly string[] | string {
  const binds: string[] = []
  for (const directory of SYSTEM_DIRECTORIES) {
    const status = lstatOrMissing(directory)
    if (status === undefined) continue
    if (status.isSymbolicLink()) binds.push('--symlink', readlinkSync(directory), directory)
    else if (writableByThisUser(directory)) return `${directory} can be written by this user, so no sandbox is built on it`
    else binds.push('--ro-bind', directory, directory)
  }
  return binds
}

function lstatOrMissing(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

/** Whether a sandbox can be built here at all; why not otherwise. */
export function sandboxRefusal(): string | undefined {
  const tried = spawnSync(SANDBOX, ['--unshare-all', '--ro-bind', '/', '/', 'true'], { stdio: 'ignore' })
  return tried.status === 0 ? undefined : `${SANDBOX} cannot build a sandbox here (unprivileged user namespaces may be off), so no listed command keeps the shell`
}

/** bubblewrap's whole argument list for one run. */
export function sandboxArguments(run: { readonly tree: string; readonly home: string }, argv: readonly string[]): readonly string[] | string {
  const system = systemBinds()
  if (typeof system === 'string') return system
  const node = nodeInstall()
  const env = {
    HOME: RUN_HOME,
    PATH: `${node.bin}:/usr/bin:/bin`,
    npm_config_userconfig: join(RUN_HOME, EMPTY_NPM_CONFIG),
    npm_config_globalconfig: join(RUN_HOME, EMPTY_NPM_GLOBAL_CONFIG),
    npm_config_cache: join(RUN_HOME, NPM_CACHE),
    npm_config_ignore_scripts: 'true',
    npm_config_script_shell: SHELL,
    npm_config_update_notifier: 'false',
  }
  return [
    '--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
    ...system,
    '--ro-bind-try', node.root, node.root,
    '--bind', run.tree, RUN_TREE,
    '--bind', run.home, RUN_HOME,
    '--tmpfs', '/tmp', '--proc', '/proc', '--dev', '/dev',
    '--chdir', RUN_TREE,
    ...Object.entries(env).flatMap(([name, value]) => ['--setenv', name, value]),
    '--', SHELL, '-c', MERGE_STDERR_INTO_STDOUT, SHELL, ...argv,
  ]
}

/** Run `argv` in the sandbox over the run directory: the merged output and the status. */
export function runInTheSandbox(run: { readonly tree: string; readonly home: string }, argv: readonly string[], deadline_ms = RUN_DEADLINE_MS): Promise<RunEnded | string> {
  const args = sandboxArguments(run, argv)
  if (typeof args === 'string') return Promise.resolve(args)
  return new Promise((resolve) => {
    const child = spawn(SANDBOX, args, { stdio: ['ignore', 'pipe', 'ignore'], env: {} })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), deadline_ms)
    child.once('error', (error) => {
      clearTimeout(timer)
      resolve(`${SANDBOX} could not start (${error.message})`)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      const number = signal === null ? undefined : os.signals[signal]
      resolve({ output: Buffer.concat(chunks), status: code ?? 128 + (number ?? 0) })
    })
  })
}
