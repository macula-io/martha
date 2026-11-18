// Run: <release>/node/bin/node <release>/<releaseFolder>/carry_marthas_own_node/checks_martha_relies_on.ts
//
// The things Martha's run time asks of the Node under it (martha#547, package S3), each checked on the Node that runs
// this file, through Martha's own code where Martha has it:
//   - file sync: a file written whole through a temporary name, fsynced and renamed into place
//     (keepTheCrewsFilesAsDirectories, as every crew file is kept);
//   - child process groups: a detached child leads a group of its own, and killing the group ends what it started
//     (how a launch and the relay probe are ended);
//   - Unix sockets: an HTTP request answered over a socket at a path no longer than Martha allows (the relay);
//   - npm beside node: the npm Martha runs, found where Martha looks for it (npmBesideNode), runs;
//   - a start with --import: process.execPath runs a file with a module imported first (the mesh server's confined
//     start).
//
// prove_a_standalone_martha.sh runs this with the release's own Node. Prints one line per check, `ok <check>` or
// `FAILS <check>: <why>`. Exit 0 all hold, 1 one fails.

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { keepTheCrewsFilesAsDirectories } from '../src/keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { npmBesideNode } from '../src/run_the_nodes_own_npm_alone/run_the_nodes_own_npm_alone.ts'
import { longestSocketPath } from '../src/serve_the_relay_to_a_launch/relay_directory.ts'

type Check = (dir: string) => Promise<string | undefined>

const GROUP_GONE_WITHIN_MS = 10_000

async function fileSync(dir: string): Promise<string | undefined> {
  const place = keepTheCrewsFilesAsDirectories(dir).place('kept')
  if ('refusal' in place) return place.refusal
  const text = '{"kept":1}\n'
  const refused = place.keep('kept.json', text)
  if (refused !== undefined) return refused.refusal
  return readFileSync(join(place.path, 'kept.json'), 'utf8') === text ? undefined : 'the file read back is not the bytes written'
}

/** Whether any process is left in the group `group`. */
function groupAlive(group: number): boolean {
  try {
    process.kill(-group, 0)
    return true
  } catch {
    return false
  }
}

async function childProcessGroups(): Promise<string | undefined> {
  const leader = spawn('/bin/sh', ['-c', 'sleep 600 & sleep 600 & wait'], { detached: true, stdio: 'ignore' })
  const ended = new Promise((resolve) => leader.once('exit', resolve))
  if (leader.pid === undefined) return 'the detached child was not started'
  await sleep(200)
  process.kill(-leader.pid, 'SIGKILL')
  await ended
  for (const deadline = Date.now() + GROUP_GONE_WITHIN_MS; Date.now() < deadline; await sleep(50)) {
    if (!groupAlive(leader.pid)) return undefined
  }
  return `the group of ${leader.pid} still runs ${GROUP_GONE_WITHIN_MS} ms after it was killed`
}

async function unixSockets(dir: string): Promise<string | undefined> {
  const socket = join(dir, 'relay.sock')
  if (Buffer.byteLength(socket) > longestSocketPath()) return `${socket} is longer than a socket address holds`
  const server = createServer((_asked, answer) => answer.end('answered'))
  await new Promise<void>((resolve) => server.listen(socket, resolve))
  try {
    const body = await new Promise<string>((resolve, reject) => {
      request({ socketPath: socket, path: '/' }, (answer) => {
        let text = ''
        answer.on('data', (chunk: Buffer) => (text += chunk.toString()))
        answer.on('end', () => resolve(text))
      }).on('error', reject).end()
    })
    return body === 'answered' ? undefined : `the socket answered ${JSON.stringify(body)}`
  } finally {
    server.close()
  }
}

async function npmBesideTheNode(): Promise<string | undefined> {
  const ran = spawnSync(process.execPath, [npmBesideNode(), '--version'], { encoding: 'utf8' })
  return ran.status === 0 ? undefined : `${npmBesideNode()} did not run: ${(ran.stderr || ran.error?.message || String(ran.status)).trim()}`
}

async function aStartWithImport(dir: string): Promise<string | undefined> {
  const [hook, file, mark] = ['hook.mjs', 'run.mjs', 'mark'].map((name) => join(dir, name)) as [string, string, string]
  writeFileSync(hook, 'globalThis.MARTHA_HOOKED = "hooked"\n')
  writeFileSync(file, "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[2], String(globalThis.MARTHA_HOOKED))\n")
  // '--import' is Node's own flag, the one the mesh server's confined start passes (install_the_recorded_mesh_server).
  const ran = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, file, mark], { encoding: 'utf8' })
  if (ran.status !== 0) return `the start ended ${String(ran.status)}: ${ran.stderr.trim()}`
  const got = readFileSync(mark, 'utf8')
  return got === 'hooked' ? undefined : `the file ran without the module imported first (it saw ${got})`
}

const CHECKS: Readonly<Record<string, Check>> = {
  'file sync': fileSync,
  'child process groups': childProcessGroups,
  'Unix sockets': unixSockets,
  'npm beside node': npmBesideTheNode,
  'a start with --import': aStartWithImport,
}

async function main(): Promise<number> {
  let failed = 0
  for (const [name, check] of Object.entries(CHECKS)) {
    const dir = mkdtempSync(join(tmpdir(), 'martha-check-'))
    const why = await check(dir).catch((error: unknown) => (error instanceof Error ? error.message : String(error))).finally(() => rmSync(dir, { recursive: true, force: true }))
    console.log(why === undefined ? `ok ${name}` : `FAILS ${name}: ${why}`)
    failed += why === undefined ? 0 : 1
  }
  console.log(`checks_martha_relies_on: ${Object.keys(CHECKS).length - failed} of ${Object.keys(CHECKS).length} hold on Node ${process.version}, ${process.platform}-${process.arch}`)
  return failed === 0 ? 0 : 1
}

process.exitCode = await main()
