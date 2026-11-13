// What a ceiling fails on: a directory over it, a ceiling above its directory, a
// directory with none, or a ceiling nobody declares a directory for.
//
// The judgement is pure: it reads the declarations, the ceilings and the counts,
// and says what is wrong, in the words a member reads on a red run. A directory
// over its ceiling is the decision that hid; a ceiling above its directory is
// room for that decision to grow back unseen, so it fails until a record run
// brings it down in the change that shrank the directory (martha#341); a
// directory the lists declare with
// no ceiling is the hole this check exists to close, so it fails by name rather
// than passing quietly; a ceiling left behind for a directory no list names is a
// number nobody holds anything to, and says the map and the lists have drifted.

import { HOST_CEILINGS_SCRIPT } from '../../prove_the_core/declared_in_package_json.ts'
import { NPM } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import type { DeclaredDirectory, HostList } from './declared_host_directories.ts'
import { standsAbove } from './record_the_ceilings.ts'

/** One thing the check has to say, with the list the directory came from. */
export type Finding =
  | {
      readonly kind: 'over'
      readonly list: HostList
      readonly directory: string
      readonly code: number
      readonly ceiling: number
    }
  | {
      readonly kind: 'headroom'
      readonly list: HostList
      readonly directory: string
      readonly code: number
      readonly ceiling: number
    }
  | { readonly kind: 'no_ceiling'; readonly list: HostList; readonly directory: string }
  | { readonly kind: 'stale_ceiling'; readonly directory: string }

/** The command that brings every ceiling down to its directory's count. */
export const RECORD_COMMAND = `${NPM} run ${HOST_CEILINGS_SCRIPT} -- --record`

/** Where a decision belongs once a directory is over its ceiling, said for the list it came from. */
const ADVICE: Readonly<Record<HostList, string>> = {
  hostAdapters: 'an adapter composes slices of the core; a decision inside it belongs in a slice',
  hostGlue: 'glue implements the host contract; a decision inside it belongs in a slice',
}

/** The lists as package.json names them, for a message that says where a directory was declared. */
const LIST_NAME: Readonly<Record<HostList, string>> = {
  hostAdapters: 'martha.hostAdapters',
  hostGlue: 'martha.hostGlue',
}

/** What a directory's count says against its ceiling: over it, below it, or nothing. */
const againstItsCeiling = (entry: DeclaredDirectory, counted: number, ceiling: number): Finding | undefined => {
  if (counted > ceiling) return { kind: 'over', ...entry, code: counted, ceiling }
  if (standsAbove(ceiling, counted)) return { kind: 'headroom', ...entry, code: counted, ceiling }
  return undefined
}

/** Everything wrong with the counts, in the order the lists declare their directories. */
export function findingsOf(
  directories: readonly DeclaredDirectory[],
  ceilings: Readonly<Record<string, number>>,
  code: Readonly<Record<string, number>>,
): Finding[] {
  const declared = new Set(directories.map((entry) => entry.directory))
  const found: Finding[] = []
  for (const { list, directory } of directories) {
    const ceiling = ceilings[directory]
    if (ceiling === undefined) {
      found.push({ kind: 'no_ceiling', list, directory })
      continue
    }
    const finding = againstItsCeiling({ list, directory }, code[directory] ?? 0, ceiling)
    if (finding !== undefined) found.push(finding)
  }
  for (const directory of Object.keys(ceilings)) {
    if (!declared.has(directory)) found.push({ kind: 'stale_ceiling', directory })
  }
  return found
}

/** One finding in the words a red run prints it, the advice on its own line. */
export function describe(finding: Finding): string {
  switch (finding.kind) {
    case 'over':
      return (
        `${finding.directory}: ${finding.code} lines of code, ceiling ${finding.ceiling} (martha.hostCeilings)\n` +
        `  ${ADVICE[finding.list]}`
      )
    case 'headroom':
      return (
        `${finding.directory}: ${finding.code} lines of code, ceiling ${finding.ceiling} (martha.hostCeilings): ` +
        `${finding.ceiling - finding.code} line(s) of room to grow back unseen\n` +
        `  lower it in the change that shrank it: ${RECORD_COMMAND}`
      )
    case 'no_ceiling':
      return `${LIST_NAME[finding.list]} names ${finding.directory}, which has no ceiling in martha.hostCeilings`
    case 'stale_ceiling':
      return `martha.hostCeilings names ${finding.directory}, which is in neither ${LIST_NAME.hostAdapters} nor ${LIST_NAME.hostGlue}`
  }
}
