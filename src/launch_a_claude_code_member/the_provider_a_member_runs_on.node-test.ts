// The environment a member on a provider's own endpoint is given (gap 4 of martha#957): the endpoint, the provider's key
// as the bearer token, the model and its context window, and never the other billing's credential. A provider with no
// endpoint is Anthropic's own and is handed none of it. The key files are real files, made and removed by this test.

import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { API_KEY_VARIABLE, AUTH_TOKEN_VARIABLE } from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'
import { CLAUDE_CODE_SIGN_IN_STORE_VARIABLE } from '../claude_code_host/recorded_claude_code_host.ts'
import {
  THE_CONTEXT_TOKENS_VARIABLE,
  THE_MODELS_VARIABLE,
  THE_PROVIDERS_ENDPOINT_VARIABLE,
  THE_SMALL_MODELS_VARIABLE,
  theProviderMembersEnvironment,
  type AMemberOnAProvider,
} from './the_provider_a_member_runs_on.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-provider-env-'))
after(() => rmSync(home, { recursive: true, force: true }))

const A_KEY = 'a-key-this-test-names'
const THE_ENDPOINT = 'https://a-provider.test/anthropic'
const THE_MODEL = 'a-model-this-test-names'
const THE_NAMED_AT = 'providers.a-provider-this-test-names'
const THE_KEY_VARIABLE = 'A_PROVIDERS_KEY_VARIABLE_A_TEST_NAMES'

/** The provider this test declares, its key in the variable above unless a test says otherwise. */
const A_PROVIDER = {
  name: 'a-provider-this-test-names',
  named_at: THE_NAMED_AT,
  endpoint: THE_ENDPOINT,
  key_from: THE_KEY_VARIABLE,
  key_file: null,
  model: THE_MODEL,
  context_limit: 1_000_000,
}

/** What one launch asks with: the provider above, the launcher's environment carrying its key, and a home. */
const ASKED: AMemberOnAProvider = { member: 'a-member', provider: A_PROVIDER, inherited: { [THE_KEY_VARIABLE]: A_KEY }, home }

/** A key file under the test's home holding `text`, at `mode`. */
function aFile(name: string, text: string, mode: number): string {
  const at = join(home, name)
  writeFileSync(at, text)
  chmodSync(at, mode)
  return at
}

test('gap 4: a member on the provider\'s endpoint is handed its base URL, its own key, the model and the context window, and nothing else', () => {
  assert.deepEqual(theProviderMembersEnvironment(ASKED), {
    env: {
      [THE_PROVIDERS_ENDPOINT_VARIABLE]: THE_ENDPOINT,
      [AUTH_TOKEN_VARIABLE]: A_KEY,
      [THE_MODELS_VARIABLE]: THE_MODEL,
      [THE_SMALL_MODELS_VARIABLE]: THE_MODEL,
      [THE_CONTEXT_TOKENS_VARIABLE]: '1000000',
    },
    not_given: [API_KEY_VARIABLE, CLAUDE_CODE_SIGN_IN_STORE_VARIABLE],
  })
  const noContext = theProviderMembersEnvironment({ ...ASKED, provider: { ...A_PROVIDER, context_limit: null } })
  assert.deepEqual(noContext, {
    env: {
      [THE_PROVIDERS_ENDPOINT_VARIABLE]: THE_ENDPOINT,
      [AUTH_TOKEN_VARIABLE]: A_KEY,
      [THE_MODELS_VARIABLE]: THE_MODEL,
      [THE_SMALL_MODELS_VARIABLE]: THE_MODEL,
    },
    not_given: [API_KEY_VARIABLE, CLAUDE_CODE_SIGN_IN_STORE_VARIABLE],
  }, 'a profile that names no context_limit hands no window')
})

test('gap 4: a provider with no endpoint is Anthropic\'s own, and the member is handed nothing of this', () => {
  assert.deepEqual(theProviderMembersEnvironment({ ...ASKED, provider: { ...A_PROVIDER, endpoint: null } }), { env: {}, not_given: [] })
})

test('gap 4: an endpoint with no key to reach it is refused, naming the field, and the endpoint is not the key', () => {
  const refused = theProviderMembersEnvironment({ ...ASKED, provider: { ...A_PROVIDER, key_from: null, key_file: null } })
  assert.ok('refusal' in refused, JSON.stringify(refused))
  assert.ok(refused.refusal.startsWith(`${THE_NAMED_AT}.endpoint`), refused.refusal)
  assert.ok(refused.refusal.includes('no key_from and no key_file'), refused.refusal)
})

test('gap 4: a key_from the launcher carries no value for is refused, whether it is absent or empty, and no refusal says the key', () => {
  for (const inherited of [{}, { [THE_KEY_VARIABLE]: '' }] as const) {
    const refused = theProviderMembersEnvironment({ ...ASKED, inherited })
    assert.ok('refusal' in refused, JSON.stringify(refused))
    assert.ok(refused.refusal.startsWith(`${THE_NAMED_AT}.key_from`), refused.refusal)
    assert.ok(refused.refusal.includes(THE_KEY_VARIABLE), refused.refusal)
    assert.ok(!refused.refusal.includes(A_KEY), refused.refusal)
  }
})

test('gap 4: the key is read from the file the provider names, and the file\'s own checks refuse it by the field it is named at', () => {
  const closed = aFile('closed', `${A_KEY}\n`, 0o600)
  const read = theProviderMembersEnvironment({ ...ASKED, inherited: {}, provider: { ...A_PROVIDER, key_from: null, key_file: closed } })
  assert.ok('env' in read, JSON.stringify(read))
  assert.equal(read.env[AUTH_TOKEN_VARIABLE], A_KEY, 'the key file\'s own key is the bearer token, without its line end')

  const open = aFile('open', A_KEY, 0o604)
  const refused = theProviderMembersEnvironment({ ...ASKED, inherited: {}, provider: { ...A_PROVIDER, key_from: null, key_file: open } })
  assert.ok('refusal' in refused, JSON.stringify(refused))
  assert.ok(refused.refusal.startsWith(`${THE_NAMED_AT}.key_file ${open}`), refused.refusal)
  assert.ok(!refused.refusal.includes(A_KEY), refused.refusal)
})
