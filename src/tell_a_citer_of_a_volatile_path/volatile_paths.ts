// A path a reboot deletes, said to the member that cited it (martha#314).
//
// This exists because a member sent a verdict that pointed at a file under a scratch root, the machine was rebooted,
// and the successor that opened the verdict found nothing there (crew-code#37 keeps the same rule, and today's wipe
// is the same loss at a wider scale). The roots are never written here: a crew names its own in the declaration, and
// when it names none the roots the launch knows from the machine are used, so this file holds no path of its own.
//
// No I/O and no import but the handover tool's name, so every host runs the same rule: what a text cites, which of
// those a reboot deletes, and the one line the member reads.

import { isAbsolute } from 'node:path'

import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'

/**
 * The roots this machine keeps in memory, from the two facts a host reads off it: its temporary directory, and its
 * runtime directory when it has one (martha#314). The rule lives here, where a decision belongs, and the reading of the
 * machine lives in the adapter that launches, which hands both in. A runtime directory that is not absolute names no
 * root, a trailing slash is not part of one, and one directory named twice is named once.
 */
export function machineRootsFrom(temporaryDirectory: string, runtimeDirectory: string | undefined): readonly string[] {
  const named = [temporaryDirectory, ...(runtimeDirectory !== undefined && isAbsolute(runtimeDirectory) ? [runtimeDirectory] : [])]
  return [...new Set(named.map(root => root.replace(/\/+$/, '')))]
}

/**
 * The roots in force: the ones the crew declares, or — when it declares none — the ones the launch knows from the
 * machine. Both are handed in, so nothing here decides what a machine's own volatile roots are.
 */
export const theRootsInForce = (declared: readonly string[], machine: readonly string[]): readonly string[] =>
  declared.length > 0 ? declared : machine

// An absolute path: one or more `/segment` runs, matched only where a path can start, so a URL's slashes
// (`https://host/tmp/x`) and a deeper `/home/x/tmp/y` are not read as a path under a root. A path may follow `=`
// (`--work=/tmp/x`) or `*` (`**/tmp/x**`) as it does a space, and sentence punctuation after it is not part of it
// (`/tmp/t1.log. Read ...` names one path, once). Written as line comments, since a `*/` inside a block would end it.
const A_PATH = /(?:^|[\s"'`([{<,;:|=*])((?:\/[A-Za-z0-9._@+-]+)+)/g
const TRAILING = /[.,;:!?'")\]}*]+$/

/** Every path this text cites under one of these roots, each once, in the order they appear. */
export function volatilePathsIn(text: string, roots: readonly string[]): string[] {
  const found: string[] = []
  for (const match of text.matchAll(A_PATH)) {
    const path = (match[1] ?? '').replace(TRAILING, '')
    if (path === '' || found.includes(path)) continue
    if (roots.some(root => path === root || path.startsWith(`${root}/`))) found.push(path)
  }
  return found
}

/**
 * The one line a member reads beside what it just sent or handed over. It names the paths it cited and what a reboot
 * does to them, and it points at the handover tool by its own name rather than at a directory: the place a crew keeps
 * its files is the host's, so no path is restated here for a machine that does not have it.
 */
export const theVolatileNote = (paths: readonly string[]): string =>
  `${paths.join(', ')} ${paths.length === 1 ? 'does' : 'do'} not survive a reboot: ` +
  'the directory it sits under is kept in memory, so the file is gone at the next one. ' +
  `Write what matters into your handover (${WRITE_MY_HANDOVER_TOOL}) or into the text itself, and cite that instead.`
