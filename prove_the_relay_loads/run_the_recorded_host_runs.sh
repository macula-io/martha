#!/usr/bin/env bash
# run_the_recorded_host_runs.sh: every test case that drives the recorded host, one file at a time, with the binary the
# variable RECORDED_HOST_VARIABLE names (martha#383, martha#385).
#
# Two callers run it: prove_the_relay_loads.sh in ci.yml's relay job, after it has installed the host, and `npm test`,
# before the rest of the suite. The suite runs its files in parallel, and on a loaded machine a recorded-host case
# starves there and runs out of time for want of a core, not for anything it tests; here each file has the machine to
# itself. The parallel run that follows unsets the variable, so every marked case skips there and none runs twice.
#
# recorded_host_runs.json lists the runs, one entry per file (and name pattern), with how many cases must pass;
# check_every_recorded_host_test_is_run holds that count to the cases in the file, so a case the list misses fails by
# name. One function decides whether a run counts, the_run_is_whole: exactly the listed number of passes, none skipped,
# none failed. It is proved on three planted summaries before any run, one for each condition, so a guard that stopped
# checking one of them fails here by name rather than passing every run.
#
# Each run is bounded the way the suite's are (martha#56): a time limit per test (RUN_TIMEOUT_MS, defined here and
# nowhere else, above the cases' own silence budgets so their words come first), force-exit, and the guard that fails a
# file leaving something running. The last two are read from prove_the_core/every_test_run_ends.ts, never restated, and
# the runs start from the repository's top, where the guard's path holds. testRunBoundOf reads only the test script's
# words and cannot see these, so the runner holds its own argument list to all four (with --test-concurrency=1) before
# it runs anything, and refuses by name a list that lacks one. Each run goes through
# no_test_output_carries_the_environment.ts, so its output is held to the suite's two rules: no planted secret in it
# (martha#92), and it ends with its own summary (martha#325).
#
# Where the variable is unset nothing runs: it says how many runs it left to the relay job and exits 0, claiming no pass.
#
# Exit: 0 every run was whole (or none ran here, as it says), 1 a run was not whole or a self-test did not hold,
# 2 the runs could not be set up.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
NAME="prove_the_relay_loads"
HARNESS="src/launch_a_claude_code_member/drive_the_recorded_host.ts"
MARKER_FILE="src/check_every_recorded_host_test_is_run/recorded_host_skip.ts"
BOUNDS="./prove_the_core/every_test_run_ends.ts"
OUTPUT_CHECK="./prove_the_core/no_test_output_carries_the_environment.ts"
RUN_TIMEOUT_MS=300000
cd "${REPO}"

HOST_VARIABLE="$(sed -n "s/^export const RECORDED_HOST_VARIABLE = '\([^']*\)'$/\1/p" "${HARNESS}")"
[[ -n "${HOST_VARIABLE}" ]] || { echo "${NAME}: ${HARNESS} defines no RECORDED_HOST_VARIABLE" >&2; exit 2; }
RUNS="$(sed -n "s/^export const RECORDED_HOST_RUNS = '\([^']*\)'$/\1/p" "${MARKER_FILE}")"
[[ -f "${RUNS}" ]] || { echo "${NAME}: ${MARKER_FILE} names no RECORDED_HOST_RUNS list there is" >&2; exit 2; }
jq -e 'type == "array" and length > 0 and all(.[]; (.file | type == "string") and (.cases | type == "number" and . >= 1 and floor == .) and (.proves | type == "string"))' "${RUNS}" > /dev/null \
  || { echo "${NAME}: ${RUNS} is not a list of {file, name_pattern?, cases >= 1, proves}" >&2; exit 2; }
mapfile -t bounds < <(node --input-type=module -e "import { FORCE_EXIT_FLAG, GUARD_FLAG } from '${BOUNDS}'; console.log(FORCE_EXIT_FLAG); console.log(GUARD_FLAG)")
FORCE_EXIT_FLAG="${bounds[0]:-}"
GUARD_FLAG="${bounds[1]:-}"
[[ -n "${FORCE_EXIT_FLAG}" && -n "${GUARD_FLAG}" ]] || { echo "${NAME}: ${BOUNDS} gave no FORCE_EXIT_FLAG and GUARD_FLAG" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

# the_run_is_whole <summary-file> <cases>: the one test of a run (martha#385). Exactly <cases> passed, none was skipped
# and none failed; anything else, a case filtered out, skipped for want of the host or failed, is a run that proves
# nothing.
the_run_is_whole() {
  grep -qx "ℹ pass $2" "$1" && grep -qx 'ℹ skipped 0' "$1" && grep -qx 'ℹ fail 0' "$1"
}

# The guard bites, on each of its three conditions: each planted summary meets the other two, so only the one it plants
# can refuse it. Plain text, so this needs no host.
planted_cases="$(jq -r '.[0].cases' "${RUNS}")"
plant() { printf 'ℹ pass %s\nℹ fail %s\nℹ skipped %s\n' "$2" "$3" "$4" > "${WORK}/planted_$1.txt"; }
plant skipped "${planted_cases}" 0 1
plant short "$((planted_cases - 1))" 0 0
plant failed "${planted_cases}" 1 0
the_run_is_whole "${WORK}/planted_skipped.txt" "${planted_cases}" && { echo "${NAME}: the run guard accepts a run with a skipped case; it would not bite" >&2; exit 1; }
the_run_is_whole "${WORK}/planted_short.txt" "${planted_cases}" && { echo "${NAME}: the run guard accepts a run one case short; it would not bite" >&2; exit 1; }
the_run_is_whole "${WORK}/planted_failed.txt" "${planted_cases}" && { echo "${NAME}: the run guard accepts a run with a failed case; it would not bite" >&2; exit 1; }

# Every run's arguments, held to the four things that bound it before anything runs.
RUN_ARGS=(--test --test-reporter=spec --test-concurrency=1 --test-timeout="${RUN_TIMEOUT_MS}" "${FORCE_EXIT_FLAG}" "${GUARD_FLAG}")
holds() { local want="$1" word; for word in "${RUN_ARGS[@]}"; do [[ "${word}" == ${want} ]] && return 0; done; return 1; }
holds '--test-concurrency=1' || { echo "${NAME}: the runs' arguments lack --test-concurrency=1; the recorded-host files would share the machine" >&2; exit 1; }
for word in "${RUN_ARGS[@]}"; do
  [[ "${word}" == --test-concurrency=* && "${word}" != '--test-concurrency=1' ]] && { echo "${NAME}: the runs' arguments say ${word}; the recorded-host files must run one at a time" >&2; exit 1; }
done
holds '--test-timeout=[1-9]*' || { echo "${NAME}: the runs' arguments lack --test-timeout; a hung case would never fail (martha#56)" >&2; exit 1; }
holds "${FORCE_EXIT_FLAG}" || { echo "${NAME}: the runs' arguments lack ${FORCE_EXIT_FLAG}; a file holding a handle open would never exit (martha#56)" >&2; exit 1; }
holds "${GUARD_FLAG}" || { echo "${NAME}: the runs' arguments lack ${GUARD_FLAG}; a file leaving something running would pass silently (martha#56)" >&2; exit 1; }

count="$(jq 'length' "${RUNS}")"
if [[ -z "${!HOST_VARIABLE:-}" ]]; then
  echo "${NAME}: ${count} recorded-host run(s) not run here; ci.yml's relay job runs them"
  exit 0
fi
said="$("${!HOST_VARIABLE}" --version)"
version="${said%% *}"

# Every listed run, in this host, one file at a time, each held to the_run_is_whole.
while IFS= read -r run; do
  file="$(jq -r '.file' <<< "${run}")"
  pattern="$(jq -r '.name_pattern // empty' <<< "${run}")"
  cases="$(jq -r '.cases' <<< "${run}")"
  proves="$(jq -r '.proves' <<< "${run}")"
  narrowed=()
  [[ -n "${pattern}" ]] && narrowed=(--test-name-pattern="${pattern}")
  log="${WORK}/run_$(basename "${file}").txt"
  if ! node "${OUTPUT_CHECK}" node "${RUN_ARGS[@]}" "${narrowed[@]}" "${file}" > "${log}" 2>&1; then
    echo "${NAME}: with Claude Code ${version}, a case of ${file} failed:" >&2
    cat "${log}" >&2
    echo "${NAME}: a recorded-host run failed, so the rest of the suite did not run" >&2
    exit 1
  fi
  the_run_is_whole "${log}" "${cases}" || {
    echo "${NAME}: ${file} did not run its ${cases} listed case(s) whole in this host; a skipped or missing case proves nothing:" >&2
    cat "${log}" >&2
    echo "${NAME}: a recorded-host run was not whole, so the rest of the suite did not run" >&2
    exit 1
  }
  echo "${NAME}: with Claude Code ${version}, ${proves}"
done < <(jq -c '.[]' "${RUNS}")
