// The structural floor (martha#87, the shared floor of macula-io/macula-codebase-checks#9): a function that nests
// too deep, branches too much or runs too long cannot reach main. The caps are named here and nowhere else:
// prove_the_core/structure_stays_flat.node-test.ts reads them from this file and plants a function one step over
// each. A repo may tighten the shared floor, never relax it.
//
// - max-depth 2: eslint counts the blocks inside a function and not the function body itself, so 2 is an `if`
//   inside an `if`, no deeper. That is credo's and elvis's nesting 2; the shared floor's eslint number (3) lets a
//   third level through, so Martha is tighter.
// - complexity 9: cyclomatic, branch points + 1, the shared floor's number.
// - max-lines-per-function 60: lines of a function, blank lines and comments not counted, the shared floor's
//   function length (elvis, clippy, funlen).
//
// No baseline and no exception in the code: an `eslint-disable` comment is refused, not obeyed (noInlineConfig).
// eslint warns that it was ignored, and `npm run lint` allows no warning, so the comment itself fails the run.
// Every JavaScript and TypeScript file is under it.
import tseslint from 'typescript-eslint'

export const STRUCTURAL_CAPS = {
  'max-depth': ['error', { max: 2 }],
  complexity: ['error', { max: 9 }],
  'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
}

export default [
  { ignores: ['node_modules/'] },
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { noInlineConfig: true },
    rules: STRUCTURAL_CAPS,
  },
]
