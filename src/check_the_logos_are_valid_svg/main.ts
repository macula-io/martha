// Run the SVG check: node src/check_the_logos_are_valid_svg/main.ts assets/*.svg
//
// The files are given expanded by the shell, and one that is not there is exit 2, not a pass: a check that looked
// at nothing never reads as a green. Naming no file at all is exit 2 for the same reason.
//
// Exit 0 every logo is well-formed XML, 1 a logo is not (saxes' line each, naming the file and where it stopped),
// 2 the check could not be made.

import { checkTheLogosAreValidSvg, type LogoVerdict } from './check_the_logos_are_valid_svg.ts'

const announce = (verdict: LogoVerdict): number => {
  if (verdict.verdict === 'valid') {
    console.log(`check_the_logos_are_valid_svg: every logo is well-formed (${verdict.checked} file(s))`)
    return 0
  }
  if (verdict.verdict === 'unreadable') {
    console.error(`check_the_logos_are_valid_svg: the check could not be made: ${verdict.reason}`)
    return 2
  }
  for (const logo of verdict.logos) console.error(logo.problem)
  console.error(`check_the_logos_are_valid_svg: ${verdict.logos.length} logo(s) are not well-formed SVG`)
  return 1
}

const main = (files: readonly string[]): number => {
  if (files.length === 0) {
    console.error('check_the_logos_are_valid_svg: no file was named, so nothing was checked')
    return 2
  }
  return announce(checkTheLogosAreValidSvg(files))
}

process.exitCode = main(process.argv.slice(2))
