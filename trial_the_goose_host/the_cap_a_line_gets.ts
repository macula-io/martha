// The bound one turn gets, made from what the model itself has been measured to take and from how many
// requests the line's turn makes (macula-io/martha#732).
//
// This exists because a fixed bound is a guess about a model: the trial model spent 141 s of silence producing
// one tool call, and a line whose turn makes three requests cannot finish inside a bound sized for one. A line
// that worked then read not-observed, and its verdict was the bound's rather than the model's. The bound here is
// the model's own slowest answer so far in this launch times the requests the line's turn makes, and it is
// renewed every time an answer lands, so a turn that keeps working is never cut for being long.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The requests one turn makes unless its line says otherwise: one prompt, one answer. */
export const REQUESTS_IN_ONE_TURN = 1

/**
 * The lines whose turn makes more than one model request, by the count their own code makes: line 4's turn asks
 * for the delegate, the subagent answers the model, and the main agent then answers again with the result.
 */
export const THE_REQUESTS_EACH_LINE_MAKES: Readonly<Record<number, number>> = { 4: 3 }

/** The requests a line's own turn makes. */
export function requestsOf(line: number): number {
  return THE_REQUESTS_EACH_LINE_MAKES[line] ?? REQUESTS_IN_ONE_TURN
}

/** The key the fork's pins.env defines the launch's bound under, and the runner exports into the launch. */
export const THE_LAUNCH_BOUND_KEY = 'TRIAL_MINUTES_PER_LAUNCH'

const MS_IN_A_MINUTE = 60_000

/** The model's own pace, measured request by request as the launch runs. */
export class TheModelPace {
  #slowestMs = 0
  readonly #onEachAnswer: (() => void)[] = []

  /** One request finished, having taken `ms`: it may be the slowest yet, and whatever was waiting is told. */
  noteAnAnswer(ms: number): void {
    if (ms > this.#slowestMs) this.#slowestMs = ms
    for (const listen of this.#onEachAnswer) listen()
  }

  /** The slowest answer this launch has measured, or 0 until one has landed. */
  theSlowestAnswerSoFar(): number {
    return this.#slowestMs
  }

  /** Calls `listen` after every answer that lands, and answers with the way to stop being called. */
  onEachAnswer(listen: () => void): () => void {
    this.#onEachAnswer.push(listen)
    return () => {
      const at = this.#onEachAnswer.indexOf(listen)
      if (at !== -1) this.#onEachAnswer.splice(at, 1)
    }
  }
}

/** What a turn is bounded by, and the values the bound was made of, for the line's result. */
export interface TheCapALineGets {
  readonly line: number
  readonly requests: number
  readonly pace: TheModelPace
  /** The runner's bound for one launch, or Infinity when nothing says it. */
  readonly boundMs: number
  /** The bound for the turn in hand, now: the launch's own bound until an answer has been measured. */
  ms(): number
  /** The values this bound was made of, as the line's result.json records them. */
  made(): TheCapMadeOf
}

/** What the bound was made of: the model's pace, the requests, the bound it fits in or does not. */
export interface TheCapMadeOf {
  readonly requests: number
  readonly roundTripMs: number
  readonly boundMs: number
  readonly ms: number
  /** Whether the line's requests fit: false is the arithmetic this issue is about, and the check names it. */
  readonly fits: boolean
}

/** The bound a line's turn gets: the model's slowest answer so far times the requests the turn makes. */
export function theCapFor(line: number, pace: TheModelPace, boundMs: number): TheCapALineGets {
  const requests = requestsOf(line)
  const wanted = (): number => {
    const roundTrip = pace.theSlowestAnswerSoFar()
    return roundTrip === 0 ? boundMs : requests * roundTrip
  }
  return {
    line, requests, pace, boundMs,
    ms: () => Math.min(wanted(), boundMs),
    made: () => {
      const ms = wanted()
      return { requests, roundTripMs: pace.theSlowestAnswerSoFar(), boundMs, ms, fits: ms <= boundMs }
    },
  }
}

/** Why a line cannot fit its requests in the bound it would get, in the words the check and the log use. */
export function whyALineCannotFitItsRequests(made: TheCapMadeOf): string | undefined {
  if (made.fits || made.roundTripMs === 0) return undefined
  return `${String(made.requests)} requests at ${String(made.roundTripMs)} ms a round-trip is ${String(made.ms)} ms, beyond the ${String(made.boundMs)} ms bound`
}

/**
 * The bound the runner gives one launch, in milliseconds, read from where the runner defines it: the fork's
 * pins.env, keyed by THE_LAUNCH_BOUND_KEY, which the runner exports into the launch's environment. Undefined when
 * nothing says it — a trial run outside the fork — and then a turn is bounded by the model's pace alone.
 */
export function theLaunchesBoundMs(gooseSource: string, environment: Readonly<Record<string, string | undefined>> = process.env): number | undefined {
  const exported = environment[THE_LAUNCH_BOUND_KEY]
  if (exported !== undefined) return Number(exported) * MS_IN_A_MINUTE
  try {
    const pins = readFileSync(join(gooseSource, 'martha', 'sync', 'pins.env'), 'utf8')
    const found = new RegExp(`^${THE_LAUNCH_BOUND_KEY}=(.+)$`, 'm').exec(pins)?.[1]
    return found === undefined ? undefined : Number(found) * MS_IN_A_MINUTE
  } catch {
    return undefined
  }
}
