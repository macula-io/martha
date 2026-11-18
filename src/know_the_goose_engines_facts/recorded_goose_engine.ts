// What the Goose engine says about itself, as this repository recorded it from the engine's source
// (recorded_goose_engine.json, macula-io/martha#541 package 10).
//
// The recording is re-taken by npm run record:goose-engine (src/record_the_goose_engine/), which reads with the
// parsers beside this file and never with this module, so a recording an older shape cannot read never stops a new
// one being taken.

import recording from './recorded_goose_engine.json' with { type: 'json' }

import type { EngineFacts } from './the_engines_facts_in_its_source.ts'

/** The recording as committed: the engine's facts, why the file exists, and the commit they were read at. */
export interface RecordedEngine extends EngineFacts {
  readonly _why: string
  /** The engine commit the facts were read at: the pin a launch builds the engine from. */
  readonly engine_commit: string
}

/** Where the recording is, for the recorder that writes it. */
export const RECORDING_OF_THE_ENGINE = new URL('./recorded_goose_engine.json', import.meta.url)

/** The recorded engine. */
export const RECORDED_GOOSE_ENGINE: RecordedEngine = recording as RecordedEngine
