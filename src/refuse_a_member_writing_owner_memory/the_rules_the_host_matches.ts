/**
 * The permission rules Martha hands the host, and how they are read back from it (martha#136, martha#226). They are
 * built in ../../refuse_a_member_writing_owner_memory and spelled for the host there; this file holds the two rules
 * that are about the host's own answer — what it is started with, and what it says about a rule it never matched —
 * so that file stays under the line cap the owner set in the linter.
 */

import { NOT_MATCHED_MARK } from '../claude_code_host/file_permission_rules.ts'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The lines of what a host printed about `rules` — one per rule of this repository's the host says it never matches
 * (martha#226).
 *
 * The host says in its own words which rules its file permission checks never match, on the terminal at a session's
 * start and on the standard error of a run that is not a terminal. A rule it names there is a rule that does nothing,
 * so the launch reads this before it starts a member and refuses rather than run with a place it believes closed.
 * Each line is read for the rule it is about — the one it names as the rule it read, which is what a rule of ours has
 * to be — and never for one it merely quotes: the host's complaint ends with the rule to write instead, so a dead rule
 * in the owner's own settings quotes the very spelling this launch writes, and that is the owner's rule and not one of
 * ours (martha#226 r=1). One rule is one fault: the host prints a complaint more than once, and the first line about a
 * rule is kept.
 */
export function hostLinesNamingARule(printed: string, rules: readonly string[]): string[] {
  const about = new Map<string, string>()
  for (const line of printed.split('\n').map((one) => one.trim()).filter((one) => one !== '')) {
    const rule = theRuleTheLineIsAbout(line)
    if (rule === undefined || !rules.includes(rule) || about.has(rule)) continue
    about.set(rule, line)
  }
  return [...about.values()]
}

/**
 * The rule a host's line is about: the one it names after the settings file it read, which is the subject of the
 * complaint (martha#226 r=1). The host writes `Permission deny rule (<file>): <rule> is not matched …` and then the
 * rule to write instead, so the subject has to be cut out rather than searched for. A line that names no such rule is
 * no complaint about one. The wording is the recording's own (NOT_MATCHED_MARK), never retyped here: a host that
 * rewords the complaint fails the recording before it can be read wrongly here.
 */
const THE_RULE_A_LINE_IS_ABOUT = new RegExp(`\\): (.+?) ${NOT_MATCHED_MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
const theRuleTheLineIsAbout = (line: string): string | undefined => THE_RULE_A_LINE_IS_ABOUT.exec(line)?.[1]?.trim()


/**
 * The settings the host is started with: the approved copy, or none, with
 * `rules` added to its `permissions.deny` after the rules it already has; or
 * why it cannot be, naming `name`. Every other key is kept as approved.
 */
export function settingsWithMemoryDenied(approved: string | undefined, rules: readonly string[], name: string): { readonly text: string } | { readonly refusal: string } {
  let settings: unknown = {}
  try {
    if (approved !== undefined) settings = JSON.parse(approved)
  } catch {
    return { refusal: `${name} is not JSON, so the rules that keep a member out of the owner's memory cannot be added to it (martha#136)` }
  }
  if (!isRecord(settings)) return { refusal: `${name} is not a JSON object, so the rules that keep a member out of the owner's memory cannot be added to it (martha#136)` }
  const permissions = settings.permissions ?? {}
  if (!isRecord(permissions)) return { refusal: `${name} has a permissions that is not an object, so the rules that keep a member out of the owner's memory cannot be added to it (martha#136)` }
  const deny = permissions.deny ?? []
  if (!Array.isArray(deny)) return { refusal: `${name} has a permissions.deny that is not a list, so the rules that keep a member out of the owner's memory cannot be added to it (martha#136)` }
  return { text: JSON.stringify({ ...settings, permissions: { ...permissions, deny: [...(deny as unknown[]), ...rules] } }) }
}
