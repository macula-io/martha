// Whether a shell line is crew text: nothing but `gh` and git reads of the crew's own repositories (martha#987, rows
// T5-T8 and T14 of gap 15, ported from crew-code's stranger_text_arrivals.ts).
//
// Every command's output records A13 (../take_in_a_tool_result), and A13 taints. This slice says when it need not: the
// line is plain (./judge_a_plain_line.ts, T14), and every call on it reads only the crew's own repositories, by
// crew-code's rules.
//
//   T5  OWN IS AN ORG AND NOT A FORK. The repository's org is one of `workspace.own_orgs` (compared case-insensitively)
//       and the repository is not one of the forks GitHub lists under those orgs, read once at launch. A fork carries
//       upstream strangers' commits and pull requests. A listing that failed makes nothing own.
//   T6  A THREAD IS OWN WHEN EVERY AUTHOR IS THE CREW. `issue view`, `pr view` and `pr diff` need a number, and every
//       author on the thread — the opener, each comment, each review and review comment — must be the login the crew
//       acts as. The state reads (`pr checks`, `workflow list`, `repo view`) are own, except with their log. Every other
//       `gh` subcommand stays B3. A login or an author that cannot be read, in time, is B3.
//   T7  THE REPOSITORY IS NAMED, NEVER GUESSED. `-R` / `--repo` names it, else the origin of the directory the line
//       names (a leading `cd`, or git's `-C`), on github.com, where origin is the only remote. The contract hands the
//       relay no shell directory, so a bare `gh pr view 1` names none and stays B3. A member whose own environment sets
//       GH_REPO or GH_HOST has every `gh` call moved by it, so none is own.
//   T8  GIT HISTORY IS OWN BY crew-code's RULES, IN AN OWN REPOSITORY ONLY. The subcommand is one of crew-code's reads;
//       the only option before it is `-C <absolute directory>` (so no `-c`, `--git-dir`, `--exec-path`, and no alias); no
//       argument names a pull request's ref or FETCH_HEAD, opens files in a pager, or runs a diff or text driver; diff
//       and grep read nothing outside the repository; and origin is the repository's only remote, so no other remote's
//       refs are there to read.
//
// Anything unknown is no vouch: the line records what it records today.

import { GITHUB_CLI } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { isAPlainDirectory, judgeAPlainLine, type APlainCall } from './judge_a_plain_line.ts'

/** What only GitHub and git can say. Each answer fails closed: '' or null. */
export interface WhatGithubAndGitSay {
  /** `org/repo` of the directory's origin on github.com, or '' when origin is not its only remote or is elsewhere. */
  originOf(directory: string): Promise<string>
  /** The login the crew acts as, or '' when gh cannot say. */
  login(): Promise<string>
  /** Every author on an issue or pull request, its comments and its reviews, or null when gh cannot say them all. */
  authorsOf(repository: string, number: number): Promise<readonly string[] | null>
}

/** What the crew declared and what the launch read of GitHub: the crew's orgs, and the forks under them, or null. */
export interface TheCrewsOwnRepositories {
  readonly own_orgs: readonly string[]
  /** The forks under `own_orgs`, as `org/repo`; null when the listing failed, and then nothing is own. */
  readonly own_forks: Promise<readonly string[] | null>
  /** The variables the member's own environment sets that move every `gh` call (GH_REPO, GH_HOST). */
  readonly moved_by: readonly string[]
}

// crew-code's tables, ported as they are.
/** gh reads whose text is the crew's own workflows' state on its own repository. */
const GH_STATE: Readonly<Record<string, readonly string[]>> = { pr: ['checks'], workflow: ['list'], repo: ['view'] }
/** gh reads of one issue or pull request, judged by its authors. */
const GH_THREADS: Readonly<Record<string, readonly string[]>> = { issue: ['view'], pr: ['view', 'diff'] }
const GH_LOG_OPTIONS = ['--log', '--log-failed']
const GH_REPO_OPTIONS = ['-R', '--repo']
const SHORT_REPO = '-R'
const REPO_ASSIGNED = '--repo='
/** git subcommands that print the repository's own files, history or messages. */
const GIT_READS: ReadonlySet<string> = new Set(['log', 'show', 'diff', 'blame', 'grep', 'ls-files', 'ls-tree', 'cat-file', 'shortlog', 'describe', 'rev-list', 'reflog', 'for-each-ref', 'name-rev', 'range-diff', 'cherry', 'whatchanged', 'stash', 'notes', 'format-patch'])
/** A ref someone else pushed: a pull request's head or merge, or whatever the last fetch brought. */
const FOREIGN_REF = /(^|[:/^~])(pull|merge-requests)\/\d+|refs\/pull\/|FETCH_HEAD/
/** Options after the subcommand that open files in a pager, run a driver, or write where the gate does not look. */
const GIT_RUNNING_OPTIONS = /^(-O|--open-files-in-pager|--ext-diff|--textconv|--filters|--output)(=|$)|^-O./
/** diff and grep read files outside the index with these, or a pattern from a file. */
const READS_OUTSIDE_THE_INDEX = /^(--no-index|--untracked|--no-exclude-standard|-f|--file)(=|$)|^-f./
const SUBS_READING_FILES = ['diff', 'grep']
const GIT_DIRECTORY_OPTION = '-C'
const OWNER_AND_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const A_NUMBER = /^[1-9]\d*$/

/**
 * Whether the line is crew text, every call on it a read of the crew's own repositories. False for anything else,
 * including every line the plain-line judge refuses: the result is then recorded as it always was.
 */
export async function vouchForTheLine(line: string, own: TheCrewsOwnRepositories, say: WhatGithubAndGitSay): Promise<boolean> {
  const plain = judgeAPlainLine(line)
  if (plain === undefined || own.own_orgs.length === 0) return false
  const forks = await own.own_forks.catch(() => null)
  if (forks === null) return false
  const judge: TheJudge = { own, forks, say, directory: plain.directory }
  for (const call of plain.calls) if (!(await isOwnCall(call, judge))) return false
  return true
}

interface TheJudge {
  readonly own: TheCrewsOwnRepositories
  readonly forks: readonly string[]
  readonly say: WhatGithubAndGitSay
  readonly directory: string | undefined
}

function isOwnCall(call: APlainCall, judge: TheJudge): Promise<boolean> {
  return call.program === GITHUB_CLI ? isOwnGithubCall(call.words, judge) : isOwnGitCall(call.words, judge)
}

/** T5: under one of the crew's orgs, and not one of their forks. */
function isOwnRepository(repository: string, judge: TheJudge): boolean {
  const lower = repository.toLowerCase()
  const org = lower.split('/')[0] ?? ''
  return OWNER_AND_NAME.test(repository) && judge.own.own_orgs.some((name) => name.toLowerCase() === org) && !judge.forks.some((fork) => fork.toLowerCase() === lower)
}

/** The repository a directory's origin names, or '' when there is no directory or the probe cannot say. */
async function originOf(directory: string | undefined, judge: TheJudge): Promise<string> {
  return directory === undefined ? '' : judge.say.originOf(directory).catch(() => '')
}

// --- gh (T6, T7) -------------------------------------------------------------

async function isOwnGithubCall(words: readonly string[], judge: TheJudge): Promise<boolean> {
  const named = repositoryOption(words)
  if (judge.own.moved_by.length > 0 || named === null) return false
  const operands = operandsOf(words)
  const kind = kindOfRead(operands)
  if (kind === undefined) return false
  const repository = named ?? (await originOf(judge.directory, judge))
  if (!isOwnRepository(repository, judge)) return false
  return kind === 'state' ? isAnOwnStateRead(words, operands) : isAnOwnThread(repository, operands[2], judge.say)
}

/** Which of crew-code's two tables the read is in, or `undefined` when it is in neither and stays B3. */
function kindOfRead(operands: readonly string[]): 'state' | 'thread' | undefined {
  const [group = '', sub = ''] = operands
  if (GH_STATE[group]?.includes(sub) === true) return 'state'
  return GH_THREADS[group]?.includes(sub) === true ? 'thread' : undefined
}

/** A state read without its log, naming no other repository: `pr checks` takes at most its number, the others nothing. */
function isAnOwnStateRead(words: readonly string[], operands: readonly string[]): boolean {
  if (words.some((word) => GH_LOG_OPTIONS.includes(word))) return false
  const [group, , ...rest] = operands
  return rest.length === 0 || (group === 'pr' && rest.length === 1 && A_NUMBER.test(rest[0] ?? ''))
}

/** T6: one numbered thread, and every author on it is the login the crew acts as. */
async function isAnOwnThread(repository: string, number: string | undefined, say: WhatGithubAndGitSay): Promise<boolean> {
  if (number === undefined || !A_NUMBER.test(number)) return false
  const [authors, login] = await Promise.all([say.authorsOf(repository, Number(number)).catch(() => null), say.login().catch(() => '')])
  if (authors === null || login === '') return false
  return authors.every((author) => author.toLowerCase() === login.toLowerCase())
}

/** The repository `-R` / `--repo` names; `undefined` when none; null when it is named in a form the judge does not take. */
function repositoryOption(words: readonly string[]): string | undefined | null {
  const named = words.flatMap((word, at) => repositoryNamedAt(word, words[at + 1]))
  if (named.length === 0) return undefined
  const [only] = named
  return named.length === 1 && only !== undefined && OWNER_AND_NAME.test(only) ? only : null
}

/** The repository one word names with `-R` / `--repo`, in any of gh's spellings, or nothing. */
function repositoryNamedAt(word: string, next: string | undefined): readonly string[] {
  if (GH_REPO_OPTIONS.includes(word)) return [next ?? '']
  if (word.startsWith(REPO_ASSIGNED)) return [word.slice(REPO_ASSIGNED.length)]
  return word.startsWith(SHORT_REPO) && word.length > SHORT_REPO.length ? [word.slice(SHORT_REPO.length)] : []
}

/** The words that are no option and no option's repository. */
function operandsOf(words: readonly string[]): readonly string[] {
  return words.filter((word, at) => !word.startsWith('-') && !GH_REPO_OPTIONS.includes(words[at - 1] ?? ''))
}

// --- git (T8) ----------------------------------------------------------------

async function isOwnGitCall(words: readonly string[], judge: TheJudge): Promise<boolean> {
  const before = words[0] === GIT_DIRECTORY_OPTION ? words.slice(0, 2) : []
  if (before.length > 0 && !isAPlainDirectory(before[1])) return false
  const [sub = '', ...after] = words.slice(before.length)
  if (!isAnOwnRead(sub, words, after)) return false
  return isOwnRepository(await originOf(before[1] ?? judge.directory, judge), judge)
}

/** crew-code's read rules on the words alone: a listed read, no foreign ref, no driver or pager, nothing outside. */
function isAnOwnRead(sub: string, words: readonly string[], after: readonly string[]): boolean {
  if (!GIT_READS.has(sub) || words.some((word) => FOREIGN_REF.test(word))) return false
  if (after.some((word) => GIT_RUNNING_OPTIONS.test(word))) return false
  return !SUBS_READING_FILES.includes(sub) || readsOnlyTheRepository(after)
}

/** diff and grep read nothing outside the index: no option that does, and no path that leaves the repository. */
function readsOnlyTheRepository(after: readonly string[]): boolean {
  return after.every((word) => !READS_OUTSIDE_THE_INDEX.test(word) && !word.startsWith('/') && !word.split('/').includes('..'))
}
