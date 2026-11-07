// What a stand-in `claude` in a test answers before it acts as the member (#104).
//
// The launcher asks the host two questions before it starts a member: whether it
// loads Martha's relay (`plugin validate --json <relay>`) and which version it is
// (`--version`), each with the same binary the member then runs
// (host_runs_the_relay.ts). A stand-in answers both first, before it records that
// it ran, so a test of a member still sees whether the member itself ran.

import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'

/** The host's report for a plugin it loads. */
export const LOADS_THE_RELAY = JSON.stringify({ success: true, manifest: { errors: [] }, contents: [] })

/** The host's report for a plugin whose hooks module it refuses, with `why` as its error. */
export const refusesTheRelay = (why: string): string =>
  JSON.stringify({ success: false, manifest: { errors: [] }, contents: [{ type: 'hooks', errors: [{ path: 'modules', message: why }] }] })

export interface HostAnswers {
  /** The report `plugin validate --json` prints; LOADS_THE_RELAY unless given. */
  readonly report?: string
  /** Its exit status: 0 for a report of success, 1 otherwise, unless given. */
  readonly reportExit?: number
  /** The version `--version` prints; the recorded host's unless given. */
  readonly version?: string
  /** A file each run appends "$0 $1" to. */
  readonly callsFile?: string
}

const quoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

/** The shell lines a stand-in `claude` starts with, right after its #! line. */
export function hostAnswers(answers: HostAnswers = {}): string[] {
  const report = answers.report ?? LOADS_THE_RELAY
  const reportExit = answers.reportExit ?? (report === LOADS_THE_RELAY ? 0 : 1)
  return [
    ...(answers.callsFile === undefined ? [] : [`printf '%s %s\\n' "$0" "$1" >> ${quoted(answers.callsFile)}`]),
    `if [ "$1" = plugin ]; then printf '%s' ${quoted(report)}; exit ${reportExit}; fi`,
    `if [ "$1" = --version ]; then printf '%s (Claude Code)\\n' ${quoted(answers.version ?? RECORDED_HOST.host_version)}; exit 0; fi`,
  ]
}
