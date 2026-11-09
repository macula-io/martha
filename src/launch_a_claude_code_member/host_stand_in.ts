// What a stand-in `claude` in a test answers before it acts as the member (#104).
//
// The launcher asks the host three questions before it starts a member: whether it
// loads Martha's relay (`plugin validate --json <relay>`), which version it is
// (`--version`), and which folder its session init reports for the owner's user
// output styles (a control request over stream-json, martha#154), each with the
// same binary the member then runs (host_runs_the_relay.ts). A stand-in answers all
// three first, before it records that it ran, so a test of a member still sees
// whether the member itself ran.

import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FIELD, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { RELAY_MANIFEST } from './relay_copy.ts'

/** The folder a stand-in's session init reports for the owner's user output styles, unless a test gives another (#154). */
export const STAND_IN_OUTPUT_STYLES_DIR = '/home/probe/.claude/output-styles'

/**
 * A host's answer to the session init: the field the recorded host names, holding the folder it reports (#154). The
 * field's name is the recording's, never typed here; a test that wants a host reporting no such field passes its own
 * answer instead.
 */
export const reportsOutputStyles = (dir: string): string =>
  JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'martha-session-init', response: { [CLAUDE_CODE_OUTPUT_STYLES_FIELD]: dir } } })

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
  /** A file `plugin validate` writes the folder it was asked about to, then whether the relay's manifest was in it (#117). */
  readonly validatedFile?: string
  /** The line its session init prints; `reportsOutputStyles(STAND_IN_OUTPUT_STYLES_DIR)` unless given (#154). */
  readonly initAnswer?: string
  /** A file the init answer writes the pid of a child it started into, as a host that starts a server does (#154 r=2). */
  readonly initChildFile?: string
  /** A file the init answer touches when the settings it was given leave hooks on, as a host that runs one does (#154 r=2). */
  readonly initHookFile?: string
}

/** The key that turns hooks off from any settings file, as the recording spells it: the stand-in reads it, never types it. */
const HOOKS_OFF_KEY = CLAUDE_CODE_HOOK_SWITCHES.every_source[0] ?? ''

const quoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

/**
 * What a host may do before it answers its session init: start a server of its own, and run the first hook its settings
 * name (martha#154 r=2, probed on 2.1.321 where both happen). A stand-in does both when a test asks it to, so the launch
 * is shown to leave nothing running and to have turned hooks off rather than trusted that a host does neither.
 */
function initSideEffects(answers: HostAnswers): string {
  const started = answers.initChildFile === undefined ? [] : [`sh -c 'sleep 300 & echo $! > ${quoted(answers.initChildFile)}'`]
  const hook = answers.initHookFile === undefined ? [] : [`off=''; prev=''; for a in "$@"; do if [ "$prev" = --settings ] && grep -q '"${HOOKS_OFF_KEY}":true' "$a" 2>/dev/null; then off=1; fi; prev="$a"; done; [ -n "$off" ] || touch ${quoted(answers.initHookFile)}`]
  // Ended with the separator, so the line that asks the question reads as one sentence with or without these.
  const lines = [...started, ...hook]
  return lines.length === 0 ? '' : `${lines.join('; ')}; `
}

/** The shell lines a stand-in `claude` starts with, right after its #! line. */
export function hostAnswers(answers: HostAnswers = {}): string[] {
  const report = answers.report ?? LOADS_THE_RELAY
  const reportExit = answers.reportExit ?? (report === LOADS_THE_RELAY ? 0 : 1)
  // What the question may start comes first, then the answer; nothing at all when the test asks for neither.
  const sideEffects = initSideEffects(answers)
  return [
    ...(answers.callsFile === undefined ? [] : [`printf '%s %s\\n' "$0" "$1" >> ${quoted(answers.callsFile)}`]),
    ...(answers.validatedFile === undefined
      ? []
      : [`if [ "$1" = plugin ]; then eval "folder=\\\${$#}"; printf '%s %s\\n' "$folder" "$([ -f "$folder/${RELAY_MANIFEST}" ] && echo held || echo empty)" > ${quoted(answers.validatedFile)}; fi`]),
    `if [ "$1" = plugin ]; then printf '%s' ${quoted(report)}; exit ${reportExit}; fi`,
    `if [ "$1" = --version ]; then printf '%s (Claude Code)\\n' ${quoted(answers.version ?? RECORDED_HOST.host_version)}; exit 0; fi`,
    // The init question is the one run that asks for stream-json input: the member's own start never does. Whatever a
    // host may start there is started here first, so a launch that lets it happen shows it (martha#154 r=2).
    `case " $* " in *" --input-format stream-json "*) ${sideEffects}printf '%s\\n' ${quoted(answers.initAnswer ?? reportsOutputStyles(STAND_IN_OUTPUT_STYLES_DIR))}; exit 0;; esac`,
  ]
}
