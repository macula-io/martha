// The nightly live run's guards for its throwaway repository (martha#639): the delete (R2), the kept record (R4), the
// reach of its calls (R1) and a clean start for the restarted members (R3). Each case is one the review named, or one a
// weaker guard would let through.

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { whatTheStartWouldLoad, INSTRUCTION_FILES, LOADED_FOLDERS, type TheStart } from './a_clean_start.ts'
import { whyNotDelete, type WhatTheRunMade } from './the_delete_guard.ts'
import { runTheGuard } from './main.ts'
import { redactTheToken, REDACTED, THE_TOKEN_REACHED_THE_RECORD } from './the_kept_record.ts'
import { NEAR_DAYS, NO_EXPIRY_NOTE, theTokensExpiry } from './the_tokens_expiry.ts'
import { A_USER_ACCOUNT, whyTheCallsAreNotTheBots, whyTheCallsReachTooFar } from './the_tokens_reach.ts'
import { CLAUDE_FOLDER } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { CLONES, DECLARATION_DIRECTORY, DECLARATION_FILE } from '../declare_crew/declare_crew.ts'
import { MANIFEST } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import { SKILLS_KIND } from '../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts'

// --- R2: the delete -------------------------------------------------------------------------------------------------

const MADE: WhatTheRunMade = {
  id: 9001,
  owner_id: 4242,
  stamp: '20261118-031500',
  run_started_at: '2026-11-18T02:15:00Z',
  full_name: 'throwaway-owner/martha-live-20261118-031500',
}

/** GitHub's answer for the repository this run made, with `change` laid over it. */
const answerFor = (change: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: MADE.id,
  name: 'martha-live-20261118-031500',
  full_name: MADE.full_name,
  owner: { id: MADE.owner_id, login: 'throwaway-owner' },
  created_at: '2026-11-18T02:16:00Z',
  ...change,
})

test('the repository this run made may be deleted', () => {
  assert.equal(whyNotDelete(MADE, answerFor()), undefined)
})

test('a repository whose owner id differs is left, naming owner.id, even when its owner login is the same', () => {
  assert.match(whyNotDelete(MADE, answerFor({ owner: { id: 7, login: 'throwaway-owner' } })) ?? '', /^owner\.id /)
})

test("a repository carrying another run's stamp is left, naming name", () => {
  assert.match(whyNotDelete(MADE, answerFor({ name: 'martha-live-20261117-031500' })) ?? '', /^name /)
})

test('a recorded id that answers a different full name is left, naming full_name', () => {
  assert.match(whyNotDelete(MADE, answerFor({ full_name: 'throwaway-owner/something-else' })) ?? '', /^full_name /)
})

test('a repository made before this run started is left, naming created_at, and so is one with no time', () => {
  assert.match(whyNotDelete(MADE, answerFor({ created_at: '2026-11-18T02:14:59Z' })) ?? '', /^created_at /)
  assert.match(whyNotDelete(MADE, answerFor({ created_at: 'yesterday' })) ?? '', /^created_at /)
})

test('an answer for another id, an empty stamp, and no answer at all are each refused', () => {
  assert.match(whyNotDelete(MADE, answerFor({ id: 9002 })) ?? '', /^id /)
  assert.match(whyNotDelete({ ...MADE, stamp: '' }, answerFor()) ?? '', /^name /)
  assert.equal(whyNotDelete(MADE, null), 'GitHub gave no repository for the recorded id')
})

// --- R4: the kept record --------------------------------------------------------------------------------------------

const TOKEN = 'github_pat_11AAAAAAA0ThisIsAStandInToken_xyz'

test("a member's transcript that printed the token keeps no token, and says one reached it", () => {
  const kept = redactTheToken(`$ gh auth token\n${TOKEN}\n$ echo again ${TOKEN}`, TOKEN)
  assert.equal(kept.reached, true)
  assert.equal(kept.text.includes(TOKEN), false)
  assert.equal(kept.text, `$ gh auth token\n${REDACTED}\n$ echo again ${REDACTED}`)
})

test('a fine-grained token the run was not given is caught by its shape', () => {
  const kept = redactTheToken('a member printed github_pat_22BBBB_other from a remote', 'not-in-the-text')
  assert.deepEqual(kept, { text: `a member printed ${REDACTED} from a remote`, reached: true })
})

test('a token of another shape is still caught by its exact value', () => {
  const kept = redactTheToken('hosts: oauth_token: ghp_plainOldToken123', 'ghp_plainOldToken123')
  assert.deepEqual(kept, { text: `hosts: oauth_token: ${REDACTED}`, reached: true })
})

test('a record with no token stays as it was, and an empty token is refused', () => {
  assert.deepEqual(redactTheToken('nothing secret here', TOKEN), { text: 'nothing secret here', reached: false })
  assert.throws(() => redactTheToken('anything', ' '), /the token to look for is empty/)
})

// --- R1: the reach of the run's calls -------------------------------------------------------------------------------

const repo = (full_name: string, owner_id: number): Record<string, unknown> => ({ full_name, owner: { id: owner_id } })

test("calls that see only the throwaway owner's repositories, over several pages, pass", () => {
  assert.equal(whyTheCallsReachTooFar([[repo('t/a', 4242)], [repo('t/b', 4242)], []], 4242), undefined)
})

test("calls that see a repository of another owner fail, naming it: the owner's own login fails here", () => {
  const why = whyTheCallsReachTooFar([[repo('t/a', 4242)], [repo('macula-io/martha', 1)]], 4242)
  assert.equal(why, "the run's calls reach macula-io/martha, which is not the throwaway owner's")
})

test('no page, or a page that is not a list, is a reach not read', () => {
  assert.match(whyTheCallsReachTooFar([], 4242) ?? '', /no page/)
  assert.match(whyTheCallsReachTooFar([[repo('t/a', 4242)], { message: 'Bad credentials' }], 4242) ?? '', /^page 2 /)
})

test("calls that answer GET /user as the bot, a user account, are the bot's", () => {
  assert.equal(whyTheCallsAreNotTheBots({ login: 'martha-live-bot', id: 4242, type: A_USER_ACCOUNT }, 4242), undefined)
})

test("calls that answer as the owner's own login fail by name, as do an organisation and no answer", () => {
  assert.equal(
    whyTheCallsAreNotTheBots({ login: 'the-owner', id: 1, type: A_USER_ACCOUNT }, 4242),
    "the run's calls answer as the-owner (1), not as the throwaway bot (4242)",
  )
  assert.match(whyTheCallsAreNotTheBots({ login: 'an-org', id: 4242, type: 'Organization' }, 4242) ?? '', /not a user account$/)
  assert.match(whyTheCallsAreNotTheBots({ message: 'Bad credentials' }, 4242) ?? '', /was not read$/)
  assert.equal(runTheGuard(['who', '4242'], JSON.stringify({ login: 'the-owner', id: 1, type: A_USER_ACCOUNT })).code, 1)
  assert.equal(runTheGuard(['who', 'the-bot'], '{}').code, 2)
})

// --- the token's expiry, read each night ----------------------------------------------------------------------------

const NOW = new Date('2026-11-18T03:00:00Z')

test('a token a month from its expiry holds with nothing to say', () => {
  assert.deepEqual(theTokensExpiry('2026-12-18 03:00:00 UTC', NOW), { refuses: false })
})

test("a token with no expiry is the owner's choice: a note, not a warning, and the night goes on", () => {
  const said = theTokensExpiry('', NOW)
  assert.equal(said.refuses, false)
  assert.equal(said.warning, undefined)
  assert.match(said.note ?? '', /^the token has no expiry \(owner's choice, 2026-11-18\)$/)
})

test('a token within the near days is warned about, one just outside them is not', () => {
  const near = new Date(NOW.getTime() + (NEAR_DAYS - 1) * 86_400_000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
  const far = new Date(NOW.getTime() + (NEAR_DAYS + 1) * 86_400_000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
  assert.match(theTokensExpiry(near, NOW).warning ?? '', /^the token expires in \d+ day\(s\)/)
  assert.deepEqual(theTokensExpiry(far, NOW), { refuses: false })
})

test('an expired token, or an expiry that cannot be read, refuses the night', () => {
  assert.match(theTokensExpiry('2026-11-18 02:59:59 UTC', NOW).why ?? '', /^the token expired at/)
  assert.match(theTokensExpiry('next tuesday', NOW).why ?? '', /could not be read$/)
  assert.equal(runTheGuard(['expiry', NOW.toISOString()], '2026-11-18 02:59:59 UTC').code, 1)
  assert.deepEqual(runTheGuard(['expiry', NOW.toISOString()], '').code, 0)
  assert.equal(runTheGuard(['expiry', NOW.toISOString()], '').out, `note: ${NO_EXPIRY_NOTE}\n`)
  assert.equal(runTheGuard(['expiry', 'not a time'], '').code, 2)
})

// --- R3: a clean start ----------------------------------------------------------------------------------------------

const HOME = '/tmp/martha-home'
const CLONE = join(HOME, 'work', CLONES, 'throwaway-owner', 'martha-live-20261118-031500')
const START: TheStart = { home: HOME, clone: CLONE, made: ['README.md', MANIFEST, DECLARATION_DIRECTORY, join(DECLARATION_DIRECTORY, DECLARATION_FILE)] }

/** A listing of a clean start: the path to the clone, what the run made in it, its git folder, and a config folder. */
const CLEAN: readonly string[] = [
  join(HOME, 'work'),
  join(HOME, 'work', CLONES),
  join(HOME, 'work', CLONES, 'throwaway-owner'),
  CLONE,
  ...START.made.map((path) => join(CLONE, path)),
  join(CLONE, '.git'),
  join(CLONE, '.git', 'HEAD'),
  join(HOME, CLAUDE_FOLDER),
  join(HOME, CLAUDE_FOLDER, '.credentials.json'),
]

test('a start with nothing but what the run made is clean', () => {
  assert.deepEqual(whatTheStartWouldLoad(START, CLEAN), [])
})

test("the recording's instruction files hold the host's own, and its loaded folders the markdown kinds", () => {
  assert.ok(INSTRUCTION_FILES.includes('CLAUDE.md'), JSON.stringify(INSTRUCTION_FILES))
  assert.ok(LOADED_FOLDERS.includes(SKILLS_KIND) && LOADED_FOLDERS.includes('agents'), JSON.stringify(LOADED_FOLDERS))
})

test("an outsider's CLAUDE.md in the clone fails by name, as would any file the run did not put there", () => {
  const hits = whatTheStartWouldLoad(START, [...CLEAN, join(CLONE, 'CLAUDE.md'), join(CLONE, CLAUDE_FOLDER), join(CLONE, '.mcp.json')])
  assert.deepEqual(hits, [
    `${join(CLONE, 'CLAUDE.md')}: in the clone, and the run did not put it there`,
    `${join(CLONE, CLAUDE_FOLDER)}: in the clone, and the run did not put it there`,
    `${join(CLONE, '.mcp.json')}: in the clone, and the run did not put it there`,
  ])
})

test("a file beside the clone's path, below the home, fails by name", () => {
  const stranger = join(HOME, 'work', 'CLAUDE.md')
  assert.deepEqual(whatTheStartWouldLoad(START, [...CLEAN, stranger]), [`${stranger}: beside the clone's path, which holds only its next folder`])
})

test('an instruction file in the home or its config folder, and a file in a loaded folder, fail by name', () => {
  const inHome = join(HOME, 'CLAUDE.md')
  const inConfig = join(HOME, CLAUDE_FOLDER, 'CLAUDE.md')
  const aSkill = join(HOME, CLAUDE_FOLDER, SKILLS_KIND, 'x', 'SKILL.md')
  const hits = whatTheStartWouldLoad(START, [...CLEAN, inHome, inConfig, aSkill])
  assert.deepEqual(hits, [inHome, inConfig, aSkill].map((path) => `${path}: the host loads it at a session's start`))
})

test('a clone outside the home, or missing from the listing, is a start not read', () => {
  assert.deepEqual(whatTheStartWouldLoad({ ...START, clone: '/tmp/clean-checkout' }, CLEAN), [`/tmp/clean-checkout: the clone is not under the home ${HOME}`])
  assert.deepEqual(whatTheStartWouldLoad(START, CLEAN.filter((path) => path !== CLONE)), [`${CLONE}: the clone is not in the listing, so the start was not read`])
})

// --- what the run's bash calls ---------------------------------------------------------------------------------------

/** A folder of the test's own, removed when the test ends. */
const aFolder = (t: { after: (fn: () => void) => void }): string => {
  const folder = mkdtempSync(join(tmpdir(), 'martha-639-'))
  t.after(() => removeTheTree(folder))
  return folder
}

test('each guard answers 0, 1 or 2, and what it could not read is 2, never a pass', (t) => {
  const folder = aFolder(t)
  const made = join(folder, 'made.json')
  writeFileSync(made, JSON.stringify(MADE))
  assert.deepEqual(runTheGuard(['delete', made], JSON.stringify(answerFor())), { code: 0, out: MADE.full_name })
  assert.equal(runTheGuard(['delete', made], JSON.stringify(answerFor({ owner: { id: 7 } }))).code, 1)
  assert.equal(runTheGuard(['delete', made], 'not json').code, 2)
  assert.equal(runTheGuard(['reach', '4242'], JSON.stringify([[repo('t/a', 4242)]])).code, 0)
  assert.equal(runTheGuard(['reach', 'throwaway-owner'], '[]').code, 2)
  assert.equal(runTheGuard(['delete'], '').code, 2)
  assert.equal(runTheGuard(['remove', made], '').code, 2)
})

test('redact reads the token from its file, never an argument, and says when it reached the text', (t) => {
  const folder = aFolder(t)
  const file = join(folder, 'token')
  writeFileSync(file, `${TOKEN}\n`, { mode: 0o600 })
  assert.deepEqual(runTheGuard(['redact', file], `printed ${TOKEN}`), { code: 1, err: THE_TOKEN_REACHED_THE_RECORD, out: `printed ${REDACTED}` })
  assert.deepEqual(runTheGuard(['redact', file], 'clean text'), { code: 0, out: 'clean text' })
})

test("clean-start judges the run's listing, one path a line", (t) => {
  const folder = aFolder(t)
  const start = join(folder, 'start.json')
  writeFileSync(start, JSON.stringify(START))
  assert.equal(runTheGuard(['clean-start', start], `${CLEAN.join('\n')}\n`).code, 0)
  const said = runTheGuard(['clean-start', start], [...CLEAN, join(CLONE, 'CLAUDE.md')].join('\n'))
  assert.equal(said.code, 1)
  assert.match(said.err ?? '', /CLAUDE\.md: in the clone, and the run did not put it there/)
})
