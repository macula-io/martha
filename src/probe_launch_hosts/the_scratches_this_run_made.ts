// The scratches one probe:launch run made, and the project folders its runs could not take away
// (martha#179). The runner and the memory rows both write here, so neither imports the other (martha#443).

import { projectKeyOf, whatIsStillLeftAtTheEnd, type ProjectFoldersBefore } from './the_project_folders_a_run_wrote.ts'

/**
 * The key prefix of each scratch this run made, as the host names the folder for it.
 * One per scratch, because a scratch is realpath'd when it is made and a TMPDIR
 * reached through a link (the CI's own) keys the folder by the path it leads to.
 *
 * Only a scratch this run made goes in here: the set is what the last row removes
 * by, and a generic name such as `<tmpdir>/martha-probe-` would also take away the
 * folders of another probe:launch running at the same time against the same config
 * dir (martha#179 r=2). The two places that make a scratch are the two that add.
 */
const theScratchPrefixes = new Set<string>()

/**
 * Registers one scratch this run made: the only way a name gets into what the last row
 * removes by. Exported because a test plays this run with a scratch of its own, and then
 * plants another run's folder beside it.
 */
export function aScratchThisRunMade(scratch: string): void {
  theScratchPrefixes.add(projectKeyOf(scratch))
}

/**
 * The whole of what the run left, read once at the end by the two facts this file
 * owns: the scratches it registered, and what its runs could not take away. A test
 * calls this with another run's folders planted, which is how the removal is held to
 * this run's own folders and not to a name every probe's folder starts with.
 */
export function whatThisRunLeftAtTheEnd(startedWith: ProjectFoldersBefore): readonly string[] {
  return whatIsStillLeftAtTheEnd(startedWith, theScratchPrefixes, leftBehindByARun)
}

/**
 * Every project folder a run wrote and could not take away (martha#179): what the
 * last row reports by name, together with what a read at the end still finds.
 */
export const leftBehindByARun: string[] = []
