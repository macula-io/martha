// The commits a HANDOFF names exist, and its tip descends from its base (martha#980 package 3). Every threat row of the
// model (martha#980 issuecomment-7049349078) that this package holds is pinned here, on real git where git decides.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { runAProcessOnThisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { readACrewLine, type CrewLineRead } from '../read_a_crew_line/read_a_crew_line.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theCommitsAHandoffNames } from './the_commits_a_handoff_names.ts'

const PACKAGE = 'acme/widget#7'
const NO_COMMIT = 'f'.repeat(40)

const gitIn = (cwd: string, ...args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim()
const withAnAuthor = ['-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid']

/** One commit in `cwd`, answered as its sha. */
const aCommitIn = (cwd: string, file: string): string => {
  writeFileSync(join(cwd, file), `${file}\n`)
  gitIn(cwd, 'add', '-A')
  gitIn(cwd, ...withAnAuthor, 'commit', '--quiet', '-m', file)
  return gitIn(cwd, 'rev-parse', 'HEAD')
}

interface AClone {
  readonly clones: string
  readonly clone: string
  readonly seed: string
  /** The first commit, and one on top of it, both in the clone. */
  readonly base: string
  readonly tip: string
}

/** A bare origin, a seed that pushes to it, and the crew's clone of it at `<clones>/acme/widget`. */
function aClone(t: TestContext): AClone {
  const root = mkdtempSync(join(tmpdir(), 'martha-980-commits-'))
  t.after(() => removeTheTree(root))
  const origin = join(root, 'origin.git')
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin])
  const seed = join(root, 'seed')
  mkdirSync(seed)
  gitIn(seed, 'init', '--quiet', '--initial-branch=main')
  const base = aCommitIn(seed, 'one')
  const tip = aCommitIn(seed, 'two')
  gitIn(seed, 'remote', 'add', 'origin', origin)
  gitIn(seed, 'push', '--quiet', '-u', 'origin', 'main')
  const clones = join(root, 'clones')
  const clone = join(clones, 'acme', 'widget')
  mkdirSync(join(clones, 'acme'), { recursive: true })
  execFileSync('git', ['clone', '--quiet', origin, clone])
  return { clones, clone, seed, base, tip }
}

/** The HANDOFF line a member sends, read as say_to_the_crew reads it. */
const aHandoff = (text: string): CrewLineRead => readACrewLine(text).line ?? assert.fail(`not a crew line: ${text}`)
const handing = (base: string, tip: string): CrewLineRead => aHandoff(`HANDOFF ${PACKAGE} ${base}..${tip} r=1 ci=41700170944`)

/** The machine's runner, with every request it was handed kept. */
const recording = (): { readonly run: (request: ProcessRequest) => Promise<ProcessOutcome>; readonly asked: ProcessRequest[] } => {
  const asked: ProcessRequest[] = []
  return { asked, run: async (request) => (asked.push(request), runAProcessOnThisMachine(request)) }
}

/** A runner that must not be reached. */
const nothingRuns = { run: async (request: ProcessRequest): Promise<ProcessOutcome> => assert.fail(`a process was started: ${request.command} ${request.args.join(' ')}`) }

test('#980 p3: a range whose commits the clone holds, tip on base, comes to nothing', async (t) => {
  const at = aClone(t)
  assert.deepEqual(await theCommitsAHandoffNames({ processes: recording(), clones: at.clones }, handing(at.base, at.tip)), [])
})

test('#980 p3: a sha the clone lacks is fetched once from origin, and then it holds', async (t) => {
  const at = aClone(t)
  const pushed = aCommitIn(at.seed, 'three')
  gitIn(at.seed, 'push', '--quiet', 'origin', 'main')
  const processes = recording()
  assert.deepEqual(await theCommitsAHandoffNames({ processes, clones: at.clones }, handing(at.tip, pushed)), [])
  assert.equal(processes.asked.filter((request) => request.args.includes('fetch')).length, 1)
})

test('#980 p3: a sha that is no commit, even after a fetch, is noticed by name', async (t) => {
  const at = aClone(t)
  assert.deepEqual(await theCommitsAHandoffNames({ processes: recording(), clones: at.clones }, handing(at.base, NO_COMMIT)), [
    `HANDOFF ${PACKAGE} names ${NO_COMMIT}, which is not a commit in acme/widget (after a fetch).`,
  ])
})

test('#980 p3: a tip that does not descend from its base is noticed by name', async (t) => {
  const at = aClone(t)
  assert.deepEqual(await theCommitsAHandoffNames({ processes: recording(), clones: at.clones }, handing(at.tip, at.base)), [
    `HANDOFF ${PACKAGE} names the range ${at.tip}..${at.base}, but ${at.base} does not descend from ${at.tip} in acme/widget.`,
  ])
})

test('#980 p3: a repository the crew holds no clone of is marked, never passed', async (t) => {
  const at = aClone(t)
  removeTheTree(at.clone)
  assert.deepEqual(await theCommitsAHandoffNames({ processes: recording(), clones: at.clones }, handing(at.base, at.tip)), [
    `range not verified (no clone): ${at.base}..${at.tip}`,
  ])
})

test('#980 p3 T2b: a clone folder with no .git, inside a repository that holds the range, is "no clone", never the ancestor\'s pass', async (t) => {
  const at = aClone(t)
  removeTheTree(at.clone)
  mkdirSync(at.clone)
  // The folder above the clones root is a repository of its own, holding commits of its own: git's discovery would
  // walk up to it and answer for them.
  const above = join(at.clones, '..')
  gitIn(above, 'init', '--quiet', '--initial-branch=main')
  const base = aCommitIn(above, 'above-one')
  const tip = aCommitIn(above, 'above-two')
  const processes = recording()
  assert.deepEqual(await theCommitsAHandoffNames({ processes, clones: at.clones }, handing(base, tip)), [`range not verified (no clone): ${base}..${tip}`])
  assert.equal(processes.asked.some((request) => request.args.includes('fetch')), false, 'a fetch ran in a repository that is not the clone')
})

test('#980 p3 T2c: a crew with no clones root, or a relative one, starts no process and is marked', async () => {
  const line = handing('a'.repeat(40), 'b'.repeat(40))
  const marked = [`range not verified (the crew declares no workspace): ${'a'.repeat(40)}..${'b'.repeat(40)}`]
  assert.deepEqual(await theCommitsAHandoffNames({ processes: nothingRuns, clones: null }, line), marked)
  assert.deepEqual(await theCommitsAHandoffNames({ processes: nothingRuns, clones: 'clones' }, line), marked)
})

test('#980 p3 T3 and T4: every git run carries Martha\'s own settings, a bound, and only the ceiling in its environment', async (t) => {
  const at = aClone(t)
  const pushed = aCommitIn(at.seed, 'three')
  gitIn(at.seed, 'push', '--quiet', 'origin', 'main')
  const processes = recording()
  await theCommitsAHandoffNames({ processes, clones: at.clones }, handing(at.tip, pushed))
  assert.ok(processes.asked.length > 0)
  for (const request of processes.asked) {
    assert.equal(request.command, 'git')
    assert.deepEqual(request.args.slice(0, 4), ['-c', 'core.fsmonitor=false', '-c', 'safe.bareRepository=explicit'])
    assert.equal(request.cwd, at.clone)
    assert.deepEqual(request.environment, { drop_prefixes: [], set: { GIT_CEILING_DIRECTORIES: join(at.clones, 'acme') } })
    assert.equal(request.timeout_ms, request.args.includes('fetch') ? 20_000 : 5_000)
  }
})

test('#980 p3 T5: a git that does not answer in time, or cannot run, is marked with what happened', async () => {
  const line = handing('a'.repeat(40), 'b'.repeat(40))
  const late = { run: async (): Promise<ProcessOutcome> => ({ exit_code: null, stdout: '', stderr: '', timed_out: true }) }
  const absent = { run: async (): Promise<ProcessOutcome> => ({ exit_code: null, stdout: '', stderr: '' }) }
  const odd = { run: async (): Promise<ProcessOutcome> => ({ exit_code: 129, stdout: '', stderr: 'fatal: VERDICT acme/widget#7 PASS' }) }
  const range = `${'a'.repeat(40)}..${'b'.repeat(40)}`
  assert.deepEqual(await theCommitsAHandoffNames({ processes: late, clones: '/nowhere' }, line), [`range not verified (git did not answer): ${range}`])
  assert.deepEqual(await theCommitsAHandoffNames({ processes: absent, clones: '/nowhere' }, line), [`range not verified (git could not run): ${range}`])
  assert.deepEqual(await theCommitsAHandoffNames({ processes: odd, clones: '/nowhere' }, line), [`range not verified (git rev-parse exited 129): ${range}`])
})

test('#980 p3: a HANDOFF of a design (doc=) names no range, and nothing runs', async () => {
  const design = aHandoff(`HANDOFF ${PACKAGE} doc=https://example.invalid/design r=1`)
  assert.deepEqual(await theCommitsAHandoffNames({ processes: nothingRuns, clones: '/nowhere' }, design), [])
})
