// What the gate does to one member (martha#321).
//
// This exists so an owner can watch the gate on one member at a time before trusting it everywhere: a member is
// refused (enforced), or its calls run while each refusal the gate would have given is written down for the owner
// (audited), or the gate does nothing to it at all (off).
//
// Why this is a slice of its own. The reading is a decision, and a decision belongs beside the other decisions rather
// than inside the launcher or the command that asks for it (../run_the_martha_command is an adapter with a line
// ceiling). ../declare_crew parses the declaration and hands the raw fields here; the launcher and the audit ask this
// for one member's mode.
//
// THE ONE READING THAT MATTERS. Absent means OFF, and off is a state of its own:
//
//   no house_rules, no gate_enforces, no strict_gate   → off
//   strict_gate: false, and no gate_enforces           → off
//   strict_gate: true, and no gate_enforces            → enforced, every member
//   gate_enforces: 'all'                               → enforced, every member
//   gate_enforces: 'nobody'                            → audited, every member
//   gate_enforces: [names…]                            → enforced for those named, every other member off
//   gate_audits:   [names…]                            → audited for those named, every other member off
//
// Audited is the only mode that can refuse a call for a reason the owner never named — its own audit line failing to
// write (see ../audit_the_gate_for_a_member). So audited is never a fallback: falling back to it on a missing or
// misspelt field would hand an owner who never asked for the gate a mode that can stop their member. Off is the only
// safe default, and it is the one macula-io/martha#259 already chose ("the strict shell gate is off unless the owner
// names it"), so a crew declared by an earlier release keeps the shell it has.
//
// `strict_gate` is read for one upgrade and writes nothing (martha#374's lesson: a file an earlier release wrote must
// keep declaring after an upgrade). It is not a second switch beside the new fields — when `gate_enforces` names a
// mode, that is the mode, and `strict_gate` is not consulted.

/** The field that names who the gate enforces for: `all`, `nobody`, or members' names. */
export const GATE_ENFORCES = 'gate_enforces'

/** The field that names who the gate audits: members' names. */
export const GATE_AUDITS = 'gate_audits'

/** What the gate does to a member. */
export type GateMode = 'off' | 'audited' | 'enforced'

/** A word that stands for every member rather than naming one. */
export type EveryMember = 'all' | 'nobody'

export const EVERY_MEMBER: readonly EveryMember[] = ['all', 'nobody']

/**
 * The gate as the declaration asked for it, read once and free of the declaration's shape.
 *
 * `named` is the only shape that keeps the owner's own list: the members it enforced and the members it audited are
 * separate lists, so a member in neither is off. That is crew-code's departure this package makes on purpose
 * (martha#321's design, question 2): there, a list makes every unnamed member audited; here, auditing is asked for by
 * name.
 */
export type GateSetting =
  | { readonly kind: 'off' }
  | { readonly kind: 'every-member'; readonly mode: 'audited' | 'enforced' }
  | { readonly kind: 'named'; readonly enforced: readonly string[]; readonly audited: readonly string[] }

/** Why a declaration's gate fields are not a setting: the field and the reason, for the caller to name the file. */
export interface GateRefused {
  readonly refused: true
  readonly field: string
  readonly why: string
}

export interface GateAsked {
  readonly refused: false
  readonly setting: GateSetting
}

/**
 * Read the gate's fields into one setting, or say which field is wrong.
 *
 * `members` is the crew's declared names, because a name the declaration does not know cannot be a member the gate
 * enforces for: it would be a rule nothing could ever match, and the owner reading it would think somebody was held.
 */
export function gateSettingOf(
  houseRules: Readonly<Record<string, unknown>> | undefined,
  members: readonly string[],
): GateSetting | GateRefused {
  const enforced = houseRules?.[GATE_ENFORCES]
  const audited = houseRules?.[GATE_AUDITS]
  if (enforced === undefined) return withoutTheNewFields(houseRules, audited, members)
  // One word for the whole crew cannot stand beside a list that names some of them: the two would disagree the first
  // time a name in the list was also covered by the word.
  if (audited !== undefined && (enforced === 'all' || enforced === 'nobody')) {
    return refuse(GATE_AUDITS, `is named beside ${GATE_ENFORCES}: ${String(enforced)}, which already speaks for every member`)
  }
  return enforcedOf(enforced, audited, members)
}

/**
 * The reading for a declaration that names no `gate_enforces`: `gate_audits` alone, else the old `strict_gate`
 * boolean, else off. Nothing here turns the gate on that the file did not ask for.
 */
function withoutTheNewFields(
  houseRules: Readonly<Record<string, unknown>> | undefined,
  audited: unknown,
  members: readonly string[],
): GateSetting | GateRefused {
  if (audited !== undefined) return namedOf([], audited, members)
  // The one upgrade reading: an old file's boolean still declares, and `true` is the owner asking for the gate.
  return houseRules?.['strict_gate'] === true
    ? { kind: 'every-member', mode: 'enforced' }
    : { kind: 'off' }
}

function enforcedOf(value: unknown, audited: unknown, members: readonly string[]): GateSetting | GateRefused {
  if (value === 'all') return { kind: 'every-member', mode: 'enforced' }
  // `nobody` is crew-code's name for "refuse nobody, watch everybody", and it is audited, never off.
  if (value === 'nobody') return { kind: 'every-member', mode: 'audited' }
  if (!Array.isArray(value)) return refuse(GATE_ENFORCES, 'is not "all", "nobody", or a list of member names')
  const enforced = namesOf(value, GATE_ENFORCES, members)
  if ('refused' in enforced) return enforced
  return audited === undefined
    ? { kind: 'named', enforced: enforced.names, audited: [] }
    : namedOf(enforced.names, audited, members)
}

function namedOf(enforcedList: readonly string[], audited: unknown, members: readonly string[]): GateSetting | GateRefused {
  if (!Array.isArray(audited)) return refuse(GATE_AUDITS, 'is not a list of member names')
  const auditedNames = namesOf(audited, GATE_AUDITS, members)
  if ('refused' in auditedNames) return auditedNames
  const both = enforcedList.find((name) => auditedNames.names.includes(name))
  if (both !== undefined) {
    return refuse(GATE_AUDITS, `names ${both}, who is also in ${GATE_ENFORCES}: a member is enforced or audited, never both`)
  }
  return { kind: 'named', enforced: enforcedList, audited: auditedNames.names }
}

/** A list of member names, each one the declaration knows, or the field and the name that is not. */
function namesOf(value: readonly unknown[], field: string, members: readonly string[]): { readonly names: string[] } | GateRefused {
  const names: string[] = []
  for (const [index, name] of value.entries()) {
    if (typeof name !== 'string' || name.trim() === '') return refuse(`${field}[${index}]`, 'is not a member name')
    const known = members.find((member) => member.toLowerCase() === name.toLowerCase())
    if (known === undefined) return refuse(`${field}[${index}]`, `names ${name}, who is not a member of this crew`)
    if (names.some((seen) => seen.toLowerCase() === known.toLowerCase())) {
      return refuse(`${field}[${index}]`, `names ${name} twice (names are compared ignoring case)`)
    }
    names.push(known)
  }
  if (names.length === 0) return refuse(field, 'names nobody: leave the field out for off, or name a member')
  return { names }
}

const refuse = (field: string, why: string): GateRefused => ({ refused: true, field, why })

/**
 * What the gate does to `member`: off, audited, or enforced.
 *
 * A member's mode is read from the setting alone, never from whether the member happens to hold anything: the audit
 * writes its line before the call, and a mode that changed with the record could not be read back afterwards.
 */
export function gateModeFor(setting: GateSetting, member: string): GateMode {
  if (setting.kind === 'off') return 'off'
  if (setting.kind === 'every-member') return setting.mode
  const folded = member.toLowerCase()
  const holds = (names: readonly string[]): boolean => names.some((name) => name.toLowerCase() === folded)
  if (holds(setting.enforced)) return 'enforced'
  // A member named in neither is OFF, not audited: auditing is asked for by name (martha#321, question 2).
  return holds(setting.audited) ? 'audited' : 'off'
}

/** The mode a setting gives every member, when it is one word for the whole crew; null when it names members. */
export function everyMembersMode(setting: GateSetting): GateMode | null {
  if (setting.kind === 'every-member') return setting.mode
  return setting.kind === 'off' ? 'off' : null
}
