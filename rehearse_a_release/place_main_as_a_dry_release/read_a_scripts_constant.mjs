// A number a bash script of this folder defines on a line of its own, `NAME=<digits>`, read from the script itself so
// no test and no other script spells it (martha#696). The nightly driver reads the proof's DRY_PASSED and the packer's
// NOT_PACKABLE the same way, in bash.

import { readFileSync } from 'node:fs'

/**
 * The value of `name` in `script`: exactly one line `name=<digits>`, or it throws, naming the script and the name.
 * @param {string} script @param {string} name @returns {number}
 */
export function aScriptsConstant (script, name) {
  const lines = readFileSync(script, 'utf8').split('\n').filter((line) => line.startsWith(`${name}=`))
  const digits = lines.length === 1 ? /^[A-Z_]+=(\d+)$/.exec(lines[0])?.[1] : undefined
  if (digits === undefined) throw new Error(`${script} does not define ${name} as one line ${name}=<digits> (${lines.length} line(s) start so)`)
  return Number(digits)
}
