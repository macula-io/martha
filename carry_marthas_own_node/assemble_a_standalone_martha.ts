// Run: node carry_marthas_own_node/assemble_a_standalone_martha.ts <out-dir>
//
// Lays out the standalone Martha of this machine's platform (martha#547, package S3) from the committed tree at
// HEAD and nothing else, and packs it as <out-dir>/<command>-<version>-<platform>.tar.gz. The release folder holds:
//
//   <releaseFolder>/   git archive of HEAD, exactly what a release image packs (pack_a_release.sh)
//   node/              the pinned Node of ./the_node_runtime.json, its archive checked against nodejs.org's sha256
//   bin/<command>      the command: Martha's own bin/martha, run by that Node, whatever node the machine has
//
// The command and the release folder are named once, in installer/package.json; the version is the root
// package.json's at HEAD. Signing and the install channel are later packages (S4, S5): this writes nothing outside
// <out-dir>, which must not exist yet. Exit 0 assembled, 1 refused (no build for this platform, a hash that is not
// the pin's), 2 it could not be assembled.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { archiveOf, platformOf, theNodeRuntime, urlOf, type NodeRuntime, type Platform } from './the_node_runtime.ts'

/** The folder of a standalone release that holds its Node. */
export const RUNTIME_FOLDER = 'node'

/** The folder of a standalone release that holds its command. */
export const COMMAND_FOLDER = 'bin'

// The checkout this file is part of: git archive packs the tree of the directory it runs in, so it runs at the top.
const CHECKOUT = join(dirname(fileURLToPath(import.meta.url)), '..')

class Refused extends Error {
  readonly why: string
  readonly exit: number
  constructor(why: string, exit: number) {
    super(why)
    this.why = why
    this.exit = exit
  }
}

/** git in the checkout this file is part of; its stdout, or a refusal naming what it said. */
function git(args: readonly string[], input?: Buffer): Buffer {
  const run = spawnSync('git', ['-C', CHECKOUT, ...args], { input, maxBuffer: 1 << 30 })
  if (run.status !== 0) throw new Refused(`git ${args[0] ?? ''} failed: ${run.stderr?.toString().trim() ?? run.error?.message}`, 2)
  return run.stdout
}

function run(command: string, args: readonly string[], input?: Buffer): void {
  const ran = spawnSync(command, args, { input, maxBuffer: 1 << 30 })
  if (ran.status !== 0) throw new Refused(`${command} ${args.join(' ')} failed: ${ran.stderr?.toString().trim() ?? ran.error?.message}`, 2)
}

/** What names a release: the command and the release folder (installer/package.json), and the version (package.json). */
export function namesAtHead(show: (path: string) => string): { readonly command: string; readonly folder: string; readonly version: string } {
  const names = (JSON.parse(show('installer/package.json')) as { martha?: { command?: string; releaseFolder?: string } }).martha
  const version = (JSON.parse(show('package.json')) as { version?: string }).version
  if (names?.command === undefined || names.releaseFolder === undefined || version === undefined) throw new Refused('installer/package.json names no command or releaseFolder, or package.json no version', 2)
  return { command: names.command, folder: names.releaseFolder, version }
}

/**
 * The command a standalone release puts in bin/: it follows its own links (an install links it from a bin directory
 * on PATH), finds the release folder above them, and runs Martha's bin/martha with the Node beside it.
 */
export function theCommand(folder: string): string {
  return [
    '#!/bin/sh',
    '# The command of a standalone Martha (martha#547): Martha\'s own bin/martha, run by the Node this release carries.',
    'set -eu',
    'self=$0',
    'while [ -L "$self" ]; do',
    '  link=$(readlink "$self")',
    '  case $link in /*) self=$link ;; *) self=$(dirname "$self")/$link ;; esac',
    'done',
    '# CDPATH is emptied: with it set, cd prints the directory it found, and $release would hold that line twice.',
    'release=$(CDPATH= cd -P -- "$(dirname "$self")/.." && pwd -P)',
    `exec "$release/${RUNTIME_FOLDER}/bin/node" "$release/${folder}/bin/martha" "$@"`,
    '',
  ].join('\n')
}

/** The pinned Node's archive for `platform`, fetched into `dir` and held to the pin's sha256. */
async function fetchThePinnedNode(runtime: NodeRuntime, platform: Platform, dir: string): Promise<{ readonly archive: string; readonly folder: string }> {
  const { file, folder } = archiveOf(runtime.version, platform)
  const answer = await fetch(urlOf(runtime.version, file))
  if (!answer.ok) throw new Refused(`${urlOf(runtime.version, file)} answered ${answer.status}`, 2)
  const bytes = Buffer.from(await answer.arrayBuffer())
  const got = createHash('sha256').update(bytes).digest('hex')
  if (got !== runtime.archives[platform].sha256) throw new Refused(`${file} has sha256 ${got}, not the pinned ${runtime.archives[platform].sha256}`, 1)
  const archive = join(dir, file)
  writeFileSync(archive, bytes)
  return { archive, folder }
}

async function assemble(out: string): Promise<string> {
  if (existsSync(out)) throw new Refused(`${out} already exists; give a directory that does not exist yet`, 2)
  const platform = platformOf()
  if (typeof platform !== 'string') throw new Refused(platform.refusal, 1)
  const runtime = theNodeRuntime()
  if ('refusal' in runtime) throw new Refused(runtime.refusal, 2)
  const names = namesAtHead((path) => git(['show', `HEAD:${path}`]).toString('utf8'))
  const name = `${names.command}-${names.version}-${platform}`
  const release = join(out, name)
  mkdirSync(join(release, COMMAND_FOLDER), { recursive: true })
  const node = await fetchThePinnedNode(runtime, platform, out)
  run('tar', ['-xJf', node.archive, '-C', release])
  renameSync(join(release, node.folder), join(release, RUNTIME_FOLDER))
  run('tar', ['-x', '-C', release], git(['archive', '--format=tar', `--prefix=${names.folder}/`, 'HEAD']))
  const command = join(release, COMMAND_FOLDER, names.command)
  writeFileSync(command, theCommand(names.folder))
  chmodSync(command, 0o755)
  const packed = join(out, `${name}.tar.gz`)
  run('tar', ['-czf', packed, '-C', out, name])
  return packed
}

async function main(out: string | undefined): Promise<number> {
  if (out === undefined) {
    console.error('usage: node carry_marthas_own_node/assemble_a_standalone_martha.ts <out-dir>')
    return 2
  }
  try {
    console.log(await assemble(out))
    return 0
  } catch (error) {
    if (!(error instanceof Refused)) throw error
    console.error(`assemble_a_standalone_martha: ${error.why}`)
    return error.exit
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv[2])
