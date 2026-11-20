// How the crew confines what its members run (martha#989, gap 21 of #957): the one CPU ceiling its members share, the
// ceiling each member has of its own, and the systemd-only session bus a member reaches instead of the owner's desktop.
//
// This is crew-code's own rule ported, with no rule added (Raf 2026-11-20 on scope): the slice and its quotas
// (`systemd/crew.slice`, `bin/crew`'s install_crew_slice and in_crew_slice), and the bus its `bin/open-systemd-only-bus`
// opens. Linux only (DECIDED 2026-11-19 "we build for linux, not windows or macOS").
//
// It guards against a member that runs away, never against a hostile one: a member runs as the owner's OS user. The
// threat model and the residual risks are on martha#989, and the launch's header repeats them where the code is.
//
// Every value is the declaration's (DECIDED 2026-11-20 "i think `martha` should be fully config driven"): nothing here
// carries a number crew-code chose, and `martha init` writes those into the file it makes. What is not the
// declaration's is the control itself: `--filter` and `--talk=org.freedesktop.systemd1` are constants of the bus the
// launch opens, never fields, because "systemd and nothing else" is what the control is.

/** The declaration's key, top level: a crew that names none confines nothing, as it does today. */
export const CONFINEMENT = 'confinement'

/** The fields the block holds: the slice, its two values, a member's two, and the bus. */
export const CONFINEMENT_REQUIRED_KEYS = ['slice', 'slice_cpu_quota', 'slice_cpu_weight', 'member_cpu_quota', 'member_cpu_weight', 'systemd_only_bus'] as const

/** The two fields of the `systemd_only_bus` block: the unit Martha runs and the socket it serves. */
export const SYSTEMD_ONLY_BUS_REQUIRED_KEYS = ['unit', 'socket'] as const

/**
 * A quota as systemd reads one: a whole percentage of one CPU, one percent or more, written with its `%`. Zero is not
 * one: a slice with no share is a slice systemd would read as unspecified.
 */
export const A_CPU_QUOTA = /^[1-9][0-9]*%$/

/** systemd's own range for `CPUWeight`, both ends included. */
export const SYSTEMD_WEIGHT_LEAST = 1
export const SYSTEMD_WEIGHT_MOST = 10000

/** The characters a systemd unit's name is made of (systemd.unit(5)), its one punctuation and no whitespace. */
const UNIT_NAME_CHARACTERS = /^[A-Za-z0-9:_.\\-]+$/

/**
 * A slice's name: a unit's name, ending `.slice`. A name that does not is refused rather than repaired, because
 * `--slice=` with another suffix is a unit systemd refuses at the launch, where the refusal would name nothing Martha
 * knows.
 */
export const A_SLICE_NAME = /^[A-Za-z0-9:_.\\-]+\.slice$/

/** The suffix Martha appends to the bus unit's name: the declaration names the unit, never its type. */
export const A_SERVICE_SUFFIX = '.service'

/**
 * The socket a member's `DBUS_SESSION_BUS_ADDRESS` names: a bare file name, joined under `$XDG_RUNTIME_DIR` by the
 * launch and never a path, so a declared name cannot remove or point at a file outside the runtime directory.
 */
export const aSocketNameRefused = (name: string): string | undefined =>
  name === '' || name === '.' || name === '..' || name.includes('/') ? 'is not a bare file name (no "/", not empty, not "." or "..")' : undefined

/** How a field of the block is refused: the field, and why. */
export type RefuseAConfinement = (field: string, why: string) => never

/** How a field the block does not know is said and read past (martha#601): the field, and why. */
export type SayOfAConfinement = (field: string, why: string) => void

/**
 * The crew's confinement, as the declaration names it: the slice every member and everything it starts runs under, the
 * two values of that slice, the two of each member's own scope, and the systemd-only bus a member is given.
 */
export interface AConfinement {
  readonly slice: string
  readonly slice_cpu_quota: string
  readonly slice_cpu_weight: number
  readonly member_cpu_quota: string
  readonly member_cpu_weight: number
  readonly systemd_only_bus: {
    /** The unit Martha starts, as a unit's name without its `.service`. */
    readonly unit: string
    /** The socket it serves, as a bare file name under `$XDG_RUNTIME_DIR`. */
    readonly socket: string
  }
}

/**
 * crew-code's own values, as `martha init` writes them (martha#989): its `systemd/crew.slice` ceiling of 2400% at weight
 * 50, a member's scope of 400% at 50 (`core/crew_declaration.ts`'s defaults), and the bus unit the lab host already
 * runs for its CI runners (`ci-systemd-bus.service`, which serves `$XDG_RUNTIME_DIR/ci-systemd-bus`).
 */
export const CONFINEMENT_THAT_INIT_WRITES: AConfinement = {
  slice: 'crew.slice',
  slice_cpu_quota: '2400%',
  slice_cpu_weight: 50,
  member_cpu_quota: '400%',
  member_cpu_weight: 50,
  systemd_only_bus: { unit: 'ci-systemd-bus', socket: 'ci-systemd-bus' },
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** A weight as systemd reads one, or why the value is not one. */
const aWeightRefused = (value: unknown): string | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= SYSTEMD_WEIGHT_LEAST && value <= SYSTEMD_WEIGHT_MOST
    ? undefined
    : `is not a whole number from ${String(SYSTEMD_WEIGHT_LEAST)} to ${String(SYSTEMD_WEIGHT_MOST)}, as systemd reads one`

/** A text field, or why the value is not one. */
const aTextRefused = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? undefined : 'is not a name')

/**
 * The crew's confinement as the declaration names it, or null when it names none: a block with all six fields, each
 * refused by its own name when it is not one Martha can hand systemd. A block naming only some is refused naming the
 * first field it leaves out, because a ceiling half declared is a ceiling nobody can read.
 */
export function theConfinementOf(refuse: RefuseAConfinement, value: unknown, say: SayOfAConfinement = () => {}): AConfinement | null {
  if (value === undefined) return null
  if (!isObject(value)) return refuse(CONFINEMENT, `is not an object with ${CONFINEMENT_REQUIRED_KEYS.join(', ')}`)
  for (const key of Object.keys(value)) {
    if (!(CONFINEMENT_REQUIRED_KEYS as readonly string[]).includes(key)) say(`${CONFINEMENT}.${key}`, `is not a field here (they are ${CONFINEMENT_REQUIRED_KEYS.join(', ')}); ignoring it`)
  }
  const at = (key: string): string => `${CONFINEMENT}.${key}`
  const fields = CONFINEMENT_REQUIRED_KEYS.filter((key) => value[key] === undefined)
  if (fields.length > 0) refuse(at(fields[0] as string), `is required when ${CONFINEMENT} is declared (it holds ${CONFINEMENT_REQUIRED_KEYS.join(', ')})`)
  return {
    slice: aSliceOf(refuse, at('slice'), value['slice']),
    slice_cpu_quota: aQuotaOf(refuse, at('slice_cpu_quota'), value['slice_cpu_quota']),
    slice_cpu_weight: aWeightOf(refuse, at('slice_cpu_weight'), value['slice_cpu_weight']),
    member_cpu_quota: aQuotaOf(refuse, at('member_cpu_quota'), value['member_cpu_quota']),
    member_cpu_weight: aWeightOf(refuse, at('member_cpu_weight'), value['member_cpu_weight']),
    systemd_only_bus: theBusOf(refuse, at('systemd_only_bus'), value['systemd_only_bus']),
  }
}

/** The slice's name, or the refusal naming the field. */
function aSliceOf(refuse: RefuseAConfinement, field: string, value: unknown): string {
  const why = aTextRefused(value) ?? (A_SLICE_NAME.test(value as string) ? undefined : 'is not a slice\'s name (a unit name ending ".slice")')
  return why === undefined ? (value as string) : refuse(field, why)
}

/** A quota, or the refusal naming the field. */
function aQuotaOf(refuse: RefuseAConfinement, field: string, value: unknown): string {
  const why = aTextRefused(value) ?? (A_CPU_QUOTA.test(value as string) ? undefined : 'is not a CPU quota (a whole percentage, one or more, written with its "%")')
  return why === undefined ? (value as string) : refuse(field, why)
}

/** A weight, or the refusal naming the field. */
function aWeightOf(refuse: RefuseAConfinement, field: string, value: unknown): number {
  const why = aWeightRefused(value)
  return why === undefined ? (value as number) : refuse(field, why)
}

/** The bus's unit and socket, each refused by its own name under the block's. */
function theBusOf(refuse: RefuseAConfinement, field: string, value: unknown): AConfinement['systemd_only_bus'] {
  if (!isObject(value)) return refuse(field, `is not an object with ${SYSTEMD_ONLY_BUS_REQUIRED_KEYS.join(', ')}`)
  const gone = SYSTEMD_ONLY_BUS_REQUIRED_KEYS.filter((key) => value[key] === undefined)
  if (gone.length > 0) refuse(`${field}.${gone[0] as string}`, `is required (the block holds ${SYSTEMD_ONLY_BUS_REQUIRED_KEYS.join(', ')})`)
  return {
    unit: aUnitOf(refuse, `${field}.unit`, value['unit']),
    socket: aSocketOf(refuse, `${field}.socket`, value['socket']),
  }
}

/** The bus unit's name, without its type: Martha appends `.service` itself. */
function aUnitOf(refuse: RefuseAConfinement, field: string, value: unknown): string {
  if (typeof value !== 'string' || value === '') return refuse(field, 'is not a name')
  if (!UNIT_NAME_CHARACTERS.test(value)) return refuse(field, 'is not a unit\'s name (letters, digits, and : _ . \\ - only)')
  if (value.endsWith(A_SERVICE_SUFFIX)) return refuse(field, `is named with its ${A_SERVICE_SUFFIX}, which Martha adds: name the unit alone`)
  return value
}

/** The socket's name: a bare file name the launch joins under `$XDG_RUNTIME_DIR`. */
function aSocketOf(refuse: RefuseAConfinement, field: string, value: unknown): string {
  if (typeof value !== 'string') return refuse(field, 'is not a name')
  const why = aSocketNameRefused(value)
  return why === undefined ? value : refuse(field, why)
}
