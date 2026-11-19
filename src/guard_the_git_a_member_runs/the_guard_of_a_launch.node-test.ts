// The `git` a launch puts first on its member's PATH, and the hook git is pointed at (martha#562, seams b and c).
//
// What is pinned here is what the ruling of 2026-11-17 fixes: a miss reaches the member's row on the launcher's tick,
// a partial line waits for its end, and a miss already folded is not folded twice. The shim itself is run as a member's
// shell runs it — through the PATH the launch gives it — so a refusal, an allow and a miss are measured on the call's
// exit status and on what the real git was handed, never on an inspection of the script.

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { GIT_CALL_PATH, REF_TRANSACTION_PATH } from './guard_protocol.ts'
import { RELAY_SOCKET_VARIABLE } from '../claude_code_relay/hooks/relay_protocol.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { switchesThatRunNothingFromACheckout } from '../refuse_code_a_checkout_runs_itself/refuse_code_a_checkout_runs_itself.ts'
import { RELAY_SOCKET_NAME } from '../serve_the_relay_to_a_launch/relay_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { shortRelayRoot } from '../drive_the_recorded_host/short_relay_root.ts'
import { theRowWithNothingSaid, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { theMissesLine } from '../guard_workspace/guard_workspace.ts'
import {
  foldTheMisses,
  MISSES_FILE_NAME,
  NOTHING_FOLDED_YET,
  putTheGuardIn,
  theMissesFileIn,
  thePathWithTheGuardFirst,
  THE_GUARD_DIRECTORY_MODE,
  THE_HOOKS_DIRECTORY_NAME,
  THE_SHIM_MODE,
  THE_SHIM_NAME,
  type TheGitGuard,
} from './the_guard_of_a_launch.ts'

/** The member whose row a fold writes. */
const MEMBER = 'Hygiea'

/** What the fake real git says when it runs, so a test can tell a judged call from one that never reached the shim. */
const RAN = 'the real git ran'

/** A directory this test removes when it ends, with the paths hard links are looked up by resolved. */
function aDirectory(t: TestContext, name: string): string {
  const made = realpathSync(mkdtempSync(join(tmpdir(), name)))
  t.after(() => removeTheTree(made))
  return made
}

/** The one miss line the judge writes, as it writes it: a whole line, ending in a newline. */
const aMissLine = (what: string, why: string): string => `${JSON.stringify({ at: '2026-11-18T02:00:00.000Z', what, why })}\n`

/** A row for the member, kept the way the launcher keeps one, so a fold has one to write into. */
function aRowIn(dashboard: string): void {
  const kept = dashboardRowsIn(dashboard).change(MEMBER, (held) => held ?? ({ ...theRowWithNothingSaid(), member: MEMBER, session: 'session-1', at: 1 } as DashboardRow))
  assert.equal(kept.kept, true, 'the test could not keep a row to fold into')
}

/** The member's row, as the dashboard store holds it. */
const theRowOf = (dashboard: string): DashboardRow | null => dashboardRowsIn(dashboard).read(MEMBER)

test('a miss written just before the launcher\'s tick still reaches the row', (t) => {
  const directory = aDirectory(t, 'martha-562-misses-a-')
  const dashboard = join(directory, 'a-dashboard')
  mkdirSync(dashboard)
  aRowIn(dashboard)
  const misses = join(directory, MISSES_FILE_NAME)
  writeFileSync(misses, aMissLine('git branch -D uranus/9', 'the launcher did not answer within 5000 ms'))

  const folded = foldTheMisses({ misses, folded: NOTHING_FOLDED_YET }, { beats: dashboardRowsIn(dashboard), member: MEMBER, at: 2 })

  assert.match(theRowOf(dashboard)?.needs ?? '', /could not judge one git call \(the launcher did not answer within 5000 ms\) and let it run: git branch -D uranus\/9/)
  assert.notEqual(folded.cursor, 0, 'the fold did not move past the line it folded')
})

test('a partial line waits for its end rather than being read as a miss', (t) => {
  const directory = aDirectory(t, 'martha-562-misses-b-')
  const dashboard = join(directory, 'a-dashboard')
  mkdirSync(dashboard)
  aRowIn(dashboard)
  const misses = join(directory, MISSES_FILE_NAME)
  const whole = aMissLine('git branch -D uranus/9', 'the launcher could not be asked (ENOENT)')
  // The line the judge is still writing: every byte of it but the newline that ends it.
  writeFileSync(misses, whole.slice(0, -1))

  const waited = foldTheMisses({ misses, folded: NOTHING_FOLDED_YET }, { beats: dashboardRowsIn(dashboard), member: MEMBER, at: 2 })

  assert.deepEqual(waited, NOTHING_FOLDED_YET, 'a line with no end yet was read as a miss')
  assert.equal(theRowOf(dashboard)?.needs, '', 'a half-written miss reached the row')

  writeFileSync(misses, whole)
  foldTheMisses({ misses, folded: waited }, { beats: dashboardRowsIn(dashboard), member: MEMBER, at: 3 })
  assert.match(theRowOf(dashboard)?.needs ?? '', /could not judge one git call/, 'the line did not reach the row once it was whole')
})

test('a miss already folded is not folded twice', (t) => {
  const directory = aDirectory(t, 'martha-562-misses-c-')
  const dashboard = join(directory, 'a-dashboard')
  mkdirSync(dashboard)
  aRowIn(dashboard)
  const misses = join(directory, MISSES_FILE_NAME)
  writeFileSync(misses, aMissLine('git branch -D uranus/9', 'the launcher did not answer in time'))

  const once = foldTheMisses({ misses, folded: NOTHING_FOLDED_YET }, { beats: dashboardRowsIn(dashboard), member: MEMBER, at: 2 })
  const rowAfterOne = theRowOf(dashboard)
  const twice = foldTheMisses({ misses, folded: once }, { beats: dashboardRowsIn(dashboard), member: MEMBER, at: 3 })

  assert.deepEqual(twice, once, 'a second tick past the same file moved the cursor again')
  assert.deepEqual(theRowOf(dashboard), rowAfterOne, 'a second tick folded the same miss a second time')

  // A second miss is folded over the line the first one wrote, which is this writer's own.
  appendFileSync(misses, aMissLine('git branch -D uranus/9', 'one more') + aMissLine('git worktree remove /x', 'and another'))
  foldTheMisses({ misses, folded: twice }, { beats: dashboardRowsIn(dashboard), member: MEMBER, at: 4 })
  assert.match(theRowOf(dashboard)?.needs ?? '', /could not judge 2 git calls/)
})

test("a line another writer put in the row is left alone, and the misses wait for a tick that can take it", (t) => {
  const directory = aDirectory(t, 'martha-562-misses-d-')
  const dashboard = join(directory, 'a-dashboard')
  mkdirSync(dashboard)
  aRowIn(dashboard)
  dashboardRowsIn(dashboard).change(MEMBER, (held) => (held === null ? null : { ...held, needs: 'the owner has a switch to answer' }))
  const misses = join(directory, MISSES_FILE_NAME)
  writeFileSync(misses, aMissLine('git branch -D uranus/9', 'no answer'))

  const folded = foldTheMisses({ misses, folded: NOTHING_FOLDED_YET }, { beats: dashboardRowsIn(dashboard), member: MEMBER, at: 2 })

  assert.equal(theRowOf(dashboard)?.needs, 'the owner has a switch to answer', "the fold wrote over another owner's line")
  assert.deepEqual(folded, NOTHING_FOLDED_YET, 'the fold moved past a line the row did not take')
})

/** A real git that says it ran, so a test can tell a call the shim let through from one it stopped. */
function aRealGitIn(directory: string): string {
  const bin = join(directory, 'real-bin')
  mkdirSync(bin)
  const realGit = join(bin, 'git')
  writeFileSync(realGit, `#!/bin/sh\nprintf '%s\\n' "${RAN}: $*"\n`)
  chmodSync(realGit, 0o755)
  return realGit
}

/** A launcher answering one verdict on its socket, and the questions it was asked. */
interface AFakeLauncher {
  readonly socket: string
  readonly asked: { path: string; body: Record<string, unknown> }[]
  close(): Promise<void>
}

/**
 * A launcher that answers every guard's question with `answer`, body and status, and keeps what it was asked.
 *
 * Its socket is served from a relay root short enough for a socket address whatever TMPDIR is (martha#79): this
 * test's own directory sits under TMPDIR, and CI runs the suite under a long one reached through a link, where
 * `<directory>/launch/relay.sock` is past the hundred bytes an address holds and `listen` refuses it by name.
 */
async function aLauncherIn(t: TestContext, answer: { readonly status: number; readonly body: string }): Promise<AFakeLauncher> {
  const socket = join(shortRelayRoot(t), RELAY_SOCKET_NAME)
  const asked: AFakeLauncher['asked'] = []
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      asked.push({ path: request.url ?? '', body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> })
      response.writeHead(answer.status, { 'content-type': 'application/json' })
      response.end(answer.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(socket, resolve))
  return {
    socket,
    asked,
    close: () => new Promise<void>((resolve) => (server.close(() => resolve()), server.closeAllConnections())),
  }
}

/** Where a launch's guard is placed, and the real git it hands an allowed call to. */
interface APlacedGuard {
  readonly directory: string
  readonly guard: TheGitGuard
  readonly env: Record<string, string>
}

/** Places the guard in `directory`, as a launch does, with a real git that says it ran. */
function aGuardIn(directory: string, socket: string): APlacedGuard {
  const realGit = aRealGitIn(directory)
  const placed = putTheGuardIn(join(directory, 'launch'), process.execPath, realGit)
  assert.ok('directory' in placed, `the guard could not be placed: ${'refusal' in placed ? placed.refusal : ''}`)
  const env = thePathWithTheGuardFirst({ PATH: `${join(directory, 'real-bin')}:/usr/bin:/bin`, [RELAY_SOCKET_VARIABLE]: socket }, placed.directory) as Record<string, string>
  return { directory, guard: placed, env }
}

/** What a program's run ended with, and what it said on its two streams. */
interface AProcRun {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/**
 * Runs a program and waits for it, which is what every test here must do: the stand-in launcher answers on a socket in
 * this very process, so a blocking spawn would leave the shim's question unanswered until its deadline passed.
 */
function theRunOf(command: string, args: readonly string[], options: { readonly cwd: string; readonly env: Record<string, string> }): Promise<AProcRun> {
  const child = spawn(command, [...args], options)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  return new Promise<AProcRun>((resolve) => child.on('close', (status) => resolve({ status, stdout, stderr })))
}

/** The shim, as a member's shell runs it: `git` found on the PATH the launch gave the member. */
async function runGitThroughThePath(placed: APlacedGuard, args: readonly string[]): Promise<AProcRun> {
  return theRunOf('/bin/sh', ['-c', `git ${args.join(' ')}`], { cwd: placed.directory, env: placed.env })
}

test('the shim runs the real git when the launcher allows the call, and the launch decides the question', async (t) => {
  const directory = aDirectory(t, 'martha-562-shim-a-')
  mkdirSync(join(directory, 'launch'), { recursive: true })
  const launcher = await aLauncherIn(t, { status: 200, body: JSON.stringify({ allow: 1 }) })
  t.after(() => launcher.close())
  const placed = aGuardIn(directory, launcher.socket)

  const ran = await runGitThroughThePath(placed, ['branch', '-D', 'uranus/9'])

  assert.equal(ran.status, 0, `the allowed call did not run: ${ran.stderr}`)
  assert.match(ran.stdout, new RegExp(`${RAN}: branch -D uranus/9`), 'the real git was not handed the words unchanged')
  assert.deepEqual(launcher.asked, [{ path: GIT_CALL_PATH, body: { cwd: placed.directory, args: ['branch', '-D', 'uranus/9'] } }])
})

test('the shim stops the call on a refusal, with the reason, and the real git never runs', async (t) => {
  const directory = aDirectory(t, 'martha-562-shim-b-')
  mkdirSync(join(directory, 'launch'), { recursive: true })
  const launcher = await aLauncherIn(t, { status: 200, body: JSON.stringify({ deny: "uranus/9 is another member's branch" }) })
  t.after(() => launcher.close())
  const placed = aGuardIn(directory, launcher.socket)

  const ran = await runGitThroughThePath(placed, ['branch', '-D', 'uranus/9'])

  assert.equal(ran.status, 3, 'a refused call did not end with the refusal status')
  assert.equal(ran.stdout, '', 'the real git ran a call the launcher refused')
  assert.match(ran.stderr, /is another member's branch/)
})

test('a launcher that cannot answer is a miss: the real git runs, and one line is left for the tick', async (t) => {
  const directory = aDirectory(t, 'martha-562-shim-c-')
  mkdirSync(join(directory, 'launch'), { recursive: true })
  // No server at the socket the environment names: the shim's question is answered by nothing at all.
  const placed = aGuardIn(directory, join(directory, 'launch', 'nowhere.sock'))

  const ran = await runGitThroughThePath(placed, ['branch', '-D', 'uranus/9'])

  assert.equal(ran.status, 0, `a missed call did not fail open: ${ran.stderr}`)
  assert.match(ran.stdout, new RegExp(`${RAN}: branch -D uranus/9`))
  const written = readFileSync(theMissesFileIn(join(directory, 'launch')), 'utf8')
  const lines = written.split('\n').filter((line) => line !== '')
  assert.equal(lines.length, 1, `one miss was not one line: ${written}`)
  assert.match(theMissesLine(lines), /could not judge one git call .* and let it run: git branch -D uranus\/9/)
})

test('Martha\'s own run, and a shell with no launcher socket, are not asked about at all', async (t) => {
  const directory = aDirectory(t, 'martha-562-shim-d-')
  mkdirSync(join(directory, 'launch'), { recursive: true })
  const launcher = await aLauncherIn(t, { status: 200, body: JSON.stringify({ allow: 1 }) })
  t.after(() => launcher.close())
  const placed = aGuardIn(directory, launcher.socket)

  // The run marthasOwnGitArgs builds, which every one of Martha's own git runs carries.
  const own = ['-c', 'core.fsmonitor=false', '-c', 'safe.bareRepository=explicit', 'worktree', 'list', '--porcelain']
  assert.equal((await runGitThroughThePath(placed, own)).status, 0)
  assert.deepEqual(launcher.asked, [], "Martha's own run was judged")

  const { [RELAY_SOCKET_VARIABLE]: _noSocket, ...withoutSocket } = placed.env
  const ran = await theRunOf('/bin/sh', ['-c', 'git status'], { cwd: directory, env: withoutSocket })
  assert.match(ran.stdout, new RegExp(`${RAN}: status`), 'a shell with no launcher socket did not reach the real git')
  assert.deepEqual(launcher.asked, [], 'a shell with no launcher socket was asked about')
})

test('the guard git is pointed at is the only hook folder, and its shim and folders are closed to every write', (t) => {
  const directory = aDirectory(t, 'martha-562-shim-e-')
  mkdirSync(join(directory, 'launch'), { recursive: true })
  const placed = aGuardIn(directory, join(directory, 'launch', RELAY_SOCKET_NAME))

  assert.equal(statSync(placed.guard.directory).mode & 0o777, THE_GUARD_DIRECTORY_MODE)
  assert.equal(statSync(join(placed.guard.directory, THE_SHIM_NAME)).mode & 0o777, THE_SHIM_MODE)
  // The folder git is pointed at holds the launch's one hook and nothing else, which is what makes every event staying
  // off safe: no file a checkout wrote can be in it (martha#562 r=1, martha#24).
  assert.equal(placed.guard.hooks.directory, join(placed.guard.directory, THE_HOOKS_DIRECTORY_NAME))
  assert.deepEqual(readdirSync(placed.guard.hooks.directory), ['reference-transaction'])
})

/** A clone with a branch of another member's, and the launch's hooks pointed at the guard's. */
interface ACloneUnderTheGuard {
  readonly clone: string
  readonly env: Record<string, string>
  /** The file the hook this checkout names in its own config would touch, if git ever ran it. */
  readonly aHookTheCheckoutNames: string
}

const gitIn = (cwd: string, ...args: readonly string[]): string => execFileSync('/usr/bin/git', [...args], { cwd, encoding: 'utf8' }).trim()

/** A clone cut from nothing, with `uranus/9` on a branch, run under the settings a launch gives a member's git. */
function aCloneUnderTheGuard(directory: string, socket: string): ACloneUnderTheGuard {
  const placed = aGuardIn(directory, socket)
  const clone = join(directory, 'acme', 'widget')
  mkdirSync(join(directory, 'acme'))
  gitIn(directory, 'init', '--quiet', '--initial-branch=main', clone)
  gitIn(clone, '-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'the first commit')
  gitIn(clone, 'branch', 'uranus/9')
  // A hook the checkout names in its own `.git/config`, which `core.hooksPath` does not govern (martha#24): the launch's
  // switches must run none of it, while the launch's own hook in its own folder still runs (martha#562 r=1).
  const touched = join(directory, 'the-checkouts-own-hook-ran')
  const named = join(directory, 'a-hook-the-checkout-names')
  writeFileSync(named, `#!/bin/sh\ntouch ${touched}\n`)
  chmodSync(named, 0o755)
  gitIn(clone, 'config', 'hook.a-checkout-named.event', 'reference-transaction')
  gitIn(clone, 'config', 'hook.a-checkout-named.command', named)
  const empty = join(directory, 'an-empty-place')
  mkdirSync(empty)
  const switches = switchesThatRunNothingFromACheckout({}, empty, placed.guard.hooks)
  return { clone, env: { ...placed.env, ...switches.env } as Record<string, string>, aHookTheCheckoutNames: touched }
}

test("a delete that reaches the transaction through git's absolute path is refused", async (t) => {
  const directory = aDirectory(t, 'martha-562-hook-a-')
  mkdirSync(join(directory, 'launch'), { recursive: true })
  const launcher = await aLauncherIn(t, { status: 200, body: JSON.stringify({ deny: "uranus/9 is another member's branch" }) })
  t.after(() => launcher.close())
  const under = aCloneUnderTheGuard(directory, launcher.socket)

  const ran = await theRunOf('/usr/bin/git', ['branch', '-D', 'uranus/9'], { cwd: under.clone, env: under.env })

  assert.notEqual(ran.status, 0, 'a delete of another member\'s branch was not stopped by the transaction')
  assert.equal(gitIn(under.clone, 'branch', '--list', 'uranus/9'), 'uranus/9', 'the branch was deleted past the hook')
  assert.match(ran.stderr, /is another member's branch/)
  assert.deepEqual(launcher.asked.map((question) => question.body), [{ updates: [{ ref: 'refs/heads/uranus/9', deletes: true }] }])
})

test("a delete of the member's own branch reaches git's transaction and is let through", async (t) => {
  const directory = aDirectory(t, 'martha-562-hook-b-')
  mkdirSync(join(directory, 'launch'), { recursive: true })
  const launcher = await aLauncherIn(t, { status: 200, body: JSON.stringify({ allow: 1 }) })
  t.after(() => launcher.close())
  const under = aCloneUnderTheGuard(directory, launcher.socket)
  gitIn(under.clone, 'branch', 'hygiea/562')

  const ran = await theRunOf('/usr/bin/git', ['branch', '-D', 'hygiea/562'], { cwd: under.clone, env: under.env })

  assert.equal(ran.status, 0, `the member's own delete did not run: ${ran.stderr}`)
  assert.equal(gitIn(under.clone, 'branch', '--list', 'hygiea/562'), '', 'the branch the member may delete is still there')
})

test("a checkout's own config-named hook runs none for the event the launch keeps, and the launch's own does (martha#562 r=1)", async (t) => {
  const directory = aDirectory(t, 'martha-562-hook-c-')
  mkdirSync(join(directory, 'launch'), { recursive: true })
  const launcher = await aLauncherIn(t, { status: 200, body: JSON.stringify({ deny: "uranus/9 is another member's branch" }) })
  t.after(() => launcher.close())
  const under = aCloneUnderTheGuard(directory, launcher.socket)

  const ran = await theRunOf('/usr/bin/git', ['branch', '-D', 'uranus/9'], { cwd: under.clone, env: under.env })

  // The launch's own hook ran — it asked the launcher, and the refusal stopped the delete — and the hook the checkout
  // names in its own config ran none, because the event it names is one of the events the launch switches off.
  assert.notEqual(ran.status, 0, `the delete was not stopped: ${ran.stderr}`)
  assert.deepEqual(launcher.asked.map((question) => question.body), [{ updates: [{ ref: 'refs/heads/uranus/9', deletes: true }] }])
  assert.equal(existsSync(under.aHookTheCheckoutNames), false, "the hook the checkout names in its own config ran under the launch's switches")
})

// The judge's own process (martha#772): the shim and the hook start the launch's node on the launch's judge, and what a
// member's environment carries must not choose the code that node runs. The two variables are spelled here, never read
// from the guard's own list of them, so a list that loses one is caught by name rather than planting nothing.
const A_PRELOAD_VARIABLE = 'NODE_OPTIONS'
const A_CACHE_VARIABLE = 'NODE_COMPILE_CACHE'

/** What a member planted for every node it starts, and where each plant shows that it was taken. */
interface APlantedNode {
  readonly env: Record<string, string>
  /** The file the planted preload appends to whenever a node runs it. */
  readonly mark: string
  /** The member's own compile cache folder, empty until a node writes its entries there. */
  readonly cache: string
}

/**
 * A member environment that plants code for the judge: a preload that leaves a mark, a compile cache of the member's,
 * and a `node.config.json` in each folder git runs from, which node reads only when a flag asks it to (route 3 of the
 * design) — so a flag that reached the judge by any road is caught here too.
 */
function aPlantedNodeIn(directory: string, workingFolders: readonly string[]): APlantedNode {
  const planted = join(directory, 'planted')
  mkdirSync(planted)
  const mark = join(planted, 'the-planted-preload-ran')
  const preload = join(planted, 'preload.mjs')
  writeFileSync(preload, `import { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(mark)}, process.argv.slice(2).join(' ') + '\\n')\n`)
  for (const folder of workingFolders) writeFileSync(join(folder, 'node.config.json'), `${JSON.stringify({ nodeOptions: { import: [preload] } })}\n`)
  const cache = join(planted, 'the-members-own-compile-cache')
  mkdirSync(cache)
  return { env: { [A_PRELOAD_VARIABLE]: `--import=${preload}`, [A_CACHE_VARIABLE]: cache }, mark, cache }
}

test("the judge takes neither the member's NODE_OPTIONS nor its NODE_COMPILE_CACHE, on the shim or on the hook (martha#772)", async (t) => {
  const directory = aDirectory(t, 'martha-772-door-')
  mkdirSync(join(directory, 'launch'), { recursive: true })
  const launcher = await aLauncherIn(t, { status: 200, body: JSON.stringify({ allow: 1 }) })
  t.after(() => launcher.close())
  const under = aCloneUnderTheGuard(directory, launcher.socket)
  const planted = aPlantedNodeIn(directory, [directory, under.clone])
  const env = { ...under.env, ...planted.env }

  const shim = await theRunOf('/bin/sh', ['-c', 'git status'], { cwd: directory, env })
  const hook = await theRunOf('/usr/bin/git', ['-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'a commit the hook judges'], { cwd: under.clone, env })

  // Both judges ran, or this test proves nothing about them: each asked the launcher its own question.
  assert.equal(shim.status, 0, `the shim's call did not run: ${shim.stderr}`)
  assert.equal(hook.status, 0, `the commit did not run: ${hook.stderr}`)
  assert.ok(launcher.asked.some((question) => question.path === GIT_CALL_PATH), "the shim's judge never ran")
  assert.ok(launcher.asked.some((question) => question.path === REF_TRANSACTION_PATH), "the hook's judge never ran")
  // Every door that was open is named, not only the first: each one is its own route into the judge.
  const open = [
    ...(existsSync(planted.mark) ? [`the member's NODE_OPTIONS reached the judge (the planted preload ran for: ${readFileSync(planted.mark, 'utf8').trim().replaceAll('\n', '; ')})`] : []),
    ...(readdirSync(planted.cache).length > 0 ? [`the judge took the member's NODE_COMPILE_CACHE (it wrote ${readdirSync(planted.cache).join(', ')} there)`] : []),
  ]
  assert.deepEqual(open, [], open.join('\n'))
})

/** A real git that says the whole environment it was started with, one `NAME=value` a line. */
function aRealGitThatSaysItsEnvironmentIn(directory: string): string {
  const bin = join(directory, 'real-bin')
  mkdirSync(bin)
  const realGit = join(bin, 'git')
  writeFileSync(realGit, '#!/bin/sh\nexec env\n')
  chmodSync(realGit, 0o755)
  return realGit
}

/** What a started program's `env` said, as names and values; a value may hold `=`, a name never does. */
const theEnvironmentSaid = (said: string): Map<string, string> =>
  new Map(said.split('\n').filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))

/** The names a shell adds to what it is given, which no program of the guard's sets. */
const WHAT_A_SHELL_ADDS = new Set(['PWD', 'OLDPWD', 'SHLVL', '_'])

test("the real git, and everything it starts, still gets the member's own NODE_OPTIONS and NODE_COMPILE_CACHE, set, empty or unset (martha#772)", async (t) => {
  const directory = aDirectory(t, 'martha-772-kept-')
  mkdirSync(join(directory, 'launch'), { recursive: true })
  const placed = putTheGuardIn(join(directory, 'launch'), process.execPath, aRealGitThatSaysItsEnvironmentIn(directory))
  assert.ok('directory' in placed, `the guard could not be placed: ${'refusal' in placed ? placed.refusal : ''}`)
  // No launcher socket: the judge hands the call straight to the real git, which is the path every allowed call ends on.
  const base = thePathWithTheGuardFirst({ PATH: `${join(directory, 'real-bin')}:/usr/bin:/bin` }, placed.directory) as Record<string, string>

  const cases: readonly { readonly given: Record<string, string>; readonly said: string }[] = [
    { given: { [A_PRELOAD_VARIABLE]: '--max-old-space-size=512', [A_CACHE_VARIABLE]: '' }, said: 'one set, one set empty' },
    { given: {}, said: 'both unset' },
  ]
  for (const one of cases) {
    const given = { ...base, ...one.given }
    const ran = await theRunOf('/bin/sh', ['-c', 'git status'], { cwd: directory, env: given })
    assert.equal(ran.status, 0, `${one.said}: the call did not run: ${ran.stderr}`)
    const seen = theEnvironmentSaid(ran.stdout)
    for (const name of [A_PRELOAD_VARIABLE, A_CACHE_VARIABLE]) {
      assert.equal(seen.get(name), given[name], `${one.said}: the real git was not handed the member's ${name} as the member had it`)
    }
    const added = [...seen.keys()].filter((name) => !(name in given) && !WHAT_A_SHELL_ADDS.has(name))
    assert.deepEqual(added, [], `${one.said}: the real git was handed names the member never set`)
  }
})
