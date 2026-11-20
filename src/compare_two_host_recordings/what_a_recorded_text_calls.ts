// What a recorded text of the Claude Code host calls, as the recording holds it (martha#412, martha#811): the shape the
// follower writes and the compare reads. It lives with the compare, which reads every field of the recording, so the
// follower and the recorder import it and the compare imports neither.

/** One function a recorded text reaches, whole, and the entry each name it calls binds to. */
export interface GuardFunction {
  readonly function: string
  readonly calls: Readonly<Record<string, number>>
}

/** A text's own calls, by the entry each binds to, and every function they reach, in the order first reached. */
export interface GuardCalls {
  readonly guard_calls: Readonly<Record<string, number>>
  readonly functions: readonly GuardFunction[]
}

/** How far a field's callees are followed. */
export type Depth = 'full' | 'one level'
