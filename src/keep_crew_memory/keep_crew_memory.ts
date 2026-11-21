// Crew memory (martha#1016, design and threat model M1-M7 on issuecomment-7054673284): a team crew's members keep short
// notes in mcl-rag, the mesh's shared memory, and recall what another member kept. A port of crew-code's
// keep_crew_memory/memory.ts (macula-sponsors 6f353d51), under Martha's own tool names.
//
// What a member keeps is a deposit in the realm's PUBLIC commons: mcl-rag has no private collections yet
// (macula-services/mcl-rag#21), so every caller the station admits can read it. Every description and answer says so,
// and a note carrying text Martha keeps out of public places (../know_what_text_is_private, the classes CI's private check
// runs) is refused before anything is sent, by its class, never its value (M1).
//
// The launcher cannot make the call: the station keeps one link per key, and the member's session holds it. So a tool
// here answers a mesh order, which the relay carries to the call as the member (../claude_code_relay/hooks/
// carry_a_mesh_order.ts) and whose sealed reply it hands back to one of the two asks below, which compose the words.
// A launch whose host carries no order (an engine member's) hands no roster, and memory is off there.
//
// Anyone can tag a note with the crew's topic, so a recalled hit counts as the crew's only when mcl-rag's own
// provenance names a depositor that is a node id on the crew's roster (M2). A recall asks for 100 hits, so notes from
// outside that rank higher cannot push the members' notes out. Memory is off unless the crew is a team, declares
// `mesh.memory` served by mcl-rag and not switched off, declares the mesh's realm, and has an id (M6).

import { NODE_ID } from '../admit_a_room_message/admit_a_room_message.ts'
import { isATeamMode, memberNameKey, type CrewSettings } from '../declare_crew/declare_crew.ts'
import { refusedValuesIn, rulesOf } from '../know_what_text_is_private/know_what_text_is_private.ts'

/** The model's two tools. */
export const REMEMBER_FOR_THE_CREW = 'remember_for_the_crew'
export const RECALL_WHAT_THE_CREW_KEPT = 'recall_what_the_crew_kept'

/** The two asks the relay makes with a sealed reply: never a model's tool, so the model cannot hand in a reply. */
export const THE_NOTE_WAS_KEPT = 'the_crews_note_was_kept'
export const THE_NOTES_WERE_FOUND = 'the_crews_notes_were_found'

/** The provider a crew's memory must be served by, and its two procedures. */
export const MEMORY_SERVICE = 'mcl-rag'
export const KEEP_PROCEDURE = `${MEMORY_SERVICE}/add_knowledge`
export const FIND_PROCEDURE = `${MEMORY_SERVICE}/answer_query`

/** How long the relay waits for mcl-rag's answer before the call is unreachable. */
export const MEMORY_CALL_TIMEOUT_MS = 30_000

/** A note is a note, not a document: longer text belongs in a repository. */
export const MOST_NOTE_CHARACTERS = 4000

/** Notes a recall shows when the call names no number, and the most it may name. */
export const NOTES_SHOWN_WHEN_UNNAMED = 5
export const MOST_NOTES_SHOWN = 20

/** Hits a recall asks mcl-rag for (its own cap), so the crew's notes are among them whoever else tags the topic. */
export const HITS_ASKED = 100

export const PUBLIC_COMMONS =
  "Crew memory is the realm's public commons in mcl-rag: every caller the station admits can read what is kept there."

/** What a tool answers: always words for the model, as crew-code's did. */
export type AMemoryAnswer = { readonly answer: string }

/** What a launch whose host carries a mesh order hands crew memory: the roster. */
export interface TheCrewsMemoryHost {
  /** The crew's roster `martha up` kept, read when it is needed. */
  readonly roster: () => Readonly<Record<string, string>>
}

/** What the slice is given: whose call it is, the declaration, and the host's part, left out by a host that cannot carry a mesh order. */
export interface TheMemoryAsked {
  readonly member: string
  readonly settings: () => Promise<CrewSettings | { readonly refused: string }>
  readonly host?: TheCrewsMemoryHost | undefined
}

/** The crew's memory when it is on: its topic and realm. */
interface CrewMemory {
  readonly topic: string
  readonly realm: string
}

const off = (why: string): AMemoryAnswer => ({ answer: `Crew memory is off: ${why}, so nothing was sent to ${MEMORY_SERVICE}.` })

/** The crew's memory, or why it is off (M6): every condition the header names, each checked. */
export function crewMemoryOf(settings: CrewSettings, carries: boolean): CrewMemory | { readonly off: string } {
  if (!carries) return { off: 'this member runs on a host that cannot call the mesh as the member' }
  if (!isATeamMode(settings.mode.name)) return { off: 'a solo crew uses no mesh service' }
  const memory = settings.mesh_services.memory
  if (memory === undefined || memory.service !== MEMORY_SERVICE || !memory.on) return { off: `the declaration's mesh.memory is not ${MEMORY_SERVICE}, switched on` }
  if (settings.mesh_realm === null) return { off: "the declaration's mesh names no realm" }
  if (settings.opens.id === null) return { off: 'the declaration names no crew id' }
  return { topic: `crew:${settings.opens.id.toLowerCase()}`, realm: settings.mesh_realm }
}

/** The order the relay carries: one sealed call, and the ask that reads its reply. */
const anOrder = (memory: CrewMemory, procedure: string, args: Record<string, unknown>, then: string, keep: unknown): AMemoryAnswer => ({
  answer: JSON.stringify({ mesh_order: { procedure, args, realm: memory.realm, timeout_ms: MEMORY_CALL_TIMEOUT_MS, then, keep } }),
})

/** Each private class a text carries (M1), named once, never its value: the private check's own rules, synthetic forms refused too. */
export const privateClassesIn = (text: string): readonly string[] => [...new Set(refusedValuesIn(text, rulesOf(false)).map((refused) => refused.what))]

/** A note to keep, checked: the order, or why it is not kept. */
export function rememberOrder(memory: CrewMemory, member: string, args: Readonly<Record<string, unknown>>): AMemoryAnswer {
  const text = typeof args['text'] === 'string' ? args['text'].trim() : ''
  if (text === '') return { answer: 'Not remembered: text is the note to keep, in your own words.' }
  if (text.length > MOST_NOTE_CHARACTERS) return { answer: `Not remembered: a note is at most ${MOST_NOTE_CHARACTERS} characters; commit longer text to a repository instead.` }
  const carried = privateClassesIn(text)
  if (carried.length > 0) return { answer: `Not remembered: the note carries ${carried.join(', ')}, and crew memory is public. ${PUBLIC_COMMONS}` }
  return anOrder(memory, KEEP_PROCEDURE, { text, source_label: `${memory.topic}/${memberNameKey(member)}`, topics: [memory.topic] }, THE_NOTE_WAS_KEPT, { topic: memory.topic })
}

/** How many notes a recall shows: a whole number from 1 to MOST_NOTES_SHOWN, or NOTES_SHOWN_WHEN_UNNAMED. */
export function notesWanted(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, MOST_NOTES_SHOWN) : NOTES_SHOWN_WHEN_UNNAMED
}

/** A recall, checked: the order, or why nothing is looked for. */
export function recallOrder(memory: CrewMemory, args: Readonly<Record<string, unknown>>): AMemoryAnswer {
  const query = typeof args['query'] === 'string' ? args['query'].trim() : ''
  if (query === '') return { answer: 'Nothing recalled: query is what to look for, in plain words.' }
  return anOrder(memory, FIND_PROCEDURE, { query_text: query, top_k: HITS_ASKED, topics: [memory.topic] }, THE_NOTES_WERE_FOUND, { wanted: notesWanted(args['top_k']) })
}

/** One recalled note: its words, and the member who kept it. */
export interface ARecalledNote {
  readonly text: string
  readonly by: string
}

const isARecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The member mcl-rag's provenance names as a hit's depositor, or undefined when it names none on the roster (M2). */
function depositorOf(hit: Record<string, unknown>, members: ReadonlyMap<string, string>): string | undefined {
  const by = isARecord(hit['provenance']) ? hit['provenance']['deposited_by'] : undefined
  return typeof by === 'string' ? members.get(by.toLowerCase()) : undefined
}

/** A reply's hits held to the roster: the members' notes, best first, at most `wanted`, and how many hits were not theirs. */
export function theCrewsNotes(result: unknown, roster: Readonly<Record<string, string>>, wanted: number): { readonly notes: readonly ARecalledNote[]; readonly outside: number } {
  const hits = isARecord(result) && Array.isArray(result['hits']) ? result['hits'].filter(isARecord) : []
  const members = new Map(Object.entries(roster).flatMap(([name, id]) => (NODE_ID.test(id) ? [[id.toLowerCase(), name] as const] : [])))
  const notes = hits.flatMap((hit) => {
    const by = depositorOf(hit, members)
    return by === undefined ? [] : [{ text: typeof hit['content'] === 'string' ? hit['content'] : '', by }]
  })
  return { notes: notes.slice(0, wanted), outside: hits.length - notes.length }
}

/** The words a recall answers. */
export function recalledWords({ notes, outside }: ReturnType<typeof theCrewsNotes>): string {
  const left = outside === 0 ? '' : ` ${outside} hit${outside === 1 ? '' : 's'} not kept by a member of this crew ${outside === 1 ? 'was' : 'were'} left out.`
  if (notes.length === 0) return `Nothing in crew memory matches.${left} ${PUBLIC_COMMONS}`
  const lines = notes.map((note) => `- ${note.by}: ${note.text.replace(/\s+/g, ' ')}`)
  return [`From crew memory (${notes.length}), notes the crew's members kept:`, ...lines, `${left.trim()} ${PUBLIC_COMMONS}`.trim()].join('\n')
}

/** A failed call, in one line of Martha's own words: never the provider's (M7). */
export function faultOf(refusal: string): string {
  if (/no answer within/.test(refusal)) return 'no answer in time'
  if (/unsealed/.test(refusal)) return 'the answer came back unsealed'
  return 'the call failed'
}

const unreachable = (what: string, refusal: string): AMemoryAnswer => ({
  answer: `Crew memory is unreachable (${faultOf(refusal)}): nothing was ${what}. Carry on without it; the work does not depend on it.`,
})

/** The sealed reply the relay hands back, or the refusal it carries. */
function theReplyIn(args: Readonly<Record<string, unknown>>): { readonly result: unknown } | { readonly refusal: string } {
  const answer = args['answer']
  if (isARecord(answer) && 'result' in answer) return { result: answer['result'] }
  return { refusal: isARecord(answer) && typeof answer['refusal'] === 'string' ? answer['refusal'] : '' }
}

/** A deposit's reply, in words. */
export function keptWords(args: Readonly<Record<string, unknown>>): AMemoryAnswer {
  const reply = theReplyIn(args)
  if ('refusal' in reply) return unreachable('remembered', reply.refusal)
  const topic = isARecord(args['keep']) && typeof args['keep']['topic'] === 'string' ? args['keep']['topic'] : 'the crew'
  return { answer: `Remembered under ${topic}: the crew's ${RECALL_WHAT_THE_CREW_KEPT} finds it. ${PUBLIC_COMMONS}` }
}

/** A recall's reply, in words, held to the roster as it reads now. */
export function foundWords(args: Readonly<Record<string, unknown>>, roster: Readonly<Record<string, string>>): AMemoryAnswer {
  const reply = theReplyIn(args)
  if ('refusal' in reply) return unreachable('recalled', reply.refusal)
  const wanted = notesWanted(isARecord(args['keep']) ? args['keep']['wanted'] : undefined)
  return { answer: recalledWords(theCrewsNotes(reply.result, roster, wanted)) }
}

/** A model's tool call: off, a refusal, or the order to carry. */
async function aToolCall(asked: TheMemoryAsked, order: (memory: CrewMemory, host: TheCrewsMemoryHost) => AMemoryAnswer): Promise<AMemoryAnswer> {
  const settings = await asked.settings()
  if ('refused' in settings) return off(settings.refused)
  const memory = crewMemoryOf(settings, asked.host !== undefined)
  return 'off' in memory || asked.host === undefined ? off('off' in memory ? memory.off : 'no host') : order(memory, asked.host)
}

/** The model's two tools, answered over one place. */
export const crewMemoryHandlers = (asked: TheMemoryAsked) => ({
  [REMEMBER_FOR_THE_CREW]: (args: Readonly<Record<string, unknown>>) => aToolCall(asked, (memory) => rememberOrder(memory, asked.member, args)),
  [RECALL_WHAT_THE_CREW_KEPT]: (args: Readonly<Record<string, unknown>>) => aToolCall(asked, (memory) => recallOrder(memory, args)),
})

/** The answer to one of the relay's two asks with a sealed reply, or undefined when the name is not one of them. */
export function answerTheCrewMemoryAsk(asked: TheMemoryAsked, name: string, args: Readonly<Record<string, unknown>>): Promise<AMemoryAnswer> | undefined {
  if (name === THE_NOTE_WAS_KEPT) return Promise.resolve(keptWords(args))
  if (name === THE_NOTES_WERE_FOUND) return Promise.resolve(foundWords(args, asked.host?.roster() ?? {}))
  return undefined
}

/** The answer to any of this slice's names, tools and asks alike, or undefined when the name is not one of them. */
export function answerCrewMemory(asked: TheMemoryAsked, name: string, args: Readonly<Record<string, unknown>>): Promise<AMemoryAnswer> | undefined {
  const tool = (crewMemoryHandlers(asked) as Readonly<Record<string, (args: Readonly<Record<string, unknown>>) => Promise<AMemoryAnswer>>>)[name]
  return tool === undefined ? answerTheCrewMemoryAsk(asked, name, args) : tool(args)
}

/** The two tools, as the mod registers them. */
export const CREW_MEMORY_TOOLS = [
  {
    name: REMEMBER_FOR_THE_CREW,
    description: `Keep a short note in crew memory so the crew's other members can recall it (${RECALL_WHAT_THE_CREW_KEPT}), in this session and later ones. ${PUBLIC_COMMONS} Never put anything there you would not put in a public repository.`,
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: `The note, in your own words; at most ${MOST_NOTE_CHARACTERS} characters` } },
      required: ['text'],
    },
  },
  {
    name: RECALL_WHAT_THE_CREW_KEPT,
    description: `Search crew memory for notes the crew's members kept with ${REMEMBER_FOR_THE_CREW}. Only notes kept by a member on the crew's roster are returned. ${PUBLIC_COMMONS}`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in plain words' },
        top_k: { type: 'number', description: `How many notes at most (default ${NOTES_SHOWN_WHEN_UNNAMED}, at most ${MOST_NOTES_SHOWN})` },
      },
      required: ['query'],
    },
  },
] as const
