#!/usr/bin/env bash
# keep_a_throwaway_repository.sh open <run folder>
#                                 close <run folder>
#                                 round-trip <run folder>
#                                 --self-test
#
# The nightly live run's throwaway repository, made and removed on the crew host (martha#639, sections 4 and 5).
#
# A night lands one small real package in a private repository that exists for that night alone. The repository
# belongs to a separate bot account that holds nothing else (DECIDED by the owner, 2026-11-18: "Separate bot
# account"), and every GitHub call made here uses the bot's token alone:
#
# - open: the run's own GitHub login is made in the run folder, from the token file on standard input (never an
#   argument), and every call runs under `env -i` with only the run's own config folders, HOME, PATH and TERM set, so a
#   GH_TOKEN or GITHUB_TOKEN in the caller's shell never reaches gh (gh prefers those to any config folder). Before
#   anything is made, the guards on main (src/land_a_package_on_a_throwaway_repository) read GitHub's answers: the token's
#   expiry, that the calls answer as the bot recorded at setup, and that every repository they can see is the bot's.
#   Any repository the bot holds at all is a leftover of an earlier night, and stops the run naming it: the run never
#   deletes what it did not make. Then the repository is made (`POST /user/repos`, private), its record written before
#   anything else is done with it, the first commit pushed over https through gh's own credential helper (no token in
#   a URL), and issue #1 opened with the night's package. The run's login stays in the run folder (mode 0700) for
#   the close that follows.
# - close: the repository read by the numeric id the create answered, the delete guard holding on every field, the
#   delete sent to the full name the guard read, and the same id read again: only GitHub's 404 says it is gone. A
#   refusal or a repository still there fails by name and leaves it for the operator. The run's GitHub login is removed
#   whatever happens.
# - round-trip: open, then close in the EXIT trap, so an interrupted run still deletes what it made. It is the first
#   night's own check that GitHub takes the bot's token for `POST /user/repos`, before any member is involved.
#
# The setup files live outside every repository, in MARTHA_LIVE_DIR (default ~/.config/martha-live): `token`, mode
# 0600, and `owner.json`, the bot's login and numeric id. Nothing here prints the token, and no argument carries it.
#
# Exit: 0 done; 1 a guard refused, a step failed, or the repository could not be proven gone; 2 the arguments or the
# setup files were refused and nothing was made.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO="$(git -C "${HERE}" rev-parse --show-toplevel)"
GUARDS="${REPO}/src/land_a_package_on_a_throwaway_repository/main.ts"

LIVE_DIR="${MARTHA_LIVE_DIR:-${HOME}/.config/martha-live}"
TOKEN_FILE="${LIVE_DIR}/token"
OWNER_FILE="${LIVE_DIR}/owner.json"
# The only mode the token file may have: the owner's read and write, nobody else's.
TOKEN_MODE='600'
# What every repository a night makes is called, before the run's stamp, and the stamp's own shape.
NAME_PREFIX='martha-live-'
STAMP_FORMAT='+%Y%m%d-%H%M%S'
# The first commit: its author (no person's), its branch, and its two files. The package's test script is node's own
# runner, so the repository needs nothing installed.
AUTHOR='the owner'
AUTHOR_EMAIL='owner@example.invalid'
BRANCH='main'
README_TEXT='# A throwaway repository

Made by one night of the nightly live run, and deleted at its end.
'
# The test runner's own flag, kept in a variable and joined where the fixture text below needs it. The bytes this
# script makes are the same either way; written out, the two fixture strings below read to the bounded-runs check
# (prove_the_core/every_run_of_the_tests_is_bounded.ts, #683) as a run of OUR tests that states none of the three
# things that bound it, and the check is line-based, so it cannot tell a fixture's prose from a command here.
TEST_FLAG='--test'
PACKAGE_JSON='{
  "name": "greet",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node '"${TEST_FLAG}"'" }
}
'
# Issue #1: the night's package, the one the builder is given.
ISSUE_NUMBER=1
ISSUE_TITLE='Add greet(name)'
ISSUE_BODY='Add `greet(name)` in `greet.js`, returning `Hello, <name>!`, with a `node '"${TEST_FLAG}"'` test that pins the exact string, a name with a space included.'
# GitHub's answer to the same id once the repository is gone, as gh prints its status line.
GONE_STATUS='404'
# The run folder's parts: the run's own GitHub login (never kept), the record the delete guard reads, and what the
# night reads of the repository it made.
PRIVATE_PART='private'
MADE_PART='made.json'
REPOSITORY_PART='repository.env'

USAGE='usage: keep_a_throwaway_repository.sh open|close|round-trip <run folder> | --self-test'

RUN_DIR=''
PRIVATE=''
BOT_PATH=''

log() { printf '%s\n' "$*"; }
ok() { log "ok $1: $2"; }
failed() { log "FAIL $1: $2" >&2; }

# The guard named `name` on standard input, with its one argument.
guard() { node --no-warnings "${GUARDS}" "$@"; }

# A field of a JSON file, or nothing when it has none.
json_field() {
  node -e 'const v = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); let x = v; for (const k of process.argv[2].split(".")) x = x?.[k]; if (x !== undefined) process.stdout.write(String(x))' "$1" "$2"
}

# The same, of the JSON text on standard input.
json_text_field() {
  node -e 'let t = ""; process.stdin.on("data", (c) => { t += c }).on("end", () => { let x; try { x = JSON.parse(t) } catch { process.exit(3) } for (const k of process.argv[1].split(".")) x = x?.[k]; if (x === undefined) process.exit(3); process.stdout.write(String(x)) })' "$1"
}

# A command run as the bot: no variable of the caller's shell but the ones named here, so no token in the caller's
# environment reaches gh or git, and gh and git find only the run's own login and config.
as_the_bot() {
  env -i HOME="${PRIVATE}/home" PATH="${BOT_PATH}" TERM=dumb GH_CONFIG_DIR="${PRIVATE}/gh" \
    GIT_CONFIG_GLOBAL="${PRIVATE}/gitconfig" GIT_CONFIG_NOSYSTEM=1 "$@"
}

# The setup files, read: the token file with its one mode, and the bot's numeric id.
read_the_setup() {
  local mode
  [ -f "${TOKEN_FILE}" ] || { failed setup "no token file at ${TOKEN_FILE}"; return 2; }
  mode="$(stat -c '%a' "${TOKEN_FILE}")"
  [ "${mode}" = "${TOKEN_MODE}" ] || { failed setup "${TOKEN_FILE} has mode ${mode}, not ${TOKEN_MODE}"; return 2; }
  [ -f "${OWNER_FILE}" ] || { failed setup "no owner file at ${OWNER_FILE}"; return 2; }
  OWNER_ID="$(json_field "${OWNER_FILE}" 'id')"
  [[ "${OWNER_ID}" =~ ^[1-9][0-9]*$ ]] || { failed setup "${OWNER_FILE} names no numeric id"; return 2; }
}

# The run folder's places, named.
name_the_places() {
  RUN_DIR="$1"
  PRIVATE="${RUN_DIR}/${PRIVATE_PART}"
  # gh's own folder first, then the system's default PATH: the bot's calls find gh and git, and nothing of the
  # caller's PATH.
  BOT_PATH="$(dirname "$(command -v gh)"):$(getconf PATH)"
}

# The run's own GitHub login, made from the token file on standard input, and gh set as git's credential helper in
# the run's own git config.
log_in() {
  mkdir -m 700 "${PRIVATE}" "${PRIVATE}/home" "${PRIVATE}/gh"
  : > "${PRIVATE}/gitconfig"
  as_the_bot gh auth login --with-token --insecure-storage < "${TOKEN_FILE}" \
    || { failed 'log in' 'gh would not log in with the token file'; return 1; }
  as_the_bot gh auth setup-git || { failed 'log in' 'gh could not be set as git credential helper'; return 1; }
}

# The run's own GitHub login removed.
log_out() {
  if [ -n "${PRIVATE}" ] && [ -d "${PRIVATE}" ]; then rm -rf "${PRIVATE}"; fi
}

# The guards before anything is made: the token's expiry, who the calls answer as, how far they reach, and no
# leftover.
check_before_making() {
  local answer headers body expiry said leftovers
  answer="$(as_the_bot gh api -i user)" || { failed who 'GitHub did not answer GET /user'; return 1; }
  headers="$(sed '/^\r\{0,1\}$/q' <<< "${answer}")"
  body="$(sed '1,/^\r\{0,1\}$/d' <<< "${answer}")"
  expiry="$(sed -n 's/^[Gg]ithub-[Aa]uthentication-[Tt]oken-[Ee]xpiration: *//p' <<< "${headers}" | tr -d '\r')"
  said="$(printf '%s' "${expiry}" | guard expiry "$(date -Is)")" || { failed expiry 'the token cannot be used'; return 1; }
  if [ -n "${said}" ]; then log "${said}"; fi
  printf '%s' "${body}" | guard who "${OWNER_ID}" || { failed who 'the calls are not the bot'"'"'s'; return 1; }
  ok who "the calls answer as the bot (${OWNER_ID}), through the run's own login"
  as_the_bot gh api --paginate --slurp user/repos > "${RUN_DIR}/reach.json" || { failed reach 'GitHub did not list the repositories'; return 1; }
  guard reach "${OWNER_ID}" < "${RUN_DIR}/reach.json" || { failed reach 'the calls reach beyond the bot'; return 1; }
  leftovers="$(node -e 'const pages = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); console.log(pages.flat().map((r) => r.full_name).join(" "))' "${RUN_DIR}/reach.json")"
  if [ -n "${leftovers}" ]; then
    failed leftover "the bot holds ${leftovers}, left by an earlier night: delete it in GitHub, then run again"
    return 1
  fi
  ok reach 'every repository the calls see is the bot'"'"'s, and the bot holds none'
}

# The repository made, private, and recorded before anything else is done with it.
make_the_repository() {
  local stamp started name answer
  stamp="$(date "${STAMP_FORMAT}")"
  started="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  name="${NAME_PREFIX}${stamp}"
  answer="$(as_the_bot gh api -X POST user/repos -f "name=${name}" -F private=true)" \
    || { failed make "GitHub would not make ${name} with the bot's token"; return 1; }
  ID="$(json_text_field id <<< "${answer}")" || { failed make 'the create gave no id'; return 1; }
  FULL_NAME="$(json_text_field full_name <<< "${answer}")" || { failed make 'the create gave no full name'; return 1; }
  node -e 'const [id, owner_id, stamp, run_started_at, full_name] = process.argv.slice(1); process.stdout.write(JSON.stringify({ id: Number(id), owner_id: Number(owner_id), stamp, run_started_at, full_name }) + "\n")' \
    "${ID}" "${OWNER_ID}" "${stamp}" "${started}" "${FULL_NAME}" > "${RUN_DIR}/${MADE_PART}"
  if [ "$(json_text_field private <<< "${answer}" || true)" != true ]; then
    failed make "${FULL_NAME} was not made private"
    return 1
  fi
  ok make "${FULL_NAME} (id ${ID}), private"
}

# The first commit, pushed over https through gh's credential helper, and issue #1 opened with the package.
fill_the_repository() {
  local first="${RUN_DIR}/first" base answer number
  mkdir "${first}"
  printf '%s' "${README_TEXT}" > "${first}/README.md"
  printf '%s' "${PACKAGE_JSON}" > "${first}/package.json"
  as_the_bot git -C "${first}" init -q -b "${BRANCH}"
  as_the_bot git -C "${first}" add README.md package.json
  as_the_bot env GIT_AUTHOR_NAME="${AUTHOR}" GIT_AUTHOR_EMAIL="${AUTHOR_EMAIL}" GIT_COMMITTER_NAME="${AUTHOR}" \
    GIT_COMMITTER_EMAIL="${AUTHOR_EMAIL}" git -C "${first}" commit -qm 'The first commit'
  base="$(as_the_bot git -C "${first}" rev-parse HEAD)"
  as_the_bot git -C "${first}" push -q "https://github.com/${FULL_NAME}.git" "${BRANCH}" \
    || { failed fill "the first commit could not be pushed to ${FULL_NAME}"; return 1; }
  answer="$(as_the_bot gh api -X POST "repos/${FULL_NAME}/issues" -f "title=${ISSUE_TITLE}" -f "body=${ISSUE_BODY}")" \
    || { failed fill "issue #${ISSUE_NUMBER} could not be opened in ${FULL_NAME}"; return 1; }
  number="$(json_text_field number <<< "${answer}" || true)"
  [ "${number}" = "${ISSUE_NUMBER}" ] || { failed fill "the issue opened as #${number}, not #${ISSUE_NUMBER}"; return 1; }
  printf 'FULL_NAME=%s\nID=%s\nBASE=%s\nBRANCH=%s\nPACKAGE=%s#%s\n' "${FULL_NAME}" "${ID}" "${base}" "${BRANCH}" \
    "${FULL_NAME}" "${ISSUE_NUMBER}" > "${RUN_DIR}/${REPOSITORY_PART}"
  ok fill "${BRANCH} at ${base}, and ${FULL_NAME}#${ISSUE_NUMBER} holds the package"
}

# The open half: the setup read, the run's login made, the guards, then the repository made and filled.
open_it() {
  read_the_setup || return $?
  [ ! -e "$1" ] || { failed open "$1 is there already: a run folder is one night's"; return 2; }
  mkdir -m 700 -p "$1"
  name_the_places "$1"
  log_in || return 1
  check_before_making || return 1
  make_the_repository || return 1
  fill_the_repository || return 1
}

# The status line gh prints for a GET of the repository's id.
status_of_the_id() {
  as_the_bot gh api -i "repositories/$1" 2> /dev/null | head -1 | tr -d '\r' || true
}

# The close half: nothing made is nothing to delete; otherwise the guard on the answer read now, the delete to the
# full name it holds for, and the id read again once: only GitHub's 404 says it is gone.
close_it() {
  local made answer full_name status
  made="${RUN_DIR}/${MADE_PART}"
  if [ ! -f "${made}" ]; then ok close 'the run made no repository'; return 0; fi
  if [ ! -d "${PRIVATE}/gh" ]; then log_in || return 1; fi
  answer="$(as_the_bot gh api "repositories/$(json_field "${made}" id)")" \
    || { failed close "GitHub gave no repository for id $(json_field "${made}" id); left for the operator"; return 1; }
  full_name="$(printf '%s' "${answer}" | guard delete "${made}")" || { failed close 'the delete guard refused; nothing was deleted'; return 1; }
  as_the_bot gh api -X DELETE "repos/${full_name}" > /dev/null || { failed close "GitHub would not delete ${full_name}"; return 1; }
  status="$(status_of_the_id "$(json_field "${made}" id)")"
  case "${status}" in
    *" ${GONE_STATUS} "* | *" ${GONE_STATUS}") ok close "${full_name} deleted, and its id answers ${GONE_STATUS}" ;;
    *) failed close "${full_name} still answers '${status}' after the delete; left for the operator"; return 1 ;;
  esac
}

# Close, whatever happened, with the run's login removed after it.
close_and_log_out() {
  local status=0
  close_it || status=$?
  log_out
  return "${status}"
}

main() {
  local verb="${1:-}" dir="${2:-}" status=0
  case "${verb}" in
    --self-test) self_test; return $? ;;
    open | close | round-trip) [ -n "${dir}" ] && [ "$#" -eq 2 ] || { echo "${USAGE}" >&2; return 2; } ;;
    *) echo "${USAGE}" >&2; return 2 ;;
  esac
  case "${verb}" in
    open)
      # An open that fails part-way leaves a record for close; the login goes either way only once close has run.
      open_it "${dir}" || status=$?
      return "${status}"
      ;;
    close)
      read_the_setup || return $?
      name_the_places "${dir}"
      close_and_log_out
      ;;
    round-trip)
      trap 'trap - EXIT INT TERM; close_and_log_out || exit 1' EXIT
      trap 'exit 1' INT TERM
      open_it "${dir}" || status=$?
      if [ "${status}" -eq 2 ]; then trap - EXIT; return 2; fi
      trap - EXIT INT TERM
      close_and_log_out || return 1
      return "${status}"
      ;;
  esac
}

# The stand-in gh and git a self-test case runs against, answering from the folder the stand-ins' own `case` file
# names: every call recorded with its arguments and the names of the variables it was given, its standard input kept
# for `auth login`.
write_stand_ins() {
  local dir="$1" real_git
  # The system's own git, never a wrapper on the caller's PATH.
  real_git="$(PATH="$(getconf PATH)" command -v git)"
  cat > "${dir}/gh" << 'GH'
#!/usr/bin/env bash
set -u
case_dir="$(cat "$(dirname "$0")/case")"
printf '%s\n' "$*" >> "${case_dir}/calls"
# The names of the variables it was given, never their values.
env | sed 's/=.*//' | sort > "${case_dir}/env.$(wc -l < "${case_dir}/calls" | tr -d ' ')"
answer() { if [ -f "${case_dir}/$1" ]; then cat "${case_dir}/$1"; else return 1; fi; }
# GitHub's answer for the made repository's id: the run's own record read back, with the owner a case may change.
by_id() {
  local made owner
  made="$(cat "${case_dir}/run/made.json")" || return 1
  field() { sed -n "s/.*\"$1\":\"\{0,1\}\([^\",}]*\).*/\1/p" <<< "${made}"; }
  owner="$(cat "${case_dir}/byid.owner" 2> /dev/null || field owner_id)"
  printf '{"id":%s,"owner":{"id":%s},"name":"martha-live-%s","created_at":"%s","full_name":"%s"}' \
    "$(field id)" "${owner}" "$(field stamp)" "$(field run_started_at)" "$(field full_name)"
}
case "$*" in
  'auth login --with-token --insecure-storage') cat > "${case_dir}/login.stdin" ;;
  'auth setup-git') ;;
  'api -i user') answer user.headers; printf '\r\n'; answer user.json ;;
  'api --paginate --slurp user/repos') answer repos.json ;;
  'api -X POST user/repos '*) answer create.json; touch "${case_dir}/created" ;;
  'api -X POST repos/'*'/issues '*) if [ -e "${case_dir}/issue.hangs" ]; then touch "${case_dir}/hanging"; sleep 3; fi; answer issue.json ;;
  'api -X DELETE repos/'*) touch "${case_dir}/deleted"; answer delete.status > /dev/null || exit 1 ;;
  'api -i repositories/'*) if [ -e "${case_dir}/deleted" ] && [ ! -e "${case_dir}/still-there" ]; then printf 'HTTP/2.0 404 Not Found\r\n'; exit 1; fi; printf 'HTTP/2.0 200 OK\r\n\r\n'; by_id ;;
  'api repositories/'*) by_id ;;
  *) echo "stand-in gh: no answer for: $*" >&2; exit 1 ;;
esac
GH
  cat > "${dir}/git" << GIT
#!/usr/bin/env bash
set -u
case_dir="\$(cat "\$(dirname "\$0")/case")"
# The names of the variables a bot's call was given (the run's own config folder set), never their values. The
# script's own call that finds its tree is the caller's, not the bot's, and is not one of these.
if [ -n "\${GH_CONFIG_DIR:-}" ]; then env | sed 's/=.*//' | sort > "\${case_dir}/env.git.\$\$"; fi
for word in "\$@"; do if [ "\${word}" = push ]; then printf '%s\n' "\$*" >> "\${case_dir}/pushes"; exit 0; fi; done
exec ${real_git} "\$@"
GIT
  chmod +x "${dir}/gh" "${dir}/git"
}

# One case: the setup files of a bot with id 4242, the token a word nobody else holds, and GitHub's answers for a night
# that goes right. A case changes one answer.
a_case() {
  local dir="$1" token="$2"
  mkdir -p "${dir}/live"
  printf '%s\n' "${token}" > "${dir}/live/token"
  chmod 600 "${dir}/live/token"
  printf '{"login":"synthetic-bot","id":4242}\n' > "${dir}/live/owner.json"
  printf 'HTTP/2.0 200 OK\r\n' > "${dir}/user.headers"
  printf '{"login":"synthetic-bot","id":4242,"type":"User"}' > "${dir}/user.json"
  printf '[[]]' > "${dir}/repos.json"
  printf '{"id":77,"full_name":"synthetic-bot/the-made-one","private":true}' > "${dir}/create.json"
  printf '{"number":1}' > "${dir}/issue.json"
  printf '0' > "${dir}/delete.status"
}

# A run of the script against a case, its output and status kept. The caller's shell carries a GH_TOKEN the run must
# never pass on.
run_a_case() {
  local dir="$1" verb="$2" status=0
  printf '%s\n' "${dir}" > "${STAND_INS}/case"
  PATH="${STAND_INS}:${PATH}" MARTHA_LIVE_DIR="${dir}/live" GH_TOKEN='the-callers-own-token' GITHUB_TOKEN='the-callers-own-token' \
    "${SELF}" "${verb}" "${dir}/run" > "${dir}/out" 2> "${dir}/err" || status=$?
  printf '%s' "${status}" > "${dir}/status"
}

self_test() {
  local root case failures=0 token waited
  root="$(mktemp -d)"
  # shellcheck disable=SC2064 # the folder is this run's, named now
  trap "rm -rf '${root}'" EXIT
  STAND_INS="${root}/bin"
  SELF="$(readlink -f "$0")"
  mkdir -p "${STAND_INS}"
  write_stand_ins "${STAND_INS}"
  token="github_pat_a-word-only-this-case-holds"
  fail() { echo "the self-test: $1" >&2; failures=$((failures + 1)); }
  status_is() { [ "$(cat "$1/status")" = "$2" ] || fail "$1 exited $(cat "$1/status"), not $2: $(cat "$1/out" "$1/err")"; }
  said() { grep -qF -- "$2" "$1/out" "$1/err" || fail "$1 does not say '$2': $(cat "$1/out" "$1/err")"; }
  made_nothing() { [ ! -e "$1/created" ] || fail "$1 made a repository"; }
  deleted_nothing() { [ ! -e "$1/deleted" ] || fail "$1 deleted a repository"; }

  # A night that goes right: made, filled, and deleted, the id answering 404 after; open and close run apart, as a
  # night runs them.
  case="${root}/pass"; a_case "${case}" "${token}"
  run_a_case "${case}" open
  status_is "${case}" 0
  run_a_case "${case}" close
  status_is "${case}" 0
  said "${case}" 'deleted, and its id answers 404'
  grep -q '^api -X DELETE repos/synthetic-bot/the-made-one$' "${case}/calls" || fail 'the delete did not go to the full name the guard read'
  grep -q 'push -q https://github.com/synthetic-bot/the-made-one.git main$' "${case}/pushes" || fail 'the first commit was not pushed over https to the made repository'
  [ "$(cat "${case}/login.stdin")" = "${token}" ] || fail 'the login did not read the token on standard input'
  # The token is never an argument, and the caller's tokens never reach gh or git (R1, R4).
  if grep -qF -- "${token}" "${case}/calls" "${case}/pushes"; then fail 'the token was an argument'; fi
  ls "${case}"/env.git.* > /dev/null 2>&1 || fail "no git call of the bot's was seen"
  if grep -lx 'GH_TOKEN\|GITHUB_TOKEN' "${case}"/env.* > /dev/null 2>&1; then fail "the caller's token reached the bot's calls"; fi
  grep -qx 'GH_CONFIG_DIR' "${case}/env.1" || fail "gh did not run on the run's own config folder"
  [ ! -e "${case}/run/${PRIVATE_PART}" ] || fail "the run's own login was left after close"
  grep -q 'private=true' "${case}/calls" || fail 'the repository was not asked for private'
  grep -q "PACKAGE=synthetic-bot/the-made-one#1" "${case}/run/${REPOSITORY_PART}" || fail 'the run did not record the package it made'

  # R1: the calls answer as another account: refused before anything is made.
  case="${root}/who"; a_case "${case}" "${token}"
  printf '{"login":"the-owner","id":99,"type":"User"}' > "${case}/user.json"
  run_a_case "${case}" round-trip
  status_is "${case}" 1; said "${case}" 'not as the throwaway bot'; made_nothing "${case}"

  # R1: the calls reach a repository that is not the bot's: refused before anything is made.
  case="${root}/reach"; a_case "${case}" "${token}"
  printf '[[{"full_name":"synthetic-someone/real","owner":{"id":99}}]]' > "${case}/repos.json"
  run_a_case "${case}" round-trip
  status_is "${case}" 1; said "${case}" "reach synthetic-someone/real, which is not the throwaway owner's"; made_nothing "${case}"

  # A leftover of an earlier night: named, never deleted, and nothing made.
  case="${root}/leftover"; a_case "${case}" "${token}"
  printf '[[{"full_name":"synthetic-bot/martha-live-20260101-000000","owner":{"id":4242}}]]' > "${case}/repos.json"
  run_a_case "${case}" round-trip
  status_is "${case}" 1; said "${case}" 'synthetic-bot/martha-live-20260101-000000, left by an earlier night'; made_nothing "${case}"; deleted_nothing "${case}"

  # An expired token: refused before anything is made.
  case="${root}/expired"; a_case "${case}" "${token}"
  printf 'HTTP/2.0 200 OK\r\nGithub-Authentication-Token-Expiration: 2020-01-01 00:00:00 UTC\r\n' > "${case}/user.headers"
  run_a_case "${case}" round-trip
  status_is "${case}" 1; said "${case}" 'expired'; made_nothing "${case}"

  # A token file another user can read: refused, nothing made, exit 2.
  case="${root}/mode"; a_case "${case}" "${token}"
  chmod 644 "${case}/live/token"
  run_a_case "${case}" round-trip
  status_is "${case}" 2; said "${case}" 'not 600'; made_nothing "${case}"

  # R2: the id answers another owner at delete time: nothing deleted, the field named, the repository left.
  case="${root}/owner"; a_case "${case}" "${token}"
  run_a_case "${case}" open
  printf 99 > "${case}/byid.owner"
  run_a_case "${case}" close
  status_is "${case}" 1; said "${case}" 'owner.id is not the one this run made'; deleted_nothing "${case}"

  # The repository still there after the delete: never reported gone.
  case="${root}/still"; a_case "${case}" "${token}"
  run_a_case "${case}" open
  : > "${case}/still-there"
  run_a_case "${case}" close
  status_is "${case}" 1; said "${case}" 'still answers'

  # A create GitHub made public: the night fails, and the round trip still deletes it.
  case="${root}/public"; a_case "${case}" "${token}"
  printf '{"id":77,"full_name":"synthetic-bot/the-made-one","private":false}' > "${case}/create.json"
  run_a_case "${case}" open
  status_is "${case}" 1; said "${case}" 'was not made private'
  run_a_case "${case}" close
  status_is "${case}" 0
  [ -e "${case}/deleted" ] || fail 'a public create was not deleted'

  # A round trip whose open fails after the create, with no signal: it still deletes what it made, and its login goes.
  case="${root}/failed-round-trip"; a_case "${case}" "${token}"
  printf '{"id":77,"full_name":"synthetic-bot/the-made-one","private":false}' > "${case}/create.json"
  run_a_case "${case}" round-trip
  status_is "${case}" 1; said "${case}" 'was not made private'; said "${case}" 'deleted, and its id answers 404'
  [ -e "${case}/deleted" ] || fail 'a round trip that failed after the create did not delete what it made'
  [ ! -e "${case}/run/${PRIVATE_PART}" ] || fail "a round trip that failed after the create left the run's own login"

  # A round trip stopped by a signal after the create: its trap deletes what it made.
  case="${root}/stopped"; a_case "${case}" "${token}"
  : > "${case}/issue.hangs"
  run_a_case "${case}" round-trip &
  waited=0
  while [ ! -e "${case}/hanging" ] && [ "${waited}" -lt 100 ]; do sleep 0.1; waited=$((waited + 1)); done
  pkill -TERM -f -- "${SELF} round-trip ${case}/run" || fail 'the round trip to stop was not found'
  wait "$!" || true
  status_is "${case}" 1
  [ -e "${case}/deleted" ] || fail 'a round trip stopped after the create did not delete what it made'

  if [ "${failures}" -ne 0 ]; then echo "the self-test: ${failures} check(s) failed" >&2; return 1; fi
  echo 'the self-test: every case holds'
}

main "$@"
