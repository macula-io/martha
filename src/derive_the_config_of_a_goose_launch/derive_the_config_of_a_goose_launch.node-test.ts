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
import { KEYRING_OFF, SKILLS_OFF, theConfigOfALaunch, theSecretsOfALaunch, theServersAConfigNames, THE_EXTENSIONS_SETTING, type AToolServerTheConfigNames, type TheModelALaunchRuns } from './derive_the_config_of_a_goose_launch.ts'

const FACTS = RECORDED_GOOSE_ENGINE

/** A tool server a test names: the config writes it after every setting these cases read. */
const A_SERVER: AToolServerTheConfigNames = { key: 'a-server-a-test-names', entry: [['cmd', 'a-command-a-test-names']] }

/** A setting the provider's recording names and does not read as a secret, which is the only kind a declaration's settings may carry. */
function aRecordedSetting(): string {
  const setting = FACTS.openai_provider.settings.find((one) => !FACTS.openai_provider.secrets.includes(one))
  if (setting === undefined) throw new Error('the recording names no provider setting that is not a secret, so no declaration could carry one')
  return setting
}

/** A secret the provider reads, by its recorded name (#541 package A). */
function aRecordedSecret(): string {
  const secret = FACTS.openai_provider.secrets[0]
  if (secret === undefined) throw new Error('the recording names no secret the provider reads, so no launch could write one')
  return secret
}

/** A declaration a launch could be asked to run, with the recorded provider unless a case names another. */
function aDeclaration(settings: Readonly<Record<string, string>>, provider: string = FACTS.openai_provider.name): TheModelALaunchRuns {
  return { provider, model: 'a-model-a-test-names', settings, secrets: { [aRecordedSecret()]: 'a-secret-a-test-names' } }
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
  assert.doesNotThrow(() => theConfigOfALaunch(FACTS, aDeclaration({}, recorded), A_SERVER))
  const unrecorded = `${recorded}-not-recorded`
  assert.notEqual(unrecorded, recorded, 'the unrecorded provider is the recorded one')
  refusedSaying(() => theConfigOfALaunch(FACTS, aDeclaration({}, unrecorded), A_SERVER), [unrecorded, recorded, 'recording package'])
})

test('a setting that replaces the engine\'s hint files is refused by the name the recording gives it, quoting the value as it is written (martha#797; mutant: the hint-setting check dropped)', () => {
  const value = `["${FACTS.hint_files.goose_hints}"]`
  refusedSaying(() => theConfigOfALaunch(FACTS, aDeclaration({ [FACTS.hint_files.setting]: value }), A_SERVER), [
    FACTS.hint_files.setting,
    JSON.stringify(value),
    ...FACTS.hint_files.when_unset,
  ])
})

test('an unparsable value under the hint-files setting is refused with the hint words, not with a parse error (martha#797, R3)', () => {
  const notAList = 'not a list of files'
  refusedSaying(() => theConfigOfALaunch(FACTS, aDeclaration({ [FACTS.hint_files.setting]: notAList }), A_SERVER), [
    FACTS.hint_files.setting,
    JSON.stringify(notAList),
    ...FACTS.hint_files.when_unset,
  ])
})

test('every setting the provider\'s recording names, and does not read as a secret, is written as it is (martha#797; mutant: the allow-list refuses everything)', () => {
  // Every entry, never one fixture: an allow-list that admitted only the first would survive a single case. A secret is
  // the secrets file's, never the config's (#541 package A), and has a case of its own.
  const settings = FACTS.openai_provider.settings.filter((setting) => !FACTS.openai_provider.secrets.includes(setting))
  assert.ok(settings.length > 1, 'fewer than two settings are left once the secrets are taken out, so an allow-list admitting only the first would survive')
  for (const setting of settings) {
    const value = 'a-value-a-test-names'
    assert.ok(theConfigOfALaunch(FACTS, aDeclaration({ [setting]: value }), A_SERVER).includes(`${setting}: "${value}"`), `${setting} is not written as the recording names it`)
  }
})

test('a setting no recording names is refused, and the refusal says where the list comes from (martha#797; mutant: the allow-list dropped)', () => {
  const unrecorded = `${aRecordedSetting()}-not-recorded`
  assert.equal(FACTS.openai_provider.settings.includes(unrecorded), false, 'the unrecorded setting is one the recording names')
  refusedSaying(() => theConfigOfALaunch(FACTS, aDeclaration({ [unrecorded]: 'a-value-a-test-names' }), A_SERVER), [unrecorded, FACTS.openai_provider.name, ENGINE_PLACES.openai_provider])
})

test('the same name in another case is another key, and refused (martha#797; mutant: the comparison case-folded)', () => {
  const anotherCase = aRecordedSetting().toLowerCase()
  for (const setting of FACTS.openai_provider.settings) assert.notEqual(setting, anotherCase, `${anotherCase} is a name the recording already holds`)
  refusedSaying(() => theConfigOfALaunch(FACTS, aDeclaration({ [anotherCase]: 'a-value-a-test-names' }), A_SERVER), [anotherCase])
})

test('a recorded setting whose value carries a line break is refused (martha#797; mutant: the value check dropped)', () => {
  refusedSaying(() => theConfigOfALaunch(FACTS, aDeclaration({ [aRecordedSetting()]: 'a value\nwith a line of its own' }), A_SERVER), ['line break'])
})

test('both skills switches are written off by the names the recording gives them, whatever the engine does when they are unset (martha#839; mutants: either line dropped)', () => {
  const switches = [FACTS.skills_advertised.setting, FACTS.builtin_skills_advertised.setting]
  assert.notEqual(switches[0], switches[1], 'the two switches are one setting, so one line would pass for both')
  for (const when_unset of [true, false]) {
    const facts = { ...FACTS, skills_advertised: { ...FACTS.skills_advertised, when_unset }, builtin_skills_advertised: { ...FACTS.builtin_skills_advertised, when_unset } }
    const lines = theConfigOfALaunch(facts, aDeclaration({}), A_SERVER).split('\n')
    for (const setting of switches) {
      assert.deepEqual(lines.filter((line) => line.startsWith(`${setting}:`)), [`${setting}: ${String(SKILLS_OFF)}`], `${setting} with the engine's default ${String(when_unset)}`)
    }
  }
  assert.equal(SKILLS_OFF, false, 'the switches offer skills when true, so off is false')
})

test('the servers a config root names are read back from its text: the one it was written with, and every key under extensions that is no platform extension (martha#541 C1 R1; mutant: the reader skips a key)', () => {
  const written = theConfigOfALaunch(FACTS, aDeclaration({}), A_SERVER)
  assert.deepEqual(theServersAConfigNames(FACTS, written), [A_SERVER.key])

  const aSecond = 'a-second-server-a-test-names'
  const edited = written.replace(`${THE_EXTENSIONS_SETTING}:\n`, `${THE_EXTENSIONS_SETTING}:\n  ${aSecond}:\n    enabled: true\n    cmd: "a-command-a-test-names"\n`)
  assert.notEqual(edited, written, 'the edit found no extensions line to put the second server under')
  assert.deepEqual(theServersAConfigNames(FACTS, edited), [aSecond, A_SERVER.key])

  const theKept = FACTS.platform_extensions.map((extension) => extension.key)
  assert.ok(theKept.length > 0, 'the recording names no platform extension, so this case reads nothing')
  for (const key of theKept) assert.ok(written.includes(`\n  ${key}:\n`), `the config does not write the platform extension ${key}, so its exclusion is unpinned`)
})

test('the config switches the keyring off by the recorded name, so the engine reads its secrets from the file beside it (#541 package A; mutant: the switch dropped)', () => {
  const config = theConfigOfALaunch(FACTS, aDeclaration({}), A_SERVER)
  assert.ok(config.split('\n').includes(`${FACTS.secret_storage.keyring_switch}: ${String(KEYRING_OFF)}`), `the config does not switch the keyring off:\n${config}`)
})

test('a secret the provider reads, named among the settings, is refused by name and never written into the config (#541 package A; mutant: a secret admitted into config.yaml)', () => {
  const secret = aRecordedSecret()
  assert.ok(FACTS.openai_provider.settings.includes(secret), 'the secret is no provider setting, so the allow-list alone would refuse it and this case would be blind')
  refusedSaying(() => theConfigOfALaunch(FACTS, aDeclaration({ [secret]: 'a-secret-a-test-names' }), A_SERVER), [secret, FACTS.secret_storage.file])
})

test('the config carries no secret of the declaration, and the secrets text carries each one under its recorded name (#541 package A)', () => {
  const declared = aDeclaration({ [aRecordedSetting()]: 'a-value-a-test-names' })
  const [[secret, value] = ['', '']] = Object.entries(declared.secrets)
  assert.ok(!theConfigOfALaunch(FACTS, declared, A_SERVER).includes(value), 'the config holds the secret\'s value')
  assert.equal(theSecretsOfALaunch(FACTS, declared), `${secret}: "${value}"\n`)
})

test('a secret under a name the provider does not read as a secret is refused by name, never written where nothing reads it (#541 package A; mutant: the secret written under an unrecorded key)', () => {
  const setting = aRecordedSetting()
  assert.ok(!FACTS.openai_provider.secrets.includes(setting), 'the name is a recorded secret, so this case would be blind')
  refusedSaying(() => theSecretsOfALaunch(FACTS, { ...aDeclaration({}), secrets: { [setting]: 'a-secret-a-test-names' } }), [setting, ENGINE_PLACES.openai_secrets])
})
