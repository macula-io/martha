#!/usr/bin/env bash
# prove_the_bash_answers_bites.sh: the Bash-answers harness can fail, and it never passes on cases it did not compare
# (martha#812). It runs on every PR, with no host installed and no npm: the comparison is driven with two recordings the
# tests write, and the live mode with a stand-in `claude` that never answers.
#
# Every test in the file must run and pass: a skipped or filtered-out test would let a harness that cannot bite go green.
#
# Exit: 0 every test ran and passed, 1 otherwise.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
TESTS="${REPO}/src/claude_code_host/the_bash_answers_bite.node-test.ts"
OUT="$(mktemp)"
trap 'rm -f "${OUT}"' EXIT

# Each run is bounded the way the suite's are (martha#56, martha#683): a time limit per test, force-exit, and the guard
# that fails a file leaving something running. All three come from their one definition (the_runs_bounds.sh), and the
# run starts from the repository's top, where the guard's path holds.
cd "${REPO}"
source "${REPO}/prove_the_relay_loads/the_runs_bounds.sh"

status=0
node --test --test-timeout="${RUN_TIMEOUT_MS}" "${FORCE_EXIT_FLAG}" "${GUARD_FLAG}" --test-reporter=spec "${TESTS}" > "${OUT}" 2>&1 || status=$?
count() { sed -nE "s/^ℹ $1 ([0-9]+)$/\1/p" "${OUT}"; }
tests="$(count tests)"
passed="$(count pass)"
skipped="$(count skipped)"
if [[ "${status}" -ne 0 || -z "${tests}" || "${tests}" -eq 0 || "${passed}" != "${tests}" || "${skipped}" != "0" ]]; then
  cat "${OUT}" >&2
  echo "prove_the_bash_answers_bites: ${passed:-?} of ${tests:-?} tests passed, ${skipped:-?} skipped" >&2
  exit 1
fi
echo "prove_the_bash_answers_bites: all ${tests} tests of the Bash-answers harness ran and passed"
