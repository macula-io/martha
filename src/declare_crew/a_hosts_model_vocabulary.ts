// The model names a host accepts for a subagent, as its adapter records them (macula-io/martha#541, package 6).
//
// This exists because hosts differ in what a model name is. Claude Code declares a closed list (its `AgentInput.model`
// is a union of aliases), so a name outside it is one Martha could never spell to the host. Goose declares none: its
// `delegate` tool takes any text and its provider serves whatever model it is given, a local one included, so a list
// recorded for it would restate a list the engine does not have. Each host's adapter records which kind it is, as data
// taken from the host, and the crew declaration is read against that.

/** The host names the models it accepts, and only those run. */
export const CLOSED_VOCABULARY = 'names_listed'
/** The host takes any model name its provider serves. */
export const OPEN_VOCABULARY = 'any_name'
/** Every kind a host's vocabulary can be, for a recording read back from disk. */
export const MODEL_VOCABULARY_KINDS: readonly string[] = [CLOSED_VOCABULARY, OPEN_VOCABULARY]

/** The model names one host accepts: its kind, and the names when it is closed (none when it is open). */
export interface ModelVocabulary {
  readonly kind: typeof CLOSED_VOCABULARY | typeof OPEN_VOCABULARY
  readonly names: readonly string[]
}

/** A vocabulary of no names at all: what a caller that knows no host passes, so every named model is refused. */
export const NO_MODEL_NAMED: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: [] }

/** Whether `name` (already trimmed, not empty) is one the host runs. */
export function hostRuns(vocabulary: ModelVocabulary, name: string): boolean {
  return vocabulary.kind === OPEN_VOCABULARY || vocabulary.names.includes(name)
}

/** The vocabulary a recording holds, or a throw naming what is wrong with it: a kind nothing reads is never trusted. */
export function vocabularyOf(kind: string, names: readonly string[]): ModelVocabulary {
  if (kind === OPEN_VOCABULARY && names.length > 0) throw new Error(`an open model vocabulary that also names ${names.join(', ')}`)
  if (kind === OPEN_VOCABULARY) return { kind, names }
  if (kind === CLOSED_VOCABULARY) return { kind, names }
  throw new Error(`a model vocabulary of kind ${JSON.stringify(kind)}, which is none of ${MODEL_VOCABULARY_KINDS.join(', ')}`)
}
