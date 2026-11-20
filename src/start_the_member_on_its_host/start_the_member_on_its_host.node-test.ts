// One start call, one launcher per host (martha#541 package 5): a member is started on the host its declaration names
// for it, and on no other.
//
// These tests drive the table and the command lookup directly: what a start on a host runs on is the whole of what the
// start call asks the table, and the declarations here are made in memory, so nothing is written where a test would
// have to clean it up.

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { CLOSED_VOCABULARY, type ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import {
  DECLARATION_DIRECTORY,
  DECLARATION_FILE,
  DECLARATION_VERSION,
  HOLD_REVIEWS,
  HOST,
  MODE_TEXTS_DIRECTORY,
  REVIEW_MODEL,
  ROLE_TEXTS_DIRECTORY,
  SOLO_MODE,
  THE_ENGINES_HOST,
  THE_HOST_A_MEMBER_RAN_ON,
  declareCrew,
  theHostOfMember,
  type CrewSettings,
} from '../declare_crew/declare_crew.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import type { HandoverStampStore } from '../host_contract/host_contract.ts'
import type { Approval } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { CLAUDE, CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { THE_MODELS_SWITCH } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import {
  THE_LAUNCHERS_OF_HOST,
  leftoversOfALaunch,
  noLauncherFor,
  theLaunchOfAClaudeCodeStart,
  theStartOfAHost,
  theStartOfAMember,
  type AHostsLauncher,
  type AStartOnItsHost,
  type TheLaunchersOfHost,
} from './start_the_member_on_its_host.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { THE_ENGINES_INSTALL } from '../start_an_engine_member/start_an_engine_member.ts'

/** A host no release has a launcher for: this test's own name. */
const A_HOST_NO_RELEASE_HAS = 'a-host-no-release-has'

const HOST_MODELS: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: ['opus', 'fable'] }

/** A made-up project root: this repository is public, so no real path appears here. */
const ROOT = '/martha-project'
const declaration_path = join(ROOT, DECLARATION_DIRECTORY, DECLARATION_FILE)

/** The crew file two members are declared in: one on each host, so a start has to tell them apart. */
const TWO_HOSTS = JSON.stringify({
  version: DECLARATION_VERSION,
  owner: 'Ann',
  host: THE_HOST_A_MEMBER_RAN_ON,
  members: [
    { name: 'Builder', role: 'builder' },
    { name: 'Reviewer', role: 'reviewer', [HOST]: THE_ENGINES_HOST },
  ],
  mode: { name: SOLO_MODE, roles: ['builder', 'reviewer'], may: {} },
})

async function settingsOf(text: string): Promise<CrewSettings> {
  return declareCrew(hostForTests({ documents: { [declaration_path]: text } }).host.stores.documents, ROOT, HOST_MODELS)
}

/** A launcher that records every start it is handed, so a test can say which entry a host reached. */
function aStandIn(command: string): AHostsLauncher & { readonly started: AStartOnItsHost[] } {
  const started: AStartOnItsHost[] = []
  return {
    command,
    install: `the stand-in host, runnable as ${command}`,
    started,
    start: (start: AStartOnItsHost) => {
      started.push(start)
      return Promise.resolve({ started: false, refusal: 'a stand-in launcher never starts a member' })
    },
  }
}

/** A directory holding one runnable file, which is the only command a start on this path finds. */
function aPathHolding(t: TestContext, command: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'martha-hosts-'))
  t.after(() => removeTheTree(directory))
  writeFileSync(join(directory, command), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  return directory
}

test('each member reaches the entry for the host its declaration names, and the other entry is never asked (martha#541)', async (t) => {
  const settings = await settingsOf(TWO_HOSTS)
  const [builder, reviewer] = settings.members
  const onTheBuildersHost = aStandIn('builder-host')
  const onTheReviewersHost = aStandIn('engine-host')
  const table: TheLaunchersOfHost = { [THE_HOST_A_MEMBER_RAN_ON]: onTheBuildersHost, [THE_ENGINES_HOST]: onTheReviewersHost }
  const path = aPathHolding(t, 'builder-host')
  const enginePath = aPathHolding(t, 'engine-host')
  const forBuilder = theStartOfAHost(theHostOfMember(settings, builder!), { PATH: path }, table)
  assert.ok(typeof forBuilder !== 'string', String(forBuilder))
  assert.equal(forBuilder.launcher, onTheBuildersHost)
  assert.equal(onTheReviewersHost.started.length, 0, 'the host the reviewer names was asked to start the builder')
  const forReviewer = theStartOfAHost(theHostOfMember(settings, reviewer!), { PATH: enginePath }, table)
  assert.ok(typeof forReviewer !== 'string', String(forReviewer))
  assert.equal(forReviewer.launcher, onTheReviewersHost)
  assert.equal(onTheBuildersHost.started.length, 0, 'the host the builder names was asked to start the reviewer')
})

test('a host this release has no launcher for is refused by name, and no other host is tried (martha#541, #547 line 39)', () => {
  const refusal = theStartOfAHost(A_HOST_NO_RELEASE_HAS, { PATH: '/nowhere' })
  assert.equal(refusal, noLauncherFor(A_HOST_NO_RELEASE_HAS))
  assert.ok(String(refusal).includes(A_HOST_NO_RELEASE_HAS), String(refusal))
  assert.ok(String(refusal).includes(Object.keys(THE_LAUNCHERS_OF_HOST).join(', ')), String(refusal))
})

test('a host whose command is not on the path is refused, naming the install, before anything starts (martha#541)', () => {
  const refusal = theStartOfAHost(CLAUDE_CODE, { PATH: '' })
  assert.equal(typeof refusal, 'string')
  assert.ok(String(refusal).includes(CLAUDE), String(refusal))
  assert.ok(String(refusal).includes(THE_LAUNCHERS_OF_HOST[CLAUDE_CODE]!.install), String(refusal))
})

test('the command a start runs is the host\'s own fact, found on the path and handed to the entry unchanged (martha#541)', (t) => {
  const path = aPathHolding(t, 'a-stand-in-command')
  const table: TheLaunchersOfHost = { [CLAUDE_CODE]: aStandIn('a-stand-in-command') }
  const start = theStartOfAHost(CLAUDE_CODE, { PATH: path }, table)
  assert.ok(typeof start !== 'string', String(start))
  // The file it found, not the bare name: the launch starts exactly what was checked.
  assert.equal(start.command, join(path, 'a-stand-in-command'))
  // And the fact itself: Claude Code's entry starts `claude`, from the host's own facts, never a word written here.
  assert.equal(THE_LAUNCHERS_OF_HOST[CLAUDE_CODE]!.command, CLAUDE)
})

test('#541 package A: the engine\'s entry starts the recorded engine\'s command, its install names the recorded version and commit, and a refusal names both hosts', () => {
  const entry = THE_LAUNCHERS_OF_HOST[THE_ENGINES_HOST]
  assert.ok(entry !== undefined, 'the start table has no entry for the engine')
  assert.equal(entry.command, RECORDED_GOOSE_ENGINE.engine_name)
  assert.equal(entry.install, THE_ENGINES_INSTALL)
  for (const fact of [RECORDED_GOOSE_ENGINE.engine_name, RECORDED_GOOSE_ENGINE.engine_version, RECORDED_GOOSE_ENGINE.engine_commit]) assert.ok(entry.install.includes(fact), entry.install)
  const refusal = noLauncherFor(A_HOST_NO_RELEASE_HAS)
  for (const host of [CLAUDE_CODE, THE_ENGINES_HOST]) assert.ok(refusal.includes(host), refusal)
})

/** A one-host crew whose reviewer holds reviews, and whose reviewer runs on `reviewer_model` (martha#541 package 6b). */
const aCrewWhoseReviewerRuns = (reviewer_model: string) =>
  JSON.stringify({
    version: DECLARATION_VERSION,
    owner: 'Ann',
    host: THE_HOST_A_MEMBER_RAN_ON,
    members: [
      { name: 'Builder', role: 'builder' },
      { name: 'Reviewer', role: 'reviewer', model: reviewer_model },
    ],
    mode: { name: SOLO_MODE, roles: ['builder', 'reviewer'], may: { [HOLD_REVIEWS]: ['reviewer'] } },
    house_rules: { [REVIEW_MODEL]: 'fable' },
  })

test('#541 6b: a start asks the crew\'s reviewer rule over the host it found (mutant: the reviewer rule not asked at a start)', async (t) => {
  // The path holds a runnable file named for the host's own command, so the start reaches the rule after the lookup.
  const path = aPathHolding(t, CLAUDE)
  const offItsModel = await settingsOf(aCrewWhoseReviewerRuns('opus'))
  const [builder, reviewer] = offItsModel.members
  const refused = theStartOfAMember(CLAUDE_CODE, { PATH: path }, reviewer!, offItsModel)
  assert.match(String(refused), /Reviewer holds reviews .* holds reviews to fable; its model is opus\./, 'a reviewer member off the crew\'s reviewer model was allowed to start')
  assert.ok(typeof theStartOfAMember(CLAUDE_CODE, { PATH: path }, builder!, offItsModel) !== 'string', 'a member that holds no reviews was refused a start')

  const onItsModel = await settingsOf(aCrewWhoseReviewerRuns('fable'))
  const itsReviewer = onItsModel.members[1]!
  const started = theStartOfAMember(CLAUDE_CODE, { PATH: path }, itsReviewer, onItsModel)
  assert.ok(typeof started !== 'string', `a reviewer member on the crew's reviewer model was refused a start: ${started}`)
  assert.equal(started.command, join(path, CLAUDE), 'the start did not run the command it found on the path')

  // The owner's own model switch never reaches a reviewer member (package 6b r=3): it is a second value for the switch
  // the declared model already gave, and nothing reads back which one a host took.
  const withTheOwnersSwitch = theStartOfAMember(CLAUDE_CODE, { PATH: path }, itsReviewer, onItsModel, [THE_MODELS_SWITCH, 'opus'])
  assert.match(String(withTheOwnersSwitch), /the owner's --model names opus/, `a reviewer member was started with the owner's own ${THE_MODELS_SWITCH}: ${withTheOwnersSwitch}`)
  assert.ok(
    typeof theStartOfAMember(CLAUDE_CODE, { PATH: path }, builder!, offItsModel, [THE_MODELS_SWITCH, 'opus']) !== 'string',
    'a member that holds no reviews was refused the owner\'s model switch',
  )
})

test('#541 6b r=3: a reviewer member on the engine reaches the engine\'s launcher, which reads its model back from the written root (package A)', async (t) => {
  // The pin on the engine's read-back (package 6b design r=3, item B) moved with the launcher that arrived (martha#541
  // package A): the start reads the model its config root names back and refuses another
  // (../start_an_engine_member/the_engines_model.node-test.ts, and the launch-level mutant in start_an_engine_member's
  // own test). Here: the crew's reviewer rule still holds the reviewer to the review model, and a reviewer on that model
  // reaches the engine's entry rather than a refusal.
  const path = aPathHolding(t, RECORDED_GOOSE_ENGINE.engine_name)
  const settings = await settingsOf(aCrewWhoseReviewerRuns('fable'))
  const reviewer = settings.members[1]!
  const started = theStartOfAMember(THE_ENGINES_HOST, { PATH: path }, reviewer, settings)
  assert.ok(typeof started !== 'string', String(started))
  assert.equal(started.launcher, THE_LAUNCHERS_OF_HOST[THE_ENGINES_HOST])
  const offItsModel = await settingsOf(aCrewWhoseReviewerRuns('opus'))
  assert.match(String(theStartOfAMember(THE_ENGINES_HOST, { PATH: path }, offItsModel.members[1]!, offItsModel)), /holds reviews to fable; its model is opus\./)
})

/** The crew's layout places, as a declaration names them: no constant in the tree carries these path segments. */
const LAID_OUT = { clones: '/laid/out/first-places', worktrees: '/laid/out/second-places' }

/** A declaration carrying only what a launch's leftovers read: the layout switch, its places, and the members. */
const layoutDeclared = (on: boolean): CrewSettings =>
  ({
    house_rules: { workspace_layout: on, clones: LAID_OUT.clones, worktrees: LAID_OUT.worktrees },
    members: [{ name: 'Hygiea' }, { name: 'Uranus' }],
  }) as unknown as CrewSettings

test('a start hands its launch the workspace its declaration lays out, and the crew store its end reads (#562, #693)', () => {
  // The launch tests hand `leftovers.workspace` in themselves, so nothing there says a real start gives the scan one at
  // all: this reads the start's own builder, from a planted declaration, and holds it to the planted places.
  const crew = hostForTests().host.stores.crew
  const declared = leftoversOfALaunch(layoutDeclared(true), crew)
  assert.deepEqual(declared.workspace, { clones: LAID_OUT.clones, worktrees: LAID_OUT.worktrees, members: ['Hygiea', 'Uranus'] })
  assert.equal(declared.crew, crew, 'the crew store the launch end keeps what a killed command left in is not the one the start was given')
  assert.equal(leftoversOfALaunch(layoutDeclared(false), crew).workspace, undefined, 'a crew that declared no layout handed its launch a workspace anyway')
})

/**
 * The places and names a planted start carries (martha#784). Every one is a value of its own, so a field read back
 * from the built launch names the input it came from: a literal at the call site matches none of them.
 */
const PLANTED = {
  member: 'Hygiea',
  /** A second member of the planted crew, so the workspace's member list is read back whole. */
  another_member: 'Themis',
  root: '/planted/project/place',
  home: '/planted/owners/home',
  snapshots: '/planted/state/snapshots',
  crew: '/planted/equipage/directory',
  conventions: '/planted/equipage/directory/notes-of-the-equipage.md',
  mode: 'amendment-mode',
  roles: ['reader-of-the-docket', 'keeper-of-the-docket'],
  clones: '/planted/layout/first-places',
  worktrees: '/planted/layout/second-places',
} as const

/** The one yes the owner gave the planted start, whose fingerprint and tree appear nowhere else. */
const THE_APPROVAL: Approval = {
  fingerprint: 'planted-approval-fingerprint',
  approved_at: '2026-11-19T00:00:00.000Z',
  entries: [],
  tree: 'planted-tree-id',
}

/** The crew text files the planted declaration names, built from the declaration's own fields and not from a helper. */
const THE_PLANTED_CREW_TEXTS = [
  join(PLANTED.crew, ROLE_TEXTS_DIRECTORY, `${PLANTED.roles[0]}.md`),
  join(PLANTED.crew, ROLE_TEXTS_DIRECTORY, `${PLANTED.roles[1]}.md`),
  join(PLANTED.crew, MODE_TEXTS_DIRECTORY, `${PLANTED.mode}.md`),
  PLANTED.conventions,
]

/** A declaration carrying what the launch's four fields read: the crew's place, its texts, its layout and its members. */
const thePlantedDeclaration = (): CrewSettings =>
  ({
    paths: { crew: PLANTED.crew, conventions: PLANTED.conventions },
    mode: { name: PLANTED.mode, roles: PLANTED.roles, may: {} },
    house_rules: { workspace_layout: true, clones: PLANTED.clones, worktrees: PLANTED.worktrees },
    members: [{ name: PLANTED.member }, { name: PLANTED.another_member }],
  }) as unknown as CrewSettings

/** A start whose every field is a planted value, so what a real start builds is read back against its inputs. */
function aPlantedStart(t: TestContext): AStartOnItsHost {
  // The approval's own-writes store is kept beside Martha's state, so the planted state is a directory of this test's
  // own, removed with it: every other place below is read, never written.
  const state = mkdtempSync(join(tmpdir(), 'martha-a-planted-start-'))
  t.after(() => removeTheTree(state))
  const { host } = hostForTests()
  const noStamps: HandoverStampStore = { read: () => undefined, write: () => undefined }
  return {
    member: PLANTED.member,
    node_id: 'planted-node-id',
    model: null,
    approval: THE_APPROVAL,
    settings: thePlantedDeclaration(),
    root: PLANTED.root,
    home: PLANTED.home,
    args: [],
    prompt: undefined,
    inherited: { PATH: '/planted/path' },
    stdio: 'inherit',
    documents: host.stores.documents,
    state: { directory: state, state_root: '/planted/state/root' },
    places: {
      state_root: '/planted/state/root',
      rows: '/planted/state/the-row-streams',
      dashboard: '/planted/state/the-beats',
      launch_records: '/planted/state/launch-records',
      relay_root: '/planted/state/relays',
      mesh_servers: '/planted/state/mesh-servers',
      relay_journal: '/planted/state/journal',
    },
    snapshot_root: PLANTED.snapshots,
    crew_stores: { crew: host.stores.crew, stamps: noStamps },
    restart: {},
    channel: { clock: { now: () => 1_700_000_000_000 }, stores: { rows: host.stores.rows } },
    command: '/planted/path/the-hosts-own-command',
    tellOwner: () => undefined,
  }
}

test('#784: a real start hands its launcher the launch it built, so a literal at the call site fails here by name', (t) => {
  // The launch tests build their own request and the start tests swap the whole host launcher, so this is the one place
  // that reads what `startOnClaudeCode` would really hand on: each field below, and nothing derived from a helper that
  // builds it, so a call site handing a literal (the survivor martha#784 names, `leftovers.workspace: undefined`) goes red.
  const planted = aPlantedStart(t)
  const launch = theLaunchOfAClaudeCodeStart(planted)

  // Its place: the three places the start was given, and the host it was started on.
  assert.equal(launch.place.host, CLAUDE_CODE, 'the launch was started on a host the start did not name')
  assert.equal(launch.place.launch_dir, PLANTED.root, 'the launch was not given the project place the start decided')
  assert.equal(launch.place.stop_dir, PLANTED.home, 'the launch was not given the home its gate stops at')
  assert.equal(launch.place.snapshot_root, PLANTED.snapshots, 'the launch was not given the snapshot root the start decided')

  // Its leftovers: the crew's own store the start holds, and the layout its declaration lays out.
  assert.equal(launch.leftovers?.crew, planted.crew_stores.crew, 'the launch was given a crew store that is not the one the start holds')
  assert.deepEqual(
    launch.leftovers?.workspace,
    { clones: PLANTED.clones, worktrees: PLANTED.worktrees, members: [PLANTED.member, PLANTED.another_member] },
    'the launch was handed no workspace, or not the one its planted declaration lays out',
  )

  // Its crew text files: the files the declaration names, read from the planted places.
  assert.deepEqual(launch.place.crew_text_files, THE_PLANTED_CREW_TEXTS, 'the launch was not handed the crew text files its declaration names')

  // Its approval: the owner's one yes, and the member whose own writes are kept for this launch.
  assert.deepEqual(launch.place.approved_fingerprints, [THE_APPROVAL.fingerprint], 'the launch was not held to the approval the start was given')
  assert.equal(launch.place.approved_tree, THE_APPROVAL.tree, 'the launch was not read under the tree the owner approved')
  assert.equal(launch.place.since_approval?.member, PLANTED.member, 'the launch kept no own writes for the member that was started')
})
