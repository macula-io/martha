#!/usr/bin/env bash
# run_the_night_on_main.sh <ssh-host> --evidence <folder> [--sha <sha40>] [--proof-tree <git checkout>] [-- <proof args>]
#
# The nightly live run's driver (martha#696, on #639's path): it packs main at a commit with the packer beside it,
# pack_main_as_a_dry_layer.sh, and runs the clean-install proof on that layer as a dry run, with the night's evidence
# kept under one folder.
#
# 1. The arguments are read before anything else runs. The host is a parameter and is never named here, as the proof
#    takes it: this repository is public. The evidence root is a parameter too, so no one's home is written here.
# 2. The proof checkout (--proof-tree, default this repository) must be clean, and its proof must define DRY_PASSED,
#    the code of a dry pass, read from the proof itself and never spelled here. The packer must define NOT_PACKABLE
#    the same way. A missing one refuses the run before anything is packed.
# 3. The repository is fetched, and the sha is origin/main, or the given one, which must be a commit here.
# 4. The packer packs main at the sha into <evidence>/<date>_<sha7>/, and the layer's sha256 is kept in run.txt.
# 5. The proof runs with --log in the same folder and --dry-layer <layer> <sha>. When the proof names --night in its
#    usage, it is also given --night <that folder>/NIGHT_FOLDER_NAME, a path the driver names and never makes: the
#    proof makes its own run folder and refuses one that is there. Anything after `--` goes to the proof unchanged.
#    The driver never reads, copies or passes the live token; the proof reads its own.
#
# The run has one temp folder, given to the packer and the proof as TMPDIR, and the EXIT trap removes it, so a temp
# file a signal strands between a child's mktemp and its rm goes with it. A signal stops the child as well: a Ctrl-C
# reaches the child through the process group, and its own INT trap runs; a TERM to the driver alone is passed on.
#
# Exit: the proof's own exit, 1 to DRY_PASSED, with DRY_PASSED for a dry pass, never 0; or one of the driver's own codes
# below, each above the proof's highest, DRY_PASSED, so an exit says by its number alone whose it is. The proof's 2 (it
# refused its arguments) comes after pack_exit=0 in run.txt; the driver's REFUSED is the driver refusing its own, before
# anything was packed. A proof that exits 0 on a dry layer claims a release's pass, which a dry run never is, so that is
# FAILED, and so is a run a signal stopped. The packer's exits are not passed through, because its codes collide with
# the proof's: the packer's NOT_PACKABLE is 3, and the proof's 3 is "the registry carries no release". So a packer that
# refused or could not run is PACK_FAILED, and a tree whose installer/ names differ from its tag's is NOT_PACKABLE_TONIGHT,
# reported as "not packable" in the packer's own words, never as a pass. Before the proof runs the driver checks that each
# of its codes is above
# DRY_PASSED, the proof's highest code today, so a proof whose DRY_PASSED moves up to one of them is refused. A code the
# proof adds above its DRY_PASSED is not seen by that check: the proof's own Exit: line is where a new code is written.
set -euo pipefail

PACK_FAILED=6
NOT_PACKABLE_TONIGHT=7
REFUSED=8
FAILED=9
STOP_GRACE_SECONDS=20
NIGHT_FOLDER_NAME=night

HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
PACKER="${HERE}/pack_main_as_a_dry_layer.sh"
PROOF_REL='prove_a_clean_install_in_a_throwaway_container/prove_a_clean_install_in_a_throwaway_container.sh'
USAGE='usage: run_the_night_on_main.sh <ssh-host> --evidence <folder> [--sha <sha40>] [--proof-tree <git checkout>] [-- <proof args>]'

refuse() { printf 'night: %s\n' "$1" >&2; exit "${REFUSED}"; }

# The digits of NAME in a script: exactly one line starts `NAME=`, and it is `NAME=<digits>`; otherwise nothing. The
# same rule as read_a_scripts_constant.mjs, which the tests read the codes with.
a_scripts_constant() {
  local lines
  lines="$(sed -n "/^$2=/p" "$1")"
  [[ -n "${lines}" && "${lines}" != *$'\n'* && "${lines}" =~ ^$2=([0-9]+)$ ]] && printf '%s\n' "${BASH_REMATCH[1]}"
}

HOST="${1:-}"
[[ -n "${HOST}" && "${HOST}" != -* ]] || refuse "${USAGE}"
shift
EVIDENCE=''; SHA=''; PROOF_TREE="${REPO}"; PROOF_EXTRA=()
while (($#)); do
  case "$1" in
    --evidence) [[ -n "${2:-}" ]] || refuse "${USAGE}"; EVIDENCE="$2"; shift 2 ;;
    --sha) [[ -n "${2:-}" ]] || refuse "${USAGE}"; SHA="$2"; shift 2 ;;
    --proof-tree) [[ -n "${2:-}" ]] || refuse "${USAGE}"; PROOF_TREE="$2"; shift 2 ;;
    --) shift; PROOF_EXTRA=("$@"); break ;;
    *) refuse "${USAGE}" ;;
  esac
done
[[ -n "${EVIDENCE}" ]] || refuse "${USAGE}"
[[ -d "${EVIDENCE}" ]] || refuse "the evidence root ${EVIDENCE} is not a folder"
EVIDENCE="$(cd "${EVIDENCE}" && pwd)"
[[ -z "${SHA}" || "${SHA}" =~ ^[0-9a-f]{40}$ ]] || refuse "--sha takes a 40-character sha, not ${SHA}"

PROOF="${PROOF_TREE}/${PROOF_REL}"
[[ -f "${PROOF}" ]] || refuse "${PROOF_TREE} holds no proof at ${PROOF_REL}"
[[ -z "$(git -C "${PROOF_TREE}" status --porcelain)" ]] || refuse "the proof tree ${PROOF_TREE} is not clean"
DRY_PASSED="$(a_scripts_constant "${PROOF}" DRY_PASSED)" || refuse "the proof in ${PROOF_TREE} defines no DRY_PASSED, so it takes no --dry-layer"
NOT_PACKABLE="$(a_scripts_constant "${PACKER}" NOT_PACKABLE)" || refuse "the packer defines no NOT_PACKABLE"
for code in "${PACK_FAILED}" "${NOT_PACKABLE_TONIGHT}" "${REFUSED}" "${FAILED}"; do
  ((code > DRY_PASSED)) || refuse "the driver's code ${code} is not above the proof's DRY_PASSED ${DRY_PASSED}, so an exit could not say whose it is"
done

git -C "${REPO}" fetch --quiet origin || refuse "git could not fetch origin in ${REPO}"
[[ -n "${SHA}" ]] || SHA="$(git -C "${REPO}" rev-parse origin/main)"
git -C "${REPO}" cat-file -e "${SHA}^{commit}" 2> /dev/null || refuse "${SHA} is not a commit in ${REPO}"

RUN="${EVIDENCE}/$(date +%F)_${SHA:0:7}"
LAYER="${RUN}/main-${SHA:0:7}.tar.gz"
[[ ! -e "${LAYER}" ]] || refuse "${LAYER} is there already: tonight's run for this sha has its folder"
mkdir -p "${RUN}"

RUN_TMP="$(mktemp -d)"
CHILD=''
trap 'rm -rf "${RUN_TMP}"' EXIT
# A child asked to stop gets STOP_GRACE_SECONDS to clean up behind its own TERM trap (the proof removes its container),
# and is then killed, so a child that ignores TERM or hangs in its trap cannot hold the driver past the bound. The kill
# reaches the child only: what it started and did not stop is its own to leave.
stop() {
  if [[ -n "${CHILD}" ]]; then
    kill -TERM "${CHILD}" 2> /dev/null || true
    local tenths=0
    while kill -0 "${CHILD}" 2> /dev/null && ((tenths < STOP_GRACE_SECONDS * 10)); do sleep 0.1; tenths=$((tenths + 1)); done
    kill -KILL "${CHILD}" 2> /dev/null || true
    wait "${CHILD}" 2> /dev/null || true
  fi
  printf 'night: stopped by a signal; evidence %s\n' "${RUN}" >&2
  printf 'interrupted=%s\n' "$(date -Is)" >> "${RUN}/run.txt"
  exit "${FAILED}"
}
trap stop INT TERM

# A child in the background, its standard input this run's own, and waited for, so a signal reaches the trap at once
# rather than after the child ends. Its exit is in CHILD_EXIT. Bash starts a background child of a script with SIGINT
# ignored, and a signal ignored when a program starts cannot be trapped, so the proof would never see a Ctrl-C: the
# subshell puts INT back to its default before it execs the child, and the child's own INT trap then works.
run_child() {
  (trap - INT; TMPDIR="${RUN_TMP}" exec "$@") 0<&0 &
  CHILD=$!
  local rc=0
  wait "${CHILD}" || rc=$?
  CHILD=''
  CHILD_EXIT="${rc}"
}

{
  printf 'run_folder=%s\n' "${RUN}"
  printf 'sha=%s\n' "${SHA}"
  printf 'proof_tree=%s at %s\n' "${PROOF_TREE}" "$(git -C "${PROOF_TREE}" rev-parse HEAD)"
  printf 'started=%s\n' "$(date -Is)"
} > "${RUN}/run.txt"

run_child "${PACKER}" "${SHA}" "${LAYER}" > "${RUN}/pack.log" 2>&1
printf 'pack_exit=%s\n' "${CHILD_EXIT}" >> "${RUN}/run.txt"
if [[ "${CHILD_EXIT}" -ne 0 ]]; then
  if [[ "${CHILD_EXIT}" -eq "${NOT_PACKABLE}" ]]; then
    # The packer's own reason, in its own words and read from its own log: NOT_PACKABLE means installer/'s martha names
    # differ from its tag's, and a wording restated here would drift from the packer's the next time it changed.
    PACKERS_REASON="$(awk '/^dry: not packable: /{sub(/^dry: not packable: /, ""); print; exit}' "${RUN}/pack.log")"
    # What NOT_PACKABLE means now, for a packer that said nothing of its own. Given as its own assignment: an apostrophe
    # inside a `${VAR:-default}` between double quotes ends the parsing early and eats the line's redirection.
    [[ -n "${PACKERS_REASON}" ]] || PACKERS_REASON="installer/ names differ from its tag's"
    printf 'result=not packable: %s\n' "${PACKERS_REASON}" >> "${RUN}/run.txt"
    printf 'night: not packable: %s at %s; nothing was proven; evidence %s\n' "${PACKERS_REASON}" "${SHA}" "${RUN}" >&2
    exit "${NOT_PACKABLE_TONIGHT}"
  fi
  printf 'result=the packer exited %s\n' "${CHILD_EXIT}" >> "${RUN}/run.txt"
  printf 'night: the packer exited %s; nothing was proven; evidence %s\n' "${CHILD_EXIT}" "${RUN}" >&2
  exit "${PACK_FAILED}"
fi
printf 'layer_sha256=%s\n' "$(sha256sum "${LAYER}" | sed 's/ .*//')" >> "${RUN}/run.txt"

# Main's own installer, when the packer packed one: a drifted tree's proof is given it and its digest, so the night
# proves main's installer rather than the published one and says so on its result line (martha#695 Done-when 2, #696).
DRY_INSTALLER_ARGS=()
PACKED_AS="$(awk '/^dry: main.s installer at .* packed as .* \(sha256:[0-9a-f]+\)$/{print; exit}' "${RUN}/pack.log")"
if [[ -n "${PACKED_AS}" ]]; then
  DRY_TARBALL="${PACKED_AS##* packed as }"
  DRY_TARBALL="${DRY_TARBALL% (sha256:*}"
  DRY_DIGEST="sha256:${PACKED_AS##* (sha256:}"
  DRY_DIGEST="${DRY_DIGEST%)}"
  DRY_INSTALLER_ARGS=(--dry-installer "${DRY_TARBALL}" "${DRY_DIGEST}")
  printf 'dry_installer=%s %s\n' "${DRY_TARBALL}" "${DRY_DIGEST}" >> "${RUN}/run.txt"
fi

NIGHT_ARGS=()
if sed -n 's/^USAGE=//p' "${PROOF}" | sed -n '/\[--night </p' | read -r _; then
  NIGHT_ARGS=(--night "${RUN}/${NIGHT_FOLDER_NAME}")
  printf 'night_folder=%s\n' "${RUN}/${NIGHT_FOLDER_NAME}" >> "${RUN}/run.txt"
fi

run_child "${PROOF}" "${HOST}" --log "${RUN}/proof.log" "${NIGHT_ARGS[@]}" --dry-layer "${LAYER}" "${SHA}" "${DRY_INSTALLER_ARGS[@]}" "${PROOF_EXTRA[@]}"
PROOF_EXIT="${CHILD_EXIT}"
printf 'proof_exit=%s\nended=%s\n' "${PROOF_EXIT}" "$(date -Is)" >> "${RUN}/run.txt"
if [[ "${PROOF_EXIT}" -eq 0 ]]; then
  printf 'night: the proof claimed a release'"'"'s pass on a dry layer; evidence %s\n' "${RUN}" >&2
  exit "${FAILED}"
fi
printf 'night: the proof exited %s (%s is a dry pass); evidence %s\n' "${PROOF_EXIT}" "${DRY_PASSED}" "${RUN}"
exit "${PROOF_EXIT}"
