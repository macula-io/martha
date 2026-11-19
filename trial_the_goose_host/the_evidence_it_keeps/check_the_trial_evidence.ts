// Run the check: node trial_the_goose_host/the_evidence_it_keeps/check_the_trial_evidence.ts [--dir <evidence>] [--self-test]
//
// A finished evidence directory, judged by the rule the driver keeps while a line runs (martha#694): a line that ended
// not-observed and kept no ACP transcript beside it cannot say why it observed nothing, and this fails it by name.
//
// `--dir <evidence>` judges that directory: every `line-N` (or `line-N-launch-K`, a launch the runner moved aside) that
// carries a not-observed `result.json` and no `acp.jsonl` is named. With no `--dir`, the directory `MARTHA_TRIAL_EVIDENCE`
// names is judged when it is set; a machine that names none has no trial evidence to judge and is told so, and the
// nothing-to-judge answer is 0 — this check never fails a machine for having run no trial.
//
// `--self-test` plants two evidence directories under the temp directory — one not-observed line with no transcript,
// which must be refused by name, and its twin with a transcript, which must pass — judges both by the same path, and
// removes the tree whatever the verdict.
//
// Exit 0 clean, 1 one line per refusal then the count, 2 the check could not be made: no directory to judge, or one
// that cannot be read. It never passes because it could not look.

import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NOT_OBSERVED, refusalsIn, THE_TRANSCRIPT } from './the_evidence_says_why.ts'

const NAME = 'check_the_trial_evidence'

/** The variable a trial's runner leaves the evidence directory's place in, for the run that judges it afterwards. */
const THE_EVIDENCE_VARIABLE = 'MARTHA_TRIAL_EVIDENCE'

/** The value given after `name`, or undefined when `name` is not given. Throws when it is given with no value. */
function option(name: string): string | undefined {
  const at = process.argv.indexOf(name)
  if (at === -1) return undefined
  const value = process.argv[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} names no directory`)
  return value
}

/** Whether `directory` is a directory this check can read. */
const readable = (directory: string): boolean => existsSync(directory) && statSync(directory).isDirectory()

/** The refusals in one evidence directory, in the words a run prints. */
export function refusalsNamedIn(directory: string): string[] {
  return refusalsIn(directory)
}

/** The lines a run prints for what a directory said, and the exit its findings are worth. */
function report(directory: string, refusals: readonly string[]): number {
  if (refusals.length === 0) {
    console.log(`${NAME}: ${directory} holds no line that ended not-observed without its transcript`)
    return 0
  }
  for (const refusal of refusals) console.error(`${NAME}: ${refusal}`)
  console.error(`${NAME}: ${String(refusals.length)} line(s) cannot say why they observed nothing`)
  return 1
}

/** A line's evidence as the runner writes it: the verdict file, and the transcript when one crossed. */
function plant(aDirectory: string, verdict: string, transcript: string | undefined): void {
  const line = join(aDirectory, 'line-1')
  mkdirSync(line, { recursive: true })
  writeFileSync(join(line, 'result.json'), JSON.stringify({ verdict }))
  if (transcript !== undefined) writeFileSync(join(line, THE_TRANSCRIPT), transcript)
}

/** The two plants, judged: the utterance, the twin, and what each must answer. */
function selfTest(): number {
  const root = mkdtempSync(join(tmpdir(), 'trial-evidence-'))
  try {
    const refused = join(root, 'not-observed-with-nothing-kept')
    const twin = join(root, 'not-observed-with-its-transcript')
    plant(refused, NOT_OBSERVED, undefined)
    plant(twin, NOT_OBSERVED, `${JSON.stringify({ at: 1, direction: 'sent', message: {} })}\n`)
    const named = refusalsNamedIn(refused)
    if (named.length !== 1 || !named[0]?.includes('line 1') || !named[0].includes('no ACP transcript')) {
      console.error(`${NAME}: the self-test: a not-observed line with no transcript was not refused by name: ${JSON.stringify(named)}`)
      return 1
    }
    const quiet = refusalsNamedIn(twin)
    if (quiet.length !== 0) {
      console.error(`${NAME}: the self-test: a not-observed line that kept its transcript was refused: ${JSON.stringify(quiet)}`)
      return 1
    }
    console.log(`${NAME}: the self-test: a line with no transcript is refused by name, and one with it passes`)
    return 0
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function main(): number {
  if (process.argv.includes('--self-test')) return selfTest()
  const named = option('--dir') ?? process.env[THE_EVIDENCE_VARIABLE]
  if (named === undefined) {
    console.log(`${NAME}: no evidence directory was named, so there is no trial evidence to judge`)
    return 0
  }
  if (!readable(named)) {
    console.error(`${NAME}: the check could not be made: ${named} is not a directory this check can read`)
    return 2
  }
  return report(named, refusalsNamedIn(named))
}

if (import.meta.main) process.exitCode = main()
