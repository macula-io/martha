// The bound one turn gets, made from what the model itself has been measured to take (macula-io/martha#732).
//
// This exists because a fixed bound is a guess about a model: the trial model spent 141 s of silence producing
// one tool call, and a bound sized for one request cut a turn that was still working, so the line's verdict was
// the bound's rather than the model's. The bound here is an idle one: the model's own slowest chat answer plus a
// named margin, re-armed every time an answer lands, so a turn is cut when the model goes quiet for longer than
// it has ever taken to answer, and never for being long. It is never more than what is left of the launch.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The key the fork's pins.env defines the launch's bound under; the runner sources that file for `timeout`. */
export const THE_LAUNCH_BOUND_KEY = 'TRIAL_MINUTES_PER_LAUNCH'

/** A bound in minutes, as pins.env gives it: a positive number and nothing else. */
const MINUTES = /^\d+(?:\.\d+)?$/

const MS_IN_A_MINUTE = 60_000

/**
 * The margin a turn is allowed on top of a round-trip before the model counts as gone quiet: half again as long
 * as its own slowest answer. A model that streams a long answer pauses between its pieces; a model that has
 * stopped has stopped for longer than it has ever taken to finish one.
 */
export const THE_MARGIN_OVER_A_ROUND_TRIP = 0.5

/** The model's own pace, measured chat answer by chat answer as the launch runs. */
export class TheModelPace {
  #slowestMs = 0
  readonly #onEachAnswer: (() => void)[] = []

  /** One chat answer finished, having taken `ms`: it may be the slowest yet, and whatever was waiting is told. */
  noteAnAnswer(ms: number): void {
    if (ms > this.#slowestMs) this.#slowestMs = ms
    for (const listen of this.#onEachAnswer) listen()
  }

  /** The slowest chat answer this launch has measured, or 0 until one has landed. */
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

/** What the bound was made of, as the line's result.json records it. */
export interface TheCapMadeOf {
  /** The model's slowest chat answer this launch measured, or 0 before any landed. */
  readonly roundTripMs: number
  /** The margin allowed over it. */
  readonly marginMs: number
  /** What is left of the launch's own bound at this moment. */
  readonly remainingMs: number
  /** The bound that actually runs: the idle bound, or what is left of the launch, whichever is smaller. */
  readonly ms: number
  /** Whether the idle bound fits inside what is left: false is the arithmetic the check names. */
  readonly fits: boolean
}

/** What a turn is bounded by, and the values the bound was made of, for the line's result. */
export interface TheCapALineGets {
  readonly pace: TheModelPace
  /** What is left of the launch's own bound, now. */
  remaining(): number
  /** The bound for the turn in hand, now: what is left of the launch until an answer has been measured. */
  ms(): number
  /** The values this bound was made of. */
  made(): TheCapMadeOf
}

/** The bound a turn gets: the model's own slowest answer plus its margin, renewed on every answer. */
export function theCapFor(pace: TheModelPace, remaining: () => number): TheCapALineGets {
  const idle = (): number => {
    const roundTrip = pace.theSlowestAnswerSoFar()
    return roundTrip === 0 ? Number.POSITIVE_INFINITY : roundTrip + Math.round(roundTrip * THE_MARGIN_OVER_A_ROUND_TRIP)
  }
  return {
    pace, remaining,
    ms: () => Math.min(idle(), remaining()),
    made: () => {
      const roundTrip = pace.theSlowestAnswerSoFar()
      const wanted = idle()
      const left = remaining()
      return {
        roundTripMs: roundTrip,
        marginMs: roundTrip === 0 ? 0 : Math.round(roundTrip * THE_MARGIN_OVER_A_ROUND_TRIP),
        remainingMs: left,
        ms: Math.max(0, Math.min(wanted, left)),
        fits: left > 0 && (roundTrip === 0 || wanted <= left),
      }
    },
  }
}

/** Why the bound the model set cannot fit in what is left of the launch, in the words the check and the log use. */
export function whyTheBoundCannotFit(made: TheCapMadeOf): string | undefined {
  if (made.fits) return undefined
  if (made.remainingMs <= 0) return `the launch has ${String(made.remainingMs)} ms left, less than the room its own end needs`
  const wanted = made.roundTripMs + made.marginMs
  return `a ${String(made.roundTripMs)} ms round-trip plus its ${String(made.marginMs)} ms margin is ${String(wanted)} ms, beyond the ${String(made.remainingMs)} ms left of the launch`
}

/**
 * The model has paced itself too slowly for what is left of the launch: a turn under it would only be reaped by
 * the runner, writing no result at all, so it is refused by name instead (PR 733 R2, R4).
 */
export class TheBoundCannotFitTheLaunch extends Error {
  constructor(why: string) {
    super(`the launch cannot give this turn the bound its model asks for: ${why}`)
    this.name = 'TheBoundCannotFitTheLaunch'
  }
}

/**
 * The bound the runner gives one launch, in milliseconds, read from the fork's pins.env — the same file the
 * runner sources for its `timeout`, which is the only place it is defined. A value that is not a positive number
 * of minutes is refused by name rather than turned into a bound of zero or of no bound at all.
 */
export function theLaunchesBoundMs(gooseSource: string): number {
  const path = join(gooseSource, 'martha', 'sync', 'pins.env')
  let pins: string
  try {
    pins = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`no ${path}: the launch's bound is defined there and nowhere else`)
  }
  const found = new RegExp(`^${THE_LAUNCH_BOUND_KEY}=(.+)$`, 'm').exec(pins)?.[1]?.trim()
  if (found === undefined) throw new Error(`${path} says nothing of ${THE_LAUNCH_BOUND_KEY}`)
  if (!MINUTES.test(found)) throw new Error(`${path} gives ${THE_LAUNCH_BOUND_KEY} as '${found}', not a positive number of minutes`)
  return Number(found) * MS_IN_A_MINUTE
}
