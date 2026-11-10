// The places under the owner's config dirs that Claude Code runs as code, and
// the host's own list of what it protects there, as the recorder cuts them from
// the host binary (martha#187).
//
// A member's file tool that writes one of these places writes code the owner's
// next session runs, or work it starts, without asking anyone: the shell
// snapshots a Bash command runs first, the scripts session-env holds, the jobs
// and daemon services, the plugins, hooks, workflows, routines, backups and the
// files named beside them. The guard (../refuse_a_member_writing_owner_memory/)
// refuses each of them; nothing here is typed, so a host that renames a place or
// adds one fails the recording before the gate can fall short:
//   - `protected_config_names`: the array the host puts together to protect its
//     config dir, whole and in the host's order. Three of its entries are built
//     by a function from `policy-limits.json` rather than written out; each is
//     resolved through that function's own template and the constant it closes
//     over, so what a signature file is called comes from the host too;
//   - `config_code_places`: the places the host's own statements say it runs:
//     the four folders its "This writes to the Claude Code <name> folder."
//     statements name, and the file named beside them, in the sentence that
//     spells the same four out with it. The two must agree;
//   - `legacy_global_config_names`: the file the host prefers over `.claude.json`
//     for its global config at the config dir's root, where the owner's user MCP
//     servers are read from: the literal its one chooser joins to the config dir,
//     which the host also holds as a constant of its own (martha#187 r=3).

/** The places under a config dir the host names as ones it runs. */
export interface ConfigCodePlaces {
  /** The folders the host's own statements name, sorted. */
  readonly folders: readonly string[]
  /** The file named beside those folders in the same sentence. */
  readonly files: readonly string[]
}

/** What the host binary says about the config-dir places it runs as code, as recorded. */
export interface ProtectedConfigPlaces {
  /** Every name in the host's protected config-dir array, in its order, its three computed files resolved. */
  readonly protected_config_names: readonly string[]
  /** The places the host's own statements name as ones it runs. */
  readonly config_code_places: ConfigCodePlaces
  /**
   * The names the host gives the global config file it prefers over `.claude.json`
   * at a config dir's root, where the owner's user MCP servers are read from when
   * that file is there and not empty (martha#187 r=3).
   */
  readonly legacy_global_config_names: readonly string[]
}

const escaped = (name: string): string => name.replaceAll('$', '\\$')

const sortedUnique = (names: readonly string[]): string[] => [...new Set(names)].sort()

/** Where one module of the host's bundle starts; a name it closes over is looked up inside it. */
const CHUNK = '// @bun @bytecode'

/** The text of the one module that holds `at`: names minified small are reused by other modules. */
function moduleHolding(text: string, at: number): string {
  const before = text.lastIndexOf(CHUNK, at)
  const after = text.indexOf(CHUNK, at)
  return text.slice(before < 0 ? 0 : before, after < 0 ? text.length : after)
}

/** Whether `char` opens a string in this bundle: a name, a template or a quoted string. */
const opensAString = (char: string): boolean => char === '"' || char === "'"

/** The quote still open after `char`, when the comma that splits entries is the one outside a string. */
const quoteAfter = (quote: string, char: string): string => {
  if (quote !== '') return char === quote ? '' : quote
  return opensAString(char) ? char : quote
}

/** The entries of an array literal, split at the commas outside its strings. */
function entriesOf(source: string): string[] {
  const entries: string[] = []
  let start = 0
  let quote = ''
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at] ?? ''
    if (quote === '' && char === ',') {
      entries.push(source.slice(start, at))
      start = at + 1
    } else quote = quoteAfter(quote, char)
  }
  entries.push(source.slice(start))
  return entries.map((entry) => entry.trim()).filter((entry) => entry !== '')
}

/** The one string value `name` is given inside `module`, or a refusal when it is given none or several. */
function constantCalled(name: string, module: string): string {
  const found = new Set([...module.matchAll(new RegExp(`[,;{ ]${escaped(name)}="([^"]*)"`, 'g'))].map((match) => match[1] ?? ''))
  if (found.size !== 1) throw new Error(`The host gives ${name} ${String(found.size)} string values, not one, so the file it names cannot be told.`)
  return [...found][0] ?? ''
}

/** The value a function that returns one template literal gives `argument`, its other names resolved where it is defined. */
function templateValue(text: string, name: string, argument: string): string {
  const definitions = [...text.matchAll(new RegExp(`function ${escaped(name)}\\(([\\w$]+)\\)\\{return\`([^\`]*)\`\\}`, 'g'))]
  if (new Set(definitions.map((match) => match[0])).size !== 1) throw new Error(`The host holds ${String(new Set(definitions.map((match) => match[0])).size)} functions named ${name} that return one template, not one.`)
  const [definition] = definitions
  const parameter = definition?.[1]
  const template = definition?.[2]
  if (definition === undefined || parameter === undefined || template === undefined) throw new Error(`The function ${name} cannot be read from the host.`)
  const module = moduleHolding(text, definition.index)
  return template.replaceAll(/\$\{([\w$]+)\}/g, (_whole, closed: string) => (closed === parameter ? argument : constantCalled(closed, module)))
}

/** One entry of a protected-names array, resolved: a name the host writes, the file a call builds, or a spread of the array. */
function namesOfEntry(text: string, entry: string, at: number): string[] {
  const literal = /^"([^"]*)"$/.exec(entry)
  if (literal !== null) return [literal[1] ?? '']
  const call = /^([\w$]+)\("([^"]*)"\)$/.exec(entry)
  if (call !== null) return [templateValue(text, call[1] ?? '', call[2] ?? '')]
  const spread = /^\.\.\.([\w$]+)$/.exec(entry)
  if (spread === null) throw new Error(`The host's protected-names array holds ${entry}, which is neither a name nor a call this reads.`)
  return spreadNames(text, spread[1] ?? '', at)
}

/** The source of the one array `name` is given inside the module that holds `at`. */
function spreadSource(text: string, name: string, at: number): string {
  const module = moduleHolding(text, at)
  const found = new Set([...module.matchAll(new RegExp(`[,;{ ]${escaped(name)}=\\[([^\\]]*)\\]`, 'g'))].map((match) => match[1] ?? ''))
  if (found.size !== 1) throw new Error(`The host gives ${name} ${String(found.size)} arrays inside its module, not one, so the places it spreads cannot be told.`)
  return [...found][0] ?? ''
}

/** The names the array a spread brings in holds: one level, which is all the host's arrays need. */
function spreadNames(text: string, name: string, at: number): string[] {
  return entriesOf(spreadSource(text, name, at)).flatMap((entry) => {
    if (/^\.\.\./.test(entry)) throw new Error('A protected-names array spreads a spread, which this reads no further.')
    return namesOfEntry(text, entry, at)
  })
}

/** The one array the host walks to protect its config dir, and where it stands. */
function protectedArrayIn(text: string): { readonly source: string; readonly at: number } {
  const candidates = [...text.matchAll(/new Set\(\[[^\]\n]*\]\);for\(let [\w$]+ of\[([^\]\n]*)\]\)\{/g)]
  const shaped = candidates.filter((match) => {
    const entries = entriesOf(match[1] ?? '')
    return entries.filter((entry) => /^"/.test(entry)).length > 1 && entries.some((entry) => /^\.\.\./.test(entry))
  })
  if (shaped.length !== 1) throw new Error(`The host holds ${String(shaped.length)} arrays it walks to protect its config dir, not one, so the places it protects cannot be told.`)
  const [match] = shaped
  return { source: match?.[1] ?? '', at: match?.index ?? 0 }
}

/** Where the host states that it writes a code folder, and where it spells that folder out beside the file. */
const CODE_FOLDER_STATEMENT = /This writes to the Claude Code ([\w.-]+) folder\./g
const CODE_PLACE_SENTENCE = /the ([\w-]+), ([\w-]+), ([\w-]+) or ([\w-]+) folder or (?:in|to) ([\w.-]+) of the Claude Code config directory/g

/** The four folders the host's statements name, checked against the sentence that names them with the file beside them. */
function codePlacesIn(text: string): ConfigCodePlaces {
  const stated = sortedUnique([...text.matchAll(CODE_FOLDER_STATEMENT)].map((match) => match[1] ?? ''))
  const spelled = new Set([...text.matchAll(CODE_PLACE_SENTENCE)].map((match) => [...match.slice(1, 5)].sort().join(',') + `|${match[5] ?? ''}`))
  if (spelled.size !== 1) throw new Error(`The host holds ${String(spelled.size)} sentences naming the folders it runs beside a file, not one.`)
  const [only = ''] = [...spelled]
  const [folders = '', file = ''] = only.split('|')
  if (stated.length === 0 || folders !== stated.join(',')) {
    throw new Error(`The host's statements name ${stated.join(', ') || 'no folders'} where its sentence names ${folders}, so the places it runs cannot be told.`)
  }
  return { folders: stated, files: [file] }
}

/** `text` as a regular expression reads it, for a name cut from the host rather than typed here. */
const asALiteral = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The shape in which the host builds the path of the global config file it
 * prefers over `.claude.json`: its config dir joined with the file's name, then a
 * stat of what it built, inside the one function that chooses between the two
 * files (martha#187 r=3).
 */
const PREFERRED_GLOBAL_CONFIG = /let ([\w$]+)=([\w$]+)\(([\w$]+)\(\),\"([^\"]+)\"\),([\w$]+)=([\w$]+)\(\);try\{let ([\w$]+)=([\w$]+)\(\)\.statSync\(\1\)/g

/**
 * The names the host gives the global config file it prefers over `.claude.json`
 * at a config dir's root (martha#187 r=3), cut and never typed: the literal the
 * one chooser joins to the config dir, which the host must also hold as a
 * constant of its own. A host that drops the chooser, renames the file or holds
 * two choosers fails here, so the guard cannot go on denying a name nothing reads.
 */
export function legacyGlobalConfigNamesIn(text: string): string[] {
  const choosers = [...text.matchAll(PREFERRED_GLOBAL_CONFIG)].map((match) => match[4] ?? '')
  if (choosers.length !== 1) {
    throw new Error(`The host holds ${String(choosers.length)} choosers of the global config file it prefers over .claude.json, not one, so the file the owner's user MCP servers are read from cannot be told.`)
  }
  const found = sortedUnique(choosers)
  const [name = ''] = found
  if (![...text.matchAll(new RegExp(`[,;{ ][\\w$]+="${asALiteral(name)}"`, 'g'))].length) {
    throw new Error(`The host joins ${name} to its config dir but holds it as no constant of its own, so the file it reads the owner's user MCP servers from cannot be told.`)
  }
  return found
}

/** The protected config-dir names, the code places and the preferred global config the host names, cut from its text. */
export function protectedConfigPlacesIn(text: string): ProtectedConfigPlaces {
  const array = protectedArrayIn(text)
  return {
    protected_config_names: entriesOf(array.source).flatMap((entry) => namesOfEntry(text, entry, array.at)),
    config_code_places: codePlacesIn(text),
    legacy_global_config_names: legacyGlobalConfigNamesIn(text),
  }
}
