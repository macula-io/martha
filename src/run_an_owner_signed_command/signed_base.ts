// The base a signed command is judged against (martha#129, design step 5): the branch the owner signed, fetched
// from the remote the owner signed, into a bare repository the launcher owns.
//
// This exists so no ref a clean command moves can move the base. `gh repo fork --remote` re-points `origin`,
// `git remote set-head` moves `origin/HEAD`, and a checkout's `url.*.insteadOf` rewrites a URL; none of them is
// read here. The launcher never reads the checkout's `.git` for the base: it fetches the signed branch from the
// signed URL into `refs/martha/base` of its own repository in Martha's state directory, with git's global and
// system config off, every inherited GIT_ variable dropped, and only the protocols the list allows. When the
// fetch fails (offline), the commit it last fetched itself is the base; with none, there is no base.
//
// The repository is made with the checkout's object format, so the ids `ls-tree` prints compare with the blob ids
// git gives the checkout's own files (../read_the_checkout_once).

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { GIT_OBJECT_FORMATS, type GitObjectFormat } from '../hash_a_file_under_a_tree/hash_a_file_under_a_tree.ts'
import type { SignedBase } from '../keep_the_shell_for_an_owner_signed_command/command_shapes.ts'
import type { BaseEntry } from '../keep_the_shell_for_an_owner_signed_command/whose_tree.ts'
import { stateSubdirectory, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** The launcher's own repository of the signed base, inside the project's state directory. */
export const SIGNED_BASE_REPOSITORY = 'signed_base.git'
/** The ref the signed branch is fetched into: the launcher's, never a remote-tracking ref. */
export const BASE_REF = 'refs/martha/base'
/** The protocols git may use to fetch the base: the ones the signed list may name. */
export const BASE_PROTOCOLS = 'https:ssh:file'
/** The inherited variables a fetch keeps: where git and ssh are, the home ssh reads its keys from, and the agent. */
const FETCH_KEEPS = ['PATH', 'HOME', 'SSH_AUTH_SOCK'] as const
const NULL_CONFIG = '/dev/null'
const RECORD = '\u0000'
const FIELDS = /^(\d{6}) (\w+) ([0-9a-f]+)\t/

/** The signed base, opened: its commit, every entry of its tree, and a way to read a blob's bytes. */
export interface OpenedBase {
  readonly commit: string
  readonly fetched: boolean
  /** The launcher's own repository of the base: where a file is hashed under the base's attributes (#129, #167). */
  readonly repository: string
  /** The object format this repository and the checkout name their objects in. */
  readonly format: GitObjectFormat
  readonly entries: readonly BaseEntry[]
  blob(id: string): Buffer | undefined
}

interface Git {
  (args: readonly string[], input?: Buffer): { readonly ok: boolean; readonly out: Buffer; readonly err: string }
}

/** git with nothing of the caller's but FETCH_KEEPS: no global or system config, no GIT_ variable, no prompt. */
function gitIn(repository: string, inherited: Readonly<Record<string, string | undefined>>, also: Readonly<Record<string, string>> = {}): Git {
  return gitWith(['--git-dir', repository], inherited, also)
}

function gitWith(where: readonly string[], inherited: Readonly<Record<string, string | undefined>>, also: Readonly<Record<string, string>> = {}): Git {
  const kept = Object.fromEntries(FETCH_KEEPS.flatMap((name) => (inherited[name] === undefined ? [] : [[name, inherited[name]!]])))
  const env = { ...kept, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_CONFIG, GIT_ALLOW_PROTOCOL: BASE_PROTOCOLS, GIT_TERMINAL_PROMPT: '0', ...also }
  return (args, input) => {
    const run = spawnSync('git', [...where, '-c', 'core.fsmonitor=false', ...args], { env, input, maxBuffer: Number.MAX_SAFE_INTEGER })
    return { ok: run.status === 0, out: run.stdout ?? Buffer.alloc(0), err: run.stderr?.toString('utf8').trim() ?? String(run.error) }
  }
}

/** The checkout's object format, as git names it, or why it cannot be read. */
function objectFormatOf(checkout: string, inherited: Readonly<Record<string, string | undefined>>): GitObjectFormat | string {
  const said = gitWith(['-C', checkout], inherited)(['rev-parse', '--show-object-format']).out.toString('utf8').trim()
  return GIT_OBJECT_FORMATS.find((format) => format === said) ?? `the checkout's object format cannot be read (${said})`
}

/** The launcher's repository of the base, made with `format` when missing; or why it cannot be used. */
function baseRepository(state: MarthaState, format: GitObjectFormat, inherited: Readonly<Record<string, string | undefined>>): { readonly git: Git; readonly path: string } | string {
  const place = stateSubdirectory(state, SIGNED_BASE_REPOSITORY)
  if ('refusal' in place) return place.refusal
  const git = gitIn(place.path, inherited)
  if (!existsSync(join(place.path, 'HEAD'))) {
    const made = git(['init', '--quiet', '--bare', `--object-format=${format}`, place.path])
    if (!made.ok) return `the base repository cannot be made (${made.err})`
  }
  const has = git(['rev-parse', '--show-object-format']).out.toString('utf8').trim()
  return has === format ? { git, path: place.path } : `the base repository holds ${has} objects and the checkout ${format}`
}

const isObjectFormat = (value: string): value is GitObjectFormat => GIT_OBJECT_FORMATS.some((format) => format === value)

/** Fetch the signed branch into BASE_REF and open it; the last fetched base when the fetch fails. */
export function openSignedBase(state: MarthaState, checkout: string, base: SignedBase, inherited: Readonly<Record<string, string | undefined>>): OpenedBase | string {
  const format = objectFormatOf(checkout, inherited)
  if (!isObjectFormat(format)) return format
  const repository = baseRepository(state, format, inherited)
  if (typeof repository === 'string') return repository
  const { git, path: repositoryPath } = repository
  const fetched = git(['fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--', base.remote_url, `+refs/heads/${base.branch}:${BASE_REF}`])
  const commit = git(['rev-parse', '--verify', '--quiet', `${BASE_REF}^{commit}`])
  if (!commit.ok) return `the signed branch ${base.branch} could not be fetched and none was fetched before (${fetched.err})`
  const listed = git(['ls-tree', '-r', '-z', '--full-tree', BASE_REF])
  if (!listed.ok) return `the base tree cannot be listed (${listed.err})`
  const head = commit.out.toString('utf8').trim()
  return {
    commit: head,
    fetched: fetched.ok,
    repository: repositoryPath,
    format,
    entries: entriesOf(listed.out),
    blob: (id) => {
      const read = git(['cat-file', 'blob', id])
      return read.ok ? read.out : undefined
    },
  }
}

/** Every entry `ls-tree -r -z` lists: mode, id and path. */
function entriesOf(listing: Buffer): readonly BaseEntry[] {
  return listing
    .toString('utf8')
    .split(RECORD)
    .filter((record) => record !== '')
    .flatMap((record) => {
      const fields = FIELDS.exec(record)
      return fields === null ? [] : [{ mode: fields[1]!, blob: fields[3]!, path: record.slice(fields[0].length) }]
    })
}
