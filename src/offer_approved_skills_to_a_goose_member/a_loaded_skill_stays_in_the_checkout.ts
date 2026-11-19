// What `load_skill` can read stays the checkout's (martha#614 slice 3, plan r=2 R4 and r=3 R4a).
//
// The engine finds skills by following file and folder links, targets outside a root included, and leaves access
// policy to its caller (goose-agent skills/discovery.rs, at the pinned engine). It re-scans its roots on every
// `load_skill` call, so a link made mid-session, after the owner approved the checkout, is read under a skill's name.
// The row that places a loaded skill as a file of the checkout is true only if nothing under the checkout's skill roots
// reaches outside it. So before a `load_skill` call is allowed, and again after its result, the checkout's skill roots
// are walked without following links, and this decides on what the walk found:
//   - a link whose real target is outside the checkout's real path, or whose target cannot be told, is refused by name;
//   - a regular file with more than one hard link is refused by name: it sits inside the checkout and may hold bytes
//     from anywhere, and no comparison of paths can see which (r=3 R4a). An innocent hard link is refused too, the
//     strict side; the owner removes it.
//
// Said plainly, a known residual (DECIDED 2026-11-19 "Fix (a), state (b) (Recommended)"): the check after the result
// runs once the engine has already sent that result to the model. A link made between the owner's approval of a call
// and the engine's read can reach the model's provider before the member is stopped; the re-check then stops the member
// and names the link, but it does not stop those bytes from leaving. Only a link that exists when the request is
// answered is refused before anything is read.
//
// The walk reads the files through the host contract's FileTree, never following a link, so it is a slice like the
// decision: what it is handed is the machine's, and a stand-in tree in a test is walked the same way.

import { join, relative, sep } from 'node:path'

import type { FileTree } from '../host_contract/host_contract.ts'

/** One entry the walk found under a skill root, the root itself included, read without following a link. */
export type AnEntryUnderASkillRoot =
  /** A link, and the real path it leads to, or undefined when it leads nowhere that can be told. */
  | { readonly kind: 'link'; readonly path: string; readonly leads_to: string | undefined }
  /** A regular file, and how many hard links it has, or undefined when the tree cannot tell. */
  | { readonly kind: 'file'; readonly path: string; readonly hard_links: number | undefined }
  /** Anything that is not a file, a folder or a link (a socket, a device, a pipe). */
  | { readonly kind: 'other'; readonly path: string }
  /** A folder. */
  | { readonly kind: 'folder'; readonly path: string }

/** Whether `path` is `folder` or inside it, both real paths; a trailing separator on either is not part of the place. */
function isWithin(path: string, folder: string): boolean {
  const trimmed = (place: string): string => (place.length > sep.length && place.endsWith(sep) ? place.slice(0, -sep.length) : place)
  const [at, within] = [trimmed(path), trimmed(folder)]
  return at === within || at.startsWith(within === sep ? within : `${within}${sep}`)
}

/** What a refusal says a skill loaded through an entry would be. */
const AS_THE_CHECKOUTS = "would be taken in as the checkout's own file (martha#614 slice 3)"

/** Why a link could hand text from outside `checkout`: it leads outside, or nowhere that can be told. */
function aLinkOut(checkout: string, link: { readonly path: string; readonly leads_to: string | undefined }): string | undefined {
  if (link.leads_to !== undefined && isWithin(link.leads_to, checkout)) return undefined
  return `${link.path} is a link to ${link.leads_to ?? 'a place that cannot be told'}, outside the checkout ${checkout}: a skill loaded through it ${AS_THE_CHECKOUTS}`
}

/** Why a file could hold bytes from outside `checkout`: it has another hard link, or a count that cannot be told. */
function aSharedFile(checkout: string, file: { readonly path: string; readonly hard_links: number | undefined }): string | undefined {
  if (file.hard_links === 1) return undefined
  const count = file.hard_links === undefined ? 'a count of hard links that cannot be told' : `${String(file.hard_links)} hard links`
  return `${file.path} has ${count}: its bytes may be a file from outside the checkout ${checkout}, and a skill loaded from it ${AS_THE_CHECKOUTS}`
}

/** Why this one entry could hand `load_skill` text from outside `checkout`, or undefined when it could not. */
function whyThisEntryCouldLeave(checkout: string, entry: AnEntryUnderASkillRoot): string | undefined {
  switch (entry.kind) {
    case 'link':
      return aLinkOut(checkout, entry)
    case 'file':
      return aSharedFile(checkout, entry)
    case 'other':
      return `${entry.path} is neither a file, a folder nor a link under the checkout's skill roots, so what a skill loaded from it holds cannot be told (martha#614 slice 3)`
    case 'folder':
      return undefined
  }
}

/**
 * Why something under the checkout's skill roots could hand `load_skill` text from outside the checkout, naming the
 * first such entry, or undefined when nothing could. `checkout` is the checkout's real path.
 */
export function whyALoadedSkillCouldLeaveTheCheckout(checkout: string, entries: readonly AnEntryUnderASkillRoot[]): string | undefined {
  for (const entry of entries) {
    const why = whyThisEntryCouldLeave(checkout, entry)
    if (why !== undefined) return why
  }
  return undefined
}

/** The entry for what `tree` finds at `path`, never following a link, or undefined when nothing is there. */
function anEntryAt(tree: FileTree, path: string): AnEntryUnderASkillRoot | undefined {
  const kind = tree.kindOf(path)
  switch (kind.kind) {
    case 'absent':
      return undefined
    case 'symlink':
      return { kind: 'link', path, leads_to: tree.realPathOf(path) ?? undefined }
    case 'file':
      return { kind: 'file', path, hard_links: kind.hardLinks }
    case 'other':
      return { kind: 'other', path }
    case 'directory':
      return { kind: 'folder', path }
  }
}

/**
 * Every entry under the checkout's skill roots, read through `tree` without following a link: each folder between the
 * checkout and a root (a link there moves the whole root), each root, and everything below a root that is a folder.
 * `roots` are relative to the checkout, as the recording names them; a root that is absent adds nothing.
 */
export function theEntriesUnderTheSkillRoots(tree: FileTree, checkout: string, roots: readonly string[]): AnEntryUnderASkillRoot[] {
  const entries: AnEntryUnderASkillRoot[] = []
  const seen = new Set<string>()
  const visit = (path: string, below: boolean): void => {
    if (seen.has(path)) return
    seen.add(path)
    const entry = anEntryAt(tree, path)
    if (entry === undefined) return
    entries.push(entry)
    if (entry.kind !== 'folder' || !below) return
    for (const name of tree.childrenOf(path)) visit(join(path, name), true)
  }
  for (const root of roots) {
    const segments = relative(checkout, join(checkout, root)).split(sep)
    segments.forEach((_, at) => visit(join(checkout, ...segments.slice(0, at + 1)), at === segments.length - 1))
  }
  return entries
}
