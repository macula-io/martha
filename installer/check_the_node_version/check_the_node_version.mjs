// The Node running the installer is one Martha runs on (martha#21, step 1): refused before anything is fetched.
// The range is the installer's own engines.node, which the drift test holds equal to the root package.json's, so
// the installer never fetches a release this Node could not run. Only the one form Martha writes is read, ">=X.Y.Z";
// any other is a fault in this package, and says so.
import { NAMES } from '../keep_the_names_in_one_place/names.mjs'
import { compareVersions } from '../read_the_release_registry/read_the_release_registry.mjs'
import { refuse } from '../refuse_in_words/refuse_in_words.mjs'

const AT_LEAST = /^>=(\d+\.\d+\.\d+)$/

/**
 * @param {string} running  the Node version, as process.versions.node gives it
 * @param {string} [range]  engines.node
 */
export function checkNodeVersion (running, range = NAMES.nodeRange) {
  const lowest = range.match(AT_LEAST)?.[1]
  if (lowest === undefined) throw new Error(`engines.node is '${range}', not the >=X.Y.Z this installer reads`)
  if (compareVersions(running, lowest) < 0) refuse(`Martha needs Node ${range}; this is Node ${running}. Install a newer Node and run the same line again`)
}
