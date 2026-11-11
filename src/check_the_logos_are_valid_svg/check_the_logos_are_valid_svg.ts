// Which logos are not well-formed XML (martha#271). GitHub shows an SVG it cannot parse as a broken image, so
// every file in assets/ is parsed whole.
//
// This is the check `xmllint --noout assets/*.svg` made, run on this repository's own Node instead of on
// libxml2-utils from the Ubuntu archive: on 2026-11-11 a hosted runner could not resolve archive.ubuntu.com, and
// the install ended the job with exit 100 and not one line of this repository run. saxes parses the same XML and
// refuses the same files, and it is a dev dependency, so the parser is on the pin the other jobs run on.

import { readFileSync } from 'node:fs'
import { SaxesParser } from 'saxes'

export interface MalformedLogo {
  readonly file: string
  /** saxes' own words, which open with the file and where it stopped. */
  readonly problem: string
}

export type LogoVerdict =
  | { readonly verdict: 'valid'; readonly checked: number }
  | { readonly verdict: 'malformed'; readonly logos: readonly MalformedLogo[] }
  /** A file named here could not be read: the check could not be made, which is never a pass. */
  | { readonly verdict: 'unreadable'; readonly reason: string }

const readError = (error: unknown): string => (error instanceof Error ? error.message : 'not readable')

/** Why `text` is not well-formed XML, or undefined when it is. saxes throws on the first thing it refuses. */
const problemIn = (file: string, text: string): string | undefined => {
  const parser = new SaxesParser({ fileName: file })
  try {
    parser.write(text).close()
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : `${file}: the parser refused it`
  }
}

/** Every file named, in the order given; the malformed ones kept with what the parser said. */
export function checkTheLogosAreValidSvg(files: readonly string[]): LogoVerdict {
  const malformed: MalformedLogo[] = []
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      return { verdict: 'unreadable', reason: `${file}: ${readError(error)}` }
    }
    const problem = problemIn(file, text)
    if (problem !== undefined) malformed.push({ file, problem })
  }
  return malformed.length === 0 ? { verdict: 'valid', checked: files.length } : { verdict: 'malformed', logos: malformed }
}
