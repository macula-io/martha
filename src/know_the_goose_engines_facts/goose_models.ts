// The model names the Goose engine runs for a delegate, as the recording holds them (macula-io/martha#541, package 6).
//
// This exists so a crew working in Goose has its review model read against the engine's own vocabulary, taken from
// the recording and never typed here. It sits apart from recorded_goose_engine.ts because the recorder loads that
// module: a recording in an older shape must still load there, so a new one can be taken.

import { vocabularyOf, type ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { RECORDED_GOOSE_ENGINE } from './recorded_goose_engine.ts'

/** What a crew's review model is read against when its members run in Goose. */
export const GOOSE_MODELS: ModelVocabulary = vocabularyOf(RECORDED_GOOSE_ENGINE.subagent_models.kind, RECORDED_GOOSE_ENGINE.subagent_models.names)
