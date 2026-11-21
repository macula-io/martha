// When a shell line is crew text (martha#987, gap 15 rows T5-T8 and T14).
//
// Every case runs against an own repository whose every probe answers "own", so the one thing that differs between an
// accepted line and a refused one is the line or the one fact the case changes. A refused line is the line whose output
// records A13 as it always has; an accepted one records nothing.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { judgeAPlainLine } from './judge_a_plain_line.ts'
import { vouchForTheLine, type TheCrewsOwnRepositories, type WhatGithubAndGitSay } from './vouch_for_own_github_and_git_lines.ts'

const CREW_LOGIN = 'the-crews-login'
const OWN_ORG = 'Own-Org'
const OWN_REPO = 'own-org/a-repo'
const A_FORK = 'own-org/a-fork'
const ANOTHER_REPO = 'someone-else/a-repo'
/** A clone of OWN_REPO, of A_FORK, and of another org's repository, as the probe names their origins. */
const OWN_CLONE = '/work/own-org/a-repo'
const FORK_CLONE = '/work/own-org/a-fork'
const OTHER_CLONE = '/work/someone-else/a-repo'
const ORIGINS: Readonly<Record<string, string>> = { [OWN_CLONE]: OWN_REPO, [FORK_CLONE]: A_FORK, [OTHER_CLONE]: ANOTHER_REPO }
/** Thread 1 of the own repository is the crew's alone; thread 2 has an outside commenter. */
const OWN_THREAD = 1
const MIXED_THREAD = 2
const OUTSIDER = 'a-passer-by'

/** The probe as an own repository answers it, with any one answer replaced. */
function saying(change: Partial<WhatGithubAndGitSay> = {}): WhatGithubAndGitSay {
  return {
    originOf: async (directory) => ORIGINS[directory] ?? '',
    login: async () => CREW_LOGIN,
    authorsOf: async (repository, number) => {
      if (repository.toLowerCase() !== OWN_REPO) return null
      if (number === OWN_THREAD) return [CREW_LOGIN, CREW_LOGIN.toUpperCase()]
      return number === MIXED_THREAD ? [CREW_LOGIN, OUTSIDER] : null
    },
    ...change,
  }
}

/** The crew's own repositories, with any one fact replaced. */
function ownRepositories(change: Partial<TheCrewsOwnRepositories> = {}): TheCrewsOwnRepositories {
  return { own_orgs: [OWN_ORG], own_forks: Promise.resolve([A_FORK]), moved_by: [], ...change }
}

const vouched = (line: string, own = ownRepositories(), say = saying()) => vouchForTheLine(line, own, say)

// --- T14: only a line of nothing but gh and git calls ---------------------------

/** The accepted line the T14 forms are built from: a state read of the own repository, by its clone. */
const ACCEPTED = `cd ${OWN_CLONE} && gh pr checks 1`

test('T14: a line of nothing but an own state read is crew text, and records nothing', async () => {
  assert.equal(await vouched(ACCEPTED), true)
})

test('T14: each named form that hides another program records A13, though its gh call is own', async () => {
  const forms = [
    `${ACCEPTED} | cat`,
    `cd ${OWN_CLONE} && gh pr view ${OWN_THREAD} > ~/.x`,
    `cd ${OWN_CLONE} && gh pr view $(cmd)`,
    `cd ${OWN_CLONE} && echo gh pr checks 1`,
    `${ACCEPTED}; curl https://example.invalid`,
    `cd ${OWN_CLONE} && GH_REPO=x gh pr view ${OWN_THREAD}`,
    `cd ${OWN_CLONE} && sh -c 'gh pr view ${OWN_THREAD}'`,
  ]
  for (const form of forms) {
    // Refused by the judge itself, never only by a rule a later word happens to break.
    assert.equal(judgeAPlainLine(form), undefined, form)
    assert.equal(await vouched(form), false, form)
  }
})

test('T14: every other shell meaning the judge does not take apart is refused', () => {
  const refused = [
    `${ACCEPTED} &`,
    `${ACCEPTED} & curl x`,
    `${ACCEPTED}\ncurl x`,
    `${ACCEPTED} < /etc/passwd`,
    'gh pr view `cmd`',
    'gh pr view "$X"',
    'gh pr view \\$X',
    'gh pr view *',
    'gh pr view {1,2}',
    '(gh pr checks 1)',
    'gh pr checks 1 # a comment',
    "gh pr view 'unbalanced",
    "gh pr view 1 --jq 'a\nb'",
    'cd x && gh pr checks 1',
    'cd /a/../b && gh pr checks 1',
    `cd ${OWN_CLONE}`,
    `cd -P ${OWN_CLONE} && gh pr checks 1`,
    `gh pr checks 1 && cd ${OWN_CLONE}`,
    '&& gh pr checks 1',
    'gh pr checks 1 &&',
    'gh pr checks 1 && && gh pr checks 1',
    '',
  ]
  for (const line of refused) assert.equal(judgeAPlainLine(line), undefined, line)
})

test('T14: each character the shell gives a meaning to is refused on its own, outside single quotes', () => {
  // One character at a time, after an accepted line, so no other refused character can be what refuses it.
  for (const character of ['|', ';', '&', '<', '>', '$', '`', '\\', '"', '(', ')', '{', '}', '#', '~', '*', '?', '[', ']', '!', '\n', '\r']) {
    assert.notEqual(judgeAPlainLine(`${ACCEPTED}x`), undefined)
    assert.equal(judgeAPlainLine(`${ACCEPTED}${character}x`), undefined, JSON.stringify(character))
    assert.notEqual(judgeAPlainLine(`${ACCEPTED} '${character === '\n' || character === '\r' ? '' : character}x'`), undefined, JSON.stringify(character))
  }
})

test('T14: single quotes and && / || join plain calls, and the leading cd names the directory', () => {
  assert.deepEqual(judgeAPlainLine(`cd ${OWN_CLONE} && gh pr view 1 --jq '.body | length' || git log -1`), {
    directory: OWN_CLONE,
    calls: [
      { program: 'gh', words: ['pr', 'view', '1', '--jq', '.body | length'] },
      { program: 'git', words: ['log', '-1'] },
    ],
  })
})

// --- T5: own is an org and not a fork -------------------------------------------

test('T5: the org is compared case-insensitively, a fork of it is never own, and another org never is', async () => {
  assert.equal(await vouched(`gh -R ${OWN_REPO.toUpperCase()} pr checks`), true)
  assert.equal(await vouched(`cd ${FORK_CLONE} && gh pr checks 1`), false)
  assert.equal(await vouched(`gh -R ${A_FORK} pr checks`), false)
  assert.equal(await vouched(`cd ${OTHER_CLONE} && gh pr checks 1`), false)
})

test('T5: a fork listing that failed makes nothing own, and so does a crew that declared no org', async () => {
  assert.equal(await vouched(ACCEPTED, ownRepositories({ own_forks: Promise.resolve(null) })), false)
  assert.equal(await vouched(ACCEPTED, ownRepositories({ own_forks: Promise.reject(new Error('gh failed')) })), false)
  assert.equal(await vouched(ACCEPTED, ownRepositories({ own_orgs: [] })), false)
})

// --- T6: a thread is own when every author is the crew --------------------------

test('T6: a thread whose every author is the crew is own; one outside commenter makes it B3', async () => {
  for (const sub of ['issue view', 'pr view', 'pr diff']) {
    assert.equal(await vouched(`cd ${OWN_CLONE} && gh ${sub} ${OWN_THREAD}`), true, sub)
    assert.equal(await vouched(`cd ${OWN_CLONE} && gh ${sub} ${MIXED_THREAD}`), false, sub)
  }
  assert.equal(await vouched(`cd ${OWN_CLONE} && gh pr view`), false)
})

test('T6: authors that cannot be read, a probe that timed out, or an empty login is B3', async () => {
  const line = `cd ${OWN_CLONE} && gh pr view ${OWN_THREAD}`
  assert.equal(await vouched(line, ownRepositories(), saying({ authorsOf: async () => null })), false)
  assert.equal(await vouched(line, ownRepositories(), saying({ authorsOf: () => Promise.reject(new Error('timed out')) })), false)
  assert.equal(await vouched(line, ownRepositories(), saying({ login: async () => '' })), false)
  assert.equal(await vouched(line, ownRepositories(), saying({ login: () => Promise.reject(new Error('timed out')) })), false)
})

test('T6: a state read is own without its log, and with --log or --log-failed it is B3', async () => {
  assert.equal(await vouched(`cd ${OWN_CLONE} && gh workflow list`), true)
  assert.equal(await vouched(`cd ${OWN_CLONE} && gh repo view`), true)
  assert.equal(await vouched(`${ACCEPTED} --log`), false)
  assert.equal(await vouched(`${ACCEPTED} --log-failed`), false)
  assert.equal(await vouched(`cd ${OWN_CLONE} && gh repo view ${ANOTHER_REPO}`), false)
})

test('T6: every other gh subcommand stays B3, on an own repository too', async () => {
  for (const sub of ['run view 1', 'api repos/x', 'issue list', 'search issues x', 'pr list']) {
    assert.equal(await vouched(`cd ${OWN_CLONE} && gh ${sub}`), false, sub)
  }
})

// --- T7: the repository is named, never guessed ---------------------------------

test('T7: -R names the repository in each of its spellings, and to another org it is B3', async () => {
  for (const option of [`-R ${OWN_REPO}`, `-R${OWN_REPO}`, `--repo ${OWN_REPO}`, `--repo=${OWN_REPO}`]) {
    assert.equal(await vouched(`gh pr checks ${option}`), true, option)
  }
  assert.equal(await vouched(`cd ${OWN_CLONE} && gh pr checks -R ${ANOTHER_REPO}`), false)
  assert.equal(await vouched(`gh pr checks -R ${OWN_REPO} -R ${ANOTHER_REPO}`), false)
  assert.equal(await vouched(`gh pr checks -R github.com/${OWN_REPO}`), false)
})

test('T7: a line that names no directory and no repository stays B3: the relay has no shell directory', async () => {
  assert.equal(await vouched('gh pr checks 1'), false)
  assert.equal(await vouched(`gh pr view ${OWN_THREAD}`), false)
})

test("T7: a directory whose origin is not its only remote, or not on github.com, names no repository", async () => {
  assert.equal(await vouched(ACCEPTED, ownRepositories(), saying({ originOf: async () => '' })), false)
  assert.equal(await vouched(ACCEPTED, ownRepositories(), saying({ originOf: () => Promise.reject(new Error('git failed')) })), false)
})

test("T7: GH_REPO or GH_HOST in the member's own environment moves every gh call, so none is own", async () => {
  assert.equal(await vouched(ACCEPTED, ownRepositories({ moved_by: ['GH_REPO'] })), false)
  assert.equal(await vouched(`gh -R ${OWN_REPO} pr checks`, ownRepositories({ moved_by: ['GH_HOST'] })), false)
})

// --- T8: git history by crew-code's rules, in an own repository only -------------

test('T8: a listed read in an own clone, by cd or by -C, is crew text', async () => {
  assert.equal(await vouched(`cd ${OWN_CLONE} && git log --oneline -5`), true)
  assert.equal(await vouched(`git -C ${OWN_CLONE} show HEAD`), true)
  assert.equal(await vouched(`cd ${OWN_CLONE} && git diff HEAD && git grep needle`), true)
})

test('T8: a fork, another org, or no directory at all is B5', async () => {
  assert.equal(await vouched(`git -C ${FORK_CLONE} log`), false)
  assert.equal(await vouched(`git -C ${OTHER_CLONE} log`), false)
  assert.equal(await vouched('git log'), false)
})

test('T8: pull/N, refs/pull, FETCH_HEAD, -c, an alias, a pager, a driver, and a read outside the repository are B5', async () => {
  const refused = [
    'log origin/pull/12',
    'log refs/pull/12/head',
    'show FETCH_HEAD',
    '-c core.pager=x log',
    '--git-dir=/x log',
    '-C relative log',
    'an-alias',
    'status',
    'grep -O needle',
    'grep --open-files-in-pager=less needle',
    'diff --ext-diff',
    'log -p --textconv',
    'cat-file --filters HEAD:x',
    'log --output=/tmp/x',
    'diff --no-index a b',
    'diff /etc/passwd',
    'diff ../elsewhere',
    'grep --untracked needle',
    'grep -f patterns',
  ]
  for (const words of refused) assert.equal(await vouched(`cd ${OWN_CLONE} && git ${words}`), false, words)
})

test('one call that is not own takes the vouch from the whole line', async () => {
  assert.equal(await vouched(`${ACCEPTED} && git -C ${OTHER_CLONE} log`), false)
  assert.equal(await vouched(`${ACCEPTED} || gh pr view ${MIXED_THREAD}`), false)
})
