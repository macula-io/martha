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
  REVIEW_MODEL,
  SOLO_MODE,
  THE_ENGINES_HOST,
  THE_HOST_A_MEMBER_RAN_ON,
  declareCrew,
  theHostOfMember,
  type CrewSettings,
} from '../declare_crew/declare_crew.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { CLAUDE, CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { THE_MODELS_SWITCH } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import {
  THE_LAUNCHERS_OF_HOST,
  noLauncherFor,
  theStartOfAHost,
  theStartOfAMember,
  type AHostsLauncher,
  type AStartOnItsHost,
  type TheLaunchersOfHost,
} from './start_the_member_on_its_host.ts'

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
  const refusal = theStartOfAHost(THE_ENGINES_HOST, { PATH: '/nowhere' })
  assert.equal(refusal, noLauncherFor(THE_ENGINES_HOST))
  assert.ok(String(refusal).includes(THE_ENGINES_HOST), String(refusal))
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

test('the engine has no launcher in this release, so a declaration may name it and a start of it is refused by name (martha#541)', () => {
  assert.equal(Object.hasOwn(THE_LAUNCHERS_OF_HOST, THE_ENGINES_HOST), false)
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

test('#541 6b r=3: a reviewer member on the engine is refused to start by name, until its launcher reads the model back', async () => {
  // This is the pin on the engine's read-back (package 6b design r=3, item B): when a launcher for `martha-engine`
  // arrives it must read the model its own config root names back, and this test is updated with it. A launcher that
  // lifts this refusal without that read-back turns this test red rather than passing quietly.
  const settings = await settingsOf(aCrewWhoseReviewerRuns('fable'))
  const reviewer = settings.members[1]!
  assert.equal(
    theStartOfAMember(THE_ENGINES_HOST, { PATH: '/nowhere' }, reviewer, settings),
    noLauncherFor(THE_ENGINES_HOST),
    'a reviewer member on martha-engine is no longer refused by the missing launcher, and nothing in this release reads its model back yet',
  )
})
