#!/usr/bin/env bash
# declare_the_floor.sh <version> <folder>: write the version floor the release <version> declares (martha#21, R9 of
# #84) into its packed folder, from the tree's floor.txt, as <folder>/<floorFile> = { "floor": "X.Y.Z" }.
#
# This is the release's half of the floor: the layer the release signature covers says which floor that release
# holds a machine to. It refuses, before anything is built or tagged:
#   - no floor.txt, or one that is not one X.Y.Z line;
#   - a floor.txt above <version>: a release never declares a floor above itself;
#   - a floor.json already in the tree: it is generated here, never committed;
#   - a floor-withdrawal.json that is not { "version": "X.Y.Z", "from": "X.Y.Z" }, that lowers nothing, or whose
#     `from` is below floor.txt: once the floor has risen past it, a withdrawal is dead and never ships.
# Versions are compared as whole numbers, so 0.10.0 is above 0.9.0. The release and the dry run both reach this through
# pack_a_release.sh. The file names come from the installer's package.json (installer/keep_the_names_in_one_place).
#
# Exit: 0 declared, 1 refused, 2 not how it is used.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
NAMES="${HERE}/../installer/package.json"
version="${1:-}"
folder="${2:-}"
VERSION_LINE='^[0-9]+\.[0-9]+\.[0-9]+$'
[[ "${version}" =~ ${VERSION_LINE} && -d "${folder}" ]] || { echo "usage: declare_the_floor.sh <X.Y.Z> <packed release folder>" >&2; exit 2; }

floor_file="$(jq -r '.martha.floorFile // empty' "${NAMES}")"
withdrawal_file="$(jq -r '.martha.withdrawalFile // empty' "${NAMES}")"
[[ -n "${floor_file}" && -n "${withdrawal_file}" ]] || { echo "declare_the_floor: installer/package.json names no floorFile or withdrawalFile" >&2; exit 2; }
project_floor="floor.txt"

refuse () { echo "declare_the_floor: $*" >&2; exit 1; }

# digits N: the part N without its leading zeros, so two parts compare as whole numbers at any length: bash's own
# arithmetic wraps past 2^63-1.
digits () {
  local part="${1#"${1%%[!0]*}"}"
  echo "${part:-0}"
}

# below A B: A is a lower version than B, compared part by part as whole numbers: a longer part is the larger, and two
# of one length compare digit by digit. The installer's compareVersions and the launcher's below order them the same
# way, held by installer/hold_the_version_floor/every_reader_agrees_on_the_floor.node-test.mjs (martha#433).
below () {
  local -a a b
  IFS=. read -r -a a <<<"$1"
  IFS=. read -r -a b <<<"$2"
  local i x y LC_ALL=C
  for i in 0 1 2; do
    x="$(digits "${a[i]}")"
    y="$(digits "${b[i]}")"
    if (( ${#x} != ${#y} )); then
      (( ${#x} < ${#y} )) && return 0
      return 1
    fi
    [[ "${x}" < "${y}" ]] && return 0
    [[ "${x}" > "${y}" ]] && return 1
  done
  return 1
}

[[ -f "${folder}/${project_floor}" ]] || refuse "the tree carries no ${project_floor}, so it declares no floor"
# One line, ended by a newline: what `$(<file)` would hide (a missing newline, a second line) is checked first.
[[ "$(wc -l < "${folder}/${project_floor}")" -eq 1 && "$(tail -c 1 "${folder}/${project_floor}" | od -An -tx1 | tr -d ' ')" == 0a ]] \
  || refuse "${project_floor} is not one X.Y.Z line"
floor="$(<"${folder}/${project_floor}")"
[[ "${floor}" =~ ${VERSION_LINE} ]] || refuse "${project_floor} is not one X.Y.Z line"
! below "${version}" "${floor}" || refuse "${project_floor} says ${floor}, above the release ${version}; a release never declares a floor above itself"
[[ ! -e "${folder}/${floor_file}" ]] || refuse "${floor_file} was packed; a release's floor is generated from ${project_floor}, never committed"

if [[ -e "${folder}/${withdrawal_file}" ]]; then
  shape="{ \"version\": \"X.Y.Z\", \"from\": \"X.Y.Z\" }"
  jq -e --arg line "${VERSION_LINE}" 'type == "object" and (keys == ["from", "version"]) and (.version | type == "string" and test($line)) and (.from | type == "string" and test($line))' \
    "${folder}/${withdrawal_file}" > /dev/null 2>&1 || refuse "${withdrawal_file} is not ${shape}"
  to="$(jq -r .version "${folder}/${withdrawal_file}")"
  from="$(jq -r .from "${folder}/${withdrawal_file}")"
  below "${to}" "${from}" || refuse "${withdrawal_file} goes to ${to} from ${from}, which lowers nothing"
  ! below "${from}" "${floor}" || refuse "${withdrawal_file} lowers from ${from}, below this release's floor ${floor}; a dead withdrawal never ships, delete it"
fi

jq -n --arg floor "${floor}" '{ floor: $floor }' > "${folder}/${floor_file}"
