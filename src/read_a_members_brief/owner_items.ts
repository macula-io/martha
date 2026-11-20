// Ported from crew-code core/owner_items.ts at crew-code 6f353d51 (martha#999 package 2), unchanged but for the
// package reader, which is this slice's own (thePackagesABriefNames). The issue numbers below are crew-code's.
//
// Every item in a handover or a brief that comes from the owner says whether the owner decided it or only
// floated it: `DECIDED <YYYY-MM-DD> "<their words>"` or `IDEA`.
//
// Why: on 2026-10-28 a handover carried "invite-only" as a decided register branch. It was an idea the owner
// had floated. A member waited on a flip nobody had decided, and a decided, unrelated change was held behind
// it. Free prose turns an idea into a decision the moment it is copied across a refresh.
//
// Shape only, like the handover check: a line counts as the owner's when it puts words or a choice in the
// owner's mouth ("<owner> said", "<owner> wants", "<owner>'s idea", "<owner>: \"...\""), or when it waits on an
// act of the owner's ("after <owner>'s flip", "<owner> is about to", "once <owner> ...", "tell <owner> to",
// "<owner> informed"). Those last are the 2026-10-27/28 lines themselves (review r=1): the idea travelled as
// "after <owner>'s invite-only flip", never as "<owner> wants". A line that only names the owner as the one whose yes a
// push needs ("needs <owner>'s yes", "<owner> menu") says nothing the owner said.

import { thePackagesABriefNames } from './read_a_members_brief.ts'

// DECIDED carries the day and the owner's own words, so the next reader can check them; IDEA carries nothing,
// because there is nothing yet to check.
export const DECIDED = /\bDECIDED\s+\d{4}-\d{2}-\d{2}\s+["“][^"”]+["”]/
// IDEA as a marker, not as a word in a sentence. A marker follows something that ends what came before it — a bullet,
// ':', '—', '–', '-', '(', '=', a full stop, a possessive — or it opens the line; what it never follows is a word that
// carries the sentence on, so an item that names the marker as one of two alternatives ("… pending, or IDEA",
// "… pending and IDEA", "… pending, IDEA") stays an item and goes into a handover marked. The
// negation guard stays too, so "not an IDEA, <owner> decided" reads as the prose it is.
export const IDEA = /(?<!\b(?:not|no|an|the)\s+)(?<!(?:\bor|\band|,)\s+)\bIDEA\b(?=\s*(?:[:(—–-]|$))/
// DECIDED without its day and the owner's words reads as a decision and gives the reader nothing to check.
const BARE_DECIDED = /\bDECIDED\b/

export const ownerMarkerShape = (owner: string) => `DECIDED <YYYY-MM-DD> "<${owner}'s words>" or IDEA`

const marked = (line: string) => DECIDED.test(line) || IDEA.test(line)

const SAYS = [
  'said', 'says', 'ruled', 'rules', 'wants', 'wanted', 'asked', 'asks', 'decided', 'decides', 'floated',
  'suggested', 'suggests', 'proposed', 'proposes', 'agreed', 'agrees', 'approved', 'chose', 'picked',
  'prefers', 'preferred', 'would like', 'likes', 'thinks', 'thought', 'mentioned', 'insists', 'insisted',
]
const SAID = [
  'idea', 'ideas', 'ruling', 'decision', 'call', 'wish', 'words', 'proposal', 'suggestion', 'preference',
  'choice', 'plan', 'request',
]
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The owner as the crew names them, and the generic words a card uses when the crew names nobody.
const ownerNames = (owner: string) => [...new Set([owner, 'the owner'].map(name => name.trim()).filter(Boolean))]

// An act of the owner's that a line waits on: what the owner is about to do, will do, or is told to do.
const ACTS = ['is about to', 'was about to', 'will', 'to', 'must', 'should', 'confirms', 'confirmed', 'informed', 'is informed', 'has to']
// Words before the owner that make the line wait on them.
const WAITS = ['after', 'once', 'when', 'until', 'before', 'unless', 'tell']

const ownerSpeaks = (owner: string) => {
  const names = `(?:${ownerNames(owner).map(escape).join('|')})`
  const start = '(?:^|[^\\w])'
  const patterns = [
    `${start}${names}\\s+(?:${SAYS.join('|')})\\b`,
    `${start}${names}['’]s\\s+(?:[\\w-]+\\s+){0,3}?(?:${SAID.join('|')}|flip|go|ok|okay|approval|order|answer)\\b`,
    `${start}${names}\\s*:\\s*["“]`,
    `${start}${names}\\s+(?:${ACTS.join('|')})\\b`,
    `\\b(?:${WAITS.join('|')})\\s+(?:he\\s+|she\\s+|they\\s+)?${names}\\b`,
  ]
  return new RegExp(patterns.join('|'), 'i')
}

// What only names the owner as the one whose yes or menu a step needs: taken out before the line is read.
const processRefs = (owner: string) => {
  const names = `(?:${ownerNames(owner).map(escape).join('|')})`
  return new RegExp(
    [
      `${names}['’]s\\s+(?:push\\s+|tag\\s+)?(?:yes|menu|todo)\\b`,
      `${names}\\s+(?:menu|todo)\\b`,
      `(?:needs|for|with|without)\\s+${names}\\b(?!['’]s|\\s+to\\b)`,
      `${names}\\s+ask(?:s|ed)?\\s+for\\s+(?:a\\s+)?(?:push\\s+|tag\\s+)?yes\\b`,
      `ask(?:s|ed)?\\s+${names}\\s+for\\s+(?:a\\s+)?(?:push\\s+|tag\\s+)?yes\\b`,
    ].join('|'),
    'gi',
  )
}

// A fence line's info string: what follows the backticks. Only an opening fence carries one; a closing fence is bare
// whitespace (CommonMark), which is how a dropped closing line stays dropped (review r=1).
const fenceInfo = (line: string) => {
  const match = /^\s*```(.*)$/.exec(line)
  return match === null ? null : (match[1] ?? '')
}

// Which lines are hidden: the fence lines themselves, and everything between a fence and the bare one that closes it.
// A fence still open at the end of the text is no fence — its lines are read as prose, so a
// copy that keeps the opening line and drops the closing one cannot switch the check off for the rest of the file.
// A fence line carrying an info string cannot close a block either, so a dropped closing line is not replaced by the
// next block's opening one: that block was never closed, and its lines are prose too (review r=1).
const fencedLines = (lines: string[]) => {
  const fenced = lines.map(() => false)
  let opened = -1
  lines.forEach((line, at) => {
    const info = fenceInfo(line)
    if (info === null) return
    fenced[at] = true
    if (opened === -1 || info.trim() !== '') {
      opened = at
      return
    }
    for (let i = opened; i < at; i++) fenced[i] = true
    opened = -1
  })
  return fenced
}

// The lines outside code fences: a fenced block quotes a file or a command, not the owner.
const proseLines = (text: string) => {
  const lines = text.split('\n')
  const fenced = fencedLines(lines)
  return lines.filter((line, at) => !fenced[at] && line.trim() !== '')
}

const excerpt = (line: string) => {
  const trimmed = line.trim().replace(/^[-*>\d.)\s]+/, '')
  return trimmed.length > 100 ? `${trimmed.slice(0, 97)}...` : trimmed
}

// A line that needs a marker: the owner's words or act, or a DECIDED that carries neither day nor words.
const needsMark = (line: string, speaks: RegExp, yesRefs: RegExp) =>
  !marked(line) && (speaks.test(line.replace(yesRefs, ' ')) || BARE_DECIDED.test(line))

// The owner's items that carry neither marker, each with its line number, so a writer appending to an older
// file sees which of its existing lines need the mark too (review r=1).
export const unmarkedOwnerItems = (text: string, owner: string): string[] => {
  const speaks = ownerSpeaks(owner)
  const yesRefs = processRefs(owner)
  const lines = text.split('\n')
  const fenced = fencedLines(lines)
  return lines.flatMap((line, at) => {
    if (fenced[at] || line.trim() === '') return []
    return needsMark(line, speaks, yesRefs) ? [`line ${at + 1}: ${excerpt(line)}`] : []
  })
}

// A brief's sections: a heading starts one. A brief with no heading is one section.
const sectionsOf = (text: string) => {
  const sections: string[][] = [[]]
  for (const line of proseLines(text)) {
    if (/^#{1,6}\s/.test(line)) sections.push([])
    sections.at(-1)?.push(line)
  }
  return sections.filter(section => section.length > 0)
}

// The packages a brief puts in one section with both an IDEA and a DECIDED item: work assigned on a decision
// that also carries something nobody decided, which is how the 2026-10-28 change waited on an idea.
export const bundledPackages = (brief: string): string[] =>
  sectionsOf(brief).flatMap(section => {
    const hasIdea = section.some(line => IDEA.test(line))
    const hasDecided = section.some(line => DECIDED.test(line))
    return hasIdea && hasDecided ? thePackagesABriefNames(section.join('\n')) : []
  }).filter((pkg, index, all) => all.indexOf(pkg) === index)

// What is wrong with a brief, or '' when nothing is.
export const briefProblems = (brief: string, owner: string) => {
  const unmarked = unmarkedOwnerItems(brief, owner)
  const bundled = bundledPackages(brief)
  const reasons = [
    ...(unmarked.length > 0
      ? [`these lines carry ${owner}'s words or wait on an act of theirs with no marker, lines already in the file included (${unmarked.map(line => `"${line}"`).join('; ')}): mark each ${ownerMarkerShape(owner)}`]
      : []),
    ...(bundled.length > 0
      ? [`it puts an IDEA and a DECIDED item in one package (${bundled.join(', ')}): give the IDEA its own section with no package in it, so the package waits on nothing undecided`]
      : []),
  ]
  return reasons.join('; and ')
}

// Why a brief is not written, or '' when it may be.
export const briefRefusal = (brief: string, owner: string) => {
  const problems = briefProblems(brief, owner)
  return problems === '' ? '' : `brief not written: ${problems}.`
}

// A brief dated on one of these days: the ones a shell command may just have written to.
export const briefDatedOn = (name: string, days: string[]) => isBriefPath(name) && days.some(day => name.startsWith(`BRIEF_${day}_`))

export const isBriefPath = (path: string) => /(?:^|\/)BRIEF_\d{4}-\d{2}-\d{2}_[^/]+\.md$/.test(path)
