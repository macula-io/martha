// How long a recorded-host run may go without doing anything, before the wait gives up on it (martha#210).
//
// This was a deadline on the whole run, moved here from the driver so a test can drive it. A real model request rides
// inside that run, so on a busy hosted runner the runner's speed decided the verdict: run 42747883703 went red on
// `No model request 3 within 120000 ms` for a diff that job never runs, and the same tree passed on a re-run. A budget
// counted from the start therefore measures the machine, not the relay (the same reason martha#90 gave for a wait that
// holds no deadline of its own).
//
// So the budget is spent on silence: every new thing the host shows — output on its terminal, or a model request
// arriving — refills it, and only a host that shows nothing new for the whole budget is given up on. A slow machine
// that is still working is never cut off by how long it has taken. A run that draws forever is ended by the harness's
// own --test-timeout, which is named where these cases run, and which reports itself as the harness timeout.
//
// A host can be working with nothing to show either: between a tool call and the next request it runs the tool, and
// during a call the launcher answers, a recheck and a record write all happen with the terminal still. So the wait
// reads the launcher's journal too (./keep_the_relays_journal.ts, martha#240): a new line is the host working seen from
// the other side, and a call the launcher holds open is not silence at all. An open stretch spends OPEN_WORK_MS
// instead, and the red names which stretch ran out — the launcher deciding, the tool, or the launcher answering —
// rather than blaming a model request for a tool that is still running (runs 42752345298 and 42747883703).

import { NO_JOURNAL, stretchOfTheJournal, type RelayJournalRead, type Stretch } from './keep_the_relays_journal.ts'

/** How long the wait sleeps between looks: short enough that an event is noticed at once. */
export const POLL_MS = 100

/**
 * How long the relay job lets the recorded host show nothing new before it gives up on it: the budget #210 moved
 * from the whole run onto silence. Named here, where the rule that spends it is, and taken from here by the cases
 * that run a host and by the cases that only run the rule.
 */
export const HOST_SILENCE_MS = 120_000

/**
 * How long one stretch of a call may last before it is named as stuck (martha#240). A launcher stretch is normally
 * short — the relay gives the launcher 30 000 ms before it takes the answer as a no — and a tool's is a tool's. The
 * number is chosen to name itself before the recorded-host cases' own 300 000 ms harness timeout
 * (../../prove_the_relay_loads/prove_the_relay_loads.sh), which stays the backstop for a case that has spent its time
 * elsewhere.
 */
export const OPEN_WORK_MS = 180_000

/** What a run gives the wait: what the host has shown so far, and how many model requests it has sent. */
export interface HostWhileWaiting {
  /** Everything the host has shown so far: its terminal. More than last time is the host working. */
  readonly shown: () => string
  /** How many model requests the host has sent so far. More than last time is the host working. */
  readonly heard: () => number
}

/** One wait: what it waits for, how it is ended, and the run it is watching. */
export interface ProgressWait extends HostWhileWaiting {
  /** What the wait is for, as a person reading a failure reads it. */
  readonly what: string
  /** Whether the thing waited for has happened. */
  readonly holds: () => boolean
  /** Why the thing can no longer come, once something has ruled it out. */
  readonly cannotHappen?: () => string | undefined
  /** How long the host may show nothing new before the wait gives up on it. */
  readonly silence_ms: number
  /** What the launcher has recorded (martha#240); a run whose launcher keeps no journal gives none. */
  readonly journal?: () => RelayJournalRead
  /**
   * When the run began. A run makes several waits and each begins its own silence budget, so a wait cannot count its
   * own time and call it the run's: this is the figure the red reports, and it is the run's (martha#210 r=1).
   */
  readonly run_started_at: number
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}

/**
 * The red for a run that showed nothing new: the silence, the run's own time, and — when the launcher kept a journal —
 * the last event it answered and how long ago, so a reader is told what the run was doing when it stopped.
 */
function wentSilent(wait: ProgressWait, journal: RelayJournalRead, written_at: number, now: number): string {
  const taken = now - wait.run_started_at
  const said = `No ${wait.what} for ${wait.silence_ms} ms: the host showed nothing new in that time, and the run has taken ${taken} ms in all`
  const last = [...journal.events].reverse().find((line) => line.phase === 'answered')
  if (last === undefined) return said
  return `${said}. The launcher last answered ${last.event} ${now - written_at} ms ago`
}

/** The red for one stretch that has run out: which of the three it was, its budget, and the run's own time. */
function stuckIn(stretch: Stretch, held: number, taken: number): string {
  const ran_out = `for ${held} ms, and the run has taken ${taken} ms in all`
  // The tool is named first here: an open call is the stretch a host spends waiting on something it started.
  if (stretch.kind === 'tool') return `The tool \`${stretch.of}\` has not returned in ${held} ms (the launcher allowed it at ${stretch.at}): the run has taken ${taken} ms in all`
  if (stretch.kind === 'answering') return `The launcher has been answering \`${stretch.of}\` ${ran_out}`
  return `The launcher has been deciding \`${stretch.of}\` ${ran_out}`
}

/** What a wait has seen so far of the host and the launcher, and when each of them last moved. */
interface Sightings {
  /** How much the terminal has shown: it only ever grows, so its length is enough to see it move. */
  shown: number
  /** How many model requests have arrived. */
  heard: number
  /** Every journal line the launcher has written. */
  written: number
  /** When anything last moved. */
  moved_at: number
  /** When the journal last grew, so a red can say how long since the launcher last answered. */
  written_at: number
}

/**
 * Takes one look: the terminal, the requests, and the launcher's journal. Moves `seen` on, and says whether anything
 * moved — the host working, whichever side of the socket it is seen from.
 */
function lookAt(wait: ProgressWait, seen: Sightings, journal: RelayJournalRead | undefined, now: number): boolean {
  const showing = wait.shown().length
  const hearing = wait.heard()
  const writing = journal?.written ?? seen.written
  const moved = showing !== seen.shown || hearing !== seen.heard || writing !== seen.written
  seen.shown = showing
  seen.heard = hearing
  if (writing !== seen.written) seen.written_at = now
  seen.written = writing
  if (moved) seen.moved_at = now
  return moved
}

/**
 * Waits for `wait.holds`, and gives up when the host has shown nothing new for `wait.silence_ms`, or when the launcher
 * has held one stretch of a call for `OPEN_WORK_MS`. The message names the budget that ran out and reports how long the
 * run had taken in all — from the run's own start, not from this wait's — so a reader can tell a slow machine, which
 * is never cut off, from a host that stopped working or a call that never came back.
 */
/** The launcher's journal as it stands, or undefined when this run's launcher keeps none. */
const journalNow = (wait: ProgressWait): RelayJournalRead | undefined => wait.journal?.()

/** The stretch the run is waiting in now, or undefined when the launcher holds nothing open. */
const stretchNow = (journal: RelayJournalRead | undefined): Stretch | undefined => (journal === undefined ? undefined : stretchOfTheJournal(journal))

/** The stretch the run is in, and when this wait first saw it. */
interface Held {
  stretch: Stretch | undefined
  since: number
}

/** Moves the wait into the stretch it is in now; one that opened or closed is the launcher having moved. */
function enterStretch(seen: Sightings, held: Held, open: Stretch | undefined, now: number): void {
  if (open?.key === held.stretch?.key) return
  held.stretch = open
  held.since = now
  // A stretch that opened or closed is the launcher having done something, whatever the terminal shows.
  seen.moved_at = now
}

/** The red this look's state owes, or undefined while the run may go on: one budget, whichever held it. */
function redFor(wait: ProgressWait, seen: Sightings, held: Held, journal: RelayJournalRead | undefined, now: number): string | undefined {
  if (held.stretch !== undefined) return now - held.since > OPEN_WORK_MS ? stuckIn(held.stretch, now - held.since, now - wait.run_started_at) : undefined
  return now - seen.moved_at > wait.silence_ms ? wentSilent(wait, journal ?? NO_JOURNAL, seen.written_at, now) : undefined
}

export async function waitWhileTheHostKeepsShowing(wait: ProgressWait): Promise<void> {
  const opened = wait.now()
  const seen: Sightings = { shown: wait.shown().length, heard: wait.heard(), written: journalNow(wait)?.written ?? 0, moved_at: opened, written_at: opened }
  // A stretch is timed from when this wait first saw it open, so a case that starts in the middle of one counts only
  // the time it watched (martha#240).
  const held: Held = { stretch: stretchNow(journalNow(wait)), since: opened }
  while (!wait.holds()) {
    const ruledOut = wait.cannotHappen?.()
    if (ruledOut !== undefined) throw new Error(ruledOut)
    const now = wait.now()
    const journal = journalNow(wait)
    lookAt(wait, seen, journal, now)
    enterStretch(seen, held, stretchNow(journal), now)
    const red = redFor(wait, seen, held, journal, now)
    if (red !== undefined) throw new Error(red)
    await wait.sleep(POLL_MS)
  }
}