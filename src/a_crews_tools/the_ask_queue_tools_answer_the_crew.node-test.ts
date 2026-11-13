// The four ask-queue tools over a real crew store (martha#313, the queue half): a member queues, the session the
// table names takes one batch, and a settle stands on a menu its host closed.
//
// The decisions are the slice's (../queue_the_owners_asks); this file pins the wiring, so a tool that read the wrong
// asker, the wrong declaration or no menu at all fails here by name.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import {
  ACTS,
  CLONES,
  DASHBOARD,
  DECLARATION_DIRECTORY,
  DECLARATION_FILE,
  DECLARATION_VERSION,
  NUDGES,
  OFFER_OWNER_ASKS,
  OWNER,
  OWNER_BELL,
  PERSON_MINUTES,
  REFRESH_BETWEEN_TASKS,
  RESTART_MEMBER,
  REVIEW_MINUTES,
  STALLED_MINUTES,
  STRICT_GATE,
  WORKTREES,
  type CrewSettings,
} from '../declare_crew/declare_crew.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import type { ProcessOutcome, ProcessRequest, Processes } from '../host_contract/host_contract.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { LIST_ASKS, QUEUE_ASK, SETTLE_ASKS, TAKE_ASKS, menusTheLauncherKeeps } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { MENU_TOOL } from '../say_what_the_host_is_asking/say_what_the_host_is_asking.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import { crewToolsOver, type CrewTools } from './a_crews_tools.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-ask-queue-tools-'))
after(() => removeTheTree(home))
mkdirSync(join(home, 'row'))
// The row store writes into directories the launcher makes; it makes none itself.
mkdirSync(join(home, CREW_ROWS_PLACE), { mode: STREAM_DIRECTORY_MODE })
mkdirSync(join(home, 'rows-without-menus'), { mode: STREAM_DIRECTORY_MODE })

// A made-up project root: this repository is public, so no real path appears here.
const root = '/crew-project'
const LEAD = 'Lead'
const BUILDER = 'Builder1'
const team = {
  version: DECLARATION_VERSION,
  owner: 'Ann',
  members: [
    { name: LEAD, role: SUPERVISOR },
    { name: BUILDER, role: 'builder' },
  ],
  mode: {
    name: 'team',
    roles: [SUPERVISOR, 'builder'],
    may: { ...Object.fromEntries(ACTS.map((act) => [act, [SUPERVISOR]])), [OFFER_OWNER_ASKS]: [SUPERVISOR], approve_landing: [OWNER] },
  },
  channel_read_seconds: 30,
}
const declaration = JSON.stringify(team)
const documents = {
  read: async (path: string): Promise<string> => {
    if (path === join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)) return declaration
    throw Object.assign(new Error(`no document at ${path}`), { code: 'ENOENT' })
  },
}

const clock = { at: 1_000 }
/** Each member's tools over one shared crew store, with the menus a launcher keeps over the same clock. */
function theToolsOf(member: string): CrewTools {
  return crewToolsOver({
    member,
    ledger: { clock: { now: () => clock.at }, stores: { rows: rowStreamsDirectory(join(home, CREW_ROWS_PLACE)) } },
    beats: dashboardRowsIn(join(home, 'row')),
    root,
    documents,
    stores: { crew: crewFilesDirectory(join(home, 'the-crew-store')) },
    menus: menusTheLauncherKeeps({ now: () => clock.at }),
  })
}

const TOLD = (said: { readonly answer: string } | { readonly refused: string }): string => ('answer' in said ? said.answer : assert.fail(`refused: ${said.refused}`))
const REFUSED = (said: { readonly answer: string } | { readonly refused: string }): string => ('refused' in said ? said.refused : assert.fail(`answered: ${said.answer}`))

test('a member queues an ask the launcher stamps with its own member, never with a name the call carries', async () => {
  clock.at = 1_000
  const told = TOLD(await theToolsOf(BUILDER).answer(QUEUE_ASK, { ask: 'Delete the merged branch vesta/313-old?', asked_by: 'a name in the call' }, 'session-builder'))
  assert.equal(told, 'Queued for the owner; 1 ask waiting. Do not open a menu for it; carry on.')
  const listed = TOLD(await theToolsOf(LEAD).answer(LIST_ASKS, {}, 'session-lead'))
  assert.match(listed, /- 0 \(from Builder1\): Delete the merged branch vesta\/313-old\?$/, 'the asker is the member the launcher started')
})

test('the session the table does not name is refused, and the one it names takes one batch and settles it after a menu closes', async () => {
  const lead = theToolsOf(LEAD)
  assert.match(REFUSED(await theToolsOf(BUILDER).answer(TAKE_ASKS, {}, 'session-builder')), /Builder1 may not take or settle the owner's asks/)

  clock.at = 2_000
  const taken = TOLD(await lead.answer(TAKE_ASKS, {}, 'session-lead'))
  const batch = Number(/settle batch (\d+)/.exec(taken)?.[1])
  assert.match(taken, /1 queued ask, oldest first\./, `one batch of the waiting ask: ${taken}`)

  assert.match(REFUSED(await lead.answer(SETTLE_ASKS, { batch, yes: [0] }, 'session-lead')), /no menu has closed/)

  clock.at = 3_000
  lead.noteTheCallsAnswer({ tool: MENU_TOOL }, 'session-lead')
  assert.equal(TOLD(await lead.answer(SETTLE_ASKS, { batch, yes: [0] }, 'session-lead')), `Batch ${String(batch)} settled: 1 the owner ticked, 0 back in the queue.`)
  assert.equal(TOLD(await lead.answer(LIST_ASKS, {}, 'session-lead')), 'No asks are waiting for the owner.')
})

// --- a queue_ask that removes a branch (martha#391) --------------------------------

const THE_CLONES = join(home, 'the-clones')
mkdirSync(THE_CLONES)
const THE_BRANCH = 'vesta/313-old'
const THE_REPO = 'macula-io/martha'
const THE_CLONE = join(THE_CLONES, THE_REPO)
const THE_LOCAL_TIP = '72081ee'
const THE_ORIGIN_TIP = 'e8c127a'
const THE_TIPS_SAID = `It removes ${THE_BRANCH}, and the ask records both tips the yes covers: this clone at ${THE_LOCAL_TIP}, origin at ${THE_ORIGIN_TIP}.`

/** git's own words in a run: Martha's `-c <name>=<value>` settings come first, and are not what the test asked for. */
const gitSaid = (args: readonly string[]): string => {
  let at = 0
  while (args[at] === '-c') at += 2
  return args.slice(at).join(' ')
}

/**
 * A git that answers only in the clone the ask names, as a real one would: a run anywhere else is no repository and
 * fails, so a tips read in the clones root, or in any other directory, leaves the ask refused and the test red. In the
 * clone, a ref it was not told about answers as git does — a resolve that fails, and a remote that holds no such branch.
 */
function aGitOnlyInTheClone(answers: Readonly<Record<string, string>>, asked: string[] = []): ReturnType<typeof hostForTests>['host']['processes'] {
  const run = async (request: ProcessRequest): Promise<ProcessOutcome> => {
    const said = gitSaid(request.args)
    asked.push(`${request.cwd} ${said}`)
    if (request.cwd !== THE_CLONE) return { exit_code: 128, stdout: '', stderr: 'fatal: not a git repository' }
    const answer = answers[said]
    if (answer !== undefined) return { exit_code: 0, stdout: answer, stderr: '' }
    return said.startsWith('ls-remote') ? { exit_code: 0, stdout: '', stderr: '' } : { exit_code: 1, stdout: '', stderr: 'fatal: not a valid object name' }
  }
  return hostForTests({ run }).host.processes
}

/** The clone one commit ahead of origin, which is the case that cost the owner a second ask. */
const THE_TWO_COPIES: Readonly<Record<string, string>> = {
  [`rev-parse --verify --quiet refs/heads/${THE_BRANCH}`]: `${THE_LOCAL_TIP}\n`,
  [`ls-remote --heads origin refs/heads/${THE_BRANCH}`]: `${THE_ORIGIN_TIP}\trefs/heads/${THE_BRANCH}\n`,
}

/** The declaration a place is built over, with the clones place the tips are read in. */
const theSettingsWith = (clones: string | null): CrewSettings => ({
  paths: { root, crew: join(root, DECLARATION_DIRECTORY), declaration: join(root, DECLARATION_DIRECTORY, DECLARATION_FILE), conventions: null },
  owner: 'Ann',
  members: [
    { name: LEAD, role: SUPERVISOR, model: null },
    { name: BUILDER, role: 'builder', model: null },
  ],
  mode: {
    name: 'team',
    roles: [SUPERVISOR, 'builder'],
    may: {
      assign_work: [SUPERVISOR],
      approve_landing: [OWNER],
      resume_parked_work: [SUPERVISOR],
      [OFFER_OWNER_ASKS]: [SUPERVISOR],
      [RESTART_MEMBER]: [SUPERVISOR],
    },
  },
  house_rules: {
    owner_items: false,
    workspace_layout: true,
    member_work: false,
    practice: false,
    [STRICT_GATE]: false,
    [DASHBOARD]: false,
    [REFRESH_BETWEEN_TASKS]: false,
    [OWNER_BELL]: false,
    [NUDGES]: false,
    review_model: null,
    [CLONES]: clones,
    [WORKTREES]: join(home, 'the-worktrees'),
    [STALLED_MINUTES]: null,
    [REVIEW_MINUTES]: null,
    [PERSON_MINUTES]: null,
  },
  channel_read_seconds: 30,
})

/** A place of the test's own, over `rows`, with the git and declaration it is handed: either may be left out. */
function aPlaceOver(rows: string, held: { member?: string; processes?: Processes; settings?: CrewSettings }): CrewTools {
  mkdirSync(join(home, rows), { mode: STREAM_DIRECTORY_MODE, recursive: true })
  return crewToolsOver({
    member: held.member ?? BUILDER,
    ledger: { clock: { now: () => clock.at }, stores: { rows: rowStreamsDirectory(join(home, rows)) } },
    beats: dashboardRowsIn(join(home, 'row')),
    root,
    documents,
    stores: { crew: crewFilesDirectory(join(home, 'the-crew-store')) },
    ...held,
  })
}

test('an ask that removes a branch records both tips, read in the clone it names, and both tools that show the queue name them (martha#391)', async () => {
  const asked: string[] = []
  const place = aPlaceOver('rows-for-branches', { processes: aGitOnlyInTheClone(THE_TWO_COPIES, asked), settings: theSettingsWith(THE_CLONES) })
  clock.at = 6_000
  const told = TOLD(await place.answer(QUEUE_ASK, { ask: `Delete the merged branch ${THE_BRANCH}?`, repo: THE_REPO, branch: THE_BRANCH }, 'session-builder'))
  assert.equal(told, `Queued for the owner; 1 ask waiting. ${THE_TIPS_SAID} Do not open a menu for it; carry on.`, 'the member reads what the owner will be told')
  assert.deepEqual([...new Set(asked.map((one) => one.slice(0, THE_CLONE.length)))], [THE_CLONE], 'both tips are read in <clones>/<org>/<repo>: a read anywhere else answers no repository')
  assert.equal(asked.length, 2, 'two refs are read: the clone\'s own branch, and origin itself')

  assert.match(TOLD(await place.answer(LIST_ASKS, {}, 'session-lead')), new RegExp(`- 0 \\(from Builder1\\): Delete the merged branch vesta/313-old\\? It removes ${THE_BRANCH}`), 'list_asks names both tips')
  const lead = aPlaceOver('rows-for-branches', { member: LEAD, processes: aGitOnlyInTheClone(THE_TWO_COPIES), settings: theSettingsWith(THE_CLONES) })
  assert.match(TOLD(await lead.answer(TAKE_ASKS, {}, 'session-lead')), /It removes vesta\/313-old, and the ask records both tips the yes covers: this clone at 72081ee, origin at e8c127a\./, 'take_asks, which the menu is built from, names both tips')
})

test('a removal this launch cannot read is refused by name, and nothing is queued (martha#391)', async () => {
  const half = aPlaceOver('rows-for-half', { processes: aGitOnlyInTheClone(THE_TWO_COPIES), settings: theSettingsWith(THE_CLONES) })
  assert.equal(
    REFUSED(await half.answer(QUEUE_ASK, { ask: `Delete ${THE_BRANCH}?`, branch: THE_BRANCH }, 'session-builder')),
    'an ask that removes a branch names both repo (as owner/name) and branch together: they say which copy the yes removes',
    'half a removal is refused by its own words, never dying on the way to git',
  )

  const notARepo = aPlaceOver('rows-for-not-a-repo', { processes: aGitOnlyInTheClone(THE_TWO_COPIES), settings: theSettingsWith(THE_CLONES) })
  assert.equal(
    REFUSED(await notARepo.answer(QUEUE_ASK, { ask: `Delete ${THE_BRANCH}?`, repo: 'macula-io', branch: THE_BRANCH }, 'session-builder')),
    'an ask that removes a branch names both repo (as owner/name) and branch together: they say which copy the yes removes',
    'an organisation is not a repository',
  )

  const noPlaces = aPlaceOver('rows-for-no-places', { settings: theSettingsWith(null) })
  assert.equal(
    REFUSED(await noPlaces.answer(QUEUE_ASK, { ask: `Delete ${THE_BRANCH}?`, repo: THE_REPO, branch: THE_BRANCH }, 'session-builder')),
    'this launch holds no processes or names no clones place, so the tips of the branch this ask removes cannot be read',
    'a place with no clones place refuses by name rather than recording half a deletion',
  )

  const nothingThere = aPlaceOver('rows-for-nothing-there', { processes: aGitOnlyInTheClone({}), settings: theSettingsWith(THE_CLONES) })
  assert.equal(
    REFUSED(await nothingThere.answer(QUEUE_ASK, { ask: `Delete ${THE_BRANCH}?`, repo: THE_REPO, branch: THE_BRANCH }, 'session-builder')),
    `neither ${THE_CLONE} nor origin holds ${THE_BRANCH}, so there is no deletion for the owner to answer`,
    'a branch neither copy holds is refused, naming the clone',
  )

  for (const rows of ['rows-for-half', 'rows-for-not-a-repo', 'rows-for-no-places', 'rows-for-nothing-there']) {
    const place = aPlaceOver(rows, { processes: aGitOnlyInTheClone(THE_TWO_COPIES), settings: theSettingsWith(THE_CLONES) })
    assert.equal(TOLD(await place.answer(LIST_ASKS, {}, 'session-lead')), 'No asks are waiting for the owner.', `${rows}: a refused removal queues nothing`)
  }
})

test('a place handed no menu record keeps its own over the crew clock, so a menu its host closed still settles', async () => {  const place = crewToolsOver({
    member: LEAD,
    ledger: { clock: { now: () => clock.at }, stores: { rows: rowStreamsDirectory(join(home, 'rows-without-menus')) } },
    beats: dashboardRowsIn(join(home, 'row')),
    root,
    documents,
    stores: { crew: crewFilesDirectory(join(home, 'the-crew-store')) },
  })
  clock.at = 4_000
  TOLD(await place.answer(QUEUE_ASK, { ask: 'Remove the stale worktree?' }, 'session-lead'))
  const batch = Number(/settle batch (\d+)/.exec(TOLD(await place.answer(TAKE_ASKS, {}, 'session-lead')))?.[1])
  clock.at = 5_000
  place.noteTheCallsAnswer({ tool: MENU_TOOL }, 'session-lead')
  assert.match(TOLD(await place.answer(SETTLE_ASKS, { batch, yes: [0] }, 'session-lead')), /^Batch \d+ settled: 1 the owner ticked, 0 back in the queue\.$/)
})
