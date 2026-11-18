// The judge a member's `git` and its clone's reference-transaction hook ask the launcher through (martha#562, seams b
// and c).
//
// A launch copies this file into its own directory and puts the shim that runs it first on the member's PATH, so it
// runs in the member's shell and may import nothing but node's own modules and the protocol copied beside it: a path
// back into Martha's tree would be a path into a tree the member may have moved. What it is given — the real git a
// call is handed to, the misses file, and Martha's own git settings — is read from `guard.json` beside it, written by
// the launcher, so nothing here restates a value the tree defines.
//
// Two modes, one file. `git` judges the call a shell handed the shim, in the directory the shell runs it in.
// `reference-transaction` judges the refs git would update: git calls a hook with the state on its arguments, and every
// ref the transaction touches on its input, `<old> <new> <ref>` a line.
//
// It fails open, as the ruling on seam (b) says: a launcher that does not answer in time, or an answer this file cannot
// read, runs the real git and appends one line to the misses file — the launcher folds those into the member's row on
// the tick it already keeps. It fails closed only on a refusal the decision actually returned, which is the launcher's
// `{"deny":"..."}` and becomes exit 3 with the reason on standard error.
//
// One pass-through is the ruling's too: a run carrying Martha's own git settings is Martha's own and is not judged. A
// member can write those two `-c` words themselves and pass the shim, which the design states plainly — the shim is a
// speed bump in front of the shell the relay reads, not a boundary, and the drift scan reports what got through.

import { appendFileSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

import { RELAY_ORIGIN, RELAY_SOCKET_VARIABLE } from '../claude_code_relay/hooks/relay_protocol.ts'
import {
  GIT_CALL_PATH,
  gitCallBody,
  heardGitVerdict,
  REF_TRANSACTION_PATH,
  refTransactionBody,
  THE_GUARDS_DEADLINE_MS,
  type ARefUpdate,
  type HeardGitVerdict,
} from './guard_protocol.ts'

/** The status a refusal exits with, which no git command returns for itself: the crew-code shape (martha#562). */
export const REFUSED_STATUS = 3

/** What the launch wrote beside this file: the real git, the misses file, and Martha's own git settings. */
interface TheGuardsConfig {
  readonly real_git: string
  readonly misses: string
  readonly settings: readonly (readonly [string, string])[]
}

/** The state git calls a hook with: only the one before the transaction runs can stop it. */
const PREPARED = 'prepared'

/** The two modes this file judges, which are also the two names the launch gives its shims. */
const THE_GIT_MODE = 'git'
const THE_HOOK_MODE = 'reference-transaction'

/** The word git gives an option that sets a config value for one run, which is what Martha's own runs carry. */
const A_SETTING_OPTION = '-c'

/** A ref that is all zeros names no object: on the new side, that is a ref the transaction deletes. */
const NO_OBJECT = /^0+$/

/** What one miss says: the call that could not be judged, and why. One line, written as the judge saw it. */
interface AMiss {
  readonly what: string
  readonly why: string
}

/** The words a shell handed the shim: judged, then run by the real git unless the launcher refused them. */
async function aGitCall(the: TheGuardsConfig, args: readonly string[]): Promise<number> {
  const socket = process.env[RELAY_SOCKET_VARIABLE]
  // A shell with no launcher's socket is no crew's shell, and a run carrying Martha's own settings is Martha's own:
  // neither is judged (the design's pass-through, martha#562).
  if (socket === undefined || socket === '' || carriesMarthasOwnWords(args, the.settings)) return runGit(the, args)
  const verdict = await asked(GIT_CALL_PATH, gitCallBody(process.cwd(), args), socket)
  return theStopItMeets(verdict, the, { what: `git ${oneLine(args.join(' '))}`, why: '' }) ?? runGit(the, args)
}

/** The refs a transaction would update: a delete of another member's branch is what the launcher refuses. */
async function aRefTransaction(the: TheGuardsConfig, state: string | undefined): Promise<number> {
  if (state !== PREPARED) return 0
  const socket = process.env[RELAY_SOCKET_VARIABLE]
  if (socket === undefined || socket === '') return 0
  const updates = theRefUpdates(theHooksInput())
  if (updates.length === 0) return 0
  const verdict = await asked(REF_TRANSACTION_PATH, refTransactionBody(updates), socket)
  const refs = oneLine(updates.map((update) => update.ref).join(' '))
  return theStopItMeets(verdict, the, { what: `the ref transaction touching ${refs}`, why: '' }) ?? 0
}

/**
 * What a verdict does to the call: nothing when it allows it, the reason on standard error and the refused status when
 * the launcher refused it, and a miss written, then a fail-open, when the answer could not be read.
 */
function theStopItMeets(verdict: HeardGitVerdict, the: TheGuardsConfig, miss: AMiss): number | undefined {
  if (verdict.kind === 'allow') return undefined
  if (verdict.kind === 'deny') {
    process.stderr.write(`${verdict.why}\n`)
    return REFUSED_STATUS
  }
  writeMiss(the, { ...miss, why: verdict.why })
  return undefined
}

/** Asks the launcher at `socket`, and hears its verdict; a launcher that does not answer in time is a miss. */
function asked(path: string, body: Readonly<Record<string, unknown>>, socket: string): Promise<HeardGitVerdict> {
  const text = JSON.stringify(body)
  return new Promise<HeardGitVerdict>((resolve) => {
    const asking = request(
      `${RELAY_ORIGIN}${path}`,
      { socketPath: socket, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) }, timeout: THE_GUARDS_DEADLINE_MS },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve(heardGitVerdict(response.statusCode ?? 0, Buffer.concat(chunks).toString('utf8'))))
        response.on('error', (error) => resolve({ kind: 'unreadable', why: `the launcher's answer broke off (${error.message})` }))
      },
    )
    asking.on('timeout', () => asking.destroy(new Error(`the launcher did not answer within ${String(THE_GUARDS_DEADLINE_MS)} ms`)))
    asking.on('error', (error) => resolve({ kind: 'unreadable', why: `the launcher could not be asked (${error.message})` }))
    asking.end(text)
  })
}

/** The real git, with the words unchanged, and this process ending the way it did — a signal raised, or its status. */
function runGit(the: TheGuardsConfig, args: readonly string[]): number {
  const ran = spawnSync(the.real_git, args, { stdio: 'inherit' })
  if (ran.signal !== null && ran.signal !== 'SIGKILL') process.kill(process.pid, ran.signal)
  return ran.status ?? REFUSED_STATUS
}

/** Whether the run carries Martha's own settings: every pair, as the two words `git -c <name>=<value>` takes. */
function carriesMarthasOwnWords(args: readonly string[], settings: readonly (readonly [string, string])[]): boolean {
  const given = new Set<string>()
  for (const [at, word] of args.entries()) {
    if (word === A_SETTING_OPTION) given.add(args[at + 1] ?? '')
    else if (word.startsWith(A_SETTING_OPTION)) given.add(word.slice(A_SETTING_OPTION.length))
  }
  return settings.every(([name, value]) => given.has(`${name}=${value}`))
}

/** The refs a transaction's input lines name: `<old> <new> <ref>`, a delete when the new side names no object. */
function theRefUpdates(input: string): readonly ARefUpdate[] {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .flatMap((line) => {
      const [old, next, ref] = line.split(' ')
      return old === undefined || next === undefined || ref === undefined ? [] : [{ ref, deletes: NO_OBJECT.test(next) }]
    })
}

/** Everything the hook's input holds, which git has already written whole when it calls the hook. */
function theHooksInput(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

/** One line on the misses file, saying what could not be judged and why; the launcher reads it and folds it in. */
function writeMiss(the: TheGuardsConfig, miss: AMiss): void {
  try {
    appendFileSync(the.misses, `${JSON.stringify({ at: new Date().toISOString(), what: oneLine(miss.what), why: oneLine(miss.why) })}\n`)
  } catch {
    // A miss that cannot be written changes nothing about the call: the run still goes to the real git.
  }
}

/** A text with every run of whitespace around a newline made one space, so a line of the misses file is one line. */
function oneLine(text: string): string {
  return text.replaceAll(/\s*\n\s*/g, ' ').trim()
}

/** What the launch wrote beside this file. */
const config = (): TheGuardsConfig => JSON.parse(readFileSync(new URL('./guard.json', import.meta.url), 'utf8')) as TheGuardsConfig

/**
 * The judge, run by the shim the launch put first on the member's PATH. A config it cannot read is the one thing it
 * does not fail open on: without the real git's path there is no program to hand the call to, and a silent exit would
 * read as a failed call rather than as a guard that could not run.
 */
async function main(): Promise<number> {
  const [mode, ...words] = process.argv.slice(2)
  let the: TheGuardsConfig
  try {
    the = config()
  } catch (error) {
    process.stderr.write(`Martha's git guard cannot read what its launch wrote beside it (${(error as Error).message}), so it runs no git.\n`)
    return 1
  }
  if (mode === THE_HOOK_MODE) return aRefTransaction(the, words[0])
  try {
    return mode === THE_GIT_MODE ? await aGitCall(the, words) : runGit(the, words)
  } catch {
    // Nothing the judge does is worth losing a member's git over: what it could not read becomes the real git's run.
    return runGit(the, words)
  }
}

void main().then((status) => process.exit(status))
