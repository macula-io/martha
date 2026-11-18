// The C4 pictures are drawn at release, not carried by every pull request (martha#627).
//
// Two rules, and they are one: **the only change that may touch a picture is one that bumps the root package.json's
// version**, and such a change must leave every picture equal to what architecture/c4_diagrams.ts draws. The version
// bump is the release's own pull request, so the redraw goes through the review the owner already gives a release,
// and two changes about different work can never clash in a generated file again.
//
// The release reads the tree alone as its backstop, and a stale picture found there means the version-bump check was
// bypassed — a change landed without one. Neither read draws anything: the picture is drawn by the program this names.

import { THE_C4_DIAGRAMS_PROGRAM, THE_PICTURES_THE_C4_DRAWS } from '../../architecture/c4_diagrams.ts'

/** Why a picture is refused in a change that does not bump the version, in the rule's own words. */
export const DRAWN_AT_RELEASE = 'the picture is drawn at release, in the version-bump pull request (martha#627)'

/** One picture: what the tree holds for it, when it holds it at all, and what the generator draws. */
export interface APicture {
  readonly file: string
  readonly committed: string | undefined
  readonly drawn: string
}

/** A change, as the two things these rules read of it: the paths it touches, and the version at each end. */
export interface AChange {
  readonly paths: readonly string[]
  readonly versionAtBase: string | undefined
  readonly versionAtHead: string | undefined
}

/** The pictures a change touches, read from the generator's own list rather than a list kept here. */
export const thePicturesChangedIn = (paths: readonly string[]): readonly string[] =>
  THE_PICTURES_THE_C4_DRAWS.filter((file) => paths.includes(file))

/** Whether a change bumps the root version, which is the one thing that lets it touch a picture. */
export const bumpsTheVersion = (change: AChange): boolean =>
  change.versionAtBase !== undefined && change.versionAtHead !== undefined && change.versionAtBase !== change.versionAtHead

/**
 * Every path whose version this change cannot read, as the words a run prints when it could not look: a range whose
 * package.json is missing at either end is one this rule cannot judge, and it never passes because it could not judge.
 */
export const theVersionsItCannotRead = (change: AChange): readonly string[] =>
  change.versionAtBase === undefined ? ['the version at the base could not be read'] : change.versionAtHead === undefined ? ['the version at the tip could not be read'] : []

/** Every picture that is not what the generator draws, by name, with the command that redraws it. */
export const theRefusalsOfATree = (pictures: readonly APicture[]): readonly string[] =>
  pictures.flatMap((picture) =>
    picture.committed === picture.drawn
      ? []
      : [
          picture.committed === undefined
            ? `${picture.file} is not in the tree, and ${THE_C4_DIAGRAMS_PROGRAM} draws it: run node ${THE_C4_DIAGRAMS_PROGRAM}`
            : `${picture.file} is not what ${THE_C4_DIAGRAMS_PROGRAM} draws: run node ${THE_C4_DIAGRAMS_PROGRAM}`,
        ],
  )

/**
 * A change judged: a picture it touches with no version bump is refused by name, and a change that bumps the version
 * is held to the same tree rule the release reads, so the picture that lands is the picture the release archives.
 */
export const theRefusalsOfAChange = (change: AChange, pictures: readonly APicture[]): readonly string[] => {
  const touched = thePicturesChangedIn(change.paths)
  if (touched.length > 0 && !bumpsTheVersion(change)) return touched.map((file) => `${file} changed in a change that does not bump the version: ${DRAWN_AT_RELEASE}`)
  return bumpsTheVersion(change) ? theRefusalsOfATree(pictures) : []
}
