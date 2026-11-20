// The engine member's model (martha#541 package A, design r=1 step 1, Q1): built from the declaration and the crew's
// endpoint, the key read from the named variable into the secrets alone, and the written root's model read back.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { theConfigOfALaunch, THE_MODEL_SETTING } from '../derive_the_config_of_a_goose_launch/derive_the_config_of_a_goose_launch.ts'
import { ENGINE_ENDPOINT } from '../declare_crew/declare_crew.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import {
  AN_ENGINE_MEMBER_NAMES_ITS_MODEL,
  THE_ENDPOINTS_BASE_PATH_SETTING,
  THE_ENDPOINTS_HOST_SETTING,
  THE_ENDPOINTS_KEY_SECRET,
  THE_MODE_BITS_OF_GROUP_AND_OTHERS,
  theModelOfAnEngineMember,
  theModelTheConfigNames,
  whyAKeyFileIsNotTheOwners,
  whyTheConfigRunsAnotherModel,
} from './the_engines_model.ts'

const FACTS = RECORDED_GOOSE_ENGINE
const AN_ENDPOINT = { host: 'http://a-host.test:8080', base_path: 'a/base/path', key_from: 'A_KEY_VARIABLE_A_TEST_NAMES', key_file: null }
const A_KEY = 'a-key-a-test-names'
/** A key file reader no test with a key variable may reach: the variable's endpoint names no file. */
const NO_FILE_IS_READ = (key_file: string): never => assert.fail(`the key file ${key_file} was read for an endpoint that names none`)
const ASKED = { facts: FACTS, member: 'a-member', model: 'a-model-a-test-names', endpoint: AN_ENDPOINT, environment: { A_KEY_VARIABLE_A_TEST_NAMES: A_KEY }, readTheKeyFile: NO_FILE_IS_READ }

/** A server the config names, of this test's own: nothing here reads it. */
const A_SERVER = { key: 'a-server-a-test-names', entry: [] }

test('#541 package A: the model runs the recorded provider at the declared endpoint, with the key in the secrets alone', () => {
  assert.deepEqual(theModelOfAnEngineMember(ASKED), {
    provider: FACTS.openai_provider.name,
    model: ASKED.model,
    settings: { [THE_ENDPOINTS_HOST_SETTING]: AN_ENDPOINT.host, [THE_ENDPOINTS_BASE_PATH_SETTING]: AN_ENDPOINT.base_path },
    secrets: { [THE_ENDPOINTS_KEY_SECRET]: A_KEY },
  })
  assert.deepEqual(theModelOfAnEngineMember({ ...ASKED, endpoint: { ...AN_ENDPOINT, base_path: null, key_from: null } }), {
    provider: FACTS.openai_provider.name,
    model: ASKED.model,
    settings: { [THE_ENDPOINTS_HOST_SETTING]: AN_ENDPOINT.host },
    secrets: {},
  })
})

test('#541 package A: a member with no model, a crew with no endpoint, or a key variable with no value starts nothing, and no refusal says the key', () => {
  assert.deepEqual(theModelOfAnEngineMember({ ...ASKED, model: null }), { refusal: `a-member names no model: ${AN_ENGINE_MEMBER_NAMES_ITS_MODEL}` })
  const noEndpoint = theModelOfAnEngineMember({ ...ASKED, endpoint: null })
  assert.ok('refusal' in noEndpoint && noEndpoint.refusal.includes(ENGINE_ENDPOINT), JSON.stringify(noEndpoint))
  for (const environment of [{}, { A_KEY_VARIABLE_A_TEST_NAMES: '' }]) {
    const noKey = theModelOfAnEngineMember({ ...ASKED, environment })
    assert.ok('refusal' in noKey && noKey.refusal.includes(AN_ENDPOINT.key_from), JSON.stringify(noKey))
  }
})

test('#541 package A: a recording whose provider reads none of the endpoint settings, or not the key, is refused by the name it lacks', () => {
  for (const unread of [THE_ENDPOINTS_HOST_SETTING, THE_ENDPOINTS_BASE_PATH_SETTING]) {
    const facts = { openai_provider: { ...FACTS.openai_provider, settings: FACTS.openai_provider.settings.filter((setting) => setting !== unread) } }
    const refused = theModelOfAnEngineMember({ ...ASKED, facts })
    assert.ok('refusal' in refused && refused.refusal.includes(unread), JSON.stringify(refused))
  }
  const facts = { openai_provider: { ...FACTS.openai_provider, secrets: FACTS.openai_provider.secrets.filter((secret) => secret !== THE_ENDPOINTS_KEY_SECRET) } }
  const refused = theModelOfAnEngineMember({ ...ASKED, facts })
  assert.ok('refusal' in refused && refused.refusal.includes(THE_ENDPOINTS_KEY_SECRET) && !refused.refusal.includes(A_KEY), JSON.stringify(refused))
})

test('#541 package A: the root a launch writes names the declared model, read back the way the engine reads it; another model or none is refused by name', () => {
  const model = theModelOfAnEngineMember(ASKED)
  assert.ok(!('refusal' in model))
  const text = theConfigOfALaunch(FACTS, model, A_SERVER)
  assert.equal(theModelTheConfigNames(text), ASKED.model)
  assert.equal(whyTheConfigRunsAnotherModel(text, 'a-root', ASKED.model), undefined)
  const another = whyTheConfigRunsAnotherModel(text, 'a-root', 'another-model')
  assert.ok(another?.includes('a-root') && another.includes(JSON.stringify(ASKED.model)) && another.includes('another-model'), String(another))
  const without = text.split('\n').filter((line) => !line.startsWith(`${THE_MODEL_SETTING}:`)).join('\n')
  assert.match(whyTheConfigRunsAnotherModel(without, 'a-root', ASKED.model) ?? '', /names the model nowhere/)
  assert.equal(theModelTheConfigNames(`${text}\n${THE_MODEL_SETTING}: "another-model"`), undefined, 'a model named twice was read as one')
})

test('#511 part B: an endpoint that names a key file runs with the key that file holds, in the secrets alone, and reads no variable', () => {
  const key_file = '~/a-key-file-a-test-names'
  const read: string[] = []
  const FILES_KEY = 'a-key-the-file-holds'
  const model = theModelOfAnEngineMember({ ...ASKED, endpoint: { ...AN_ENDPOINT, key_from: null, key_file }, environment: {}, readTheKeyFile: (at) => (read.push(at), { key: FILES_KEY }) })
  assert.deepEqual(model, {
    provider: FACTS.openai_provider.name,
    model: ASKED.model,
    settings: { [THE_ENDPOINTS_HOST_SETTING]: AN_ENDPOINT.host, [THE_ENDPOINTS_BASE_PATH_SETTING]: AN_ENDPOINT.base_path },
    secrets: { [THE_ENDPOINTS_KEY_SECRET]: FILES_KEY },
  })
  assert.deepEqual(read, [key_file])
})

test('#511 part B: a key file the start may not read starts nothing, and the refusal names the member, the model and why', () => {
  const why = 'a reason a test names'
  const refused = theModelOfAnEngineMember({ ...ASKED, endpoint: { ...AN_ENDPOINT, key_from: null, key_file: '/a-key-file' }, readTheKeyFile: () => ({ refusal: why }) })
  assert.deepEqual(refused, { refusal: `${ASKED.member} cannot reach ${ASKED.model}: ${why}` })
})

test('#511 part B: a key file is read only when it is this user\'s own plain file with no right for the group or others', () => {
  const owners = { plain_file: true, owner_is_this_user: true, mode: 0o100600 }
  assert.equal(whyAKeyFileIsNotTheOwners('/k', owners), undefined)
  assert.match(whyAKeyFileIsNotTheOwners('/k', { ...owners, plain_file: false }) ?? '', /\/k is not a plain file/)
  assert.match(whyAKeyFileIsNotTheOwners('/k', { ...owners, owner_is_this_user: false }) ?? '', /\/k is not this user's own file/)
  for (let bit = 1; bit <= THE_MODE_BITS_OF_GROUP_AND_OTHERS; bit <<= 1) {
    assert.match(whyAKeyFileIsNotTheOwners('/k', { ...owners, mode: owners.mode | bit }) ?? '', /open to the group or to others/, `mode bit ${bit.toString(8)} was let through`)
  }
})
