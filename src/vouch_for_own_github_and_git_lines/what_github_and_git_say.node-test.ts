// What the vouch asks GitHub and git, and how (martha#987, gap 15): crew-code's calls, run with the member's own
// environment and the crew's bound, every failure read as a stranger's answer.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GITHUB_WHEN_UNNAMED } from '../declare_crew/the_crews_github.ts'
import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { theVouchOfALaunch } from './the_vouch_of_a_launch.ts'
import { FORK_LIST_LIMIT, repoOfRemote, theCrewsOwnRepositoriesIn, VARIABLES_THAT_MOVE_GH, whatGithubAndGitSayIn, type TheProbesPlace } from './what_github_and_git_say.ts'

const CLONE = '/work/own-org/a-repo'
const REPO = 'own-org/a-repo'
const LOGIN = 'the-crews-login'
/** A bound no default holds, so a probe that dropped the declared one is seen. */
const DECLARED_BOUND = GITHUB_WHEN_UNNAMED.author_probe_ms + 1
const MEMBER_ENV = { HOME: '/home/synthetic', GH_CONFIG_DIR: '/home/synthetic/.gh', GIT_DIR: '/elsewhere/.git' }

const ok = (stdout: string): ProcessOutcome => ({ exit_code: 0, stdout, stderr: '' })
const failed: ProcessOutcome = { exit_code: 1, stdout: '', stderr: 'gh: not found' }

/** A runner answering by the words it is asked, keeping every request it was handed. */
function aRunner(answers: Readonly<Record<string, ProcessOutcome>>): { readonly place: TheProbesPlace; readonly asked: ProcessRequest[] } {
  const asked: ProcessRequest[] = []
  const run = async (request: ProcessRequest): Promise<ProcessOutcome> => {
    asked.push(request)
    return answers[[request.command, ...request.args].join(' ')] ?? failed
  }
  return { place: { run, member_env: MEMBER_ENV, author_probe_ms: DECLARED_BOUND, cwd: '/' }, asked }
}

test('the login is asked once per launch, as the member, within the declared bound', async () => {
  const { place, asked } = aRunner({ 'gh api user --jq .login': ok(`${LOGIN}\n`) })
  const say = whatGithubAndGitSayIn(place)
  assert.equal(await say.login(), LOGIN)
  assert.equal(await say.login(), LOGIN)
  assert.equal(asked.length, 1)
  assert.equal(asked[0]?.timeout_ms, DECLARED_BOUND)
  assert.deepEqual(asked[0]?.environment, { drop_prefixes: [''], set: MEMBER_ENV })
})

test('a login gh cannot give is empty, and a call that could not start is a failure, not a throw', async () => {
  assert.equal(await whatGithubAndGitSayIn(aRunner({}).place).login(), '')
  const throwing: TheProbesPlace = { ...aRunner({}).place, run: () => Promise.reject(new Error('spawn gh ENOENT')) }
  assert.equal(await whatGithubAndGitSayIn(throwing).login(), '')
  assert.equal(await whatGithubAndGitSayIn(throwing).authorsOf(REPO, 1), null)
})

test("a pull request's authors are its opener, its comments, its reviews and its review comments, paginated", async () => {
  const { place } = aRunner({
    [`gh api repos/${REPO}/issues/7 --jq .user.login, (.pull_request != null)`]: ok('opener\ntrue\n'),
    [`gh api --paginate repos/${REPO}/issues/7/comments --jq .[].user.login`]: ok('commenter\n'),
    [`gh api --paginate repos/${REPO}/pulls/7/reviews --jq .[].user.login`]: ok('reviewer\n'),
    [`gh api --paginate repos/${REPO}/pulls/7/comments --jq .[].user.login`]: ok('line-commenter\n'),
  })
  assert.deepEqual(await whatGithubAndGitSayIn(place).authorsOf(REPO, 7), ['opener', 'commenter', 'reviewer', 'line-commenter'])
})

test("an issue's authors are its opener and its comments; one page that cannot be read makes them unknown", async () => {
  const head = `gh api repos/${REPO}/issues/8 --jq .user.login, (.pull_request != null)`
  const comments = `gh api --paginate repos/${REPO}/issues/8/comments --jq .[].user.login`
  assert.deepEqual(await whatGithubAndGitSayIn(aRunner({ [head]: ok('opener\nfalse\n'), [comments]: ok('') }).place).authorsOf(REPO, 8), ['opener'])
  assert.equal(await whatGithubAndGitSayIn(aRunner({ [head]: ok('opener\nfalse\n') }).place).authorsOf(REPO, 8), null)
  assert.equal(await whatGithubAndGitSayIn(aRunner({ [head]: ok('opener\n') }).place).authorsOf(REPO, 8), null)
})

test('the origin is read where origin is the only remote and on github.com, with no GIT_ variable of the member', async () => {
  const only = { [`git -C ${CLONE} remote`]: ok('origin\n'), [`git -C ${CLONE} remote get-url origin`]: ok(`git@github.com:${REPO}.git\n`) }
  const { place, asked } = aRunner(only)
  assert.equal(await whatGithubAndGitSayIn(place).originOf(CLONE), REPO)
  assert.deepEqual(asked[0]?.environment, { drop_prefixes: [''], set: { HOME: MEMBER_ENV.HOME, GH_CONFIG_DIR: MEMBER_ENV.GH_CONFIG_DIR } })
  const two = aRunner({ ...only, [`git -C ${CLONE} remote`]: ok('origin\nupstream\n') })
  assert.equal(await whatGithubAndGitSayIn(two.place).originOf(CLONE), '')
  const named = aRunner({ ...only, [`git -C ${CLONE} remote`]: ok('upstream\n') })
  assert.equal(await whatGithubAndGitSayIn(named.place).originOf(CLONE), '')
  assert.equal(await whatGithubAndGitSayIn(aRunner({}).place).originOf(CLONE), '')
})

test('a remote URL names a repository only on github.com, in https, ssh and scp form', () => {
  assert.equal(repoOfRemote(`https://github.com/${REPO}.git`), REPO)
  assert.equal(repoOfRemote(`ssh://git@github.com/${REPO}`), REPO)
  assert.equal(repoOfRemote(`git@GitHub.com:${REPO}.git`), REPO)
  assert.equal(repoOfRemote(`https://gitlab.com/${REPO}.git`), '')
  assert.equal(repoOfRemote(`https://github.com.evil.example/${REPO}.git`), '')
  assert.equal(repoOfRemote('/a/local/path'), '')
})

const forkListing = (org: string) => `gh repo list ${org} --fork --limit ${FORK_LIST_LIMIT} --json nameWithOwner --jq .[].nameWithOwner`

test('the forks under every own org are listed at launch; one listing that fails or reaches the limit is no listing', async () => {
  const both = { [forkListing('a-org')]: ok('a-org/fork-1\n'), [forkListing('b-org')]: ok('b-org/fork-2\n') }
  const { place, asked } = aRunner(both)
  const own = theCrewsOwnRepositoriesIn(place, ['a-org', 'b-org'])
  assert.equal(asked.length, 2, 'the forks were not asked for at launch')
  assert.deepEqual(await own.own_forks, ['a-org/fork-1', 'b-org/fork-2'])
  assert.equal(await theCrewsOwnRepositoriesIn(aRunner({ [forkListing('a-org')]: both[forkListing('a-org')] as ProcessOutcome }).place, ['a-org', 'b-org']).own_forks, null)
  const full = Array.from({ length: FORK_LIST_LIMIT }, (_, i) => `a-org/fork-${i}`).join('\n')
  assert.equal(await theCrewsOwnRepositoriesIn(aRunner({ [forkListing('a-org')]: ok(full) }).place, ['a-org']).own_forks, null)
})

test("GH_REPO or GH_HOST in the member's own environment is named as what moves every gh call", () => {
  const { place } = aRunner({})
  assert.deepEqual(theCrewsOwnRepositoriesIn(place, []).moved_by, [])
  for (const name of VARIABLES_THAT_MOVE_GH) {
    assert.deepEqual(theCrewsOwnRepositoriesIn({ ...place, member_env: { ...MEMBER_ENV, [name]: 'x' } }, []).moved_by, [name])
  }
})

test('a launch with no processes, no member environment, no declaration, or no own org holds no vouch', () => {
  const { place } = aRunner({})
  const settings = { own_orgs: ['a-org'], github: GITHUB_WHEN_UNNAMED }
  const processes = { run: place.run }
  assert.equal(typeof theVouchOfALaunch({ processes, member_env: MEMBER_ENV, settings, root: '/' }).vouchesForTheLine, 'function')
  assert.deepEqual(theVouchOfALaunch({ member_env: MEMBER_ENV, settings, root: '/' }), {})
  assert.deepEqual(theVouchOfALaunch({ processes, settings, root: '/' }), {})
  assert.deepEqual(theVouchOfALaunch({ processes, member_env: MEMBER_ENV, root: '/' }), {})
  assert.deepEqual(theVouchOfALaunch({ processes, member_env: MEMBER_ENV, settings: { ...settings, own_orgs: [] }, root: '/' }), {})
})
