#!/usr/bin/env bash
# the_ring_on_the_nights_pinned_tmux.sh: the ring's real-tmux cases (src/ring_the_owner/the_ring_on_the_nights_tmux
# .node-test.ts) on the tmux a live night runs (martha#843), not on whichever tmux the runner has.
#
# The night installs tmux from the .deb files it pins (NIGHT_DEB_PINS) into the Node image the clean-install proof pins
# (IMAGE_PINS). This runs the cases there: the same image by digest, the same files held to the same sha256, both read
# from the proof's own scripts, so nothing here restates them. The cases are required to run (MARTHA_TESTS_TMUX_REQUIRED)
# on the tmux the pinned .deb names (MARTHA_TESTS_TMUX_VERSION), and the run is green only when its own summary says
# every case passed and none was skipped.
#
# Usage: the_ring_on_the_nights_pinned_tmux.sh   (CONTAINER_TOOL names the container tool; docker unless set)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/.." && pwd)"
CASES='src/ring_the_owner/the_ring_on_the_nights_tmux.node-test.ts'
TOOL="${CONTAINER_TOOL:-docker}"

# shellcheck source=prove_a_clean_install_in_a_throwaway_container/prove_a_clean_install_in_a_throwaway_container.sh
. "${HERE}/prove_a_clean_install_in_a_throwaway_container.sh"

said() { printf 'the_ring_on_the_nights_pinned_tmux: %s\n' "$1" >&2; }

# The image as the proof's own image step picks it: the Node major installer/package.json declares, and its pin.
range="$(json_field "${INSTALLER_PACKAGE}" 'engines.node')" || { said 'installer/package.json declares no engines.node'; exit 1; }
major="$(node_major "${range}")" || { said "engines.node '${range}' names no Node major"; exit 1; }
digest="$(image_digest_for "${major}")" || { said "no image is pinned for Node ${major}"; exit 1; }
image="${IMAGE_REPOSITORY}:${major}-${IMAGE_VARIANT}@${digest}"

debs="$(mktemp -d)"
trap 'rm -rf "${debs}"' EXIT
version=''
for pin in "${NIGHT_DEB_PINS[@]}"; do
  read -r name sha url <<< "${pin}"
  curl -fsSL -o "${debs}/${name}" "${url}" || { said "${name} could not be fetched from ${url}"; exit 1; }
  got="sha256:$(sha256sum "${debs}/${name}" | cut -d' ' -f1)"
  [ "${got}" = "${sha}" ] || { said "${name} is ${got}, not the pinned ${sha}"; exit 1; }
  case "${name}" in tmux_*) version="${name#tmux_}"; version="${version%%-*}" ;; esac
done
[ -n "${version}" ] || { said 'the night pins no tmux .deb'; exit 1; }

summary="${debs}/summary"
status=0
"${TOOL}" run --rm -e MARTHA_TESTS_TMUX_REQUIRED=1 -e "MARTHA_TESTS_TMUX_VERSION=${version}" \
  -v "${REPO}:/repo" -v "${debs}:/debs:ro" -w /repo "${image}" \
  bash -c "dpkg -i /debs/*.deb > /dev/null && npm ci --ignore-scripts --silent && node --test --test-reporter=spec ${CASES}" \
  > "${summary}" 2>&1 || status=$?
cat "${summary}"
[ "${status}" -eq 0 ] || { said "the cases exited ${status} on tmux ${version} in ${image}"; exit 1; }

count() { sed -n "s/^ℹ $1 \([0-9][0-9]*\)$/\1/p" "${summary}" | tail -1; }
tests="$(count tests)" pass="$(count pass)" skipped="$(count skipped)" fail="$(count fail)"
if [ -z "${tests}" ] || [ "${tests}" -eq 0 ] || [ "${pass}" != "${tests}" ] || [ "${skipped}" != 0 ] || [ "${fail}" != 0 ]; then
  said "not every case ran and passed on tmux ${version}: tests ${tests:-none}, pass ${pass:-none}, skipped ${skipped:-none}, fail ${fail:-none}"
  exit 1
fi
printf 'the ring on the night'"'"'s tmux %s, in %s: %s of %s cases passed, none skipped\n' "${version}" "${image}" "${pass}" "${tests}"
