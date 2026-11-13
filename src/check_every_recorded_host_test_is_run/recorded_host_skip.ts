// The marker a test case that drives the recorded host carries, and the list of runs that runs it (martha#385).
//
// Such a case skips wherever MARTHA_RECORDED_HOST is unset, which is everywhere but ci.yml's relay job. The skip says
// where it does run, and check_every_recorded_host_test_is_run counts the cases that carry it, so a case nothing runs
// fails CI by name rather than reading as a pass.

import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { sep } from 'node:path'
import process from 'node:process'

import { DEFAULT_CONFIG_DIR } from '../claude_code_host/settings_env_reaching_servers.ts'
import { RECORDED_HOST_VARIABLE } from '../launch_a_claude_code_member/drive_the_recorded_host.ts'

/**
 * The list of runs the relay job makes with the recorded host: one entry per test file that drives it (and name
 * pattern), with how many of its cases must pass. prove_the_relay_loads.sh reads it, and the check holds it to the
 * cases in each file.
 */
export const RECORDED_HOST_RUNS = 'prove_the_relay_loads/recorded_host_runs.json'

/**
 * The skip of a test case that drives the recorded host: false where the variable names the binary, and otherwise the
 * reason, which says where the case does run. A case writes `{ skip: RECORDED_HOST_SKIP }` and reads the binary through
 * `recordedHost()`, never the variable itself.
 */
export const RECORDED_HOST_SKIP: string | false =
  process.env[RECORDED_HOST_VARIABLE] === undefined &&
  `needs ${RECORDED_HOST_VARIABLE}, the recorded host's binary; ci.yml's relay job runs this case with it, listed in ${RECORDED_HOST_RUNS}`

/**
 * Why a recorded-host run cannot be made with its checkout under `folder`, or undefined when it can (martha#383). Claude
 * Code treats a path with a DEFAULT_CONFIG_DIR segment as its own settings and asks before a member writes there; in a
 * run nobody answers, so the case waits out its whole budget and then fails for a reason that is not its own.
 */
export const whyNoRunUnder = (folder: string): string | undefined =>
  folder.split(sep).includes(DEFAULT_CONFIG_DIR)
    ? `a recorded-host run makes its checkout under ${folder}, which has a ${DEFAULT_CONFIG_DIR} segment: the host asks before a member writes there and nobody answers. Set TMPDIR to a folder outside ~/${DEFAULT_CONFIG_DIR} (martha#383)`
    : undefined

/**
 * The recorded host's binary, for a case RECORDED_HOST_SKIP let run. Every such case makes its checkout under the
 * system's temporary folder and asks for the binary before it starts the host, so this is where a temporary folder the
 * host would ask about is refused, by name, before any host starts (whyNoRunUnder).
 */
export function recordedHost(): string {
  const why = whyNoRunUnder(realpathSync(tmpdir()))
  if (why !== undefined) throw new Error(why)
  return process.env[RECORDED_HOST_VARIABLE] ?? ''
}
