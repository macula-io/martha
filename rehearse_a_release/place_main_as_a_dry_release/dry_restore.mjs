// dry_restore.mjs: the subject the dry packer's own commit carries, in one place for the three readers that refuse it
// (martha#695, option A).
//
// The dry packer clones main into a throwaway folder and, when main's installer/ has moved past the tag its version was
// published at, makes one commit there restoring installer/ from that tag: only then can the release's pin pass, and it
// pins the published installer with its provenance, which is the truth. That commit must never reach a release. It is
// marked by this subject, and two things look for the mark: the release workflow's own step
// (pack_a_release/refuse_a_dry_restore_tag.sh), which refuses a tag whose history holds a commit carrying it, and the
// check that no script the release runs restores installer/ from another ref
// (prove_the_core/no_restore_reaches_the_release.node-test.ts). The packer reads this constant; nothing spells it twice.

/** The subject of the dry packer's commit, and the one mark a dry commit can be recognised by. */
export const DRY_RESTORE_SUBJECT = 'dry: installer/ restored from its tag, in a dry run\'s own clone'

/**
 * What main's installer must agree with its tag on, for the restore to be honest: the names the release packer reads
 * from installer/package.json. A tree whose names differ cannot be packed as a release at all.
 */
export const NAMES_A_RELEASE_READS = Object.freeze(['sourceRepository', 'command', 'releaseFolder', 'pinFile'])
