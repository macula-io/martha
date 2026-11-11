#!/usr/bin/env bash
# fetch_the_direnvs.sh: the direnvs the gate proves the .envrc door with, taken from their GitHub releases
# (martha#271).
#
# `sudo apt-get install direnv` took one of them from the Ubuntu archive. On 2026-11-11 a hosted runner could not
# resolve archive.ubuntu.com for an hour: the install ended with exit 100, the job went red, and not one line of
# this repository had run. github.com answers on these runners -- the checkout itself comes from it -- so each
# direnv comes from its own release tag instead, held to the sha256 named for it.
#
# Each digest is written once, in .github/workflows/ci.yml, and never restated here: this script is given it.
# The two versions are deliberate (src/launch_a_claude_code_member/direnvs_under_test.ts): 2.38 and later stop on
# DIRENV_DISABLE, and an older direnv has only the DIRENV_CONFIG fallback, so both doors are proven.
#
# Usage: fetch_the_direnvs.sh --to <dir> (--version <tag> --sha256 <sha256:hex>)+
#
# Prints the installed direnvs' paths, joined by the PATH delimiter, on ONE line, and nothing else on stdout: that
# line is a value the caller puts in MARTHA_TESTS_DIRENV, never a log. What it did while fetching goes to stderr.
#
# Exit: 0 every direnv was fetched, held to its digest and ran; 1 otherwise, naming the version that failed.
set -euo pipefail

RELEASE_ASSET='direnv.linux-amd64'
RELEASE_URL='https://github.com/direnv/direnv/releases/download'
DIGEST_SHAPE='^sha256:[0-9a-f]{64}$'
FETCH_ATTEMPTS=3
FETCH_WAITS=(3 6)

say() { echo "fetch_the_direnvs: $*" >&2; }
die() {
  say "$*"
  exit 1
}

to=''
versions=()
digests=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)
      to="${2:-}"
      shift 2
      ;;
    --version)
      versions+=("${2:-}")
      shift 2
      ;;
    --sha256)
      digests+=("${2:-}")
      shift 2
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$to" ]] || die '--to names the directory to install into'
[[ ${#versions[@]} -gt 0 ]] || die 'no --version/--sha256 pair was named'
[[ ${#versions[@]} -eq ${#digests[@]} ]] || die 'every --version needs its --sha256'

# fetchTo <url> <file>: the download, retried while the archive-of-releases blinks. Returns non-zero when it never
# came, so the caller names the version.
fetchTo() {
  local url="$1" file="$2" attempt=1
  while ! curl -fsSL -o "$file" "$url"; do
    if [[ "$attempt" -ge "$FETCH_ATTEMPTS" ]]; then
      return 1
    fi
    say "attempt ${attempt} of ${FETCH_ATTEMPTS} did not answer; waiting ${FETCH_WAITS[$((attempt - 1))]}s"
    sleep "${FETCH_WAITS[$((attempt - 1))]}"
    attempt=$((attempt + 1))
  done
}

mkdir -p "$to"
paths=()
for index in "${!versions[@]}"; do
  version="${versions[$index]}"
  digest="${digests[$index]}"
  [[ "$digest" =~ $DIGEST_SHAPE ]] || die "${version}: '${digest}' is not sha256:<64 lowercase hex>, so nothing can be trusted for it"
  target="${to}/${version}"
  mkdir -p "$target"
  say "${version}: fetching ${RELEASE_ASSET} from ${RELEASE_URL}/${version}"
  fetchTo "${RELEASE_URL}/${version}/${RELEASE_ASSET}" "${target}/direnv" ||
    die "${version}: the release could not be fetched from github.com, so this run proves nothing"
  printf '%s  %s\n' "${digest#sha256:}" "${target}/direnv" | sha256sum --strict --check --status - ||
    die "${version}: the ${RELEASE_ASSET} fetched is not the one ${digest} names, so it is not run"
  chmod +x "${target}/direnv"
  answers="$("${target}/direnv" version)" || die "${version}: the fetched direnv does not run"
  say "${version}: held to ${digest} and answers ${answers}"
  paths+=("${target}/direnv")
done

joined="${paths[0]}"
for path in "${paths[@]:1}"; do
  joined="${joined}:${path}"
done
printf '%s\n' "$joined"
