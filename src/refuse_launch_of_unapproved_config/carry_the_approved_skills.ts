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
//   - the names a skill may not take: `synced`, which the host's skills loader reserves for the account's synced
//     skills, and `.trash`, which Martha's own scan of a member's skills (martha#146, martha#243) reads by the markdown
//     loader's rules. A copied skill under either would be read differently from the way the owner approved it;
//   - the carried bytes, keyed below the skills folder, as the member's config folder takes them.

import { SKILLS_KIND, SYNCED_SKILLS_FOLDER, TRASH_FOLDER } from '../load_the_hosts_markdown/the_skills_folders.ts'
import { CLAUDE_FOLDER } from '../know_claude_codes_own_facts/claude_code_facts.ts'

/** The skills folder of a Claude Code checkout, as the gate lists it and the approval names its files. */
export const CLAUDE_SKILLS = `${CLAUDE_FOLDER}/${SKILLS_KIND}`

/** The folder names a checkout's skill may not take, because the host or Martha's own scan reads them as their own. */
export const RESERVED_SKILL_NAMES: readonly string[] = [SYNCED_SKILLS_FOLDER, TRASH_FOLDER]

/** Whether `path`, as an approval names it, lies below one of `folders` of the start folder itself. */
export const isBelowACarriedFolder = (path: string, folders: readonly string[]): boolean => folders.some((folder) => path.startsWith(`${folder}/`))

/**
 * The refusal for the first entry below a carried skills folder whose skill takes a reserved name, or undefined. Only
 * the start folder's own skills are carried, so only they are asked.
 */
export function aSkillWithAReservedName(paths: readonly string[], folders: readonly string[]): string | undefined {
  for (const folder of folders) {
    const taken = paths.map((path) => (path.startsWith(`${folder}/`) ? path.slice(folder.length + 1).split('/')[0] : undefined)).find((name) => name !== undefined && RESERVED_SKILL_NAMES.includes(name))
    if (taken !== undefined) {
      return `${folder}/${taken} uses a folder name the host or Martha's own scan of the member's skills treats as its own (${RESERVED_SKILL_NAMES.join(', ')}); rename the skill.`
    }
  }
  return undefined
}

/** The carried skill files, keyed by their path below the skills folder: what the member's config folder writes under `skills/`. */
export function theCarriedSkills(carried_files: Readonly<Record<string, Uint8Array>>): Readonly<Record<string, Uint8Array>> {
  return Object.fromEntries(
    Object.entries(carried_files)
      .filter(([path]) => isBelowACarriedFolder(path, [CLAUDE_SKILLS]))
      .map(([path, bytes]) => [path.slice(CLAUDE_SKILLS.length + 1), bytes]),
  )
}
