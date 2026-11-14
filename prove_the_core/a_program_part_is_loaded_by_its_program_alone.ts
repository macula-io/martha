// A program's parts are loaded by that program alone (martha#443).
//
// package.json declares, under martha.programParts, the directories under src/ that only one program a script runs
// loads: each is a part of that program, cut out of it to stay under the slice cap. The core's rules treat a part
// like its program, so a part may reach the machine; this is the rule that keeps that from leaking into the core: a
// file under src/ imports a part only from the part's own directory, from its program's, or from another part of the
// same program. Anything else that imports one is named here, by file and line.

import { dirname, join, normalize, sep } from 'node:path'

import { moduleReferencesIn, parseSource } from './parse_a_source.ts'
import type { Finding, Source } from './no_setting_outside_the_declaration.ts'

/** Each part's directory under src/, mapped to the directory of the program it belongs to. */
export type ProgramParts = Readonly<Record<string, string>>

const isRelative = (specifier: string) => specifier.startsWith('./') || specifier.startsWith('../')

/** The directory under src/ a relative specifier lands in, or undefined when it is not relative or leaves src/. */
const directoryReachedBy = (path: string, specifier: string | null): string | undefined => {
  if (specifier === null || !isRelative(specifier)) return undefined
  const target = normalize(join(dirname(path), specifier))
  return target === '..' || target.startsWith(`..${sep}`) ? undefined : target.split(sep)[0]
}

/** Whether a file in directory `from` may import the part `part`: its program, or a part of that program, itself included. */
const mayImportThePart = (parts: ProgramParts, from: string, part: string): boolean =>
  from === parts[part] || parts[from] === parts[part]

/** Every import of a program's part by a file that is neither in that part, nor its program, nor another of its parts. */
export function programPartsImportedFromOutside(sources: readonly Source[], parts: ProgramParts): Finding[] {
  return sources.flatMap((source) => {
    const from = source.path.split(sep)[0] ?? ''
    const { file } = parseSource(source.text, source.path)
    return moduleReferencesIn(file).flatMap(({ specifier, line }) => {
      const part = directoryReachedBy(source.path, specifier)
      return part === undefined || !Object.hasOwn(parts, part) || mayImportThePart(parts, from, part)
        ? []
        : [{ path: source.path, line, why: `imports ${specifier}, from ${part}, a part of the program ${parts[part]} that only it and its other parts load` }]
    })
  })
}
