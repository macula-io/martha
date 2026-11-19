#!/usr/bin/env bash
# the_recorded_host_installed.sh <where-to-install-it>: the Claude Code release the recording is of, installed from
# npm, for the checks that must first prove themselves on a known host (martha#812).
#
# The Bash-answers harness reproduces the committed answers on the recorded release before its answer on a new one
# counts. That is the hand method's rule since martha#212, and it needs the recorded release installed beside npm's
# `latest`, which host-drift.yml's first step already leaves behind.
#
# The version is read from src/claude_code_host/recorded_claude_code_host.json, never typed here, and the installed host
# is held to naming it: an install that says another version is no control at all.
#
# Exit: 0 the recorded release is installed where asked and says it is that version, 2 it could not be.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
RECORDING="${REPO}/src/claude_code_host/recorded_claude_code_host.json"
PACKAGE="@anthropic-ai/claude-code"
WHERE="${1:?usage: the_recorded_host_installed.sh <where-to-install-it>}"

version="$(jq -r '.host_version // empty' "${RECORDING}")"
[[ -n "${version}" ]] || { echo "the_recorded_host_installed: ${RECORDING} names no host_version" >&2; exit 2; }

mkdir -p "${WHERE}"
npm install --prefix "${WHERE}" --no-save --no-package-lock --no-audit --no-fund "${PACKAGE}@${version}" > /dev/null \
  || { echo "the_recorded_host_installed: Claude Code ${version} could not be installed" >&2; exit 2; }
claude="$(readlink -f "${WHERE}/node_modules/.bin/claude")"
said="$("${claude}" --version)"
[[ "${said%% *}" == "${version}" ]] \
  || { echo "the_recorded_host_installed: installed a host that says '${said}', not ${version}" >&2; exit 2; }

echo "the_recorded_host_installed: Claude Code ${version}, the release the recording is of, is at ${WHERE}"
