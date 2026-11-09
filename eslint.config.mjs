// The structural floor (martha#87, the one every live Macula code repo is held to): a function that nests
// too deep, branches too much or runs too long cannot reach main. The caps are named here and nowhere else:
// prove_the_core/structure_stays_flat.node-test.ts reads them from this file and plants a function one step over
// each. Every cap is at or tighter than the shared floor: a repo may tighten that floor, never relax it.
//
// - max-depth 2: eslint counts the blocks inside a function and not the function body itself, so 2 is an `if`
//   inside an `if`, no deeper.
// - complexity 9: cyclomatic, branch points + 1.
// - max-lines-per-function 60: lines of a function, blank lines and comments not counted.
//
// No baseline and no exception in the code: an `eslint-disable` comment is refused, not obeyed (noInlineConfig).
// eslint warns that it was ignored, and `npm run lint` allows no warning, so the comment itself fails the run.
// Every JavaScript and TypeScript file is under it.
//
// The unused rule (martha#171) has two homes, because the compiler does not see everything:
// - tsc holds it for the TypeScript projects, noUnusedLocals and noUnusedParameters in tsconfig.json and
//   installer/tsconfig.json, naming the file, the line and the symbol.
// - eslint holds it for the files no tsconfig includes (this one, and a .js or .mjs beside the sources), and for
//   the one case the compiler does not look at at all: a catch binding nobody reads.
// Both accept the `_` prefix this repository already uses for a name it cannot avoid, such as a handler that must
// take the place it is given and does not read it.
import tseslint from 'typescript-eslint'

export const STRUCTURAL_CAPS = {
  'max-depth': ['error', { max: 2 }],
  complexity: ['error', { max: 9 }],
  'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
}

/** The unused rule's settings, the same for the compiler's half and eslint's half (martha#171). */
export const UNUSED_RULE = [
  'error',
  {
    args: 'after-used',
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrors: 'all',
    caughtErrorsIgnorePattern: '^_',
  },
]

export default [
  { ignores: ['node_modules/'] },
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { noInlineConfig: true },
    rules: STRUCTURAL_CAPS,
  },
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { '@typescript-eslint/no-unused-vars': UNUSED_RULE },
  },
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    rules: { 'no-unused-vars': UNUSED_RULE },
  },
]
