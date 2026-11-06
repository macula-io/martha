// Waits for the event a test means, not for the clock (martha#90). A wait that
// never ends is ended by the harness's own --test-timeout, and that timeout is
// the failure it reports, so what names the wait has to be a diagnostic.

import type { TestContext } from 'node:test'

/** How long the polling interval is: short enough that a test notices an event at once. */
const POLL_MS = 20

/**
 * Waits for the event a test means: the process started, the file written, the
 * line said. It holds no deadline of its own (martha#90): how long one of those
 * takes is the machine's business, so a number here asserts the machine's speed,
 * and CI failed on a tree that changed nothing (run 42291616077).
 *
 * A wait that never ends is ended by the harness instead, whose --test-timeout,
 * defined once in package.json, aborts the test's signal. The harness reports
 * that timeout as the failure and never the error thrown here, and it prints a
 * test's diagnostics even then (martha#90 r=2), so the wait says what it waits
 * for as a diagnostic, and says it again whenever what it is watching changes.
 * `watching` is that state — what the owner's terminal has printed so far — so a
 * hang leaves the last thing it saw in the log.
 */
export async function until(what: string, holds: () => boolean, t: TestContext, watching?: () => string): Promise<void> {
  let said = ''
  const say = (): void => {
    const seen = watching?.() ?? ''
    const line = seen === '' ? `waiting for ${what}` : `waiting for ${what}; it has shown: ${JSON.stringify(seen)}`
    if (line === said) return
    said = line
    t.diagnostic(line)
  }
  say()
  while (!holds()) {
    if (t.signal.aborted) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    say()
  }
}
