// The tips a branch removal covers (martha#391): the clone's copy and origin's, each read where it is really held.
//
// The decisions are this slice's; the tool that asks it is ../a_crews_tools's, and the queue that keeps the tips is
// ../queue_the_owners_asks's. Each test names the mutant of the design that it kills.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProcessOutcome, ProcessRequest, Processes } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import {
  WHY_HALF_A_REMOVAL,
  WHY_THE_TIPS_CANNOT_BE_READ,
  theBranchItRemoves,
  theTipsItRemoves,
} from './read_the_tips_a_removal_covers.ts'

// A made-up owner's home: this repository is public, so no real path appears here.
const CLONES = '/an-owners-home/clones'
const REPO = 'macula-io/martha'
const CLONE = `${CLONES}/${REPO}`
const BRANCH = 'vesta/313-old'
const LOCAL_TIP = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const ORIGIN_TIP = 'f0e1d2c3b4a5968778695a4b3c2d1e0f12345678'
const A_STALE_TIP = '0000000000000000000000000000000000000000'

/** What one run asked git, as the test reads it back. */
interface Ran {
  readonly said: string
  readonly cwd: string
}

/** git's own words in a run: Martha's `-c <name>=<value>` settings come first, and are not what the test asked for. */
const gitSaid = (args: readonly string[]): string => {
  let at = 0
  while (args[at] === '-c') at += 2
  return args.slice(at).join(' ')
}

/** What the slice asks of the clone, of its stale remote-tracking ref, and of origin itself. */
const ASKED_OF_THE_CLONE = `rev-parse --verify --quiet refs/heads/${BRANCH}`
const ASKED_OF_THE_TRACKING_REF = `rev-parse --verify --quiet refs/remotes/origin/${BRANCH}`
const ASKED_OF_ORIGIN = `ls-remote --heads origin refs/heads/${BRANCH}`

/**
 * A host whose git answers `answers` for the words it was asked, in full; anything else answers as git does for a ref
 * that is not there — a resolve that fails, and a remote that answers nothing, which is a remote with no such branch.
 */
function aGitThatAnswers(answers: Readonly<Record<string, string | ProcessOutcome>>, asked: Ran[] = []): Processes {
  const run = async (request: ProcessRequest): Promise<ProcessOutcome> => {
    const said = gitSaid(request.args)
    asked.push({ said, cwd: request.cwd })
    const answer = answers[said]
    if (answer === undefined) return said.startsWith('ls-remote') ? { exit_code: 0, stdout: '', stderr: '' } : { exit_code: 1, stdout: '', stderr: 'fatal: not a valid object name' }
    return typeof answer === 'string' ? { exit_code: 0, stdout: answer, stderr: '' } : answer
  }
  return hostForTests({ run }).host.processes
}

/** The clone one commit ahead of origin, which is the case that cost the owner a second ask: git answers each ref. */
const THE_TWO_COPIES: Readonly<Record<string, string>> = {
  [ASKED_OF_THE_CLONE]: `${LOCAL_TIP}\n`,
  [ASKED_OF_THE_TRACKING_REF]: `${A_STALE_TIP}\n`,
  [ASKED_OF_ORIGIN]: `${ORIGIN_TIP}\trefs/heads/${BRANCH}\n`,
}

const anAsk = (args?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => ({
  ask: `Delete the merged branch ${BRANCH}?`,
  ...(args ?? { repo: REPO, branch: BRANCH }),
})

const REFUSED = (said: Awaited<ReturnType<typeof theBranchItRemoves>>): string =>
  said !== undefined && 'refused' in said ? said.refused : assert.fail(`not a refusal: ${JSON.stringify(said)}`)

test('both tips are read in the clone the ask names, and origin is asked of the remote (mutants: the tips read in the clones root, and origin read from the ref again)', async () => {
  const asked: Ran[] = []
  const removes = await theBranchItRemoves({ processes: aGitThatAnswers(THE_TWO_COPIES, asked), clones: CLONES }, anAsk())
  assert.deepEqual(removes, { branch: BRANCH, local_tip: LOCAL_TIP, origin_tip: ORIGIN_TIP }, 'the clone is one commit ahead of origin, and both tips are kept')

  assert.deepEqual(
    asked.map((one) => one.cwd),
    [CLONE, CLONE],
    'every ref is read in <clones>/<org>/<repo>, never in the clones root where no branch of any repository is',
  )
  assert.deepEqual(asked.map((one) => one.said), [ASKED_OF_THE_CLONE, ASKED_OF_ORIGIN], 'the origin tip is asked of the remote itself')
  assert.ok(
    !asked.some((one) => one.said === ASKED_OF_THE_TRACKING_REF),
    'the clone\'s remote-tracking ref is never read: it is behind the remote as soon as anyone pushes',
  )
})

test('the tips read as one line, and a copy that is not there is said to be not there (mutant: a copy left out of the line)', () => {
  assert.equal(
    theTipsItRemoves({ branch: BRANCH, local_tip: LOCAL_TIP, origin_tip: ORIGIN_TIP }),
    `It removes ${BRANCH}, and the ask records both tips the yes covers: this clone at ${LOCAL_TIP}, origin at ${ORIGIN_TIP}.`,
  )
  assert.equal(
    theTipsItRemoves({ branch: BRANCH, local_tip: null, origin_tip: ORIGIN_TIP }),
    `It removes ${BRANCH}, and the ask records both tips the yes covers: no copy of its own, origin at ${ORIGIN_TIP}.`,
    'a copy that is not there is said to be not there, never left out',
  )
  assert.equal(
    theTipsItRemoves({ branch: BRANCH, local_tip: LOCAL_TIP, origin_tip: null }),
    `It removes ${BRANCH}, and the ask records both tips the yes covers: this clone at ${LOCAL_TIP}, no copy on origin.`,
    'origin not holding the branch is said, never left out',
  )
})

test('an ask that names no branch removes nothing and is refused nothing (the ordinary ask the queue already keeps)', async () => {
  const asked: Ran[] = []
  assert.equal(
    await theBranchItRemoves({ processes: aGitThatAnswers(THE_TWO_COPIES, asked), clones: CLONES }, anAsk({})),
    undefined,
    'an ask that removes nothing is no business of this slice',
  )
  assert.deepEqual(asked, [], 'nothing is read for an ask that removes nothing')
})

test('a branch neither copy holds is refused, naming the clone (mutant: the neither-copy refusal removed)', async () => {
  const asked: Ran[] = []
  const refused = REFUSED(await theBranchItRemoves({ processes: aGitThatAnswers({}, asked), clones: CLONES }, anAsk()))
  assert.equal(refused, `neither ${CLONE} nor origin holds ${BRANCH}, so there is no deletion for the owner to answer`)
  assert.equal(asked.length, 2, 'both copies are asked before the ask is refused')
})

test('an origin that cannot be read refuses the ask, rather than recording half the deletion it covers', async () => {
  const unreachable: ProcessOutcome = { exit_code: 128, stdout: '', stderr: 'fatal: could not read from remote repository' }
  const refused = REFUSED(
    await theBranchItRemoves(
      { processes: aGitThatAnswers({ [ASKED_OF_THE_CLONE]: `${LOCAL_TIP}\n`, [ASKED_OF_ORIGIN]: unreachable }), clones: CLONES },
      anAsk(),
    ),
  )
  assert.match(refused, /could not read from remote repository/, 'git\'s own words say why, rather than a yes that covers one copy')
  assert.match(refused, /origin/, 'the refusal names origin, the copy that could not be read')
})

test('half a removal is refused before git is asked anything (mutant: half a removal accepted)', async () => {
  const asked: Ran[] = []
  const places = { processes: aGitThatAnswers(THE_TWO_COPIES, asked), clones: CLONES }
  assert.equal(REFUSED(await theBranchItRemoves(places, anAsk({ branch: BRANCH }))), WHY_HALF_A_REMOVAL, 'a branch with no repository is refused by its own words, never dying on the way to git')
  assert.equal(REFUSED(await theBranchItRemoves(places, anAsk({ repo: REPO }))), WHY_HALF_A_REMOVAL, 'a repository with no branch is refused by its own words')
  assert.equal(REFUSED(await theBranchItRemoves(places, anAsk({ repo: REPO, branch: '  ' }))), WHY_HALF_A_REMOVAL, 'a branch of nothing is no branch to remove')
  assert.equal(REFUSED(await theBranchItRemoves(places, anAsk({ repo: REPO, branch: 7 }))), WHY_HALF_A_REMOVAL, 'a branch that is not text is no branch to remove')
  assert.deepEqual(asked, [], 'nothing is read for an ask that names half a removal')
})

test('a repo that is not owner/name is refused before git is asked anything (mutant: REPO.test removed)', async () => {
  const asked: Ran[] = []
  const places = { processes: aGitThatAnswers(THE_TWO_COPIES, asked), clones: CLONES }
  assert.equal(REFUSED(await theBranchItRemoves(places, anAsk({ repo: 'macula-io', branch: BRANCH }))), WHY_HALF_A_REMOVAL, 'an organisation is not a repository')
  assert.equal(REFUSED(await theBranchItRemoves(places, anAsk({ repo: '../elsewhere', branch: BRANCH }))), WHY_HALF_A_REMOVAL, 'a repository that walks out of the clones root is no repository')
  assert.deepEqual(asked, [], 'nothing is read for a repository this launcher would never clone into')
})

test('a place with no processes, or no clones place, is refused by name (mutant: the no-place refusal removed)', async () => {
  assert.equal(REFUSED(await theBranchItRemoves({ clones: CLONES }, anAsk())), WHY_THE_TIPS_CANNOT_BE_READ, 'no processes to read the tips with')
  assert.equal(
    REFUSED(await theBranchItRemoves({ processes: aGitThatAnswers(THE_TWO_COPIES), clones: null }, anAsk())),
    WHY_THE_TIPS_CANNOT_BE_READ,
    'a declaration whose clones place is null',
  )
  assert.equal(
    REFUSED(await theBranchItRemoves({ processes: aGitThatAnswers(THE_TWO_COPIES) }, anAsk())),
    WHY_THE_TIPS_CANNOT_BE_READ,
    'a declaration that names no clones place at all',
  )
})
