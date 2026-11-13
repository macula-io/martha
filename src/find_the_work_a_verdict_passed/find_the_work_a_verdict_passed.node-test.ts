// Finding the work a verdict passed (martha#256, slice 2's read-back).
//
// This exists so the next package can land what a reviewer really passed: from a package's ledger it reads the latest
// VERDICT, takes the head that verdict's range names, and asks GitHub for the one open pull request at that head. It
// merges nothing, pushes nothing and registers no tool; it answers with the pull request and its head, or refuses by
// name. No PASS row, a package of another repository, a head no open pull request stands at, and two open pull
// requests at one head are the four the design names, and each is answered in its own words.
//
// GitHub's answers in these tests are recordings, kept beside this file: the shape is GitHub's own, trimmed to the
// fields this slice reads (see recorded_pulls_at_a_head.json). The two answers a recording cannot hold — two open
// pull requests at one head, and an open pull request whose head moved — are written in the test that needs them and
// said to be written.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import type { HostContract, ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { hostForTests, type HostForTests } from '../host_contract/host_for_tests.ts'
import { keepTheMilestone } from '../keep_the_ledger/keep_the_ledger.ts'
import { noteMilestone } from '../log_ledger/log_ledger.ts'
import { readACrewLine, keepTheLinesRow } from '../read_a_crew_line/read_a_crew_line.ts'
import { GITHUB_CLI } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { findTheWorkAVerdictPassed } from './find_the_work_a_verdict_passed.ts'

/** One pull request as the recording kept it, to the fields this slice reads and GitHub's nesting of `head`. */
interface RecordedPull {
  readonly number: number
  readonly state: string
  readonly merged_at: string | null
  readonly head: { readonly sha: string }
}

interface RecordedAnswer {
  readonly repo: string
  readonly sha: string
  readonly answer: readonly RecordedPull[]
}

const RECORDED = JSON.parse(readFileSync(new URL('./recorded_pulls_at_a_head.json', import.meta.url), 'utf8')) as {
  readonly open: RecordedAnswer
  readonly closed: RecordedAnswer
}

const PACKAGE = 'macula-io/martha#251'
const REPO = PACKAGE.slice(0, PACKAGE.indexOf('#'))
const CWD = `/clones/${REPO}`
const OPEN = RECORDED.open
const CLOSED = RECORDED.closed
const BASE = 'e7009dfbd2b89172efccfa077c849a927648daee'

/** The pull request the recording holds, read from the recording rather than written out a second time. */
const recordedPull = (recorded: RecordedAnswer): RecordedPull => {
  const [one] = recorded.answer
  assert.ok(one !== undefined, `the recording of ${recorded.sha} holds no pull request`)
  return one
}

/** The number after `#` in a package's name: its issue number. */
const issueNumber = (work_package: string): string => work_package.slice(work_package.indexOf('#') + 1)

/** A line a reviewer sent about a package, as the row that kept it holds it, in the shape the crew really sends. */
const verdictLine = (work_package: string, verdict: 'PASS' | 'FAIL', tip: string): string =>
  `VERDICT ${work_package} ${verdict} ${BASE}..${tip} r=2 ci=1 req=0`

interface LedgerWithGithub {
  readonly host: HostContract
  readonly asked: readonly ProcessRequest[]
}

/** A ledger holding these notes as verdict rows on `work_package`, and a GitHub that answers as `answer` says. */
async function aLedgerOf(
  work_package: string,
  notes: readonly string[],
  answer: { readonly ok: ProcessOutcome } | { readonly run: (request: ProcessRequest) => Promise<ProcessOutcome> },
): Promise<LedgerWithGithub> {
  const asked: ProcessRequest[] = []
  const run =
    'run' in answer
      ? answer.run
      : (request: ProcessRequest): Promise<ProcessOutcome> => {
          asked.push(request)
          return Promise.resolve(answer.ok)
        }
  const { host }: HostForTests = hostForTests({ now: 3_000, run })
  for (const note of notes) {
    await noteMilestone(host, { package: work_package, member: 'Mercurius', milestone: 'verdict_given', note })
  }
  return { host, asked }
}

/** What gh says when it answers at all. */
const ghSaid = (answer: unknown): { readonly ok: ProcessOutcome } => ({
  ok: { exit_code: 0, stdout: JSON.stringify(answer), stderr: '' },
})

test('#256: the one open pull request at the head the latest PASS row names is found, and its number is not the issue number', async () => {
  const recorded = recordedPull(OPEN)
  const { host, asked } = await aLedgerOf(PACKAGE, [verdictLine(PACKAGE, 'PASS', OPEN.sha)], ghSaid(OPEN.answer))
  const found = await findTheWorkAVerdictPassed(host, { package: PACKAGE, repo: REPO, cwd: CWD })
  assert.deepEqual(found, { pr: recorded.number, head: OPEN.sha }, 'the recorded answer holds one open pull request at that head')
  assert.notEqual(String(recorded.number), issueNumber(PACKAGE), 'the recorded pull request carries the package\'s own issue number, so this case proves nothing')
  assert.equal(asked.length, 1, 'GitHub was asked once')
  assert.deepEqual(asked[0], {
    command: GITHUB_CLI,
    args: ['api', `repos/${REPO}/commits/${OPEN.sha}/pulls`],
    cwd: CWD,
  })
})

test('#256: the PASS line the crew really sends, with req=0, is kept and read back as the pull request and its head', async () => {
  const recorded = recordedPull(OPEN)
  const reading = readACrewLine(verdictLine(PACKAGE, 'PASS', OPEN.sha))
  assert.ok('line' in reading && reading.line !== null, `the line the crew sends was refused, so it would write no row: ${JSON.stringify(reading)}`)

  const { host } = await aLedgerOf(PACKAGE, [], ghSaid(OPEN.answer))
  await keepTheLinesRow(host, 'Pluto', reading.line)
  const found = await findTheWorkAVerdictPassed(host, { package: PACKAGE, repo: REPO, cwd: CWD })
  assert.deepEqual(found, { pr: recorded.number, head: OPEN.sha }, `the row a real PASS line wrote did not read back: ${JSON.stringify(found)}`)
})

test('#256: a reviewer\'s own words in a review round row after the VERDICT do not hide the passed head', async () => {
  const recorded = recordedPull(OPEN)
  const { host } = await aLedgerOf(PACKAGE, [verdictLine(PACKAGE, 'PASS', OPEN.sha)], ghSaid(OPEN.answer))
  // The row `log_a_milestone` writes for a review round: the same row kind, in the reviewer's own words rather than a line.
  await keepTheMilestone(host, { package: PACKAGE, member: 'Pluto', event: 'review_round', note: 'round 1 closed: three changes folded in and the tip is green again' })
  const found = await findTheWorkAVerdictPassed(host, { package: PACKAGE, repo: REPO, cwd: CWD })
  assert.deepEqual(found, { pr: recorded.number, head: OPEN.sha }, `a free-text review round row was taken for the latest verdict: ${JSON.stringify(found)}`)
})

test('#350: a VERDICT-shaped note a member logs with log_a_milestone passes no head', async () => {
  const { host, asked } = await aLedgerOf(PACKAGE, [], ghSaid(OPEN.answer))
  // A builder naming its own tip as passed the way the log tool allows: a real VERDICT line, logged as a review round.
  const logged = await keepTheMilestone(host, { package: PACKAGE, member: 'Hygiea', event: 'review_round', note: verdictLine(PACKAGE, 'PASS', OPEN.sha) })
  assert.match(logged.told, /^Kept: review_round/, 'a review round is a milestone the crew keeps, so the row is written')
  const found = await findTheWorkAVerdictPassed(host, { package: PACKAGE, repo: REPO, cwd: CWD })
  assert.ok('refused' in found, `a logged VERDICT-shaped note passed a head nobody reviewed: ${JSON.stringify(found)}`)
  assert.match(found.refused, /no PASS row/, 'the answer did not name what is missing')
  assert.equal(asked.length, 0, 'GitHub was asked for a package no reviewer passed')
})

test('#350: a logged VERDICT-shaped FAIL note hides no PASS a reviewer really gave', async () => {
  const recorded = recordedPull(OPEN)
  const { host } = await aLedgerOf(PACKAGE, [verdictLine(PACKAGE, 'PASS', OPEN.sha)], ghSaid(OPEN.answer))
  await keepTheMilestone(host, { package: PACKAGE, member: 'Hygiea', event: 'review_round', note: verdictLine(PACKAGE, 'FAIL', OPEN.sha) })
  const found = await findTheWorkAVerdictPassed(host, { package: PACKAGE, repo: REPO, cwd: CWD })
  assert.deepEqual(found, { pr: recorded.number, head: OPEN.sha }, `a logged FAIL note hid the PASS the reviewer gave: ${JSON.stringify(found)}`)
})

test('#256: the latest VERDICT decides, so an older PASS never answers after a later FAIL', async () => {
  const notes = [verdictLine(PACKAGE, 'PASS', OPEN.sha), verdictLine(PACKAGE, 'FAIL', OPEN.sha)]
  const { host, asked } = await aLedgerOf(PACKAGE, notes, ghSaid(OPEN.answer))
  const found = await findTheWorkAVerdictPassed(host, { package: PACKAGE, repo: REPO, cwd: CWD })
  assert.ok('refused' in found, `a later FAIL did not refuse: ${JSON.stringify(found)}`)
  assert.match(found.refused, /no PASS row/, 'the answer did not name what is missing')
  assert.equal(asked.length, 0, 'GitHub was asked for a package no verdict passed')
})

test('#256: a package with no PASS row is refused by name', async () => {
  const { host } = await aLedgerOf(PACKAGE, [], ghSaid(OPEN.answer))
  const found = await findTheWorkAVerdictPassed(host, { package: PACKAGE, repo: REPO, cwd: CWD })
  assert.ok('refused' in found)
  assert.match(found.refused, /no PASS row/)
  assert.match(found.refused, new RegExp(PACKAGE), 'the answer did not name the package')
})

test('#256: a package of another repository is refused, naming both', async () => {
  const other = 'macula-io/macula-go#92'
  const { host } = await aLedgerOf(other, [verdictLine(other, 'PASS', OPEN.sha)], ghSaid(OPEN.answer))
  const found = await findTheWorkAVerdictPassed(host, { package: other, repo: REPO, cwd: CWD })
  assert.ok('refused' in found)
  assert.match(found.refused, /macula-io\/macula-go#92/, 'the answer did not name the package')
  assert.match(found.refused, /macula-io\/martha/, 'the answer did not name the repository it was asked for')
})

test('#256: a head no open pull request stands at is refused by name, and the recorded closed answer says so', async () => {
  const landed = 'macula-io/martha#243'
  const { host } = await aLedgerOf(landed, [verdictLine(landed, 'PASS', CLOSED.sha)], ghSaid(CLOSED.answer))
  const found = await findTheWorkAVerdictPassed(host, { package: landed, repo: REPO, cwd: CWD })
  assert.ok('refused' in found, `a closed pull request was taken for one to land: ${JSON.stringify(found)}`)
  assert.match(found.refused, /no open pull request/, 'the answer did not name what is missing')
  assert.match(found.refused, new RegExp(CLOSED.sha), 'the answer did not name the head it asked about')
})

test('#256: two open pull requests at one head are refused, naming both', async () => {
  // Written, not recorded: GitHub allows one open pull request per head and base, so the state is rare enough that no
  // recording of it was at hand. Its shape is GitHub's own, though, which is what this case pins.
  const written = [
    { number: 901, state: 'open', merged_at: null, head: { sha: OPEN.sha } },
    { number: 902, state: 'open', merged_at: null, head: { sha: OPEN.sha } },
  ]
  const { host } = await aLedgerOf(PACKAGE, [verdictLine(PACKAGE, 'PASS', OPEN.sha)], ghSaid(written))
  const found = await findTheWorkAVerdictPassed(host, { package: PACKAGE, repo: REPO, cwd: CWD })
  assert.ok('refused' in found, `two open pull requests were taken for one: ${JSON.stringify(found)}`)
  assert.match(found.refused, /#901/, 'the answer did not name the first pull request')
  assert.match(found.refused, /#902/, 'the answer did not name the second pull request')
})

test('#256: an open pull request whose head moved is not this package\'s, so the exact head is what is matched', async () => {
  // Written, not recorded: GitHub answers for the head it was asked about and the pull request's own head may have
  // moved past it since, which is the "the head moved after the PASS" case the design refuses.
  const moved = [{ number: 903, state: 'open', merged_at: null, head: { sha: 'f'.repeat(40) } }]
  const { host } = await aLedgerOf(PACKAGE, [verdictLine(PACKAGE, 'PASS', OPEN.sha)], ghSaid(moved))
  const found = await findTheWorkAVerdictPassed(host, { package: PACKAGE, repo: REPO, cwd: CWD })
  assert.ok('refused' in found, `a pull request at another head was taken for this package's: ${JSON.stringify(found)}`)
  assert.match(found.refused, /no open pull request/)
})

test('#256: a PASS row written before the range was kept is refused by name, never a crash', async () => {
  const without_range = `VERDICT ${PACKAGE} PASS r=2 ci=1`
  const { host } = await aLedgerOf(PACKAGE, [without_range], ghSaid(OPEN.answer))
  const found = await findTheWorkAVerdictPassed(host, { package: PACKAGE, repo: REPO, cwd: CWD })
  assert.ok('refused' in found, `a row with no range was taken for a head: ${JSON.stringify(found)}`)
  assert.match(found.refused, /names no head/, 'the answer did not say what the row is missing')
  assert.match(found.refused, /range/, 'the answer did not name the range that is missing')
  assert.match(found.refused, new RegExp(PACKAGE), 'the answer did not name the package')
})

test('#256: a verdict on a design names no head, so it is refused by name too', async () => {
  const on_a_design = `VERDICT ${PACKAGE} PASS doc=https://github.com/macula-io/martha/issues/251#issuecomment-1 r=3 req=0`
  const { host } = await aLedgerOf(PACKAGE, [on_a_design], ghSaid(OPEN.answer))
  const found = await findTheWorkAVerdictPassed(host, { package: PACKAGE, repo: REPO, cwd: CWD })
  assert.ok('refused' in found, `a verdict on a design was taken for a head: ${JSON.stringify(found)}`)
  assert.match(found.refused, /no range/)
})

test('#256: a GitHub that cannot answer is refused in its own words', async () => {
  const { host } = await aLedgerOf(PACKAGE, [verdictLine(PACKAGE, 'PASS', OPEN.sha)], {
    run: () => Promise.resolve({ exit_code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)\n' }),
  })
  const found = await findTheWorkAVerdictPassed(host, { package: PACKAGE, repo: REPO, cwd: CWD })
  assert.ok('refused' in found)
  assert.match(found.refused, /gh could not answer/, 'the answer did not say GitHub could not be read')
  assert.match(found.refused, /404/, 'the answer did not keep what gh said')
})

test('#256: an answer that is not a list of pull requests is refused, not read as none', async () => {
  const { host } = await aLedgerOf(PACKAGE, [verdictLine(PACKAGE, 'PASS', OPEN.sha)], ghSaid({ message: 'Not Found' }))
  const found = await findTheWorkAVerdictPassed(host, { package: PACKAGE, repo: REPO, cwd: CWD })
  assert.ok('refused' in found, `an answer that is not a list was read as one: ${JSON.stringify(found)}`)
  assert.match(found.refused, /not a list of pull requests/)
})
