// The names crew-code owns, held here as data so a check can fail on one by name (martha#468).
//
// Martha is its own program: no file, folder, tool, marker or variable of its own may be a name crew-code also gives
// something, or a person reading a path, a transcript or a tool name cannot tell which crew a thing belongs to. The
// inventory behind this table is issue #468's comment; each entry is one of its rows, and the table is the only place
// a crew-code name is spelled in Martha.
//
// Three kinds, because a name reaches code in three ways:
//
//   - a LITERAL is the name whole, as a string: `.crew`, `crew.json`, a tool's name.
//   - a RUNS ON is the name a template spells before a value: `crew_channel_taken/${member}` spells the piece
//     `crew_channel_taken`, which is no literal and is still a name. It is matched where a piece begins with it.
//   - a FAMILY is a shape rather than a name: a `CREW_`-prefixed variable, the `crew_[a-z_]` prefix, the server a
//     tool call carries. Each is anchored, so a literal that merely contains the letters is not one of them.
//
// What a check reads is what the code says (../../../prove_the_core/the_texts_a_source_spells.ts), never a comment: a
// comment naming a crew-code name explains a difference and is not one.

/** One name crew-code gives something, and what it gives it to. */
export type CrewCodeName =
  | { readonly kind: 'literal'; readonly text: string; readonly what: string }
  | { readonly kind: 'runs_on'; readonly text: string; readonly what: string }
  | { readonly kind: 'family'; readonly pattern: RegExp; readonly what: string }

// crew-code's own names for the tools and the refresh word whose names Martha took in #468 (rows 3-8). Each is a
// literal of this table's own, never the constant of the tool it names: a table built from those would follow a rename
// silently and could no longer say that the old name came back.
export const CREW_CODES_PROGRESS_TOOL = 'report_progress'
export const CREW_CODES_ASK_TOOL = 'queue_ask'
export const CREW_CODES_LIST_TOOL = 'list_asks'
export const CREW_CODES_TAKE_TOOL = 'take_asks'
export const CREW_CODES_SETTLE_TOOL = 'settle_asks'
export const CREW_CODES_REFRESH_WORD = 'crew_refresh'

/** Every name crew-code gives something, as #468's inventory lists them. */
export const CREW_CODE_NAMES: readonly CrewCodeName[] = [
  { kind: 'literal', text: '.crew', what: "crew-code's declaration folder" },
  { kind: 'literal', text: 'crew.json', what: "crew-code's declaration file" },
  { kind: 'literal', text: CREW_CODES_PROGRESS_TOOL, what: "crew-code's progress tool" },
  { kind: 'literal', text: CREW_CODES_ASK_TOOL, what: "crew-code's tool for queueing an ask" },
  { kind: 'literal', text: CREW_CODES_LIST_TOOL, what: "crew-code's tool for listing asks" },
  { kind: 'literal', text: CREW_CODES_TAKE_TOOL, what: "crew-code's tool for taking asks" },
  { kind: 'literal', text: CREW_CODES_SETTLE_TOOL, what: "crew-code's tool for settling asks" },
  { kind: 'literal', text: CREW_CODES_REFRESH_WORD, what: "crew-code's tool for refreshing a session" },
  { kind: 'literal', text: 'CREW-HANDOVER-WRITTEN', what: "crew-code's handover marker" },
  { kind: 'literal', text: 'CREW-REFRESH-DECLINED', what: "crew-code's declined-refresh marker" },
  { kind: 'literal', text: 'gate_would_refuse', what: "crew-code's folder for what its gate would refuse" },
  { kind: 'family', pattern: /^HANDOVER_\d{4}-\d{2}-\d{2}_/, what: "crew-code's handover file name" },
  { kind: 'family', pattern: /^mcp__crew__/, what: "crew-code's server name in a tool call" },
  { kind: 'family', pattern: /^\/crew-[a-z-]+$/, what: "crew-code's slash command" },
  { kind: 'family', pattern: /^CREW_[A-Z0-9_]+$/, what: "crew-code's environment variable" },
  { kind: 'family', pattern: /^crew_[a-z_]+$/, what: "crew-code's own prefix for a name" },
  { kind: 'runs_on', text: 'crew_channel_taken', what: "crew-code's prefix for what a member took in" },
]
