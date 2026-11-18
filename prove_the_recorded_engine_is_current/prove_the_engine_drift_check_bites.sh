#!/usr/bin/env bash
# prove_the_engine_drift_check_bites.sh: the engine recorder's --check passes on a tree that says what the recording
# says and fails, by name, on one that does not (macula-io/martha#541, package 10). It runs on every PR with no
# checkout of the engine: the tests build their tree from the recording's own facts. So the checker is proven on every
# tip, and only the scheduled comparison depends on the fork.
#
# Every test in the files must run and pass: a skipped or filtered-out test would let a check that cannot bite go green.
#
# Exit: 0 every test ran and passed, 1 otherwise.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
TESTS=(
  "${REPO}/src/record_the_goose_engine/record_the_goose_engine.node-test.ts"
  "${REPO}/src/know_the_goose_engines_facts/the_engines_facts_in_its_source.node-test.ts"
)
OUT="$(mktemp)"
trap 'rm -f "${OUT}"' EXIT

# Each run is bounded the way the suite's are (martha#56, martha#683): a time limit per test, force-exit, and the guard
# that fails a file leaving something running. The last two are read from prove_the_core/every_test_run_ends.ts, never
# restated, and the runs start from the repository's top, where the guard's path holds.
cd "${REPO}"
BOUNDS="./prove_the_core/every_test_run_ends.ts"
RUN_TIMEOUT_MS=300000
mapfile -t bounds < <(node --input-type=module -e "import { FORCE_EXIT_FLAG, GUARD_FLAG } from '${BOUNDS}'; console.log(FORCE_EXIT_FLAG); console.log(GUARD_FLAG)")
FORCE_EXIT_FLAG="${bounds[0]:-}"
GUARD_FLAG="${bounds[1]:-}"
[[ -n "${FORCE_EXIT_FLAG}" && -n "${GUARD_FLAG}" ]] || { echo "prove_the_engine_drift_check_bites: ${BOUNDS} gave no FORCE_EXIT_FLAG and GUARD_FLAG" >&2; exit 2; }

status=0
node --test --test-timeout="${RUN_TIMEOUT_MS}" "${FORCE_EXIT_FLAG}" "${GUARD_FLAG}" --test-reporter=spec "${TESTS[@]}" > "${OUT}" 2>&1 || status=$?
count() { sed -nE "s/^ℹ $1 ([0-9]+)$/\1/p" "${OUT}"; }
tests="$(count tests)"
passed="$(count pass)"
skipped="$(count skipped)"
if [[ "${status}" -ne 0 || -z "${tests}" || "${tests}" -eq 0 || "${passed}" != "${tests}" || "${skipped}" != "0" ]]; then
  cat "${OUT}" >&2
  echo "prove_the_engine_drift_check_bites: ${passed:-?} of ${tests:-?} tests passed, ${skipped:-?} skipped" >&2
  exit 1
fi
echo "prove_the_engine_drift_check_bites: all ${tests} tests of the engine drift check ran and passed"
