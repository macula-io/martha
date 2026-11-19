// The config one Goose launch writes, held to the recording (martha#797): the provider must be the one recorded,
// no setting may replace the engine's hint files, no setting may carry the engine's own prefix, and every other
// setting must be one the provider's recording names.
//
// Every name here is read from `RECORDED_GOOSE_ENGINE`, never typed beside it, and a name the check is meant to
// refuse is derived from the recording and asserted to be in no list the check reads first: a coincidence would
// leave the case blind (martha#692).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ENGINE_PLACES } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { SKILLS_OFF, theConfigOfALaunch, type TheModelALaunchRuns } from './derive_the_config_of_a_goose_launch.ts'

const FACTS = RECORDED_GOOSE_ENGINE

/** A setting the provider's recording names, which is the only kind a declaration may carry. */
function aRecordedSetting(): string {
  const setting = FACTS.openai_provider.settings[0]
  if (setting === undefined) throw new Error('the recording names no provider setting, so no declaration could carry one')
  return setting
}

/** A declaration a launch could be asked to run, with the recorded provider unless a case names another. */
function aDeclaration(settings: Readonly<Record<string, string>>, provider: string = FACTS.openai_provider.name): TheModelALaunchRuns {
  return { provider, model: 'a-model-a-test-names', settings }
}

/** Asserts that `run` is refused with a message that says every one of `mustSay`. */
function refusedSaying(run: () => unknown, mustSay: readonly string[]): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof Error, 'a refusal is not an error')
    for (const word of mustSay) assert.ok(error.message.includes(word), `the refusal does not say ${JSON.stringify(word)}: ${error.message}`)
    return true
  })
}

test('only the provider the recording holds can be launched, and a name written beside the recording is refused (martha#797; mutant: the provider check dropped)', () => {
  const recorded = FACTS.openai_provider.name
  assert.doesNotThrow(() => theConfigOfALaunch(FACTS, aDeclaration({}, recorded)))
  const unrecorded = `${recorded}-not-recorded`
  assert.notEqual(unrecorded, recorded, 'the unrecorded provider is the recorded one')
  refusedSaying(() => theConfigOfALaunch(FACTS, aDeclaration({}, unrecorded)), [unrecorded, recorded, 'recording package'])
})

test('a setting that replaces the engine\'s hint files is refused by the name the recording gives it, quoting the value as it is written (martha#797; mutant: the hint-setting check dropped)', () => {
  const value = `["${FACTS.hint_files.goose_hints}"]`
  refusedSaying(() => theConfigOfALaunch(FACTS, aDeclaration({ [FACTS.hint_files.setting]: value })), [
    FACTS.hint_files.setting,
    JSON.stringify(value),
    ...FACTS.hint_files.when_unset,
  ])
})

test('an unparsable value under the hint-files setting is refused with the hint words, not with a parse error (martha#797, R3)', () => {
  const notAList = 'not a list of files'
  refusedSaying(() => theConfigOfALaunch(FACTS, aDeclaration({ [FACTS.hint_files.setting]: notAList })), [
    FACTS.hint_files.setting,
    JSON.stringify(notAList),
    ...FACTS.hint_files.when_unset,
  ])
})

test('every setting the provider\'s recording names is written as it is (martha#797; mutant: the allow-list refuses everything)', () => {
  // Every entry, never one fixture: an allow-list that admitted only the first would survive a single case.
  for (const setting of FACTS.openai_provider.settings) {
    const value = 'a-value-a-test-names'
    assert.ok(theConfigOfALaunch(FACTS, aDeclaration({ [setting]: value })).includes(`${setting}: "${value}"`), `${setting} is not written as the recording names it`)
  }
})

test('a setting no recording names is refused, and the refusal says where the list comes from (martha#797; mutant: the allow-list dropped)', () => {
  const unrecorded = `${aRecordedSetting()}-not-recorded`
  assert.equal(FACTS.openai_provider.settings.includes(unrecorded), false, 'the unrecorded setting is one the recording names')
  refusedSaying(() => theConfigOfALaunch(FACTS, aDeclaration({ [unrecorded]: 'a-value-a-test-names' })), [unrecorded, FACTS.openai_provider.name, ENGINE_PLACES.openai_provider])
})

test('the same name in another case is another key, and refused (martha#797; mutant: the comparison case-folded)', () => {
  const anotherCase = aRecordedSetting().toLowerCase()
  for (const setting of FACTS.openai_provider.settings) assert.notEqual(setting, anotherCase, `${anotherCase} is a name the recording already holds`)
  refusedSaying(() => theConfigOfALaunch(FACTS, aDeclaration({ [anotherCase]: 'a-value-a-test-names' })), [anotherCase])
})

test('a recorded setting whose value carries a line break is refused (martha#797; mutant: the value check dropped)', () => {
  refusedSaying(() => theConfigOfALaunch(FACTS, aDeclaration({ [aRecordedSetting()]: 'a value\nwith a line of its own' })), ['line break'])
})

test('both skills switches are written off by the names the recording gives them, whatever the engine does when they are unset (martha#839; mutants: either line dropped)', () => {
  const switches = [FACTS.skills_advertised.setting, FACTS.builtin_skills_advertised.setting]
  assert.notEqual(switches[0], switches[1], 'the two switches are one setting, so one line would pass for both')
  for (const when_unset of [true, false]) {
    const facts = { ...FACTS, skills_advertised: { ...FACTS.skills_advertised, when_unset }, builtin_skills_advertised: { ...FACTS.builtin_skills_advertised, when_unset } }
    const lines = theConfigOfALaunch(facts, aDeclaration({})).split('\n')
    for (const setting of switches) {
      assert.deepEqual(lines.filter((line) => line.startsWith(`${setting}:`)), [`${setting}: ${String(SKILLS_OFF)}`], `${setting} with the engine's default ${String(when_unset)}`)
    }
  }
  assert.equal(SKILLS_OFF, false, 'the switches offer skills when true, so off is false')
})
