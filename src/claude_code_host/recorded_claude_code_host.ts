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

export { CREW_REFRESH }

/** What the host binary says, as recorded. */
export interface RecordedHost {
  readonly host_version: string
  /** The host's SessionStart hook-input schema, as its binary spells it. */
  readonly session_start_schema: string
  /** The engine's mapper from an ingress origin to the one a prompt.submit hook reads. */
  readonly prompt_origin_mapper: string
  /** The engine's origin for a prompt with no ingress origin. */
  readonly prompt_origin_fallback: string
  /** The task-notification subkinds the mapper promotes to a kind of their own. */
  readonly prompt_origin_subkinds: string
}

/** The recording this repository carries. */
export const RECORDED_HOST: RecordedHost = JSON.parse(
  readFileSync(new URL('./recorded_claude_code_host.json', import.meta.url), 'utf8'),
) as RecordedHost

/** Every SessionStart source the recorded host sends. */
export const CLAUDE_CODE_SESSION_START_SOURCES: readonly string[] = sessionStartSourcesOf(RECORDED_HOST.session_start_schema)

/** Every event the Claude Code host emits when a session starts, the crew's refresh included. */
export const CLAUDE_CODE_EMITTED_SESSION_EVENTS: readonly string[] = [...CLAUDE_CODE_SESSION_START_SOURCES, CREW_REFRESH]

/** Every origin kind the recorded host stamps on a prompt. */
export const CLAUDE_CODE_PROMPT_ORIGIN_KINDS: readonly string[] = promptOriginKindsOf(RECORDED_HOST)
