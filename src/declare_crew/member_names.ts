// The one rule a member's name is compared by (martha#528), owned by the declaration that makes member names.
//
// It sits in a file of its own, importing nothing, so ../read_the_gate_mode (which ./declare_crew.ts imports) can use it
// without a cycle; every other slice imports it from ./declare_crew.ts.

/**
 * The one rule a member's name is compared by, everywhere in the tree (martha#528): case-folded, with the spaces around
 * it dropped. Terra and terra would share branches and a mailbox, so they are one member; a declared name holds no
 * space (./declare_crew.ts's MEMBER_NAME), so dropping them changes no declared name, and a name read from a row, a
 * label or a line with a stray space still finds its member. Every slice that compares two member names imports this; a case fold
 * anywhere else in the tree is named by prove_the_core's one_place_folds_a_member_name.
 */
export const memberNameKey = (name: string): string => name.trim().toLowerCase()

/** Whether two spellings name the same member, by the one rule above. */
export const sameMemberName = (one: string, other: string): boolean => memberNameKey(one) === memberNameKey(other)
