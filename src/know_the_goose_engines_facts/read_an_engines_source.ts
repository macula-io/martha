// How the facts reader reads one checkout of the engine: a file by its path, a pattern's first group, a function's
// body, each a throw naming what it could not find (macula-io/martha#541, #614). Shared by the facts reader and the
// checkout skill-roots reader, so neither imports the other's helpers.

/** Reads one checkout of the engine: a file's text, or undefined when there is none; a directory's entries, or []. */
export interface EngineSource {
  readonly read: (path: string) => string | undefined
  readonly list: (directory: string) => readonly string[]
}

/** A file the part needs, or a throw that names it. */
export function fileOf(source: EngineSource, path: string): string {
  const text = source.read(path)
  if (text === undefined) throw new Error(`no ${path}`)
  return text
}

/** The first group `pattern` captures in `text`, or a throw naming what was looked for and where. */
export function captured(text: string, pattern: RegExp, what: string, path: string): string {
  const found = pattern.exec(text)?.[1]
  if (found === undefined) throw new Error(`${path} says nothing of ${what}`)
  return found
}

/** The body of `fn <name>(`, up to the first line that closes a top-level item, or a throw naming the function. */
export function functionBody(text: string, name: string, path: string): string {
  return captured(text, new RegExp(`fn ${name}\\([\\s\\S]*?\\{([\\s\\S]*?)\\n\\}`), `the function ${name}`, path)
}
