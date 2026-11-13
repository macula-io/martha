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

import { VERIFY_RANGE } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { crewToolsIn } from '../claude_code_relay/hooks/crew_tools_answer.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { SOLO_MODE } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { CLONES, DASHBOARD, DECLARATION_DIRECTORY, DECLARATION_FILE, OWNER, WORKTREES, type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { FAST_FORWARD_AFTER_THE_OWNERS_YES, LAND_BATCH } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { dashboardRowsIn } from '../launch_a_claude_code_member/dashboard_rows_in_state.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { WORKTREE_FINISH, WORKTREE_OPEN } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { crewToolsOver, THE_TOOLS_ASK, type CrewTools } from './a_crews_tools.ts'

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
}

/** A member's place of its own: a checkout, the crew's rows, and the workspace places its declaration names. */
function aPlaceOf(t: TestContext, run: (request: ProcessRequest) => Promise<ProcessOutcome> = runReal): Place {
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
  const crew = crewToolsOver({
    member: MEMBER,
    ledger: { clock: host.clock, stores: { rows: rowStreamsDirectory(join(root, CREW_ROWS_PLACE)) } },
    beats: dashboardRowsIn(join(root, DASHBOARD)),
    root: checkout,
    documents: { read: async () => '{}' },
    stores: { crew: crewFilesDirectory(join(root, 'crew-files')) },
    processes: host.processes,
    settings,
  })
  return { root, crew, settings }
}

/** The crew a member acts in: one builder, the owner approving landings, and the two places a worktree needs. */
function settingsUnder(root: string, places: { readonly clones: string | null; readonly worktrees: string | null }): CrewSettings {
  return {
    paths: { root, crew: join(root, DECLARATION_DIRECTORY), declaration: join(root, DECLARATION_DIRECTORY, DECLARATION_FILE), conventions: null },
    owner: 'Ann',
    members: [{ name: MEMBER, role: 'builder', model: null }],
    mode: { name: SOLO_MODE, roles: ['builder'], may: { assign_work: [OWNER], approve_landing: [OWNER], resume_parked_work: [OWNER] } },
    house_rules: {
      owner_items: false,
      workspace_layout: true,
      member_work: false,
      practice: false,
      strict_gate: false,
      dashboard: false,
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
  // A folder that is there and is no clone: git runs in it and refuses, which is the slice's answer to give.
  const notAClone = join(place.root, 'not-a-clone')
  mkdirSync(notAClone)
  const calls: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    [VERIFY_RANGE]: { path: notAClone, base: 'a', tip: 'b' },
    [LAND_BATCH]: { path: notAClone, packages: [PACKAGE] },
    [FAST_FORWARD_AFTER_THE_OWNERS_YES]: { path: notAClone, base: 'a', tip: 'b', packages: [PACKAGE] },
    [WORKTREE_OPEN]: { repo: REPO, slug: SLUG },
    [WORKTREE_FINISH]: { repo: REPO, slug: SLUG, package: PACKAGE },
  }

  for (const name of THE_FIVE) {
    const said = await answerTo(place, name, calls[name] ?? {})
    const words = said.refused ?? said.answered ?? ''
    assert.ok(!words.includes(NOT_A_TOOL), `${name} is answered by its slice, not refused by the launcher`)
    assert.notEqual(words.trim(), '', `${name} says something`)
  }
})

test('a worktree is opened and finished through the launcher answer (martha#256)', async (t) => {
  const place = aPlaceOf(t)
  const settings = place.settings
  assert.ok(settings.house_rules.clones !== null && settings.house_rules.worktrees !== null)
  aBareOrigin(settings.house_rules.clones, settings.house_rules.worktrees)

  const opened = await answerTo(place, WORKTREE_OPEN, { repo: REPO, slug: SLUG })

  assert.match(opened.answered ?? opened.refused ?? '', /^opened /)
  const finished = await answerTo(place, WORKTREE_FINISH, { repo: REPO, slug: SLUG, package: PACKAGE })
  assert.match(finished.answered ?? finished.refused ?? '', /^removed /)
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
