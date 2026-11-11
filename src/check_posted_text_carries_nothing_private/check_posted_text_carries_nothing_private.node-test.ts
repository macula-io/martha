// The posted text is read, every surface of it, and what it carries that may not
// be public is refused by name (martha#265). GitHub's answers are stood in for,
// so no unit test touches the network: what is proved here is this check's own
// reading, its naming, and that the crew's decision refuses what it hands over.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  familiesFrom,
  privateHitsIn,
  type Hit,
  type Resolve,
  type Rules,
} from '../check_nothing_private_gets_in/check_nothing_private_gets_in.ts'
import { rulesOf } from '../check_nothing_private_gets_in/scan_rules_and_visibility.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { postedTextSources } from './posted_text.ts'
import { pageOf, readPostedText, ROUTES, type Call, type Request } from './read_posted_text.ts'

// Every value planted here is a synthetic form, because this file is in the
// public tree the check reads. The class tests switch the synthetic allowance
// off, so each class is shown to refuse that very value on its own.
const strict: Rules = {
  labHosts: ['synth'],
  publicEmails: ['macula.io'],
  publicAddresses: ['ada@synthetic.invalid'],
  owners: ['synthetic-owner'],
  ownRepo: 'martha',
  allowSynthetic: false,
}
const scanning: Rules = { ...strict, allowSynthetic: true }

// A fixed answer per repository, so no unit test touches the network.
const resolveFixed: Resolve = async () => 'public'

// The forms a public text may write: a placeholder the class cannot match, the
// allow_home names, and each synthetic form.
const FORMS = 'see /home/<user>, /home/test, /home/probe, /home/x, /home/ops, /home/synthetic, ci-synthetic.lab, 192.168.255.7'

const REPO = 'macula-io/martha'
const CLEAN = 'ran the suite; see martha#14'
const HOME_PATH = '/home/synthetic/notes'
const HOME_HIT = 'a home directory (/home/synthetic)'

// A commit id drawn at run time: an id written here would be read by the tree
// scan, and a drawn one is a value no reader can confuse with a real node id.
const A_COMMIT = randomBytes(20).toString('hex')

const anIssue = (plant: string) => ({ number: 1, title: 'an issue', body: plant })
const aPullInTheIssuesList = (title = 'a pull') => ({ number: 263, title, body: 'x', pull_request: {} })
const anIssueComment = (plant: string) => ({
  id: 6765201999,
  issue_url: `https://api.github.com/repos/${REPO}/issues/170`,
  body: plant,
})
const aPull = (plant: string) => ({ number: 263, title: 'a pull', body: plant })
const aReview = (plant: string) => ({ id: 4810, body: plant })
const aReviewComment = (plant: string) => ({
  id: 4812,
  pull_request_url: `https://api.github.com/repos/${REPO}/pulls/263`,
  body: plant,
})
const aCommitComment = (plant: string) => ({ id: 12, commit_id: A_COMMIT, body: plant })

// Every surface answered, with the plant where the caller puts it and a clean
// line everywhere else.
const answersWith = (surface: string, plant: string): Record<string, unknown> => {
  const at = (name: string) => (name === surface ? plant : CLEAN)
  return {
    [pageOf(ROUTES.issues(REPO), 1)]: [anIssue(at('issue')), aPullInTheIssuesList()],
    [pageOf(ROUTES.issueComments(REPO), 1)]: [anIssueComment(at('issue comment'))],
    [pageOf(ROUTES.pulls(REPO), 1)]: [aPull(at('pull'))],
    [pageOf(ROUTES.reviews(REPO, 263), 1)]: [aReview(at('review'))],
    [pageOf(ROUTES.reviewComments(REPO), 1)]: [aReviewComment(at('review comment'))],
    [pageOf(ROUTES.commitComments(REPO), 1)]: [aCommitComment(at('commit comment'))],
  }
}

// The reader's requests, answered from a map and remembered, so a test can hold
// the reader to what it asked for as well as to what it made of the answers.
const calling = (answered: Readonly<Record<string, unknown>>) => {
  const asked: Request[] = []
  const call: Call = async (request) => {
    asked.push(request)
    const answer = answered[request.path]
    if (answer === undefined) throw new Error(`the stand-in GitHub was asked for ${request.path}`)
    return answer
  }
  return { call, asked }
}

const sourcesOf = async (answers: Readonly<Record<string, unknown>>) =>
  postedTextSources(await readPostedText(calling(answers).call, REPO))

const hitsOf = async (answers: Readonly<Record<string, unknown>>, rules: Rules = strict): Promise<Hit[]> =>
  privateHitsIn(await sourcesOf(answers), rules, resolveFixed)

const wheresOf = async (answers: Readonly<Record<string, unknown>>, rules: Rules = strict): Promise<string[]> =>
  (await hitsOf(answers, rules)).map((hit) => hit.where)

test('a cited home path in an issue comment is refused, and the location names that comment', async () => {
  const hits = await hitsOf(answersWith('issue comment', `the proof is at ${HOME_PATH}`))
  assert.deepEqual(hits, [{ where: 'issue #170 comment 6765201999:1', what: HOME_HIT }])
})

test('every surface is read: a plant on any one of them is refused where it sits', async () => {
  const expected: Readonly<Record<string, string>> = {
    issue: 'issue #1 body:1',
    'issue comment': 'issue #170 comment 6765201999:1',
    pull: 'pull 263 body:1',
    review: 'pull 263 review 4810:1',
    'review comment': 'pull 263 review comment 4812:1',
    'commit comment': `commit ${A_COMMIT.slice(0, 7)} comment 12:1`,
  }
  for (const [surface, where] of Object.entries(expected)) {
    assert.deepEqual(await hitsOf(answersWith(surface, `the proof is at ${HOME_PATH}`)), [{ where, what: HOME_HIT }], surface)
  }
})

test('a title is read as posted text, and a pull is read once though it is listed twice', async () => {
  const answers = answersWith('issue', CLEAN)
  const titled = `the proof is at ${HOME_PATH}`
  answers[pageOf(ROUTES.issues(REPO), 1)] = [anIssue(CLEAN), aPullInTheIssuesList(titled)]
  answers[pageOf(ROUTES.pulls(REPO), 1)] = [{ ...aPull(CLEAN), title: titled }]
  const names = (await sourcesOf(answers)).map((source) => source.name)
  assert.deepEqual(names.filter((name) => name.startsWith('issue #263')), [], 'the pull was read from the issues list as well')
  assert.deepEqual(await wheresOf(answers), ['pull 263 title:1'], "the pull's title was not read, or was read twice")
})

test('the forms a public tree may write pass beside a real-shaped value that is refused', async () => {
  const drawn = randomBytes(32).toString('hex')
  assert.deepEqual(await wheresOf(answersWith('issue comment', FORMS), scanning), [], 'a legitimate form was refused')
  const beside = await hitsOf(answersWith('issue comment', `${FORMS} and ${drawn}`), scanning)
  assert.deepEqual(beside.map((hit) => hit.where), ['issue #170 comment 6765201999:1'])
  assert.match(beside[0]?.what ?? '', /^a 64-hex id/, 'the drawn value was not refused')
  // The same forms, with the allowance off: each synthetic form is refused, so
  // what passes above passed because the allowance is on, not because it passed unseen.
  assert.deepEqual(
    (await hitsOf(answersWith('issue comment', FORMS))).map((hit) => hit.what),
    ['a lab hostname (value withheld)', 'a home directory (/home/synthetic)', 'a private address (192.168.255.7)'],
  )
})

test('a real scan\'s rules allow the synthetic forms, and the same rules with the allowance off refuse them', async () => {
  const none = familiesFrom('[]', false)
  assert.deepEqual(await wheresOf(answersWith('issue comment', FORMS), rulesOf(none, true)), [])
  assert.deepEqual((await hitsOf(answersWith('issue comment', FORMS), rulesOf(none, false))).length, 3)
})

test('a home path inside a fenced code block is refused like any other', async () => {
  const fenced = ['the proof:', '```sh', `ls ${HOME_PATH}`, '```'].join('\n')
  const hits = await hitsOf(answersWith('issue comment', fenced))
  assert.deepEqual(hits.map((hit) => hit.where), ['issue #170 comment 6765201999:3'])
})

test('a lab machine family from the secret is refused and never printed', async () => {
  const rules = rulesOf(familiesFrom('["synth"]', false), true)
  const hits = await hitsOf(answersWith('review', 'confirmed, I ran this on synth07'), rules)
  assert.deepEqual(hits, [{ where: 'pull 263 review 4810:1', what: 'a lab machine name (value withheld)' }])
  assert.ok(!JSON.stringify(hits).includes('synth07'), 'the family was printed')
})

test('a surface that cannot be read stops the check, and names the surface', async () => {
  const answers = answersWith('issue', CLEAN)
  delete answers[pageOf(ROUTES.reviews(REPO, 263), 1)]
  await assert.rejects(readPostedText(calling(answers).call, REPO), /pulls\/263\/reviews/)
})

test('the command cannot look, and says so: a missing draft is exit 2, never a pass', () => {
  const ran = spawnSync(process.execPath, [join(import.meta.dirname, 'main.ts'), '--text', join(import.meta.dirname, 'not-a-draft.md')], {
    encoding: 'utf8',
    env: { ...process.env, MARTHA_LAB_HOSTS: '[]' },
  })
  assert.equal(ran.status, 2, ran.stderr)
  assert.match(ran.stderr, /could not be made/)
})

test('the command refuses a draft that carries a cited path, and passes a clean one', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'martha-265-'))
  t.after(() => removeTheTree(directory))
  const ran = (name: string, body: string) => {
    const draft = join(directory, name)
    writeFileSync(draft, body)
    return spawnSync(process.execPath, [join(import.meta.dirname, 'main.ts'), '--text', draft], {
      encoding: 'utf8',
      env: { ...process.env, MARTHA_LAB_HOSTS: '[]' },
    })
  }
  assert.equal(ran('clean.md', 'nothing private here\n').status, 0)
  // A path drawn at run time: the command runs a real scan, where every synthetic
  // form passes, and this file may carry none of them as a refused value.
  const cited = ['', 'home', `u${randomBytes(6).toString('hex')}`].join('/')
  const refused = ran('cited.md', `see ${cited}\n`)
  assert.equal(refused.status, 1, refused.stderr)
  assert.match(refused.stdout, /a home directory/)
})

test('every request is a GET of one of the six surfaces, a page of 100, and the comments list carries no state', async () => {
  const { call, asked } = calling(answersWith('issue', CLEAN))
  await readPostedText(call, REPO)
  const allowed = [
    ROUTES.issues(REPO),
    ROUTES.issueComments(REPO),
    ROUTES.pulls(REPO),
    ROUTES.reviews(REPO, 263),
    ROUTES.reviewComments(REPO),
    ROUTES.commitComments(REPO),
  ]
  for (const request of asked) {
    assert.equal(request.method, 'GET')
    assert.ok(allowed.some((route) => request.path.startsWith(route)), `${request.path} is not one of the surfaces`)
    assert.match(request.path, /per_page=100/)
  }
  const commentRequests = asked.filter((request) => request.path.startsWith(ROUTES.issueComments(REPO)))
  assert.ok(commentRequests.length > 0, 'the comments list was never asked for')
  assert.ok(commentRequests.every((request) => !request.path.includes('state=')), 'the comments list was asked for a state it does not take')
})

test('a full page is followed to the last one', async () => {
  const full = Array.from({ length: 100 }, (_step, at) => anIssueComment(`note ${at}`))
  const answers: Record<string, unknown> = {
    ...answersWith('issue', CLEAN),
    [pageOf(ROUTES.issueComments(REPO), 1)]: full,
    [pageOf(ROUTES.issueComments(REPO), 2)]: [anIssueComment(`the proof is at ${HOME_PATH}`)],
  }
  assert.deepEqual(await wheresOf(answers), ['issue #170 comment 6765201999:1'])
  const { call, asked } = calling(answers)
  await readPostedText(call, REPO)
  assert.ok(asked.some((request) => request.path === pageOf(ROUTES.issueComments(REPO), 2)), 'the second page was not read')
})
