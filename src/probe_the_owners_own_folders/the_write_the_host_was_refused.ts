// What the host itself says it was refused (martha#154 r=2): the run is asked for json output, and the write a row
// claims was refused is the one the host's own answer names. A row that only reads the file's absence is satisfied by
// a host that never attempted the write -- a model that did nothing, a run that failed -- so the answer is what makes
// the row say the write was tried and stopped.
//
// `spawnSync` hands its output back as a Buffer unless it was asked for a string, so the text is taken here, in one
// place, and not at the call site.

import { isRecord } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { FILE_PATH_ARGUMENT, WHOLE_FILE_TOOL } from '../claude_code_host/claude_code_file_tools.ts'

/** The text a run printed. */
export function printedText(stdout: Buffer | null): string {
  return stdout === null ? '' : stdout.toString('utf8')
}

/** The Write the host was refused, as the host itself reports it: `permission_denials` names the tool and the path. */
export function deniedWriteIn(printed: string, target: string): boolean {
  const answer = ((): unknown => {
    try {
      return JSON.parse(printed.trim().split('\n').at(-1) ?? '')
    } catch {
      return undefined
    }
  })()
  const denials = isRecord(answer) && Array.isArray(answer['permission_denials']) ? (answer['permission_denials'] as unknown[]) : []
  return denials.some((denial) => {
    const input = isRecord(denial) && isRecord(denial['tool_input']) ? denial['tool_input'] : {}
    return isRecord(denial) && denial['tool_name'] === WHOLE_FILE_TOOL && input[FILE_PATH_ARGUMENT] === target
  })
}
