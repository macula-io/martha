// The approved checkout's skills, carried into a Claude Code member's own config folder (martha#747).
//
// Raf's ruling (DECIDED 2026-11-18, "Both hosts, approved"): a member gets skills only from a checkout the owner
// approved. Claude Code reads a project's `.claude/skills` only with project settings on, and a member starts with them
// off, so the approved bytes are copied into the member's own config folder, which the host reads as user-scope skills.
// The checkout's own folder is never read by the host.
//
// What this file holds is the part of that carry the gate decides:
//   - which entries are skills of the start folder itself, the only ones carried (one in a folder above the start is
//     fingerprinted and listed as not carried, never copied);
//   - which of the start folder's skills takes one of the host's or Martha's reserved names
//     (../know_claude_codes_own_facts' RESERVED_SKILL_NAMES), said in one line and carried on (martha#601). The
//     launcher keys the carried bytes for the member's config folder (../launch_a_claude_code_member, theCarriedSkills).

import { RESERVED_SKILL_NAMES } from '../know_claude_codes_own_facts/claude_code_facts.ts'

/** Whether `path`, as an approval names it, lies below one of `folders` of the start folder itself. */
export const isBelowACarriedFolder = (path: string, folders: readonly string[]): boolean => folders.some((folder) => path.startsWith(`${folder}/`))

/**
 * The line for each entry below a carried skills folder whose skill takes a reserved name, said and then carried on
 * (martha#601): a skill hiding under a reserved name is not one of the harms a refusal is kept for. Only the start
 * folder's own skills are carried, so only they are asked.
 */
export function aSkillWithAReservedName(paths: readonly string[], folders: readonly string[], note: (line: string) => void = () => {}): void {
  for (const folder of folders) {
    const taken = paths.map((path) => (path.startsWith(`${folder}/`) ? path.slice(folder.length + 1).split('/')[0] : undefined)).find((name) => name !== undefined && RESERVED_SKILL_NAMES.includes(name))
    if (taken !== undefined) {
      note(`${folder}/${taken} uses a folder name the host or Martha's own scan of the member's skills treats as its own (${RESERVED_SKILL_NAMES.join(', ')}); keeping the skill`)
    }
  }
}
