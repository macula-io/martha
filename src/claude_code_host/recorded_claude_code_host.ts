// What the Claude Code host says about itself, as this repository recorded it
// from the host binary (recorded_claude_code_host.json), and the lists the
// adapter and the coverage check derive from it (#41, threats T1, T5 and T7).
//
// The recording is re-taken by npm run record:claude-code-host
// (src/record_claude_code_host/), which uses only the
// parsers, never this module: a recording an older parser cannot read must not
// stop a new one being taken.

import { readFileSync } from 'node:fs'

import { CREW_REFRESH } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { promptOriginKindsOf } from './claude_code_prompt_origins.ts'
import { sessionStartSourcesOf } from './claude_code_session_events.ts'
import type { OwnersMarkdown } from './hooks_and_plugins_the_owner_declares.ts'
import { outputStylesFieldIn, outputStylesFolderIn, type MarkdownTheHostLoads } from './markdown_the_host_loads.ts'
import { hookSwitchesOf, type HookSwitches, type ManagedSettingsPlace } from './settings_that_turn_hooks_off.ts'

export { CREW_REFRESH }

/** How one host version keeps auto-memory off (martha#136). */
export interface MemoryOff {
  /** The host version this was read from: a re-recorded host fails until it is read again. */
  readonly version: string
  /** The function that decides file mode, whole: off when the off switch is set. */
  readonly file_mode_guard: string
  /** The variable that turns on hosted mode, which does not check the off switch. */
  readonly hosted_mode_variable: string
  /**
   * The function the guard calls on the off switch's value, whole: the values it
   * holds true are the ones that turn memory off, which the launch's value is
   * pinned against.
   */
  readonly on_check: string
}

/** What the host binary says, as recorded; the markdown it loads since martha#146. */
export interface RecordedHost extends MarkdownTheHostLoads {
  readonly host_version: string
  /**
   * How the recorded host's auto-memory is kept off, re-read by hand from that
   * version's code and restated, never derived: the recorder carries it over
   * and --check leaves it out (martha#136).
   */
  readonly memory_off: MemoryOff
  /** The host's SessionStart hook-input schema, as its binary spells it. */
  readonly session_start_schema: string
  /** The engine's mapper from an ingress origin to the one a prompt.submit hook reads. */
  readonly prompt_origin_mapper: string
  /** The engine's origin for a prompt with no ingress origin. */
  readonly prompt_origin_fallback: string
  /** The task-notification subkinds the mapper promotes to a kind of their own. */
  readonly prompt_origin_subkinds: string
  /** The host's function that builds a session's hook set, whole: which settings keys turn hooks off (martha#122). */
  readonly hooks_switches: string
  /** Each function an exit of that function calls, whole: safe mode, and a policy key (martha#122 r=2). */
  readonly hooks_switch_calls: readonly string[]
  /** Where the host reads managed settings on Linux (martha#122). */
  readonly managed_settings: ManagedSettingsPlace
}

/** The recording this repository carries. */
export const RECORDED_HOST: RecordedHost = recordedHostFrom(readFileSync(new URL('./recorded_claude_code_host.json', import.meta.url), 'utf8'))

/**
 * A recording, read from its text; or a refusal to load it.
 *
 * The fields a launch cannot do without are checked here, so a recording that lost one is not a recording this build
 * runs on: `user_output_styles_dir` names the field the session-init response reports the owner's styles folder in,
 * and a recording without it cannot say where a member must not write (martha#154). The recorder cuts the same field,
 * and a recording that cannot be cut is a failed recording; this is the other half, a text that loads.
 */
export function recordedHostFrom(text: string): RecordedHost {
  const recording = JSON.parse(text) as RecordedHost
  if (typeof recording.user_output_styles_dir !== 'string' || recording.user_output_styles_dir.trim() === '') {
    throw new Error('The recording does not hold the session-init response\'s user-output-styles field, so where a member may not write the owner\'s styles cannot be told (martha#154).')
  }
  outputStylesFieldIn(recording.user_output_styles_dir)
  outputStylesFolderIn(recording.user_output_styles_dir)
  return recording
}

/** Every SessionStart source the recorded host sends. */
export const CLAUDE_CODE_SESSION_START_SOURCES: readonly string[] = sessionStartSourcesOf(RECORDED_HOST.session_start_schema)

/** Every event the Claude Code host emits when a session starts, the crew's refresh included. */
export const CLAUDE_CODE_EMITTED_SESSION_EVENTS: readonly string[] = [...CLAUDE_CODE_SESSION_START_SOURCES, CREW_REFRESH]

/** The settings keys that turn Martha's relay off in the recorded host, by where it honours them (martha#122). */
export const CLAUDE_CODE_HOOK_SWITCHES: HookSwitches = hookSwitchesOf(RECORDED_HOST.hooks_switches, RECORDED_HOST.hooks_switch_calls)

/** Every origin kind the recorded host stamps on a prompt. */
export const CLAUDE_CODE_PROMPT_ORIGIN_KINDS: readonly string[] = promptOriginKindsOf(RECORDED_HOST)

/** The host's frontmatter pattern and the markdown folders it loads in the user and managed scopes, as recorded (martha#146). */
export const CLAUDE_CODE_OWNERS_MARKDOWN: OwnersMarkdown = {
  frontmatter_pattern: RECORDED_HOST.frontmatter_pattern,
  kinds: RECORDED_HOST.markdown_kinds,
}

/**
 * The folder under each config dir the host lists the owner's user-level output styles from, from the recording's
 * own statement about it (martha#154): never a name typed here.
 */
export const CLAUDE_CODE_OUTPUT_STYLES_FOLDER: string = outputStylesFolderIn(RECORDED_HOST.user_output_styles_dir)

/** The session-init response's field the folder is reported in, as the recorded statement declares it (martha#154). */
export const CLAUDE_CODE_OUTPUT_STYLES_FIELD: string = outputStylesFieldIn(RECORDED_HOST.user_output_styles_dir)
