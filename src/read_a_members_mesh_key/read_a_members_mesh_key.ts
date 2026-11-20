// A team member's mesh key, read where the declaration says it sits (martha#1016, DECIDED 2026-11-20 "Build groundwork
// now (Recommended)", and martha#931's DECIDED 2026-11-20 "ok we rely on the default").
//
// This exists so a team member signs on the mesh as itself, and as nobody else. A member's mesh server that is handed no
// key makes one up, or takes the owner's own under HOME, and the owner would believe it signs as the member (T1 of the
// design on #1016). So a team member's key is read here before anything is started on it, and a member whose key cannot
// be read is refused by name: never started on a default identity.
//
// Where the key is: the member's own `mesh_key`, else `<mesh.keys>/agent-<name>.key`, the name folded by the one rule
// member names are compared by (../declare_crew/member_names.ts), as crew-code names it (`bin/crew` member_key). Where a
// written path lands on disk (the owner's home, the project root) is the launch's to say: it is handed in as `placeOf`.
//
// What a key must be, each with the harm it prevents:
//   - present: the release's own tools make a missing key when they are started on its path (T4), so a new node id would
//     appear that nobody approved. Martha never makes a key; making one is the owner's act.
//   - a regular file, not a link: a link can point at another member's key (T2 below).
//   - the launching user's own, with no group or other bits: a key someone else can read is already out (T3).
//   - no other declared member's: two members on one key share one node id, the station keeps one link per node id and
//     drops the other's every time one connects (`replaced_by_newer_handshake`), and each could
//     read the other's mail (T2). Compared on the real path, so two spellings of one file are one key.
//
// A solo crew reads no key (crew-code #155): its members carry no mesh identity.
//
// It takes no host and reads no file: what a path is, is handed in (`see`), by the launch that reads the disk.

import { join } from 'node:path'

import type { TheCrewsMeshKeys } from '../declare_crew/the_crews_workspace.ts'
import { memberNameKey } from '../declare_crew/member_names.ts'
import { SOLO_MODE } from '../declare_crew/declare_crew.ts'

/** What a key's path is on disk: its kind as lstat says it, its owner, its permission bits and its real path. */
export interface AKeyFileSeen {
  readonly kind: 'file' | 'link' | 'other'
  readonly uid: number
  readonly mode: number
  readonly real: string
}

/** What a path is on disk, or null when nothing is there. */
export type SeeAKeyFile = (path: string) => AKeyFileSeen | null

/** Everything a member's key is read from. */
export interface TheKeysAsked {
  /** True only for a team crew: a solo crew reads no key. */
  readonly team: boolean
  readonly keys: TheCrewsMeshKeys
  /** Every declared member's name: a key two of them share is refused for both. */
  readonly members: readonly string[]
  /** Where a path written in the declaration sits on disk, as the launch resolves it. */
  readonly placeOf: (written: string) => string
  /** The launching user's id: a key must be theirs. */
  readonly uid: number
  readonly see: SeeAKeyFile
}

/** A member's key: its path, or why it cannot be read. A solo crew's member has none, and is not refused for it. */
export type AMembersKey = { readonly path: string } | { readonly refusal: string } | { readonly none: typeof SOLO_MODE }

/** The name of a member's key in the keys folder: `agent-<name>.key`, as crew-code names it. */
export const keyFileNameOf = (member: string): string => `agent-${memberNameKey(member)}.key`

/** The bits a key may carry beyond the owner's: none. */
const NOT_THE_OWNERS_BITS = 0o077

/** Where a member's key is declared to sit, resolved; or why the declaration names no place for it. */
export function whereTheKeyIs(member: string, keys: TheCrewsMeshKeys, placeOf: (written: string) => string): { readonly path: string } | { readonly refusal: string } {
  const own = keys.named[memberNameKey(member)]
  if (own !== undefined) return { path: placeOf(own) }
  if (keys.folder === null) return { refusal: `${member}'s mesh key has no place: the declaration names neither mesh.keys nor a mesh_key for ${member}` }
  return { path: join(placeOf(keys.folder), keyFileNameOf(member)) }
}

/** Why a key file seen on disk may not be used, or undefined when it may. */
function whyTheFileIsRefused(path: string, seen: AKeyFileSeen | null, uid: number): string | undefined {
  if (seen === null) return `there is no key at ${path}; Martha makes none, so make it or name the member's own mesh_key`
  if (seen.kind === 'link') return `${path} is a link, and a key must be the file itself`
  if (seen.kind !== 'file') return `${path} is not a file`
  if (seen.uid !== uid) return `${path} belongs to another user`
  if ((seen.mode & NOT_THE_OWNERS_BITS) !== 0) return `${path} can be read by others (mode ${(seen.mode & 0o777).toString(8)}); a key must be the owner's alone (chmod 600)`
  return undefined
}

/** One member's key on its own: its place, then the file there. */
function aKeyAlone(member: string, asked: TheKeysAsked): { readonly path: string; readonly real: string } | { readonly refusal: string } {
  const where = whereTheKeyIs(member, asked.keys, asked.placeOf)
  if ('refusal' in where) return where
  const seen = asked.see(where.path)
  const why = whyTheFileIsRefused(where.path, seen, asked.uid)
  if (why !== undefined || seen === null) return { refusal: `${member}'s mesh key: ${why ?? ''}` }
  return { path: where.path, real: seen.real }
}

/** The key of one member of the crew, as the header says; a key another declared member shares is refused. */
export function theMeshKeyOf(member: string, asked: TheKeysAsked): AMembersKey {
  if (!asked.team) return { none: SOLO_MODE }
  const own = aKeyAlone(member, asked)
  if ('refusal' in own) return own
  const sharing = asked.members.filter((other) => memberNameKey(other) !== memberNameKey(member)).filter((other) => {
    const theirs = aKeyAlone(other, asked)
    return 'real' in theirs && theirs.real === own.real
  })
  if (sharing.length > 0) return { refusal: `${member}'s mesh key ${own.path} is also ${sharing.join(', ')}'s: two members on one key share one node id, and the station drops one whenever the other connects` }
  return { path: own.path }
}
