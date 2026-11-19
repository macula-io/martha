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
// A pure decision over what a walk handed it: the walk itself reads the machine and is not here.

import { sep } from 'node:path'

/** One entry the walk found under a skill root, the root itself included, read without following a link. */
export type AnEntryUnderASkillRoot =
  /** A link, and the real path it leads to, or undefined when it leads nowhere that can be told. */
  | { readonly kind: 'link'; readonly path: string; readonly leads_to: string | undefined }
  /** A regular file, and how many hard links it has. */
  | { readonly kind: 'file'; readonly path: string; readonly hard_links: number }
  /** A folder. */
  | { readonly kind: 'folder'; readonly path: string }

/** Whether `path` is `folder` or inside it, both real paths; a trailing separator on either is not part of the place. */
function isWithin(path: string, folder: string): boolean {
  const trimmed = (place: string): string => (place.length > sep.length && place.endsWith(sep) ? place.slice(0, -sep.length) : place)
  const [at, within] = [trimmed(path), trimmed(folder)]
  return at === within || at.startsWith(within === sep ? within : `${within}${sep}`)
}

/**
 * Why something under the checkout's skill roots could hand `load_skill` text from outside the checkout, naming the
 * first such entry, or undefined when nothing could. `checkout` is the checkout's real path.
 */
export function whyALoadedSkillCouldLeaveTheCheckout(checkout: string, entries: readonly AnEntryUnderASkillRoot[]): string | undefined {
  for (const entry of entries) {
    if (entry.kind === 'link' && (entry.leads_to === undefined || !isWithin(entry.leads_to, checkout))) {
      return `${entry.path} is a link to ${entry.leads_to ?? 'a place that cannot be told'}, outside the checkout ${checkout}: a skill loaded through it would be taken in as the checkout's own file (martha#614 slice 3)`
    }
    if (entry.kind === 'file' && entry.hard_links > 1) {
      return `${entry.path} has ${String(entry.hard_links)} hard links: its bytes may be a file from outside the checkout ${checkout}, and a skill loaded from it would be taken in as the checkout's own file (martha#614 slice 3)`
    }
  }
  return undefined
}
