// A relay root short enough for a socket address whatever TMPDIR is (martha#79).
// For tests, and the clean-install proof (installer/prove_a_clean_install), only.
//
// A launch's socket is `<relay root>/<launch>/relay.sock`, and an address holds
// about a hundred bytes. macOS's default TMPDIR is about 49 bytes behind a
// /var -> /private/var link, and CI runs the suite under a longer one on
// purpose, so a root under TMPDIR may leave no room and the launcher refuses
// the launch by name. Tests that serve the relay make their root here instead:
// under XDG_RUNTIME_DIR when it is set (a per-user directory, short on Linux),
// else under the system's own temporary directory, which TMPDIR does not move.

import { mkdtempSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import process from 'node:process'
import type { TestContext } from 'node:test'

/** The temporary directory POSIX systems keep at a fixed, short path, whatever TMPDIR says. */
const SYSTEM_TEMPORARY_DIRECTORY = '/tmp'

const PREFIX = 'martha-relay-'

/** A new directory, mode 0700, with room for a socket; its maker removes it. The clean-install proof makes its own here. */
export function newShortRelayRoot(): string {
  const runtime = process.env.XDG_RUNTIME_DIR
  const base = runtime !== undefined && isAbsolute(runtime) ? runtime : SYSTEM_TEMPORARY_DIRECTORY
  return mkdtempSync(join(base, PREFIX))
}

/** A new directory, mode 0700, removed after the test: a relay root with room for a socket. */
export function shortRelayRoot(t: TestContext): string {
  const root = newShortRelayRoot()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
