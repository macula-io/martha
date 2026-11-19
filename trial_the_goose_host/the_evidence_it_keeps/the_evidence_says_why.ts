// A line's verdict has to be readable afterwards, or it says nothing (martha#694).
//
// This exists because a line that ends "not-observed" kept only its verdict: line 4's turn got no answer in
// time, twice, and the evidence held a `result.json` and a strace with no timestamps. Whether the turn was
// waiting on a slow model or on a message that never reached the client could not be told apart, which is the
// question the line exists to answer.
//
// The rule: a not-observed verdict needs the exchange that produced it beside it. The driver writes the ACP
// transcript as each message crosses (./speak_acp_to_goose.ts's keeper) and copies the engine's own request
// logs in before the launch's evidence is moved, so the rule can be checked twice — while the line runs,
// by the driver, and afterwards, over a whole evidence directory.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { Observation } from '../the_nine_lines.ts'

/** The file the driver writes the exchange into, one JSON object per message. */
export const THE_TRANSCRIPT = 'acp.jsonl'

/** The directory the launch's own `goose-root/state/logs` is copied into. */
export const THE_ENGINE_LOGS = 'engine-logs'

/** The verdict this rule is about: nothing was observed, and the launch may be run again. */
export const NOT_OBSERVED: Observation['verdict'] = 'not-observed'

/** What the driver writes for each line: the one field this rule reads. */
interface KeptVerdict {
  readonly verdict?: unknown
}

const verdictIn = (directory: string): string | undefined => {
  const file = join(directory, 'result.json')
  if (!existsSync(file)) return undefined
  try {
    return String((JSON.parse(readFileSync(file, 'utf8')) as KeptVerdict).verdict ?? '')
  } catch {
    return 'unreadable'
  }
}

/** How many messages a transcript holds; 0 when it was never written or holds none. */
export const messagesIn = (directory: string): number => {
  const file = join(directory, THE_TRANSCRIPT)
  if (!existsSync(file)) return 0
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '').length
}

/**
 * Why a line's own evidence cannot be read, or `undefined` when it can.
 *
 * The verdict is handed in, never read back from `result.json`: the driver keeps a verdict before it writes the file
 * (martha#694), so a rule that read the file would answer "nothing to refuse" on every fresh launch.
 *
 * Named after the line, because the fork's run turns this into its own red line and the reader of the run has
 * to know which launch said nothing.
 */
export const theRefusalOf = (line: number, verdict: string, directory: string): string | undefined => {
  if (verdict !== NOT_OBSERVED) return undefined
  const messages = messagesIn(directory)
  if (messages > 0) return undefined
  return `line ${line}: not-observed, and no ACP transcript was kept, so the run cannot say why`
}

/** Every line under an evidence directory that kept a verdict it cannot explain, oldest first. */
export const refusalsIn = (evidence: string): string[] => {
  if (!existsSync(evidence)) return [`${evidence} holds no evidence`]
  const found: string[] = []
  for (const name of readdirSync(evidence).sort()) {
    // `line-N` while a launch runs, `line-N-launch-K` once the runner has moved an earlier one aside.
    const named = /^line-(\d+)(?:-launch-\d+)?$/.exec(name)
    if (named === null) continue
    const line = Number(named[1])
    if (!Number.isInteger(line)) continue
    const directory = join(evidence, name)
    const refusal = theRefusalOf(line, verdictIn(directory) ?? '', directory)
    if (refusal !== undefined) found.push(`${refusal} (${name})`)
  }
  return found
}

/**
 * The verdict the driver keeps: a not-observed line whose transcript was not kept is a `fail` that names why,
 * never a verdict the next reader cannot act on. Every other verdict is handed back untouched.
 */
export const theVerdictKeptWithItsExchange = (line: number, observation: Observation, directory: string): Observation => {
  const refusal = theRefusalOf(line, observation.verdict, directory)
  if (refusal === undefined) return observation
  return { verdict: 'fail', say: `${observation.say}; ${refusal}`, evidence: { ...observation.evidence } }
}
