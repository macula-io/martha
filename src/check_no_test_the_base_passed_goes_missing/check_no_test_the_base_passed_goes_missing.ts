// The comparison behind the dropped-test check (martha#274): every test title the base passed is still at the
// tip, unless a commit in the range says it dropped it.
//
// A branch created from a newer base while the working tree still holds edits made against the older one keeps
// the working tree across the switch, so its next commit carries files at their pre-base content and silently
// reverts what the base added (2026-11-11, 8ca6eb3: four titles and a documented paragraph). Nothing ran the
// deleted tests, so every job stayed green. This names them.
//
// The two trailer names live here and nowhere else: the workflow and the tests read them from this module, so a
// second spelling cannot drift.

import { testTitlesIn } from '../../prove_the_core/test_titles_in.ts'

/** A commit says it drops one test with this trailer, naming `<path> :: <title>`, the path as it is at the tip. */
export const DROPS_TEST_TRAILER = 'Drops-test'

/** A commit says it removes a whole test file with this trailer, naming `<path>`, as it was at the base. */
export const DROPS_TEST_FILE_TRAILER = 'Drops-test-file'

/** What a commit says it dropped: a title, or the whole file when the title is absent. */
export interface Claim {
  readonly file: string
  readonly title?: string
}

/** The sources on both sides of the range, keyed by repository path. */
export interface Sources {
  readonly atBase: ReadonlyMap<string, string>
  readonly atTip: ReadonlyMap<string, string>
  /** A base path whose file moved, mapped to where the tip holds it. */
  readonly renamedTo?: ReadonlyMap<string, string>
}

export interface MissingTest {
  /** The path at the tip, which is where a reader looks for the test that is not there. */
  readonly file: string
  readonly title: string
}

export interface Comparison {
  readonly comparedFiles: number
  readonly missing: readonly MissingTest[]
  /** Claims that excused nothing: a title still at the tip, or a file that is still there. */
  readonly staleClaims: readonly Claim[]
}

const afterTrailer = (line: string, trailer: string): string | undefined => {
  const prefix = `${trailer}: `
  return line.startsWith(prefix) ? line.slice(prefix.length).trim() : undefined
}

const claimOn = (line: string): Claim | undefined => {
  const file = afterTrailer(line, DROPS_TEST_FILE_TRAILER)
  if (file !== undefined) return { file }
  const named = afterTrailer(line, DROPS_TEST_TRAILER)
  if (named === undefined) return undefined
  const at = named.indexOf(' :: ')
  return at === -1 ? { file: named, title: '' } : { file: named.slice(0, at), title: named.slice(at + 4) }
}

/** Every claim the commit messages make, in the order they are made. */
export function claimsIn(messages: readonly string[]): Claim[] {
  return messages.flatMap((message) =>
    message.split('\n').flatMap((line) => {
      const claim = claimOn(line.trim())
      return claim === undefined ? [] : [claim]
    }),
  )
}

/** The base titles the tip no longer holds, counted: two tests with one title need two at the tip. */
export function titlesThatWentMissing(base: readonly string[], tip: readonly string[]): string[] {
  const left = new Map<string, number>()
  for (const title of tip) left.set(title, (left.get(title) ?? 0) + 1)
  return base.filter((title) => {
    const at = left.get(title) ?? 0
    if (at === 0) return true
    left.set(title, at - 1)
    return false
  })
}

/** Takes the first unused claim `matches`, and answers whether it took one. */
const takeClaim = (claims: readonly Claim[], used: Set<number>, matches: (claim: Claim) => boolean): boolean => {
  const at = claims.findIndex((claim, index) => !used.has(index) && matches(claim))
  if (at === -1) return false
  used.add(at)
  return true
}

/** What one base file's titles lost at its tip, claims accounted for first. */
const missingIn = (
  basePath: string,
  tipPath: string,
  baseText: string,
  tipText: string | undefined,
  claims: readonly Claim[],
  used: Set<number>,
): MissingTest[] => {
  const gone = tipText === undefined
  const theFileIsClaimed = gone && takeClaim(claims, used, (claim) => claim.file === basePath && claim.title === undefined)
  const tipTitles = tipText === undefined ? [] : testTitlesIn(tipText, tipPath)
  const missing: MissingTest[] = []
  for (const title of titlesThatWentMissing(testTitlesIn(baseText, basePath), tipTitles)) {
    const claimed = theFileIsClaimed || takeClaim(claims, used, (claim) => claim.file === tipPath && claim.title === title)
    if (!claimed) missing.push({ file: tipPath, title })
  }
  return missing
}

export function testsTheBasePassedThatWentMissing(sources: Sources, claims: readonly Claim[]): Comparison {
  const used = new Set<number>()
  const missing = [...sources.atBase].flatMap(([basePath, baseText]) => {
    const tipPath = sources.renamedTo?.get(basePath) ?? basePath
    return missingIn(basePath, tipPath, baseText, sources.atTip.get(tipPath), claims, used)
  })
  return { comparedFiles: sources.atBase.size, missing, staleClaims: claims.filter((_claim, at) => !used.has(at)) }
}
