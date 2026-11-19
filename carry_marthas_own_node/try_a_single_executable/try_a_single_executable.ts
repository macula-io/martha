// Run: <the pinned node> carry_marthas_own_node/try_a_single_executable/try_a_single_executable.ts <work-dir>
//
// The single-executable trial of martha#547, package S3: why a standalone Martha carries a pinned Node beside its tree
// instead of being one Node single-executable application. Run with the pinned Node (prove_a_standalone_martha's
// release carries it), it builds a single executable from that Node, as Node 24's documentation does it (a blob from
// --experimental-sea-config, written into a copy of node by postject, from this folder's lock), and holds it to the
// two things Martha's run time asks of process.execPath:
//   - npm beside node: Martha runs the npm at npmBesideNode(process.execPath);
//   - a start with --import: Martha starts the mesh server as `<process.execPath> --import <hook> <file>`.
//
// Exit 0: the single executable fails at least one of them, so the pinned Node stays (each failure is printed).
// Exit 1: it passes both, so the reason for the pinned Node is gone and the choice is to be made again.
// Exit 2: no single executable could be built or run, which proves nothing either way.

import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { npmBesideNode } from '../../src/run_the_nodes_own_npm_alone/run_the_nodes_own_npm_alone.ts'

const POSTJECT = fileURLToPath(new URL('./node_modules/postject/dist/cli.js', import.meta.url))

/** The variable the probe's main answers to: a file it writes `RERAN` into, so a start that ran it again is seen. */
const PROBE_MARK = 'MARTHA_SEA_PROBE_MARK'
const RERAN = 'the single executable ran its own main'
const HOOKED = 'the module imported first ran'

/** The resource Node looks for its blob in, and the fuse it flips; the fuse is read from the binary. */
const BLOB_RESOURCE = 'NODE_SEA_BLOB'

class CouldNotTry extends Error {}

function ran(command: string, args: readonly string[], env?: NodeJS.ProcessEnv): string {
  const run = spawnSync(command, args, { encoding: 'utf8', env })
  if (run.status !== 0) throw new CouldNotTry(`${command} ${args.join(' ')} ended ${String(run.status)}: ${(run.stderr || run.error?.message || '').trim()}`)
  return run.stdout
}

/** The sentinel fuse this node was built with, as it appears in its own bytes. */
function fuseOf(node: string): string {
  const fuse = /NODE_SEA_FUSE_[0-9a-f]{32}/.exec(readFileSync(node).toString('latin1'))
  if (fuse === null) throw new CouldNotTry(`${node} carries no single-executable fuse`)
  return fuse[0]
}

/** A single executable of this node, whose main writes RERAN into $PROBE_MARK when it is set. */
function buildTheSingleExecutable(dir: string): string {
  const main = join(dir, 'probe.cjs')
  writeFileSync(main, `const mark = process.env.${PROBE_MARK}\nif (mark) require('node:fs').writeFileSync(mark, ${JSON.stringify(RERAN)})\n`)
  const blob = join(dir, 'probe.blob')
  writeFileSync(join(dir, 'sea-config.json'), JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true }))
  ran(process.execPath, ['--experimental-sea-config', join(dir, 'sea-config.json')])
  const sea = join(dir, 'bin', 'martha-sea')
  mkdirSync(join(dir, 'bin'))
  copyFileSync(process.execPath, sea)
  chmodSync(sea, 0o755)
  ran(process.execPath, [POSTJECT, sea, BLOB_RESOURCE, blob, '--sentinel-fuse', fuseOf(process.execPath)])
  return sea
}

/** What the single executable does with a start Martha makes: run the file with the module first, or itself again. */
function aStartWithImport(sea: string, dir: string): string {
  const [hook, file, mark, reran] = ['hook.mjs', 'run.mjs', 'mark', 'reran'].map((name) => join(dir, name)) as [string, string, string, string]
  writeFileSync(hook, `globalThis.MARTHA_HOOKED = ${JSON.stringify(HOOKED)}\n`)
  writeFileSync(file, "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[2], String(globalThis.MARTHA_HOOKED))\n")
  // '--import' is Node's own flag, the one the mesh server's confined start passes (install_the_recorded_mesh_server).
  spawnSync(sea, ['--import', pathToFileURL(hook).href, file, mark], { env: { ...process.env, [PROBE_MARK]: reran } })
  if (existsSync(mark)) return readFileSync(mark, 'utf8')
  return existsSync(reran) ? readFileSync(reran, 'utf8') : 'nothing ran'
}

function trial(dir: string): number {
  const sea = buildTheSingleExecutable(dir)
  // The probe must be seen to be the single executable's own main, or a failure below could be any broken binary.
  const itself = join(dir, 'itself')
  ran(sea, [], { ...process.env, [PROBE_MARK]: itself })
  if (!existsSync(itself) || readFileSync(itself, 'utf8') !== RERAN) throw new CouldNotTry(`${sea} did not run its own main`)
  const failures: string[] = []
  if (!existsSync(npmBesideNode(sea))) failures.push(`npm beside node: there is no ${npmBesideNode(sea)}`)
  const started = aStartWithImport(sea, dir)
  if (started !== HOOKED) failures.push(`a start with --import: ${started}, not the file Martha asked for`)
  for (const failure of failures) console.log(`FAILS ${failure}`)
  console.log(`try_a_single_executable: Node ${process.version} ${process.platform}-${process.arch} single executable fails ${failures.length} of 2`)
  return failures.length > 0 ? 0 : 1
}

function main(dir: string | undefined): number {
  if (dir === undefined || existsSync(dir)) {
    console.error('usage: try_a_single_executable.ts <a work directory that does not exist yet>')
    return 2
  }
  mkdirSync(dir, { recursive: true })
  try {
    return trial(dir)
  } catch (error) {
    if (!(error instanceof CouldNotTry)) throw error
    console.error(`try_a_single_executable: could not try: ${error.message}`)
    return 2
  }
}

process.exitCode = main(process.argv[2])
