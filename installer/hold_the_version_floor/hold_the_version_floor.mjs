// This machine's version floor (martha#21, R9 of #84; design issuecomment-6753241669, build ruling
// issuecomment-6868833599).
import { dirname, join } from 'node:path'

/** The record's name: <data>/martha/floor, beside releases/, where the launcher finds it from its own real path. */
export const FLOOR_RECORD = 'floor'

/**
 * Where this machine keeps its floor: beside `releases`.
 * @param {import('../place_the_release/place_the_release.mjs').Places} places
 */
export const floorRecordOf = (places) => join(dirname(places.releases), FLOOR_RECORD)
