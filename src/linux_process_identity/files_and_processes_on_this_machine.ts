// The files on this machine's disk, scratch directories on it, and processes run
// now: the host contract's `stores.files`, `stores.scratch` and
// `processes.runNow` (martha#16's launch gate, ported behind the contract in
// martha#26). Host-neutral host glue: Node on a POSIX machine, not a coding
// tool's, so every host adapter on such a machine composes this one.
//
// Nothing here decides anything. Which files to read, what a fingerprint covers
// and which variables git must not inherit are the launch gate's
// (src/refuse_launch_of_unapproved_config/); this file only does what it is told,
// and refuses a scratch prefix or name that would leave its directory.

import { spawn, spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { env } from 'node:process'

import type {
  EnvironmentChange,
  FileKind,
  FileTree,
  Processes,
  ScratchDirectories,
  ScratchDirectory,
} from '../host_contract/host_contract.ts'
import { OWNER_EXECUTES } from '../host_contract/host_contract.ts'
import { linuxProcessIdentities } from './process_identity_from_proc.ts'

/** The files on this machine's disk, read as they are. */
export const filesOnThisMachine: FileTree = {
  kindOf(path): FileKind {
    try {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) return { kind: 'symlink', target: readlinkSync(path) }
      if (stat.isDirectory()) return { kind: 'directory' }
      return stat.isFile() ? { kind: 'file', ownerExecutes: (stat.mode & OWNER_EXECUTES) !== 0 } : { kind: 'other' }
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return { kind: 'absent' }
      throw error
    }
  },
  bytesOf: (path) => readFileSync(path),
  childrenOf: (path) => readdirSync(path),
  realPathOf(path) {
    try {
      return realpathSync(path)
    } catch {
      return null
    }
  },
}

/** Scratch directories on this machine's disk. */
export const scratchOnThisMachine: ScratchDirectories = {
  make(root, prefix): ScratchDirectory {
    if (prefix === '' || prefix === '.' || prefix === '..' || prefix.includes('/') || prefix.includes(sep)) {
      throw Object.assign(new Error(`${prefix} is not one name to start a directory under ${root ?? tmpdir()}`), { code: 'EINVAL' })
    }
    const under = root ?? tmpdir()
    mkdirSync(under, { recursive: true })
    const path = mkdtempSync(join(under, prefix))
    return {
      path,
      write(name, bytes) {
        const target = join(path, name)
        const inside = relative(path, target)
        if (isAbsolute(name) || inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
          throw Object.assign(new Error(`${name} is not a name inside ${path}`), { code: 'EINVAL' })
        }
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, bytes)
        return target
      },
      remove: () => rmSync(path, { recursive: true, force: true }),
    }
  },
}

/** The host's own environment, changed as asked. */
export function environmentWith(change: EnvironmentChange | undefined): Record<string, string> {
  const kept = Object.entries(env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !(change?.drop_prefixes ?? []).some((prefix) => entry[0].startsWith(prefix)),
  )
  return { ...Object.fromEntries(kept), ...(change?.set ?? {}) }
}

/** Processes run now on this machine, waited for. */
export const runNowOnThisMachine: Processes['runNow'] = ({ command, args, cwd, environment, input }) => {
  const run = spawnSync(command, [...args], { cwd, encoding: 'utf8', env: environmentWith(environment), input })
  return { exit_code: run.error === undefined ? run.status : null, stdout: run.stdout ?? '', stderr: run.stderr ?? '' }
}

function codeOf(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

/**
 * Runs a process on this machine, waited for by a promise, with no shell: the async half of the two above
 * (martha#256). Two places need it -- the coding tool's adapter, which runs the tools a member calls, and the
 * launcher, whose crew tools read a range, land a batch and move a worktree without asking the member's session
 * to act -- so it is one answer here rather than a second implementation beside each.
 */
export const runAProcessOnThisMachine: Processes['run'] = (request) =>
  new Promise((resolve, reject) => {
    const child = spawn(request.command, [...request.args], { cwd: request.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => void stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => void stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) =>
      resolve({
        exit_code: signal === null ? code : null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    )
  })

/** This machine's files, scratch directories and processes, shaped as the host contract holds them. */
export const thisMachine = {
  stores: { files: filesOnThisMachine, scratch: scratchOnThisMachine },
  processes: {
    run: runAProcessOnThisMachine,
    runNow: runNowOnThisMachine,
    identityOf: (pid: number) => linuxProcessIdentities.identityOf(pid),
  } satisfies Processes,
} as const
