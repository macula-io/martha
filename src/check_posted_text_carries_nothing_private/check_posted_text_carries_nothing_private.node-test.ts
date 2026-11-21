// The posted text is read, every surface of it, and what it carries that may not
// be public is refused by name (martha#265). GitHub's answers are stood in for,
// so no unit test touches the network: what is proved here is this check's own
// reading, its naming, and that the crew's decision refuses what it hands over.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { privateHitsIn, type Hit, type Resolve } from '../check_nothing_private_gets_in/check_nothing_private_gets_in.ts'
import { rulesOf, SYNTHETIC, type Rules } from '../know_what_text_is_private/know_what_text_is_private.ts'
import { PUBLIC_TEXT_PATTERNS } from '../know_what_text_is_private/public_text.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { postedTextSources } from './posted_text.ts'
import { standInPage } from './plant_every_surface.ts'
import { API, readPostedText, ROUTES, type Call, type Request } from './read_posted_text.ts'

// Every value planted here is a synthetic form, because this file is in the
// public tree the check reads. The class tests switch the synthetic allowance
// off, so each class is shown to refuse that very value on its own.
const strict: Rules = {
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
const HOME_HIT = 'a home directory (value withheld)'

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
    [standInPage(ROUTES.issues(REPO), 1)]: [anIssue(at('issue')), aPullInTheIssuesList()],
    [standInPage(ROUTES.issueComments(REPO), 1)]: [anIssueComment(at('issue comment'))],
    [standInPage(ROUTES.pulls(REPO), 1)]: [aPull(at('pull'))],
    [standInPage(ROUTES.reviews(REPO, 263), 1)]: [aReview(at('review'))],
    [standInPage(ROUTES.reviewComments(REPO), 1)]: [aReviewComment(at('review comment'))],
    [standInPage(ROUTES.commitComments(REPO), 1)]: [aCommitComment(at('commit comment'))],
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
  answers[standInPage(ROUTES.issues(REPO), 1)] = [anIssue(CLEAN), aPullInTheIssuesList(titled)]
  answers[standInPage(ROUTES.pulls(REPO), 1)] = [{ ...aPull(CLEAN), title: titled }]
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
    ['a lab hostname (value withheld)', 'a home directory (value withheld)', 'a private address (value withheld)'],
  )
})

test('a real scan\'s rules allow the synthetic forms, and the same rules with the allowance off refuse them', async () => {
  assert.deepEqual(await wheresOf(answersWith('issue comment', FORMS), rulesOf(true)), [])
  assert.deepEqual((await hitsOf(answersWith('issue comment', FORMS), rulesOf(false))).length, 3)
})

test('a home path inside a fenced code block is refused like any other', async () => {
  const fenced = ['the proof:', '```sh', `ls ${HOME_PATH}`, '```'].join('\n')
  const hits = await hitsOf(answersWith('issue comment', fenced))
  assert.deepEqual(hits.map((hit) => hit.where), ['issue #170 comment 6765201999:3'])
})

test('a lab machine name in posted text passes: the owner dropped the class (martha#773)', async () => {
  assert.deepEqual(await hitsOf(answersWith('review', 'confirmed, I ran this on synth07'), rulesOf(true)), [])
})

test('a surface that cannot be read stops the check, and names the surface', async () => {
  const answers = answersWith('issue', CLEAN)
  delete answers[standInPage(ROUTES.reviews(REPO, 263), 1)]
  await assert.rejects(readPostedText(calling(answers).call, REPO), /pulls\/263\/reviews/)
})

test('the command cannot look, and says so: a missing draft is exit 2, never a pass', () => {
  const ran = spawnSync(process.execPath, [join(import.meta.dirname, 'main.ts'), '--text', join(import.meta.dirname, 'not-a-draft.md')], {
    encoding: 'utf8',
    env: process.env,
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
      env: process.env,
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

// The seam GitHub sees: what the reader asks for, parsed the way GitHub parses it.
// Nothing here is built by pageOf, so a malformed request cannot hide behind a
// stand-in keyed by the same code (martha#265 r=2).
test('every request is a GET of one well-formed page of one surface, parsed as GitHub parses it', async () => {
  const routes = [
    ROUTES.issues(REPO),
    ROUTES.issueComments(REPO),
    ROUTES.pulls(REPO),
    ROUTES.reviews(REPO, 263),
    ROUTES.reviewComments(REPO),
    ROUTES.commitComments(REPO),
  ]
  const surfaces = routes.map((route) => new URL(route, API).pathname)
  const pullsSurface = new URL(ROUTES.pulls(REPO), API).pathname
  // A stand-in that answers whatever it is handed, so the reader finishes and every
  // request it made can be read. What is under test is the request, not the answer;
  // only the pulls list must carry a pull, so that reviews are asked for as well.
  const asked: Request[] = []
  const lenient: Call = async (request) => {
    asked.push(request)
    return new URL(request.path, API).pathname === pullsSurface ? [{ number: 263, title: CLEAN, body: CLEAN }] : []
  }
  await readPostedText(lenient, REPO)
  assert.ok(asked.length > 0, 'nothing was asked for')
  for (const request of asked) {
    const url = new URL(request.path, API)
    assert.equal(request.method, 'GET')
    assert.ok(surfaces.includes(url.pathname), `${request.path} is not one of the six surfaces`)
    // The design asks for 100 a page (§ "Every list is followed to its last page").
    assert.equal(url.searchParams.get('per_page'), '100', `${request.path} does not ask for a page of 100`)
    assert.match(url.searchParams.get('page') ?? '', /^[1-9][0-9]*$/, `${request.path} does not ask for a page number`)
  }
  assert.deepEqual(
    [...new Set(asked.map((request) => new URL(request.path, API).pathname))].sort(),
    [...surfaces].sort(),
    'not every one of the six surfaces was asked for',
  )
  const commentRequests = asked.filter((request) => new URL(request.path, API).pathname === new URL(ROUTES.issueComments(REPO), API).pathname)
  assert.ok(commentRequests.length > 0, 'the comments list was never asked for')
  assert.ok(commentRequests.every((request) => !new URL(request.path, API).searchParams.has('state')), 'the comments list was asked for a state it does not take')
})

test('a full page is followed to the last one', async () => {
  const full = Array.from({ length: 100 }, (_step, at) => anIssueComment(`note ${at}`))
  const answers: Record<string, unknown> = {
    ...answersWith('issue', CLEAN),
    [standInPage(ROUTES.issueComments(REPO), 1)]: full,
    [standInPage(ROUTES.issueComments(REPO), 2)]: [anIssueComment(`the proof is at ${HOME_PATH}`)],
  }
  assert.deepEqual(await wheresOf(answers), ['issue #170 comment 6765201999:1'])
  const { call, asked } = calling(answers)
  await readPostedText(call, REPO)
  assert.ok(asked.some((request) => request.path === standInPage(ROUTES.issueComments(REPO), 2)), 'the second page was not read')
})

// The page's promise to a member who writes an example (martha#615). What it offers must be a
// form the check accepts by a rule of its own; a spelling the check merely fails to match is not
// a form, and a member following such an example writes the same name without the brackets and
// meets a red run. The page is read here rather than restated, so the promise and the check
// cannot drift apart again.
const THE_PAGE = readFileSync(join(import.meta.dirname, '../../docs/nothing-private-gets-in.md'), 'utf8')

/** The paragraph in which the page makes that promise, as its own lines. */
const thePromisesParagraphIn = (page: string): string => {
  const lines = page.split('\n')
  const at = lines.findIndex((line) => line.startsWith('Legitimate text passes by its form'))
  assert.ok(at !== -1, 'the page no longer makes the promise this test reads, so it would prove nothing')
  const after = lines.slice(at)
  const ends = after.findIndex((line, offset) => offset > 0 && line.trim() === '')
  return (ends === -1 ? after : after.slice(0, ends)).join('\n')
}

/** Whether the check accepts `value` by a form of its own, rather than by failing to match it. */
const acceptedByAForm = (value: string): boolean =>
  new RegExp(SYNTHETIC.home_dir).test(value) || new RegExp(PUBLIC_TEXT_PATTERNS.allow_home).test(value)

test('every home path the page offers as legitimate is a form the check accepts', () => {
  const offered = [...thePromisesParagraphIn(THE_PAGE).matchAll(/`(\/home\/[^`]+)`/g)].map((found) => found[1] ?? '')
  assert.ok(offered.length > 0, 'the promise offers no home path, so this test would prove nothing')
  const unaccepted = offered.filter((value) => !acceptedByAForm(value))
  assert.deepEqual(
    unaccepted,
    [],
    `the page offers ${unaccepted.join(', ')}, which is no form: it passes only because the check does not match it, and the same name without the brackets is refused`,
  )
})

// A name nobody declared, drawn here so this file carries no such value: the page says an
// invented name is refused exactly as a real one is, because nothing tells the two apart.
const anInventedName = () => `a${randomBytes(4).toString('hex')}`

test('a home path under an invented name is refused, say the page and the check alike', async () => {
  const invented = anInventedName()
  assert.deepEqual(
    await wheresOf(answersWith('issue comment', `a home path at /home/${invented}`)),
    ['issue #170 comment 6765201999:1'],
    'an invented home name passed: the page tells a member it will be refused',
  )
})

test('a repository under an invented owner is refused, say the page and the check alike', async () => {
  const invented = anInventedName()
  const reservesNothing: Resolve = async () => 'not_public'
  const hits = await privateHitsIn(await sourcesOf(answersWith('issue comment', `see ${invented}/widget#1`)), strict, reservesNothing)
  assert.deepEqual(hits.map((hit) => hit.where), ['issue #170 comment 6765201999:1'], 'an invented owner passed')
  assert.match(hits[0]?.what ?? '', /^a repository that is not public/)
})
