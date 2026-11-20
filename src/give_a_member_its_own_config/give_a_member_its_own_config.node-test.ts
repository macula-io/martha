// A member's own config folder is made new, 0700, holding exactly the settings and the trust record the owner chose,
// and the member's environment names it and the owner's default sign-in store (martha#602). Everything a test makes
// is removed after it.

import assert from 'node:assert/strict'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { API_KEY_ANSWERS_KEY, API_KEY_VARIABLE, AUTH_TOKEN_VARIABLE, FIRST_RUN_DONE_KEY, HOST_TRUST_RECORD_FILE, hostTrustsTheFolder, KEY_TAIL_LENGTH } from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'
import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { CONFIG_DIR_VARIABLE, SKILLS_KIND, SYNC_OFF_SETTING } from '../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts'
import { USER_SETTINGS_FILE, userSettingsPath } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { BILLED_BY_API_KEY, BILLED_BY_SUBSCRIPTION } from '../declare_crew/declare_crew.ts'
import { CONNECTORS_OFF_SETTING, FILE_MODE, makeTheMembersConfig, MEMBER_CONFIG_MODE, notGivenUnder, theBillingAMemberGets, theMembersConfigEnvironment } from './give_a_member_its_own_config.ts'

/** A launch that carries no skill. */
const NO_SKILLS: Readonly<Record<string, Uint8Array>> = {}

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-member-config-'))
  t.after(() => removeTheTree(dir))
  return dir
}

test("the folder is made new and 0700, with the member's settings and a trust record for the approved checkout alone", (t) => {
  const dir = scratch(t)
  const checkout = join(dir, 'checkout')
  mkdirSync(checkout)
  const folder = join(dir, 'the-members-folder')
  assert.deepEqual(makeTheMembersConfig(folder, checkout, undefined, NO_SKILLS), { made: true })
  assert.equal(lstatSync(folder).mode & 0o777, MEMBER_CONFIG_MODE)
  assert.deepEqual(readdirSync(folder).sort(), [HOST_TRUST_RECORD_FILE, USER_SETTINGS_FILE].sort())
  // The owner's choice (martha#602): the account's connectors off and its skills not synced, each the value the host reads as that.
  assert.deepEqual(JSON.parse(readFileSync(join(folder, USER_SETTINGS_FILE), 'utf8')), { [CONNECTORS_OFF_SETTING]: true, [SYNC_OFF_SETTING]: false })
  // With no key billed, the host's record holds the first run done and the trust, and no other key: nothing else of
  // the owner's is answered.
  const record = JSON.parse(readFileSync(join(folder, HOST_TRUST_RECORD_FILE), 'utf8')) as Record<string, unknown>
  assert.deepEqual(Object.keys(record).sort(), [FIRST_RUN_DONE_KEY, 'projects'].sort())
  assert.equal(record[FIRST_RUN_DONE_KEY], true)
  const env = theMembersConfigEnvironment(folder, BILLED_BY_SUBSCRIPTION)
  // The launcher's own reading of the host's record trusts the checkout, and no other folder, not even its parent.
  assert.equal(hostTrustsTheFolder(env, checkout, []), true)
  assert.equal(hostTrustsTheFolder(env, dir, []), false)
  assert.equal(hostTrustsTheFolder(env, join(dir, 'another'), []), false)
  // The settings file the gate reads for this member is the one written here.
  assert.deepEqual(userSettingsPath(env), { path: join(folder, USER_SETTINGS_FILE) })
})

test('a checkout reached through a link is trusted by its path and its real path, and by nothing else', (t) => {
  const dir = scratch(t)
  mkdirSync(join(dir, 'real'))
  symlinkSync(join(dir, 'real'), join(dir, 'linked'))
  const folder = join(dir, 'the-members-folder')
  assert.deepEqual(makeTheMembersConfig(folder, join(dir, 'linked'), undefined, NO_SKILLS), { made: true })
  const record = JSON.parse(readFileSync(join(folder, HOST_TRUST_RECORD_FILE), 'utf8')) as { projects: Record<string, unknown> }
  assert.deepEqual(Object.keys(record.projects).sort(), [join(dir, 'linked'), realpathSync(join(dir, 'real'))].sort())
})

test('a folder that exists, or a link where it would go, is never reused', (t) => {
  const dir = scratch(t)
  const checkout = join(dir, 'checkout')
  mkdirSync(checkout)
  mkdirSync(join(dir, 'there'))
  assert.equal(makeTheMembersConfig(join(dir, 'there'), checkout, undefined, NO_SKILLS).made, false)
  assert.deepEqual(readdirSync(join(dir, 'there')), [], 'nothing was written into a folder that was already there')
  symlinkSync(join(dir, 'there'), join(dir, 'link'))
  assert.equal(makeTheMembersConfig(join(dir, 'link'), checkout, undefined, NO_SKILLS).made, false)
  assert.deepEqual(readdirSync(join(dir, 'there')), [], 'nothing was written through a link')
})

test("the member's environment names its own folder and the owner's default sign-in store, set and empty, and nothing else", () => {
  assert.deepEqual(theMembersConfigEnvironment('/a/members/folder', BILLED_BY_SUBSCRIPTION), { [CONFIG_DIR_VARIABLE]: '/a/members/folder', [RECORDED_HOST.sign_in_store_variable]: '' })
})

test("martha#916: a member billed by the key is handed its own folder and no sign-in store, and each billing leaves the other's credential out", () => {
  assert.deepEqual(theMembersConfigEnvironment('/a/members/folder', BILLED_BY_API_KEY), { [CONFIG_DIR_VARIABLE]: '/a/members/folder' })
  assert.deepEqual(notGivenUnder(BILLED_BY_SUBSCRIPTION), [API_KEY_VARIABLE, AUTH_TOKEN_VARIABLE, ...RECORDED_HOST.cloud_provider_variables])
  assert.deepEqual(notGivenUnder(BILLED_BY_API_KEY), [RECORDED_HOST.sign_in_store_variable, ...RECORDED_HOST.cloud_provider_variables])
})

test('martha#916: a key billed is answered yes by its tail alone, and an empty one is not answered', (t) => {
  const dir = scratch(t)
  const checkout = join(dir, 'checkout')
  mkdirSync(checkout)
  // A key whose tail differs from every other slice of it, so a wrong length or end cannot pass.
  const key = Array.from({ length: KEY_TAIL_LENGTH * 3 }, (_, i) => String.fromCharCode(65 + (i % 26)) + String(i)).join('')
  const folder = join(dir, 'with-a-key')
  assert.deepEqual(makeTheMembersConfig(folder, checkout, key, NO_SKILLS), { made: true })
  const record = JSON.parse(readFileSync(join(folder, HOST_TRUST_RECORD_FILE), 'utf8')) as Record<string, unknown>
  assert.deepEqual(Object.keys(record).sort(), [API_KEY_ANSWERS_KEY, FIRST_RUN_DONE_KEY, 'projects'].sort())
  assert.deepEqual(record[API_KEY_ANSWERS_KEY], { approved: [key.slice(-KEY_TAIL_LENGTH)], rejected: [] })
  assert.ok(!readFileSync(join(folder, HOST_TRUST_RECORD_FILE), 'utf8').includes(key), 'the whole key is never written')
  const empty = join(dir, 'with-an-empty-key')
  assert.deepEqual(makeTheMembersConfig(empty, checkout, '', NO_SKILLS), { made: true })
  assert.ok(!(API_KEY_ANSWERS_KEY in (JSON.parse(readFileSync(join(empty, HOST_TRUST_RECORD_FILE), 'utf8')) as Record<string, unknown>)))
})

test('martha#916: a declared billing is kept whatever the sign-in; with none, a signed-in owner is billed by the subscription, one not signed in by the key it carries, and an untold sign-in never by the key', () => {
  const signedIn = { signed_in: true }
  const notSignedIn = { signed_in: false }
  const untold = { untold: 'it exited 1' }
  for (const signIn of [signedIn, notSignedIn, untold]) {
    for (const carries of [true, false]) {
      assert.equal(theBillingAMemberGets(BILLED_BY_API_KEY, signIn, carries), BILLED_BY_API_KEY)
      assert.equal(theBillingAMemberGets(BILLED_BY_SUBSCRIPTION, signIn, carries), BILLED_BY_SUBSCRIPTION)
    }
  }
  assert.equal(theBillingAMemberGets(null, signedIn, true), BILLED_BY_SUBSCRIPTION)
  assert.equal(theBillingAMemberGets(null, notSignedIn, true), BILLED_BY_API_KEY)
  assert.equal(theBillingAMemberGets(null, notSignedIn, false), BILLED_BY_SUBSCRIPTION)
  assert.equal(theBillingAMemberGets(null, untold, true), BILLED_BY_SUBSCRIPTION)
})

test("the carried skills are written under the folder the host reads as user-scope skills, byte-equal, in files only the launcher's user reads (martha#747)", (t) => {
  const dir = scratch(t)
  const checkout = join(dir, 'checkout')
  mkdirSync(checkout)
  const folder = join(dir, 'the-members-folder')
  const skill = new TextEncoder().encode('---\nname: x\ndescription: a skill\n---\nbody\n')
  const script = new TextEncoder().encode('#!/bin/sh\necho a script the skill names\n')
  assert.deepEqual(makeTheMembersConfig(folder, checkout, undefined, { 'x/SKILL.md': skill, 'x/scripts/run.sh': script }), { made: true })
  assert.deepEqual(readdirSync(folder).sort(), [HOST_TRUST_RECORD_FILE, SKILLS_KIND, USER_SETTINGS_FILE].sort())
  assert.deepEqual(readFileSync(join(folder, SKILLS_KIND, 'x', 'SKILL.md')), Buffer.from(skill))
  assert.deepEqual(readFileSync(join(folder, SKILLS_KIND, 'x', 'scripts', 'run.sh')), Buffer.from(script))
  for (const file of [join('x', 'SKILL.md'), join('x', 'scripts', 'run.sh')]) {
    assert.equal(lstatSync(join(folder, SKILLS_KIND, file)).mode & 0o777, FILE_MODE, file)
  }
  for (const sub of [SKILLS_KIND, join(SKILLS_KIND, 'x'), join(SKILLS_KIND, 'x', 'scripts')]) {
    assert.equal(lstatSync(join(folder, sub)).mode & 0o777, MEMBER_CONFIG_MODE, sub)
  }
})
