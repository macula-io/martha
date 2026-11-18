#!/usr/bin/env bash
# the_runs_bounds.sh: the three things that bound a run of the tests (martha#56, martha#683), in one place.
#
# Sourced, never run. A caller has already changed to the repository's top, where the guard's path holds, and gets three
# variables: RUN_TIMEOUT_MS, FORCE_EXIT_FLAG and GUARD_FLAG. The time limit is defined here and nowhere else; the last
# two are read from prove_the_core/every_test_run_ends.ts, never restated. A bounds read that comes back empty exits 2
# with a line naming it, before the caller runs anything unbounded.
#
# Exit: a caller that gets this far has all three.
set -euo pipefail

THE_BOUNDS="./prove_the_core/every_test_run_ends.ts"

# A time limit per test, above the recorded hosts' own silence budgets, so their words come first.
RUN_TIMEOUT_MS=300000

mapfile -t the_bounds_read < <(node --input-type=module -e "import { FORCE_EXIT_FLAG, GUARD_FLAG } from '${THE_BOUNDS}'; console.log(FORCE_EXIT_FLAG); console.log(GUARD_FLAG)")
FORCE_EXIT_FLAG="${the_bounds_read[0]:-}"
GUARD_FLAG="${the_bounds_read[1]:-}"
[[ -n "${FORCE_EXIT_FLAG}" && -n "${GUARD_FLAG}" ]] || { echo "${0##*/}: ${THE_BOUNDS} gave no FORCE_EXIT_FLAG and GUARD_FLAG" >&2; exit 2; }
