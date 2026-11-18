#!/usr/bin/env bash
# prove_the_recorded_engine_is_current.sh <work-dir> [--at-the-pin]: the committed recording of the Goose engine
# (src/know_the_goose_engines_facts/recorded_goose_engine.json) still says what the engine's source says
# (macula-io/martha#541, package 10).
#
# The engine is the fork named below. With no second argument this checks out the tip of its default branch, the
# engine the next build of a member's engine comes from, and runs the recorder's --check against it: any fact that
# differs fails, the version alone included. A commit that moved no fact passes, and the output names both commits.
#
# With --at-the-pin it checks out the commit the recording names instead, and the check must pass there: that is what
# proves, on every PR, that the reader reads the engine's real source and not only the tree the tests build.
#
# The fix for a failure on the tip is a re-record, never a retry:
#   npm run record:goose-engine -- <a checkout of the engine> <its commit>
# then a PR with whatever the named facts call for in the launch and the adapter.
#
# --check's standard output carries versions, commits and fact or part names only, since the run's log is public.
#
# Exit: 0 the recording is current, 1 it is not (or a part cannot be read), 2 the engine could not be checked out.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
RECORDER="${REPO}/src/record_the_goose_engine/record_the_goose_engine.ts"
RECORDING="${REPO}/src/know_the_goose_engines_facts/recorded_goose_engine.json"
# The engine members run, and the branch its builds come from. Moving the crew to another engine is a decision made
# here in a reviewed PR.
ENGINE_REPOSITORY="macula-apps/martha-engine"
ENGINE_BRANCH="main"
WORK="${1:?usage: prove_the_recorded_engine_is_current.sh <work-dir> [--at-the-pin]}"
AT_THE_PIN="${2:-}"
[[ -z "${AT_THE_PIN}" || "${AT_THE_PIN}" == "--at-the-pin" ]] \
  || { echo "prove_the_recorded_engine_is_current: the second argument is --at-the-pin or nothing, not '${AT_THE_PIN}'" >&2; exit 2; }
ENGINE="${WORK}/engine"
mkdir -p "${ENGINE}"
trap 'rm -rf "${WORK}"' EXIT

if [[ -n "${AT_THE_PIN}" ]]; then
  ref="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).engine_commit)' "${RECORDING}")"
else
  ref="${ENGINE_BRANCH}"
fi

git -C "${ENGINE}" init --quiet
git -C "${ENGINE}" fetch --quiet --depth 1 "https://github.com/${ENGINE_REPOSITORY}.git" "${ref}" \
  || { echo "prove_the_recorded_engine_is_current: ${ENGINE_REPOSITORY} ${ref} could not be fetched" >&2; exit 2; }
git -C "${ENGINE}" checkout --quiet --detach FETCH_HEAD
commit="$(git -C "${ENGINE}" rev-parse HEAD)"

status=0
node "${RECORDER}" --check "${ENGINE}" "${commit}" || status=$?
[[ "${status}" -eq 0 ]] && echo "prove_the_recorded_engine_is_current: the recording says what ${ENGINE_REPOSITORY} says at ${commit}"
exit "${status}"
