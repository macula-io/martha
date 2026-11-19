// The words an ACP agent stand-in's script is written in, and the answers it gives, shared by the stand-in
// (main.ts, run as a child) and the tests that write its scripts. Kept apart from the stand-in so a
// test that imports them does not start reading its own stdin.
//
// It speaks as the recorded Goose engine does (src/know_the_goose_engines_facts/): a permission request offers the
// recording's permission_options in the engine's order, each with its kind as its id and its name, as the engine
// builds them (crates/goose/src/acp/server.rs, handle_tool_permission_request).

import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'

/** One step of a scripted turn. */
export type AStep =
  | { readonly say: string }
  | { readonly call: { readonly id: string; readonly title: string; readonly input: unknown; readonly name?: string }; readonly options?: readonly unknown[] }
  | { readonly ask: string }
  | { readonly line: string }
  | { readonly echo: 1 }
  | { readonly capabilities: 1 }
  | { readonly exit: 1 }
  /** A `session/update` sent as written: a call the engine reports and never asks about, or a status of its own. */
  | { readonly update: Readonly<Record<string, unknown>> }
  /** Steps played after the turn's prompt is answered, outside any turn (#541 package A, design R4). */
  | { readonly after_the_answer: readonly AStep[] }

/** What the stand-in answers: its version and mode, and one list of steps per prompt, in order. */
export interface AnAgentScript {
  readonly protocolVersion?: number
  readonly currentModeId?: string
  readonly turns: readonly (readonly AStep[])[]
  readonly stopReason?: string
}

/** The engine's own permission options, as it builds them: its kind as its id and its name, in the engine's order. */
export const THE_ENGINES_OPTIONS = RECORDED_GOOSE_ENGINE.permission_options.map((kind) => ({ optionId: kind, name: kind, kind }))

/**
 * The `_meta` the engine puts on a call's `tool_call` update to name its tool, at the path the recording holds
 * (`tool_naming.meta_path`, read from goose_tool_call_meta); the permission request itself carries only a title made for people.
 */
export const theEnginesNamingOf = (name: string): Record<string, unknown> =>
  RECORDED_GOOSE_ENGINE.tool_naming.meta_path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), name) as Record<string, unknown>

/** The session id the stand-in opens. */
export const STAND_IN_SESSION = 'stand-in-session'
/** How the engine reads an answer's id: a kind it offers that starts with this lets the call run. */
const LETS_IT_RUN = 'allow_'
/** And one that ends with this saves a rule that later skips the client (crates/goose/src/permission). */
const SAVES_A_RULE = '_always'

/** What the agent made of the answer to one call, as the call's update reports it back. */
export interface WhatTheAgentHeard {
  /** The id sent back, or `cancelled` when the outcome was a cancel. */
  readonly heard: string
  /** 1 when the engine would run the call, else 0. */
  readonly runs: 0 | 1
  /** 1 when the engine would save a rule from the answer, else 0. */
  readonly saves: 0 | 1
}

/** The answer read as the engine reads it: an id it did not offer is a cancel, which neither runs nor saves. */
export function whatTheEngineMakesOf(heard: string): WhatTheAgentHeard {
  const offered = RECORDED_GOOSE_ENGINE.permission_options.includes(heard)
  return { heard, runs: offered && heard.startsWith(LETS_IT_RUN) ? 1 : 0, saves: offered && heard.endsWith(SAVES_A_RULE) ? 1 : 0 }
}
