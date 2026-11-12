#!/usr/bin/env bash
# watch_two_members_reach_each_other.sh: the live observation for macula-io/martha#253.
#
# Two members of one crew, started by Martha on the recorded host, exchange a HANDOFF and a VERDICT through the crew's
# channel while one of them is inside a subagent's turn, and each takes in what the other sent. This installs the
# recorded host (./install_the_recorded_host.sh) and prints PASS or FAIL by name for each thing it saw.
#
# Needs the network: the host is installed from npm. TMPDIR should be short: a launch binds a socket under it.
#
# Exit: 0 every check passed, 1 one did not (it says which, by name), 2 the host or an observation could not be set up.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

host="$("${HERE}/install_the_recorded_host.sh" "${WORK}/host")"
variable="$(sed -n "s/^export const RECORDED_HOST_VARIABLE = '\([A-Z_]*\)'$/\1/p" "${HERE}/../src/launch_a_claude_code_member/drive_the_recorded_host.ts")"
[[ -n "${variable}" ]] || { echo "watch_two_members_reach_each_other: the drive names no RECORDED_HOST_VARIABLE" >&2; exit 2; }

status=0
env "${variable}=${host}" node "${HERE}/watch_two_members_reach_each_other.ts" || status=$?
exit "${status}"
