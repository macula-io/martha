#!/usr/bin/env bash
# watch_a_member_keep_its_shell.sh: the live observation for macula-io/martha#251.
#
# A member's first mesh answer must not cost it the shell it needs to ring: with the strict shell gate on, a member
# whose first tool call is `mesh_hello` still rings a crew mate and still runs a command of its own. This starts the
# real member on the landed tree with the recorded host (./install_the_recorded_host.sh), and prints PASS or FAIL by
# name for each thing it saw.
#
# Needs the network: a member's hello and its ring go to the mesh, and a host and a mesh server are installed from
# npm. TMPDIR should be short: a launch binds a socket under it.
#
# Exit: 0 every check passed, 1 one did not (it says which, by name), 2 the host or an observation could not be set up.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

host="$("${HERE}/install_the_recorded_host.sh" "${WORK}/host")"
variable="$(sed -n "s/^export const RECORDED_HOST_VARIABLE = '\([A-Z_]*\)'$/\1/p" "${HERE}/../src/launch_a_claude_code_member/drive_the_recorded_host.ts")"
[[ -n "${variable}" ]] || { echo "watch_a_member_keep_its_shell: the drive names no RECORDED_HOST_VARIABLE" >&2; exit 2; }

status=0
env "${variable}=${host}" node "${HERE}/watch_a_member_keep_its_shell.ts" || status=$?
exit "${status}"
