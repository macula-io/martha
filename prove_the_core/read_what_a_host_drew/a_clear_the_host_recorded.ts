// What the host's own record says about its clear, for a probe that cannot see one (martha#693).
//
// A probe types `/clear` at the host's prompt, and nothing tells it whether the clear ran. Nothing the host draws says
// "cleared", and a background command outlives a clear that never ran exactly as it outlives one that did, so the kernel
// cannot tell the two apart either. The host writes it down instead, in one of two places, and this reads both: a
// session file it started, whose entries hold the clear's own command, or its prompt history, where the line after
// `/clear` carries the sessionId the clear moved the host to. A clear the host drops -- one typed into a turn that is
// still drawing -- leaves neither.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The command the host records when it is told to clear its own screen and its earlier turns. */
const THE_CLEAR = '<command-name>/clear</command-name>'

/** Every session file the host has written under `home`, in whichever project folder it put the checkout it ran in. */
const theSessionFiles = (home: string): string[] => {
  const projects = join(home, '.claude', 'projects')
  if (!existsSync(projects)) return []
  return readdirSync(projects, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      readdirSync(join(projects, entry.name))
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => join(projects, entry.name, name)),
    )
}

/** The parsed lines of a JSON record, and no line at all before the host has written one. */
const theRecordedLines = (file: string): Array<Record<string, unknown> | undefined> => {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      try {
        const parsed: unknown = JSON.parse(line)
        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
      } catch {
        return undefined
      }
    })
}

/** Whether `home`'s prompt history holds a `/clear` whose next line carries a sessionId, and one it did not start in. */
const theHistoryMovedTheHost = (home: string): boolean => {
  const history = theRecordedLines(join(home, '.claude', 'history.jsonl'))
  return history.some((entry, at) => {
    const next = history[at + 1]
    return entry?.display === '/clear' && typeof entry.sessionId === 'string' &&
      typeof next?.sessionId === 'string' && next.sessionId !== entry.sessionId
  })
}

/**
 * Whether the host's own record, under `home`, holds a clear: a session file whose entries hold the clear's command, or
 * a prompt history whose line after `/clear` carries the sessionId the clear moved the host to.
 */
export const theClearRan = (home: string): boolean => {
  if (theSessionFiles(home).some((file) => readFileSync(file, 'utf8').includes(THE_CLEAR))) return true
  return theHistoryMovedTheHost(home)
}
