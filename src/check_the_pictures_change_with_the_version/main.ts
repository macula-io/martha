// Run the picture rule (martha#627), over a tree or over the range a change makes:
//
//   node src/check_the_pictures_change_with_the_version/main.ts --tree --repository <path>
//   node src/check_the_pictures_change_with_the_version/main.ts --base <sha> --head <sha> --repository <path>
//
// The pictures are drawn at release, so a change may touch one only when the same change bumps the root
// package.json's version, and then every picture must be what architecture/c4_diagrams.ts draws. The release reads the
// tree alone as its backstop: a stale picture there means the version-bump check was bypassed.
//
// Exit 0 the rule holds, 1 it is broken — one line a refusal — and 2 the run could not look. It never passes because
// it could not look.

import {
  bumpsTheVersion,
  theRefusalsOfAChange,
  theRefusalsOfATree,
  theVersionsItCannotRead,
} from './check_the_pictures_change_with_the_version.ts'
import { theChangeFrom, thePicturesAt } from './read_the_pictures.ts'

const NAME = 'check_the_pictures_change_with_the_version'

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

const refused = (refusals: readonly string[]): number => {
  for (const refusal of refusals) console.error(`${NAME}: ${refusal}`)
  return 1
}

const couldNotLook = (why: string): number => {
  console.error(`${NAME}: the check could not be made: ${why}`)
  return 2
}

/** The release's read: a tree alone, held to what the generator draws. */
const theTreeRead = (repository: string): number => {
  const pictures = thePicturesAt(repository)
  const refusals = theRefusalsOfATree(pictures)
  if (refusals.length > 0) return refused(refusals)
  console.log(`${NAME}: ${String(pictures.length)} picture(s) are what the generator draws`)
  return 0
}

/** A change's read: the pictures it touches, against the version bump that alone lets it touch one. */
const theRangeRead = (repository: string, base: string, head: string): number => {
  const change = theChangeFrom(repository, base, head)
  if (change === undefined) return couldNotLook(`git would not say what ${base}..${head} changes in ${repository}`)
  const unread = theVersionsItCannotRead(change)
  if (unread.length > 0) return couldNotLook(unread.join(', '))
  const refusals = theRefusalsOfAChange(change, thePicturesAt(repository))
  if (refusals.length > 0) return refused(refusals)
  const bumped = bumpsTheVersion(change) ? 'the version is bumped, and' : 'no picture is touched, and'
  console.log(`${NAME}: ${bumped} the pictures are what the generator draws`)
  return 0
}

const main = (): number => {
  const repository = option('--repository') ?? '.'
  const base = option('--base')
  const head = option('--head')
  if (process.argv.includes('--tree')) return theTreeRead(repository)
  if (base === undefined || head === undefined) {
    return couldNotLook('needs --tree, or --base and --head with it: a run told neither would read no change')
  }
  return theRangeRead(repository, base, head)
}

process.exitCode = main()
