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

status=0
node --test --test-reporter=spec "${TESTS[@]}" > "${OUT}" 2>&1 || status=$?
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
