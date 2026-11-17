// The coincidences of check_the_workspace_matches_its_layout: words its own files spell like a constant held elsewhere,
// meaning something else by them, each with its reason (martha#289, #522). Read by the restated-values check as a syntax
// tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'

export const COINCIDENCES: readonly Exception[] = [
  // `config` here is git's own subcommand in `git config --get remote.origin.url`, the one question a scan asks a clone
  // to tell one repository from another. The slice that also spells the word, ../find_what_a_later_git_run_reads, is a
  // host adapter, and a core slice may not import an adapter (prove_the_core's setting rule): borrowing its constant
  // would tie this check to an adapter's file, so the word is git's own here, named as such.
  { value: 'config', file: 'check_the_workspace_matches_its_layout/check_the_workspace_matches_its_layout.ts', reason: "git's own subcommand, not the adapter's constant, which a core slice may not import (martha#562)" },
  { value: 'config', file: 'check_the_workspace_matches_its_layout/check_the_workspace_matches_its_layout.node-test.ts', reason: "the same word as git's own subcommand in a test that asks a real clone where it came from (martha#562)" },
]
