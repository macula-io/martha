#!/usr/bin/env bash
# file_the_drift.sh <summary-file> <run-url>: opens one issue for a failed drift run, or comments on the open one
# with the same title (martha#139). The drift job calls it on a failed scheduled or main run, so a release that
# differs from the recording is a backlog item, not a red run nobody reads.
#
# The repository is public. The issue carries only what --check prints on standard output (versions and the names
# of fields or parts), and only lines of exactly those shapes: anything else in the summary is dropped.
#
# Needs GH_TOKEN with issues: write, and GITHUB_REPOSITORY.
set -euo pipefail

SUMMARY="${1:?usage: file_the_drift.sh <summary-file> <run-url>}"
RUN_URL="${2:?usage: file_the_drift.sh <summary-file> <run-url>}"
LABEL="backlog"
VERSIONS_LINE='^recorded [0-9]+\.[0-9]+\.[0-9]+, host [0-9]+\.[0-9]+\.[0-9]+$'
NAMES_LINE='^(differs|unreadable): [a-z_ ,]+$'

lines="$(grep -E "${VERSIONS_LINE}|${NAMES_LINE}" "${SUMMARY}" || true)"
host="$(sed -nE 's/^recorded [0-9.]+, host ([0-9.]+)$/\1/p' <<< "${lines}")"
if [[ -n "${host}" ]]; then
  title="Claude Code ${host} differs from the recording"
else
  title="The Claude Code drift check could not compare a host with the recording"
  lines="The check stopped before it compared anything: the host could not be found or installed."
fi

body="$(cat <<EOF
Purpose (security): the recording of the Claude Code host describes the version members run again, so every prompt kind and session start source that version can send has a declared arrival.

${lines}

Run: ${RUN_URL}

The fix is a re-record, not a retry: \`npm run record:claude-code-host -- <claude binary> <version>\`, then a PR with whatever the fields named above call for (martha#139).
EOF
)"

open="$(gh issue list --repo "${GITHUB_REPOSITORY}" --state open --search "\"${title}\" in:title" --json number,title \
  --jq "map(select(.title == \"${title}\")) | first | .number // empty")"
if [[ -n "${open}" ]]; then
  gh issue comment "${open}" --repo "${GITHUB_REPOSITORY}" --body "${body}"
else
  gh issue create --repo "${GITHUB_REPOSITORY}" --title "${title}" --label "${LABEL}" --body "${body}"
fi
