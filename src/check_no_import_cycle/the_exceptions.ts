// The loops of value imports the repository is allowed to keep, each with why and with what untangles it (martha#525).
//
// Main has none: the list below is empty, and it is here because the mechanism is the decision, not the entries. A loop
// fails the check unless it is declared here, and it is declared by the whole group of files that load each other, so
// a second loop among the same files cannot hide behind the first one's entry. An entry that excuses nothing is itself
// a finding: a list that has stopped matching the tree says nothing true about it, and a loop that has been untangled
// but is still written here would excuse the next one that lands on the same files.
//
// There is no silent baseline. A loop that appears in a change fails that change, and it is untangled there or declared
// here with the package that untangles it.

/** One group of files that load each other, allowed until the package that untangles it lands. */
export interface DeclaredCycle {
  /** The files of the loop, sorted, relative to the repository, as the check prints them. */
  readonly files: readonly string[]
  /** Why the loop stands. */
  readonly reason: string
  /** The issue or PR that untangles it. */
  readonly removed_by: string
}

/** Every loop of value imports the repository may keep. None today: a loop that lands is a finding. */
export const EXCEPTIONS: readonly DeclaredCycle[] = []
