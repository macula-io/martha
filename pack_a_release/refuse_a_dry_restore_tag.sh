#!/usr/bin/env bash
# refuse_a_dry_restore_tag.sh <release tag> [<remote>]: a release tag whose history holds the dry packer's own commit
# is refused here, before anything is packed or pushed (martha#695, T1a).
#
# The dry packer, rehearse_a_release/place_main_as_a_dry_release/pack_main_as_a_dry_layer.sh, makes one commit in a
# throwaway clone when main's installer/ has moved past its tag: it restores installer/ from that tag and marks the
# commit with DRY_RESTORE_SUBJECT (the module beside the packer, read here and never spelled). That commit must never
# reach a release. A release carrying it would ship a layer whose tree its tag does not hold, while its pin named the
# published installer -- which is exactly what martha#84 keeps apart.
#
# The history it reads is the tag's, back to the release tag before it by version order; with no tag before it, the
# tag's whole history. A release job checks out shallow, so the range is deepened for exactly that much: the tag is
# fetched again with `git fetch --shallow-exclude`, which brings the commits after the previous tag and no more. When
# the previous tag is not in this tag's history, the whole history is fetched instead, because the range it would cut
# would be a guess.
#
# Exit: 0 no dry run's commit in the range, 1 one or more found (each named with its sha, subject and range),
# 2 the check could not be made. It never passes because it could not look.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
DRY_RESTORE_MODULE="${REPO}/rehearse_a_release/place_main_as_a_dry_release/dry_restore.mjs"
INSTALLER_PACKAGE="${REPO}/installer/package.json"
NAME='refuse_a_dry_restore_tag'

TAG="${1:-}"
REMOTE="${2:-origin}"
[[ -n "${TAG}" ]] || { echo "${NAME}: usage: refuse_a_dry_restore_tag.sh <release tag> [<remote>]" >&2; exit 2; }

SUBJECT="$(node --input-type=module -e 'const { DRY_RESTORE_SUBJECT } = await import(process.argv[1]); console.log(DRY_RESTORE_SUBJECT)' "${DRY_RESTORE_MODULE}")" \
  || { echo "${NAME}: ${DRY_RESTORE_MODULE} names no DRY_RESTORE_SUBJECT" >&2; exit 2; }
PREFIX="$(jq -r '.martha.releaseTagPrefix // "v"' "${INSTALLER_PACKAGE}")" \
  || { echo "${NAME}: ${INSTALLER_PACKAGE} could not be read" >&2; exit 2; }

# The release tags the remote holds, by version order, and the one just before <tag>: the one whose version sorts
# highest under <tag>'s. Both are read from the remote, because the checkout's own tags are the shallow one's.
TAGS="$(git ls-remote --tags --refs "${REMOTE}" "refs/tags/${PREFIX}*" | sed 's|.*refs/tags/||' | LC_ALL=C sort -V)" \
  || { echo "${NAME}: ${REMOTE} could not be asked for its ${PREFIX} tags" >&2; exit 2; }
[[ -n "${TAGS}" ]] || { echo "${NAME}: ${REMOTE} holds no ${PREFIX} tag" >&2; exit 2; }
PREVIOUS="$(printf '%s\n' "${TAGS}" | awk -v tag="${TAG}" 'BEGIN { keep = 1 } { if ($0 == tag) keep = 0; if (keep) last = $0 } END { print last }')"
# git rev-parse --verify on the tag itself: a release that runs this is checked out at the tag, so it is here or the
# deepen below fails by name.
git -C "${REPO}" rev-parse --verify --quiet "refs/tags/${TAG}^{commit}" > /dev/null \
  || { echo "${NAME}: this checkout holds no ${TAG}, so its history could not be read" >&2; exit 2; }

# The deepen is the check. `--shallow-exclude` stops the history at the release tag before this one, so the log below
# reads exactly the commits this tag adds -- the tag before it need not be in this checkout, and its own commits are
# the boundary rather than something to name as a range. When it cannot be excluded (a previous tag this remote does
# not hold, or an older git), the whole history is fetched instead: a range that could not be cut is never guessed at.
DEEPENED=''
if [[ -n "${PREVIOUS}" ]]; then
  if git -C "${REPO}" fetch --quiet --no-tags --shallow-exclude="refs/tags/${PREVIOUS}" "${REMOTE}" "refs/tags/${TAG}:refs/tags/${TAG}" 2> /dev/null; then
    DEEPENED='1'
    WHAT="since ${PREVIOUS}"
    # When the previous tag is here too, it had better be in this tag's history: a range cut at a tag the history does
    # not descend from would hide exactly the commits a dry run's mark could be in.
    if git -C "${REPO}" rev-parse --verify --quiet "refs/tags/${PREVIOUS}^{commit}" > /dev/null &&
      ! git -C "${REPO}" merge-base --is-ancestor "refs/tags/${PREVIOUS}" "refs/tags/${TAG}" 2> /dev/null; then
      DEEPENED=''
    fi
  fi
fi
if [[ -z "${DEEPENED}" ]]; then
  git -C "${REPO}" fetch --quiet --no-tags --unshallow "${REMOTE}" "refs/tags/${TAG}:refs/tags/${TAG}" 2> /dev/null ||
    git -C "${REPO}" fetch --quiet --no-tags --depth=2147483647 "${REMOTE}" "refs/tags/${TAG}:refs/tags/${TAG}" ||
    { echo "${NAME}: ${TAG}'s whole history could not be fetched" >&2; exit 2; }
  WHAT='in its whole history'
fi

FOUND="$(git -C "${REPO}" log --format='%H%x09%s' "refs/tags/${TAG}" | awk -F '\t' -v subject="${SUBJECT}" '$2 == subject { print $1 "\t" $2 }')"
if [[ -z "${FOUND}" ]]; then
  echo "${NAME}: ${TAG} carries no dry run's commit (${WHAT})"
  exit 0
fi
while IFS=$'\t' read -r sha said; do
  echo "${NAME}: ${TAG} carries a dry run's commit ${sha} (${said}) ${WHAT}; a release must never carry one" >&2
done <<< "${FOUND}"
exit 1
