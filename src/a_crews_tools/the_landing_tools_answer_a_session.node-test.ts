// The five tools a landing needs, as a member's session can really call them (martha#256).
//
// Each of the five slices is proved on its own, and on main none of them can be reached from a session: the
// launcher answers eight names, and it refuses these five by name. This file drives the launcher's own answer —
// the one the mod registers and a session calls — and holds it to three things: the ask names the five, each with
// a description and a schema; a call to each reaches the slice that does the work rather than the launcher's
// refusal; and a worktree is opened and finished through it, on a throwaway origin, by real git.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { theRangeACallNames, VERIFY_RANGE, verifyRange } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { crewToolsIn } from '../claude_code_relay/hooks/crew_tools_answer.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { SOLO_MODE } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { CLONES, DASHBOARD, DECLARATION_DIRECTORY, DECLARATION_FILE, OWNER, WORKTREES, type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { HostContract, ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import {
  FAST_FORWARD_AFTER_THE_OWNERS_YES,
  fastForwardAfterTheOwnersYes,
  LAND_BATCH,
  landPassedWorkAsOneBatch,
  theBatchACallNames,
  theFastForwardACallNames,
} from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { dashboardRowsIn } from '../launch_a_claude_code_member/dashboard_rows_in_state.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { WORKTREE_FINISH, WORKTREE_OPEN } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { crewToolsOver, NO_ACTING_PLACE, THE_TOOLS_ASK, type CrewTools } from './a_crews_tools.ts'

const MEMBER = 'Ceres'
const SLUG = '256-the-five'
const REPO = 'synthetic-owner/widget'
const PACKAGE = `${REPO}#1`
const SESSION = 'session-256'

/** The five names this issue is about, each taken from the slice that answers it. */
const THE_FIVE = [VERIFY_RANGE, LAND_BATCH, FAST_FORWARD_AFTER_THE_OWNERS_YES, WORKTREE_OPEN, WORKTREE_FINISH] as const

/** What every slice says when it has not been reached at all: the launcher's own refusal by name. */
const NOT_A_TOOL = 'is not a tool this crew registers'

const gitIn = (cwd: string, ...args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim()

/** git with the identity a throwaway repository has no config for. */
const commitIn = (cwd: string, message: string): void => {
  gitIn(cwd, 'add', '-A')
  gitIn(cwd, '-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid', 'commit', '--quiet', '-m', message)
}

/** A real git, so a test sees what git does rather than what a stand-in is told to say. */
const runReal = async (request: ProcessRequest): Promise<ProcessOutcome> => {
  const outcome = spawnSync(request.command, [...request.args], { cwd: request.cwd, encoding: 'utf8' })
  return { exit_code: outcome.status, stdout: outcome.stdout ?? '', stderr: outcome.stderr ?? '' }
}

interface Place {
  readonly root: string
  readonly crew: CrewTools
  readonly settings: CrewSettings
  readonly host: HostContract
  readonly ledger: LedgerHost
}

/** Which of the two things a place must hold to act it is given; a place missing one is built to say so (r=2 R3). */
interface Held {
  readonly processes: boolean
  readonly settings: boolean
}

const HOLDS_BOTH: Held = { processes: true, settings: true }

/** A member's place of its own: a checkout, the crew's rows, and the workspace places its declaration names. */
function aPlaceOf(t: TestContext, run: (request: ProcessRequest) => Promise<ProcessOutcome> = runReal, held: Held = HOLDS_BOTH): Place {
  const root = mkdtempSync(join(tmpdir(), 'martha-256-tools-'))
  t.after(() => removeTheTree(root))
  const checkout = join(root, 'checkout')
  const clones = join(root, CLONES)
  const worktrees = join(root, WORKTREES)
  mkdirSync(checkout, { recursive: true })
  mkdirSync(clones, { recursive: true })
  mkdirSync(worktrees)
  const host = hostForTests({ run }).host
  const settings = settingsUnder(checkout, { clones, worktrees })
  const ledger: LedgerHost = { clock: host.clock, stores: { rows: rowStreamsDirectory(join(root, CREW_ROWS_PLACE)) } }
  const crew = crewToolsOver({
    member: MEMBER,
    ledger,
    beats: dashboardRowsIn(join(root, DASHBOARD)),
    root: checkout,
    documents: { read: async () => '{}' },
    stores: { crew: crewFilesDirectory(join(root, 'crew-files')) },
    ...(held.processes ? { processes: host.processes } : {}),
    ...(held.settings ? { settings } : {}),
  })
  return { root, crew, settings, host, ledger }
}

/** The crew a member acts in: one builder, the owner approving landings, and the two places a worktree needs. */
function settingsUnder(root: string, places: { readonly clones: string | null; readonly worktrees: string | null }): CrewSettings {
  return {
    paths: { root, crew: join(root, DECLARATION_DIRECTORY), declaration: join(root, DECLARATION_DIRECTORY, DECLARATION_FILE), conventions: null },
    owner: 'Ann',
    members: [{ name: MEMBER, role: 'builder', model: null }],
    mode: { name: SOLO_MODE, roles: ['builder'], may: { assign_work: [OWNER], approve_landing: [OWNER], resume_parked_work: [OWNER], offer_owner_asks: [OWNER] } },
    house_rules: {
      owner_items: false,
      workspace_layout: true,
      member_work: false,
      practice: false,
      strict_gate: false,
      dashboard: false,
      refresh_between_tasks: false,
      review_model: null,
      clones: places.clones,
      worktrees: places.worktrees,
    },
    channel_read_seconds: 30,
  }
}

/** The answer to one call, or the refusal it came back with. */
async function answerTo(place: Place, name: string, args: Readonly<Record<string, unknown>>): Promise<{ readonly answered?: string; readonly refused?: string }> {
  const answer = await place.crew.answer(name, args, SESSION)
  return 'answer' in answer ? { answered: answer.answer } : { refused: answer.refused }
}

test('the launcher names the five landing tools, each with a description and a schema (martha#256)', async (t) => {
  const place = aPlaceOf(t, () => Promise.reject(new Error('nothing is run to read the list of tools')))

  const answered = await answerTo(place, THE_TOOLS_ASK, {})

  assert.ok(answered.answered !== undefined, 'the launcher answers the ask with its tools')
  const read = crewToolsIn(answered.answered)
  assert.ok(read !== null, 'the answer parses as the launcher\'s own shape')
  const names = read.map((tool) => tool.name)
  assert.deepEqual(THE_FIVE.filter((name) => !names.includes(name)), [])
  const schemas = read.filter((tool) => THE_FIVE.includes(tool.name as (typeof THE_FIVE)[number]))
  assert.deepEqual(schemas.filter((tool) => tool.description.trim() === '' || tool.inputSchema?.['type'] !== 'object'), [])
})

test('a call to each of the five reaches its slice, and is not refused as a name the crew does not have (martha#256)', async (t) => {
  const place = aPlaceOf(t)
  const calls = theCallsIn(place)

  for (const name of THE_FIVE) {
    const words = wordsFor(await answerTo(place, name, calls[name] ?? {}))
    assert.ok(!words.includes(NOT_A_TOOL), `${name} is answered by its slice, not refused by the launcher`)
    assert.notEqual(words.trim(), '', `${name} says something`)
  }

  // The three that read a range answer in their own slice's words, driven here against the same host (r=2 R1): a
  // launcher that answered one of them itself, or refused it as a place that cannot act, would answer otherwise.
  const itsOwn = await theThreeSlicesAnswer(place, calls)
  for (const name of THE_FIVE.filter((one) => one in itsOwn)) {
    const said = await answerTo(place, name, calls[name] ?? {})
    assert.equal(wordsFor(said), itsOwn[name], `${name} answers what its slice answers`)
    assert.notEqual(said.refused, NO_ACTING_PLACE, `${name} is not refused as a place that cannot act`)
  }
})

test('a place that holds no processes, or no declaration, refuses the tools it cannot act (martha#256 r=2 R3)', async (t) => {
  const whole = aPlaceOf(t)
  const calls = theCallsIn(whole)

  // No processes at all: every one of the five is refused as a place that cannot act.
  const withoutProcesses = aPlaceOf(t, runReal, { processes: false, settings: true })
  for (const name of THE_FIVE) {
    assert.equal((await answerTo(withoutProcesses, name, calls[name] ?? {})).refused, NO_ACTING_PLACE, `${name} is refused: this place holds no processes`)
  }

  // No declaration, but the host's processes: the three that read a range reach their slices, and the two that need
  // the declaration's own places (clones and worktrees) are refused, because a worktree is opened where the
  // declaration says and nowhere else.
  const withoutDeclaration = aPlaceOf(t, runReal, { processes: true, settings: false })
  for (const name of [WORKTREE_OPEN, WORKTREE_FINISH]) {
    assert.equal((await answerTo(withoutDeclaration, name, calls[name] ?? {})).refused, NO_ACTING_PLACE, `${name} is refused: this place holds no declaration`)
  }
  for (const name of [VERIFY_RANGE, LAND_BATCH, FAST_FORWARD_AFTER_THE_OWNERS_YES]) {
    assert.notEqual((await answerTo(withoutDeclaration, name, calls[name] ?? {})).refused, NO_ACTING_PLACE, `${name} reads a range and needs no declaration`)
  }
})

/** The five calls this file drives, each shaped the way its slice reads one, on a folder that is no clone. */
function theCallsIn(place: Place): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  // A folder that is there and is no clone: git runs in it and refuses, which is the slice's answer to give.
  const notAClone = join(place.root, 'not-a-clone')
  mkdirSync(notAClone)
  return {
    [VERIFY_RANGE]: { path: notAClone, base: 'a', tip: 'b' },
    [LAND_BATCH]: { path: notAClone, packages: [PACKAGE] },
    [FAST_FORWARD_AFTER_THE_OWNERS_YES]: { path: notAClone, base: 'a', tip: 'b', packages: [PACKAGE] },
    [WORKTREE_OPEN]: { repo: REPO, slug: SLUG },
    [WORKTREE_FINISH]: { repo: REPO, slug: SLUG, package: PACKAGE },
  }
}

/** What the three range tools' own slices answer for those calls, driven directly against the place's host. */
async function theThreeSlicesAnswer(place: Place, calls: Readonly<Record<string, Readonly<Record<string, unknown>>>>): Promise<Readonly<Record<string, string>>> {
  const host = { processes: place.host.processes, ...place.ledger }
  const range = okOf(theRangeACallNames(calls[VERIFY_RANGE] ?? {}), VERIFY_RANGE)
  const batch = okOf(theBatchACallNames(calls[LAND_BATCH] ?? {}), LAND_BATCH)
  const forward = okOf(theFastForwardACallNames(calls[FAST_FORWARD_AFTER_THE_OWNERS_YES] ?? {}), FAST_FORWARD_AFTER_THE_OWNERS_YES)
  return {
    [VERIFY_RANGE]: wordsOf(await verifyRange(host, range)),
    [LAND_BATCH]: wordsOf(await landPassedWorkAsOneBatch(host, MEMBER, batch)),
    [FAST_FORWARD_AFTER_THE_OWNERS_YES]: wordsOf(await fastForwardAfterTheOwnersYes(host, MEMBER, forward)),
  }
}

/** A step's answer, or a failure: a call this file drives that its slice cannot even read is the file's own mistake. */
function okOf<T>(step: { readonly ok: T } | { readonly refused: string }, what: string): T {
  if ('refused' in step) throw new Error(`${what}: the slice cannot read the call this file drives: ${step.refused}`)
  return step.ok
}

/** What a slice said, whether it told something or refused. */
const wordsOf = (said: { readonly told: string } | { readonly refused: string }): string => ('told' in said ? said.told : said.refused)

/** What the launcher said, whether it answered or refused. */
const wordsFor = (said: { readonly answered?: string; readonly refused?: string }): string => said.refused ?? said.answered ?? ''

test('a worktree is opened and finished through the launcher answer (martha#256)', async (t) => {
  const place = aPlaceOf(t)
  const settings = place.settings
  assert.ok(settings.house_rules.clones !== null && settings.house_rules.worktrees !== null)
  aBareOrigin(settings.house_rules.clones, settings.house_rules.worktrees)

  const opened = await answerTo(place, WORKTREE_OPEN, { repo: REPO, slug: SLUG })

  // As an answer, not as the refusal: a call that opened a worktree and one that refused to are two different
  // endings, and a member reads them off this field (martha#256 r=3).
  assert.equal(opened.refused, undefined, `opening is not refused: ${opened.refused ?? ''}`)
  assert.match(opened.answered ?? '', /^opened /)
  const finished = await answerTo(place, WORKTREE_FINISH, { repo: REPO, slug: SLUG, package: PACKAGE })
  assert.equal(finished.refused, undefined, `finishing is not refused: ${finished.refused ?? ''}`)
  assert.match(finished.answered ?? '', /^removed /)
})

test('a worktree finish the slice refuses comes back refused, not as an answer (martha#256 r=3)', async (t) => {
  const place = aPlaceOf(t)
  const settings = place.settings
  assert.ok(settings.house_rules.clones !== null && settings.house_rules.worktrees !== null)
  aBareOrigin(settings.house_rules.clones, settings.house_rules.worktrees)
  const opened = await answerTo(place, WORKTREE_OPEN, { repo: REPO, slug: SLUG })
  assert.equal(opened.refused, undefined, `the worktree is opened first: ${opened.refused ?? ''}`)

  // A change nobody committed: the slice refuses to remove the worktree, because the work would go with its branch.
  // The refusal is decided in the slice, so the launcher has to carry it out as a refusal and not wrap it as success.
  writeFileSync(join(settings.house_rules.worktrees, `widget-${SLUG}`, 'work.txt'), 'not committed yet\n')
  const refused = await answerTo(place, WORKTREE_FINISH, { repo: REPO, slug: SLUG, package: PACKAGE })

  assert.equal(refused.answered, undefined, `a refused finish is not an answer: ${refused.answered ?? ''}`)
  assert.match(refused.refused ?? '', /has uncommitted changes/)
})

/** A bare origin holding one commit on main, and a clone of it under `<clones>/<the repository>`. */
function aBareOrigin(clones: string, worktrees: string): void {
  const origin = join(clones, '..', 'origin.git')
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin])
  const seed = join(worktrees, '..', 'seed')
  mkdirSync(seed, { recursive: true })
  gitIn(seed, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(seed, 'README.md'), '# widget\n')
  commitIn(seed, 'the first commit')
  gitIn(seed, 'remote', 'add', 'origin', origin)
  gitIn(seed, 'push', '--quiet', '-u', 'origin', 'main')
  const [owner, name] = REPO.split('/')
  mkdirSync(join(clones, owner!), { recursive: true })
  gitIn(clones, 'clone', '--quiet', origin, join(owner!, name!))
}
