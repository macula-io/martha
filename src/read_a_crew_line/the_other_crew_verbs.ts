// The crew lines beyond a hand-off and a verdict, read as crew-code's shorthand reads them (martha#980 package 1, a port
// of crew-code's core/shorthand.ts and the verb table of its docs/shorthand.md).
//
// This exists so every line a member sends in the crew's shorthand is read, and a line that counts as one and does not
// read is named, whatever its verb. HANDOFF and VERDICT are read by ./read_a_crew_line.ts against ./crew_lines.ts, the
// shapes the role cards teach (#253, stricter than crew-code: a full forty-hex range). The twelve verbs here are not
// taught on a card, as crew-code teaches none of them either; they are read with crew-code's own grammar:
//
//   VERB <target> [word ...] [key=value ...] [| free text]
//
// The target is a package (or several issues of one repository, `macula-io/martha#8,#11`), a name for LIVE, a package or a
// name for SCOPE, and for ASK, YES and NO a kind followed by its target. Words and keys may come in any order after it.
//
// Pure: no I/O and no import of a host.

/** Every verb crew-code's shorthand reads, in its own order (crew-code core/shorthand.ts:8-11). */
export const SHORTHAND_VERBS = ['HANDOFF', 'VERDICT', 'FIX', 'SCOPE', 'LAND', 'ASK', 'YES', 'NO', 'LIVE', 'BLOCKED', 'FILED', 'ASSIGN', 'RESTART', 'ARTIFACT'] as const

/** The kinds an ask or the owner's answer names; `design` is the one that certifies no artifact. */
export const KINDS = ['tag', 'push', 'fleet', 'install', 'delete', 'cred', 'design'] as const
const DESIGN = 'design'

/** The verbs whose second word is a kind rather than a target. */
const KIND_VERBS: readonly string[] = ['ASK', 'YES', 'NO']

/** The two keys that stand in for a range, and the two verbs they belong to. */
const STAND_INS = ['doc', 'files'] as const
const REVIEW_VERBS: readonly string[] = ['HANDOFF', 'VERDICT']

/** What one verb must carry: its required keys, at least how many words, a key one of which it needs, and its target. */
interface Rule {
  readonly keys: readonly string[]
  readonly words?: number
  readonly anyOf?: readonly string[]
  readonly target: 'package' | 'name' | 'either' | 'kind'
}

/** crew-code's rules for the twelve verbs read here (crew-code core/shorthand.ts:18-39). */
const RULES: Readonly<Record<string, Rule>> = {
  FIX: { keys: ['reviewer'], target: 'package' },
  SCOPE: { keys: [], anyOf: ['rule', 'owner'], target: 'either' },
  LAND: { keys: ['main', 'ci'], target: 'package' },
  ASK: { keys: ['ci'], words: 2, target: 'kind' },
  YES: { keys: [], words: 2, target: 'kind' },
  NO: { keys: [], words: 1, target: 'kind' },
  LIVE: { keys: ['run'], words: 1, target: 'name' },
  BLOCKED: { keys: ['on'], target: 'package' },
  FILED: { keys: [], target: 'package' },
  ASSIGN: { keys: ['brief', 'reviewer'], target: 'package' },
  RESTART: { keys: ['fresh', 'handover'], target: 'package' },
  ARTIFACT: { keys: [], target: 'package' },
}

/** The verbs read here, as a line's first word. */
export const OTHER_VERBS: readonly string[] = Object.keys(RULES)

const PACKAGE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[0-9]+$/
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$|^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const TARGET = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$|^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(#[0-9]+)?$/
const SHA = /^[0-9a-f]{7,40}$/
const FULL_SHA = /^[0-9a-f]{40}$/
const DOC = /^https?:\/\/\S+$/
const CI = /^([0-9]+(,[0-9]+)*|none:paths)$/
const ARTIFACT_LINK = /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]+$/
const ARTIFACT_ACTIONS: readonly string[] = ['read', 'publish']

/** A line of one of these verbs, read: its verb, the packages or names it is about, its words, its keys and its free text. */
export interface AShorthandLine {
  readonly verb: string
  readonly targets: readonly string[]
  readonly words: readonly string[]
  readonly keys: Readonly<Record<string, string>>
  readonly reason: string
}

/** The verb a line opens with, when it is one of the fourteen, written in capitals as every member writes it. */
const verbOf = (line: string): string | undefined => {
  const word = line.trim().split(/\s+/)[0] ?? ''
  return (SHORTHAND_VERBS as readonly string[]).includes(word) ? word : undefined
}

/**
 * The verb of a line that counts as a crew line, or undefined for a sentence (crew-code's messageVerbOf). ASK, YES and NO
 * also open sentences ("YES received and acted on"), so such a line counts only when its next word is a kind, or it
 * carries a key=value or an org/repo#n.
 */
export function crewVerbOf(line: string): string | undefined {
  const verb = verbOf(line)
  if (verb === undefined || !KIND_VERBS.includes(verb)) return verb
  const words = (line.split('|')[0] ?? '').trim().split(/\s+/).filter((word) => word !== '')
  const next = words[1]
  if (next !== undefined && (KINDS as readonly string[]).includes(next.toLowerCase())) return verb
  return words.some((word) => word.includes('=') || PACKAGE.test(word)) ? verb : undefined
}

/** A line of one of the twelve verbs read, or why it does not read. */
export function readAShorthandLine(line: string): { readonly line: AShorthandLine } | { readonly problem: string } {
  const [head = '', ...tail] = line.trim().split('|')
  const words = head.trim().split(/\s+/).filter((word) => word !== '')
  const verb = words[0] ?? ''
  const rule = RULES[verb]
  if (rule === undefined) return { problem: `${verb} is not a verb read here` }
  const first = words[1] ?? ''
  const targeted = targetsOf(verb, rule, first, words.slice(2))
  if ('problem' in targeted) return targeted
  const fields = fieldsOf(words.slice(2))
  if ('problem' in fields) return fields
  const problem = whatTheLineLacks({ verb, rule, first, args: fields.args, keys: fields.keys, design: targeted.design })
  if (problem !== undefined) return { problem }
  return { line: { verb, targets: targeted.targets, words: fields.args, keys: fields.keys, reason: tail.join('|').trim() } }
}

type Targeted = { readonly targets: readonly string[]; readonly design: boolean } | { readonly problem: string }

/** What the line is about: its packages, a name, or a kind and the target that kind names. */
function targetsOf(verb: string, rule: Rule, first: string, rest: readonly string[]): Targeted {
  if (rule.target === 'kind') return kindTargetOf(verb, first, rest)
  if (rule.target === 'either' && NAME.test(first)) return { targets: [first], design: false }
  if (rule.target === 'name') return TARGET.test(first) ? { targets: [first], design: false } : { problem: `${verb} needs a target, not "${first}"` }
  return packagesOf(verb, first)
}

/** A kind, and the thing it names: a package, a repository or a name, and for a design also the document's URL. */
function kindTargetOf(verb: string, first: string, rest: readonly string[]): Targeted {
  const kind = first.toLowerCase()
  if (!(KINDS as readonly string[]).includes(kind)) return { problem: `${verb} names no kind: "${kind}" is not ${KINDS.join(', ')}` }
  const design = kind === DESIGN
  const target = rest.find((word) => !word.includes('=')) ?? ''
  if (!TARGET.test(target) && !(design && DOC.test(target))) return { problem: `${verb} needs a target after ${first}, not "${target}"` }
  return { targets: [target], design }
}

/** A package, or several issues of one repository, `macula-io/martha#8,#11`, one package per issue. */
function packagesOf(verb: string, word: string): Targeted {
  const [first = '', ...rest] = word.split(',')
  if (!PACKAGE.test(first)) return { problem: `${verb} needs a package as org/repo#n, not "${word}"` }
  if (rest.some((item) => item.includes('/'))) return { problem: `${verb} needs one line per repo: "${word}" names more than one` }
  const wrong = rest.find((item) => !/^#[0-9]+$/.test(item))
  if (wrong !== undefined) return { problem: `${verb} lists a repository's issues as #n, not "${wrong}"` }
  const base = first.slice(0, first.indexOf('#') + 1)
  return { targets: [first, ...rest.map((item) => `${base}${item.slice(1)}`)], design: false }
}

/** The words after the target, split into bare words and keys; a key named twice is a problem. */
function fieldsOf(rest: readonly string[]): { readonly args: readonly string[]; readonly keys: Readonly<Record<string, string>> } | { readonly problem: string } {
  const args: string[] = []
  const keys: Record<string, string> = {}
  for (const word of rest) {
    const at = word.indexOf('=')
    if (at <= 0) {
      args.push(word)
      continue
    }
    const key = word.slice(0, at)
    if (Object.hasOwn(keys, key)) return { problem: `${key}= more than once: name each key once` }
    keys[key] = word.slice(at + 1)
  }
  return { args, keys }
}

interface TheLine {
  readonly verb: string
  readonly rule: Rule
  readonly first: string
  readonly args: readonly string[]
  readonly keys: Readonly<Record<string, string>>
  readonly design: boolean
}

/** The first thing the line lacks, in the order a writer reads it; undefined when it lacks nothing. */
function whatTheLineLacks(at: TheLine): string | undefined {
  return standInProblem(at) ?? artifactProblem(at) ?? wordsProblem(at) ?? missingKeyProblem(at) ?? anyOfProblem(at) ?? keyShapeProblem(at.keys) ?? yesShaProblem(at)
}

/** `doc=` and `files=` stand in for a range on a review only. */
const standInProblem = (at: TheLine): string | undefined => {
  const named = STAND_INS.find((key) => (at.keys[key] ?? '') !== '')
  return named === undefined ? undefined : `${named}= is only for a review (${REVIEW_VERBS.join(', ')}), not ${at.verb}`
}

/** An Artifact handed on names read or publish, an absolute file, and for a read the page's claude.ai link. */
function artifactProblem(at: TheLine): string | undefined {
  if (at.verb !== 'ARTIFACT') return undefined
  const action = (at.args[0] ?? '').toLowerCase()
  if (at.args.length !== 1 || !ARTIFACT_ACTIONS.includes(action)) return `ARTIFACT needs read or publish after ${at.first}`
  return artifactFileProblem(at.keys['file'] ?? '') ?? artifactUrlProblem(action, at.keys['url'] ?? '')
}

/** The file an Artifact is read from or saved to: absolute, with no `..` segment. */
function artifactFileProblem(file: string): string | undefined {
  if (file === '') return 'file is missing'
  return file.startsWith('/') && !file.split('/').includes('..') ? undefined : `file must be an absolute path with no .. segment, not "${file}"`
}

/** The page an Artifact read names, as a claude.ai artifact link; a publish may name none. */
function artifactUrlProblem(action: string, url: string): string | undefined {
  if (url === '') return action === 'read' ? 'url is missing' : undefined
  return ARTIFACT_LINK.test(url) ? undefined : `url must be a claude.ai artifact link, not "${url}"`
}

const wordsProblem = (at: TheLine): string | undefined =>
  at.rule.words !== undefined && at.args.length < at.rule.words && !at.design ? `${at.verb} needs ${String(at.rule.words)} word(s) after ${at.first}, not ${String(at.args.length)}` : undefined

/** A design ruling points at no CI run, so `ci=` is not required for one. */
const missingKeyProblem = (at: TheLine): string | undefined => {
  const missing = at.rule.keys.find((key) => (at.keys[key] ?? '') === '' && !(at.design && key === 'ci'))
  return missing === undefined ? undefined : `${missing} is missing`
}

const anyOfProblem = (at: TheLine): string | undefined => {
  const anyOf = at.rule.anyOf
  if (anyOf === undefined || anyOf.some((key) => (at.keys[key] ?? '') !== '')) return undefined
  return `${anyOf.join(' or ')} is missing`
}

/** The shapes a reader relies on: a landing names a sha, ci names run ids, and an owner's ruling is yes or no. */
function keyShapeProblem(keys: Readonly<Record<string, string>>): string | undefined {
  const owner = keys['owner']
  if (owner !== undefined && owner !== 'yes' && owner !== 'no') return `owner must be yes or no, not "${owner}"`
  const main = keys['main']
  if (main !== undefined && !SHA.test(main)) return `main must be a sha, not "${main}"`
  const ci = keys['ci']
  if (ci !== undefined && !CI.test(ci)) return `ci must be run id(s) or none:paths, not "${ci}"`
  return undefined
}

/** YES carries the owner's answer about one exact thing, so it names a full sha; a design ruling names none. */
const yesShaProblem = (at: TheLine): string | undefined => {
  if (at.verb !== 'YES' || at.design) return undefined
  return FULL_SHA.test((at.args.at(-1) ?? '').replace(/^@/, '')) ? undefined : 'a full 40-character sha is missing'
}
