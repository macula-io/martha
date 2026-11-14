// The words typed after `martha install` (martha#84, martha#21): which are a way the installer is asked, so the
// launcher passes them on unchanged, and which are no way the command is used.
//
// This exists so the pinned installer is only ever handed words it knows: one version at most, its two plain
// switches, and its two switches that take a value, each with that value. Everything else is a usage error before
// anything is fetched.

/** The switches `martha install` passes through to the installer that take no value. */
const INSTALL_SWITCHES: readonly string[] = ['--downgrade', '-h', '--help']
/** The switches that take the next word as their value (martha#21 added --withdrawal-in). */
const INSTALL_SWITCHES_OF_A_VALUE: readonly string[] = ['--digest', '--withdrawal-in']

/**
 * Whether `words`, typed after `martha install`, are a way the installer is asked: `[<version>] [--downgrade]
 * [--digest sha256:<hex>] [--withdrawal-in <version>]`, one version at most, each valued switch with its value, and
 * no other switch.
 */
export function installWordsAreAWay(words: readonly string[]): boolean {
  let hasVersion = false
  for (let at = 0; at < words.length; at++) {
    const word = words[at] ?? ''
    if (INSTALL_SWITCHES_OF_A_VALUE.includes(word) && at + 1 >= words.length) return false
    if (INSTALL_SWITCHES_OF_A_VALUE.includes(word)) at++
    else if (INSTALL_SWITCHES.includes(word)) continue
    else if (word.startsWith('-') || hasVersion) return false
    else hasVersion = true
  }
  return true
}
