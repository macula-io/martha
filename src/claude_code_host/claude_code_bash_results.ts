// What the pinned Claude Code host answered for a `Bash` call, as this repository recorded it
// (recorded_claude_code_bash_results.json), and the shapes the shell exemption builds its expected answer from
// (martha#129, design step 4.3).
//
// The recording is what a tool.call hook's `next` resolved to for the exact command `martha run test`, run by a
// stand-in that printed known text and exited with a known status. Only statuses 0 and 1 become shapes: the host's
// answer for any other status was not recorded and is not guessed, so such a run records A13.
//
// A new host version is a new recording, taken the way the JSON's own `_why` says and dropped in beside it. Nothing
// here parses the host: the shapes are its answers, read as data.

import { readFileSync } from 'node:fs'

import { RECORDED_STATUSES, type RecordedOutput, type RecordedResultShape } from '../keep_the_shell_for_an_owner_signed_command/keep_the_shell.ts'

/** One case the recording holds: what the stand-in printed, the status it exited with, and the host's answer. */
export interface RecordedBashCase {
  readonly status: number
  readonly printed: string
  readonly command: string
  readonly answer: unknown
}

/** The answers the pinned host gave a `Bash` call, as recorded. */
export interface RecordedBashResults {
  readonly host_version: string
  /** The text the stand-in printed, which every answer that shows output carries. */
  readonly mark: string
  readonly cases: readonly RecordedBashCase[]
}

/** The recording this repository carries. */
export const RECORDED_BASH_RESULTS: RecordedBashResults = JSON.parse(
  readFileSync(new URL('./recorded_claude_code_bash_results.json', import.meta.url), 'utf8'),
) as RecordedBashResults

/** The host's answer for a status with output and with none, for every status the exemption covers. */
export function bashResultShapesOf(recording: RecordedBashResults): readonly RecordedResultShape[] {
  // The recorded cases that printed other text are the same answer with another output in it, and hold nothing a
  // shape needs: one case per status and output is the shape, and the node test holds every case to it.
  const wanted = RECORDED_STATUSES.flatMap((status) => (['some', 'none'] as readonly RecordedOutput[]).map((output) => ({ status, output })))
  return wanted.flatMap(({ status, output }) => {
    const found = recording.cases.find((one) => one.status === status && one.printed === printedFor(recording, output))
    return found === undefined ? [] : [{ status, output, mark: recording.mark, value: found.answer }]
  })
}

/** What the stand-in printed for each output: the mark for one, nothing for none. */
function printedFor(recording: RecordedBashResults, output: RecordedOutput): string {
  return output === 'some' ? `${recording.mark}\n` : ''
}

/** The shapes the exemption builds its expected answer from: the pinned host's own answers. */
export const CLAUDE_CODE_BASH_RESULT_SHAPES: readonly RecordedResultShape[] = bashResultShapesOf(RECORDED_BASH_RESULTS)
