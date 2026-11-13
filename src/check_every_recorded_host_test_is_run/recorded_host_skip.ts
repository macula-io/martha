// The marker a test case that drives the recorded host carries, and the list of runs that runs it (martha#385).
//
// Such a case skips wherever MARTHA_RECORDED_HOST is unset, which is everywhere but ci.yml's relay job. The skip says
// where it does run, and check_every_recorded_host_test_is_run counts the cases that carry it, so a case nothing runs
// fails CI by name rather than reading as a pass.

import process from 'node:process'

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

/** The recorded host's binary, for a case RECORDED_HOST_SKIP let run. */
export const recordedHost = (): string => process.env[RECORDED_HOST_VARIABLE] ?? ''
