// The names of the skills folder and of the two folders the host and Martha read inside it by rules of their own.
//
// They live in a file that imports nothing, because both the owner's-markdown reader (./hooks_and_plugins_the_owner_declares.ts)
// and the launch gate's carry of a checkout's skills (martha#747) read them, and the reader reaches the gate through
// the recording's module: one file of names keeps the two from loading each other in a loop.

/** The folder under the owner's skills folder that Claude Code fills from their Claude account (martha#243). */
export const SYNCED_SKILLS_FOLDER = 'synced'

/** The kind of the owner's markdown the host syncs into: the recording names it, and a test fails if it stops. */
export const SKILLS_KIND = 'skills'

/** The folder the host moves skills it no longer runs into. It loads a SKILL.md directly in it, and nothing below an entry (martha#243). */
export const TRASH_FOLDER = '.trash'
