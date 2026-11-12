#!/usr/bin/env bash
# install_the_recorded_host.sh <dir>: prints the path of the host Martha's adapter was recorded from, installing it
# into <dir> when it is not there yet (the same install prove_the_relay_loads makes, from the recording and never from
# a version typed here).
#
# The observations beside this script start a real member on the real host: a stand-in for the model is the only thing
# this repository supplies. A run that found no host would observe nothing, so this refuses by name instead.
#
# Exit: 0 and the binary's path on stdout, 2 the host could not be set up.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
RECORDING="${REPO}/src/claude_code_host/recorded_claude_code_host.json"
HARNESS="${REPO}/src/launch_a_claude_code_member/drive_the_recorded_host.ts"
VARIABLE_CONSTANT="RECORDED_HOST_VARIABLE"
WORK="${1:-$(mktemp -d)}"
mkdir -p "${WORK}"

version="$(jq -r '.host_version // empty' "${RECORDING}")"
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "install_the_recorded_host: ${RECORDING} names no host version" >&2; exit 2; }
variable="$(sed -n "s/^export const ${VARIABLE_CONSTANT} = '\([A-Z_]*\)'$/\1/p" "${HARNESS}")"
[[ -n "${variable}" ]] || { echo "install_the_recorded_host: ${HARNESS} defines no ${VARIABLE_CONSTANT}" >&2; exit 2; }

claude="${WORK}/${variable}-${version}/node_modules/.bin/claude"
if [[ ! -x "${claude}" ]]; then
  npm install --prefix "${WORK}/${variable}-${version}" --no-save --no-package-lock --no-audit --no-fund "@anthropic-ai/claude-code@${version}" > /dev/null \
    || { echo "install_the_recorded_host: Claude Code ${version} could not be installed" >&2; exit 2; }
fi

said="$("${claude}" --version)"
[[ "${said%% *}" == "${version}" ]] || { echo "install_the_recorded_host: installed a host that says '${said}', not ${version}" >&2; exit 2; }

echo "${claude}"
