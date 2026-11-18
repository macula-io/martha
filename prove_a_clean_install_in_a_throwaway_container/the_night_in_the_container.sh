# shellcheck shell=bash
# the_night_in_the_container.sh: sourced by prove_a_clean_install_in_a_throwaway_container.sh, never run alone.
#
# The container side of the nightly live run (martha#639 phase 2, sections 2, 4 and 5), taken when the proof is given
# `--night <run folder>`. The proof's own steps run as they do without it; these steps go around and after them:
#
# - before the image: the night's throwaway repository made on the crew host by keep_a_throwaway_repository.sh, with
#   the bot's token alone, and the pinned tools fetched there: tmux and the one library it needs that the image lacks,
#   as Debian's own .deb files, and one gh release tarball, each held to the sha256 written here, never to a checksum
#   fetched beside it;
# - after Claude Code: the tools passed into the container on standard input (ssh's, then `podman exec -i`'s), so the
#   container reaches nothing new on the network. The two .deb files are installed with dpkg in an exec of their own as
#   root; that exec is the only one that is, the container itself still runs as the image's own non-root user, and the
#   gh tarball is unpacked under that user's home;
# - after the checkout: the repository's first commit passed in as a git bundle on standard input and cloned at
#   <home>/<clones>/<owner>/<name>, origin `https://github.com/<owner>/<name>.git` with no token in it, and the crew
#   declared there by `martha init`, which reads the workspace layout from that path (martha#611). What the clone
#   holds then is what the run put there, listed for the clean-start check;
# - the owner's sign-in approves both crew places, the checkout and then the clone, in one command line;
# - after every member is proven in the checkout: every member stopped, and none of their processes left; then the
#   clean start judged on the container's own listing (src/land_a_package_on_a_throwaway_repository, clean-start): the
#   clone holds only what the run put there, its parents only the next folder, and the home and its config folder
#   nothing the recorded host loads by itself. A hit fails by name and no token is placed. Then each member started
#   again by its own command, in the clone, in a tmux session of its own name, so the owner can attach to the
#   builder's terminal for the landing's yes;
# - then the token: read from its 0600 file on the crew host and passed on standard input at every hop (ssh, then
#   `podman exec -i`) into a 0600 file in the node user's home, read by `gh auth login --with-token`, and removed. It
#   is never an argument at any hop. gh in the container must then answer as the bot recorded at setup;
# - at the end, whatever happened, after the container is gone: the repository deleted by keep_a_throwaway_repository.sh,
#   which only takes GitHub's 404 as gone.
#
# The night after that (the package typed, the HANDOFF and VERDICT read, the owner's yes, the landing) is the next
# part of #639 and not here: this part ends with the members up in the clone with the bot's login.

# The script that makes and deletes the night's repository: this folder's own, or the stand-in a self-test names.
NIGHT_THROWAWAY="${MARTHA_CLEAN_INSTALL_THROWAWAY:-${HERE}/keep_a_throwaway_repository.sh}"
# The setup files the throwaway script reads too: the token, mode 0600, and the bot's numeric id.
NIGHT_LIVE_DIR="${MARTHA_LIVE_DIR:-${HOME}/.config/martha-live}"
NIGHT_TOKEN_FILE="${NIGHT_LIVE_DIR}/token"
NIGHT_OWNER_FILE="${NIGHT_LIVE_DIR}/owner.json"
# What the throwaway script writes in the run folder for the night to read: the repository it made, and the folder
# holding its first commit.
NIGHT_REPOSITORY_PART='repository.env'
NIGHT_FIRST_PART='first'
# The pinned downloads, one a line: the file's name, its sha256, and where it is fetched from. The two .deb files are
# Debian bookworm's own (the image is bookworm), their sha256 as Debian's signed index gives it; the gh tarball's is
# the one its release's checksums file gives. The digest is written labelled, the one shape a 64-hex string passes in
# (src/check_nothing_private_gets_in). A self-test names a file of its own pins instead.
NIGHT_PINS="${MARTHA_CLEAN_INSTALL_NIGHT_PINS:-}"
NIGHT_DEB_PINS=(
  'libutempter0_1.2.1-3_amd64.deb sha256:e2bf3c7fb0ebd7d7966166d98320767adcd35a6d1eabc32220d8219c9efb1c0f https://deb.debian.org/debian/pool/main/libu/libutempter/libutempter0_1.2.1-3_amd64.deb'
  'tmux_3.3a-3_amd64.deb sha256:6bd1558face5e145d66d72c9557cbc7ff5ad66701e94dcd568e6daf081269018 https://deb.debian.org/debian/pool/main/t/tmux/tmux_3.3a-3_amd64.deb'
)
NIGHT_GH_PIN='gh_2.104.0_linux_amd64.tar.gz sha256:98cb101ad87dbbd3f6b2f2bfcbd43197ccd07643140121d8a9cfaa91eadbc24e https://github.com/cli/cli/releases/download/v2.104.0/gh_2.104.0_linux_amd64.tar.gz'
# Where the night's tools go in the container: the .deb files in a folder of root's own for the one exec that installs
# them, and gh under the node user's home, on the PATH the proof's scripts already put first.
NIGHT_DEB_DROP='/root/night-debs'
NIGHT_GH_HOME='.local/gh'
# The crew's clones place under the container's home, as `martha init` reads a layout from a checkout's path
# (<clones>/<org>/<name>): the worktrees place beside it is made by the members later, so it is not there to judge.
NIGHT_CLONES='work/clones'
# The token's one stop in the container: a 0600 file in the node user's home, read by gh and removed.
NIGHT_TOKEN_DROP="${CONTAINER_HOME}/.night-token"
# The tmux server the members run on, its own socket name so nothing else's is reached, and what each member's
# session runs after its command ends, so its last screen stays readable.
NIGHT_TMUX_SOCKET='night'
NIGHT_PANE_HOLD='exec sleep infinity'
# Where each member's session keeps every byte it draws (tmux pipe-pane), and the gate its member waits on until that
# keeping has begun. Made after the clean start has been judged, so it is not a stranger to it.
NIGHT_SCREENS="${CONTAINER_HOME}/.night-screens"
# The container's own process list after the stop: pid, state, command line. Only the container's idle process (its
# pid 1) and this listing itself may be there; any other process, a member's or a host's it started, is left over. A
# zombie (state Z) has ended and holds nothing open: the idle process does not reap, so it is not counted.
NIGHT_IDLE_PID=1
NIGHT_PROCESS_LIST='ps -eo pid=,stat=,args='

NIGHT_DIR=''
NIGHT_CLONE=''
NIGHT_FULL_NAME=''
NIGHT_BRANCH=''
NIGHT_OPENED=''
NIGHT_READY=''

# Whether this run is a night.
a_night() { [ -n "${NIGHT_DIR}" ]; }

# The open step: the night's repository made on the crew host, its lines in the run's log, and what it made read.
night_open_step() {
  local said status=0 line
  NIGHT_OPENED=1
  said="$("${NIGHT_THROWAWAY}" open "${NIGHT_DIR}" 2>&1)" || status=$?
  while IFS= read -r line; do [ -z "${line}" ] || log "  ${line}"; done <<< "${said}"
  if [ "${status}" -ne 0 ]; then failed 'night open' "the throwaway repository was not made (exit ${status})"; return 1; fi
  NIGHT_FULL_NAME="$(sed -n 's/^FULL_NAME=//p' "${NIGHT_DIR}/${NIGHT_REPOSITORY_PART}")"
  NIGHT_BRANCH="$(sed -n 's/^BRANCH=//p' "${NIGHT_DIR}/${NIGHT_REPOSITORY_PART}")"
  [[ "${NIGHT_FULL_NAME}" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] && [ -n "${NIGHT_BRANCH}" ] \
    || { failed 'night open' "${NIGHT_DIR}/${NIGHT_REPOSITORY_PART} names no repository and branch"; return 1; }
  NIGHT_CLONE="${CONTAINER_HOME}/${NIGHT_CLONES}/${NIGHT_FULL_NAME}"
  ok 'night open' "${NIGHT_FULL_NAME} made by the bot, ${NIGHT_BRANCH} holding its first commit"
}

# The pins, one a line: the self-test's file, or the ones written here.
night_pins() {
  if [ -n "${NIGHT_PINS}" ]; then cat "${NIGHT_PINS}"; return; fi
  printf '%s\n' "${NIGHT_DEB_PINS[@]}" "${NIGHT_GH_PIN}"
}

# The fetch step: every pinned file fetched into the run folder on the crew host, and held to its sha256.
night_fetch_step() {
  local name digest url got
  mkdir -p "${NIGHT_DIR}/downloads"
  while read -r name digest url; do
    curl -fsSL -o "${NIGHT_DIR}/downloads/${name}" "${url}" || { failed 'night fetch' "${name} could not be fetched from ${url}"; return 1; }
    got="sha256:$(sha256sum "${NIGHT_DIR}/downloads/${name}" | cut -d' ' -f1)"
    if [ "${got}" != "${digest}" ]; then
      failed 'night fetch' "${name} is ${got}, not the pinned ${digest}"
      return 1
    fi
  done < <(night_pins)
  ok 'night fetch' "$(night_pins | wc -l | tr -d ' ') pinned files fetched, each its pinned sha256"
}

# One command in the container with a file of the crew host on its standard input, never in its arguments.
in_the_container_from() {
  local file="$1"
  shift
  ssh "${HOST}" "$(remote_words podman exec -i "$@")" < "${file}"
}

# The tools step: the two .deb files in as root and installed with dpkg, then gh unpacked under the node user's home,
# and each answering its version as the node user.
night_tools_step() {
  local name digest url debs=() said
  while read -r name digest url; do
    case "${name}" in
      *.deb)
        in_the_container_from "${NIGHT_DIR}/downloads/${name}" --user root "${CONTAINER}" sh -c "mkdir -p ${NIGHT_DEB_DROP}; cat > ${NIGHT_DEB_DROP}/${name}" \
          || { failed 'night tools' "${name} could not be passed in"; return 1; }
        debs+=("${NIGHT_DEB_DROP}/${name}")
        ;;
      *.tar.gz)
        in_the_container_from "${NIGHT_DIR}/downloads/${name}" "${CONTAINER}" sh -c "set -eu; mkdir -p ${CONTAINER_HOME}/${NIGHT_GH_HOME} ${CONTAINER_HOME}/.local/bin; tar -xzf - -C ${CONTAINER_HOME}/${NIGHT_GH_HOME} --strip-components=1; ln -sf ${CONTAINER_HOME}/${NIGHT_GH_HOME}/bin/gh ${CONTAINER_HOME}/.local/bin/gh" \
          || { failed 'night tools' "${name} could not be unpacked under ${CONTAINER_HOME}"; return 1; }
        ;;
    esac
  done < <(night_pins)
  said="$(on_the_host podman exec --user root "${CONTAINER}" sh -c "dpkg -i ${debs[*]} && rm -rf ${NIGHT_DEB_DROP}" 2>&1)" \
    || { failed 'night tools' "dpkg would not install ${debs[*]}: $(one_line "${said}")"; return 1; }
  said="$(in_the_container 'tmux -V && gh --version' 2>&1)" || { failed 'night tools' "tmux or gh does not answer as ${CONTAINER_USER}: $(one_line "${said}")"; return 1; }
  ok 'night tools' "$(one_line "$(head -2 <<< "${said}")"), passed in on standard input; dpkg ran as root in one exec, the container runs as ${CONTAINER_USER}"
}

# The script that makes the clone from the bundle on its standard input, then declares the crew there.
night_clone_script() {
  printf 'set -eu; export HOME=%s; export PATH="$HOME/.local/bin:$PATH"; mkdir -p %s; cat > %s.bundle; git clone -q -b %s %s.bundle %s; rm %s.bundle; cd %s; git remote set-url origin %s; git config user.name %s; git config user.email %s; martha init; git remote get-url origin' \
    "${CONTAINER_HOME}" "$(dirname "${NIGHT_CLONE}")" "${NIGHT_CLONE}" "$(remote_word "${NIGHT_BRANCH}")" "${NIGHT_CLONE}" "${NIGHT_CLONE}" \
    "${NIGHT_CLONE}" "${NIGHT_CLONE}" "$(remote_word "$(night_origin)")" "$(remote_word "${CHECKOUT_AUTHOR}")" "$(remote_word "${CHECKOUT_AUTHOR_EMAIL}")"
}

# The clone's origin: the repository by its https address, with no token in it.
night_origin() { printf 'https://github.com/%s.git' "${NIGHT_FULL_NAME}"; }

# The clone step: the first commit in as a bundle on standard input, cloned at the crew's clones place, its origin the
# repository's address, the crew declared there; then what it holds listed, as what the run put there.
night_clone_step() {
  local said made
  git -C "${NIGHT_DIR}/${NIGHT_FIRST_PART}" bundle create -q "${NIGHT_DIR}/first.bundle" "${NIGHT_BRANCH}" 2> /dev/null \
    || { failed 'night clone' "the first commit could not be bundled from ${NIGHT_DIR}/${NIGHT_FIRST_PART}"; return 1; }
  said="$(in_the_container_from "${NIGHT_DIR}/first.bundle" "${CONTAINER}" sh -c "$(night_clone_script)" 2>&1)" \
    || { failed 'night clone' "the clone could not be made at ${NIGHT_CLONE}: $(one_line "${said}")"; return 1; }
  if [ "$(tail -1 <<< "${said}")" != "$(night_origin)" ]; then
    failed 'night clone' "the clone's origin is '$(tail -1 <<< "${said}")', not $(night_origin)"
    return 1
  fi
  made="$(on_the_host podman exec "${CONTAINER}" sh -c "cd ${NIGHT_CLONE} && find . -mindepth 1 -path ./.git -prune -o -print" 2>&1)" \
    || { failed 'night clone' "the clone could not be listed: $(one_line "${made}")"; return 1; }
  sed 's#^\./##' <<< "${made}" | grep -vx '.git' > "${NIGHT_DIR}/made.list" || true
  ok 'night clone' "${NIGHT_CLONE} from the first commit, origin $(night_origin) with no token, the crew declared in it"
}

# What the owner's command approves: the checkout alone, or on a night the checkout and then the clone, and it comes
# back to the checkout for the sign-in.
approve_command() {
  if a_night; then
    printf 'martha approve && cd %s && martha approve && cd %s' "${NIGHT_CLONE}" "${CHECKOUT}"
  else
    printf 'martha approve'
  fi
}

# The owner's step that approves, in the words of the list: once, or on a night once for each crew place. The words
# follow approve's own output and promise no yes: a crew place with no config that starts code asks nothing, as both
# places did on night 1 (martha#639), and approve asks only on a terminal, so the run cannot learn which ahead of time.
approve_step_words() {
  if a_night; then printf '  2. approve the checkout, then the throwaway clone: type yes where martha approve asks, nothing where it asks nothing'; else printf '  2. type yes to approve'; fi
}

# What still runs in the container, one command line a line: every process but the idle one, this listing and the
# zombies. Exit 2 with the reason when the container cannot list its processes.
night_left_processes() {
  local listed
  # shellcheck disable=SC2086 # the listing is a command and its words
  listed="$(on_the_host podman exec "${CONTAINER}" ${NIGHT_PROCESS_LIST} 2>&1)" \
    || { printf 'the container could not list its processes: %s' "$(one_line "${listed}")"; return 2; }
  awk -v idle="${NIGHT_IDLE_PID}" -v self="${NIGHT_PROCESS_LIST}" '
    $1 != idle && $2 !~ /^Z/ { $1 = $1; line = $0; sub(/^[^ ]+ [^ ]+ /, "", line); if (line != self) print line }' <<< "${listed}"
}

# The members stopped: every terminal of the proof closed, and nothing left running in the container but its idle
# process, so no member and no host session a member started outlives the stop.
night_stop_step() {
  local waited=0 left
  close_every_terminal
  while :; do
    left="$(night_left_processes)" || { failed 'night stop' "${left}"; return 1; }
    if [ -z "${left}" ]; then break; fi
    if [ "${waited}" -ge "${TURN_WINDOW_S}" ]; then
      failed 'night stop' "still running in the container after the stop: $(one_line "${left}")"
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  ok 'night stop' 'every member stopped: nothing runs in the container but its idle process'
}

# The clean-start step: the container's own listing of the home judged before any member starts in the clone, and
# before the token moves (R3). A hit fails by name.
night_clean_start_step() {
  local said
  node -e 'const [home, clone, list] = process.argv.slice(1); const made = require("node:fs").readFileSync(list, "utf8").split("\n").filter((l) => l !== ""); process.stdout.write(JSON.stringify({ home, clone, made }))' \
    "${CONTAINER_HOME}" "${NIGHT_CLONE}" "${NIGHT_DIR}/made.list" > "${NIGHT_DIR}/start.json"
  on_the_host podman exec "${CONTAINER}" find "${CONTAINER_HOME}" -xdev > "${NIGHT_DIR}/home.list" 2> /dev/null \
    || { failed 'night clean start' "the container could not list ${CONTAINER_HOME}"; return 1; }
  said="$(node --no-warnings "${REPO}/src/land_a_package_on_a_throwaway_repository/main.ts" clean-start "${NIGHT_DIR}/start.json" < "${NIGHT_DIR}/home.list" 2>&1)" \
    || { failed 'night clean start' "$(one_line "${said}"); no token is placed"; return 1; }
  ok 'night clean start' "the clone holds what the run put there, and nothing the host loads by itself is in its path or the home"
}

# One tmux command in the container, on the night's own server.
night_tmux() { on_the_host podman exec "${CONTAINER}" tmux -L "${NIGHT_TMUX_SOCKET}" "$@"; }

# What the member named `name`'s session shows now: only what is on its pane. A host that draws full-screen replaces
# what was there before it, so a line printed before the host started is gone from here (#639 night 1). Used only to
# say what the member was showing when a step fails.
night_screen() { night_tmux capture-pane -p -J -S - -t "$1" 2> /dev/null || true; }

# Every byte the session of `name` drew since it started, as tmux's pipe-pane kept it in the container.
night_kept() { on_the_host podman exec "${CONTAINER}" cat "${NIGHT_SCREENS}/$1.log" 2> /dev/null || true; }

# Drawn text matched plain: terminal sequences, control characters and every whitespace removed, so a line the host
# drew in pieces, moved the cursor through, or wrapped still reads as its words.
night_plain() {
  LC_ALL=C sed -E $'s/\x1b\\[[0-9;?<>=!]*[ -/]*[@-~]//g; s/\x1b\\][^\x07\x1b]*(\x07|\x1b\\\\)//g; s/\x1b.//g' | LC_ALL=C tr -d '[:space:][:cntrl:]'
}

# Whether the session of `name` drew `pattern` (an extended pattern, matched against the plain bytes it drew since it
# started, with the pattern's own whitespace removed) within `seconds`; read at least once, so 0 asks once.
night_drew() {
  local waited=0 plain_pattern
  plain_pattern="$(printf '%s' "$2" | tr -d '[:space:]')"
  while :; do
    if night_kept "$1" | night_plain | grep -qE -- "${plain_pattern}"; then return 0; fi
    if [ "${waited}" -ge "$3" ]; then return 1; fi
    sleep 1
    waited=$((waited + 1))
  done
}

# The script a member's session runs: it waits until the run keeps its bytes, then its own command in the clone, then
# the run's line saying it ended, then held. Without the wait, what the member prints first could go before the run
# starts keeping it.
night_member_script() {
  printf 'while [ ! -e %s ]; do sleep 0.1; done; export HOME=%s; export PATH="$HOME/.local/bin:$PATH"; cd %s; martha start %s; echo %s %s "$?"; %s' \
    "$(night_gate "$1")" "${CONTAINER_HOME}" "${NIGHT_CLONE}" "$(remote_word "$1")" "$(remote_word "$1")" "$(remote_word "${ENDED_WORDS}")" "${NIGHT_PANE_HOLD}"
}

# The file whose presence lets the session of `name` start its member.
night_gate() { printf '%s/%s.go' "${NIGHT_SCREENS}" "$1"; }

# The session of `name` started, held at its gate; its bytes kept from then on; then its gate opened.
night_start_session() {
  local name="$1"
  on_the_host podman exec "${CONTAINER}" mkdir -p "${NIGHT_SCREENS}" > /dev/null 2>&1 \
    && night_tmux new-session -d -s "${name}" -x "${TERMINAL_COLUMNS}" -y "${TERMINAL_ROWS}" "$(night_member_script "${name}")" > /dev/null 2>&1 \
    && night_tmux pipe-pane -o -t "${name}" "cat >> ${NIGHT_SCREENS}/${name}.log" > /dev/null 2>&1 \
    && on_the_host podman exec "${CONTAINER}" touch "$(night_gate "${name}")" > /dev/null 2>&1
}

# The restart step: each member started again by its own command, in the clone, in a tmux session of its own name, in
# the release's order, every byte it draws kept; its first-run folder question answered; and each earlier one still up
# once a later one starts.
night_restart_step() {
  local name earlier
  for name in "${MEMBERS[@]}"; do
    night_start_session "${name}" || { failed 'night restart' "tmux would not start ${name}'s session and keep what it draws"; return 1; }
    if ! night_drew "${name}" "${name} ${STARTED_WORDS}" "${STARTED_WINDOW_S}"; then
      failed 'night restart' "${name} never said '${name} ${STARTED_WORDS}' in the clone: $(night_screen "${name}" | tail -c 300 | tr '\n' ' ')"
      return 1
    fi
    if night_drew "${name}" "${TRUST_WORDS}" "${TURN_WINDOW_S}"; then
      night_tmux send-keys -t "${name}" Down > /dev/null 2>&1 && sleep "${KEY_PAUSE_S}" && night_tmux send-keys -t "${name}" Enter > /dev/null 2>&1 \
        || { failed 'night restart' "${name}'s folder question could not be answered"; return 1; }
    fi
    for earlier in "${MEMBERS[@]}"; do
      if [ "${earlier}" = "${name}" ]; then break; fi
      if night_drew "${earlier}" "${earlier} ${ENDED_WORDS}" 0; then
        failed 'night restart' "${earlier} ended in the clone while ${name} started"
        return 1
      fi
    done
  done
  ok 'night restart' "${MEMBERS[*]} started again by their own commands in ${NIGHT_CLONE}, each in a tmux session of its name"
}

# The script that takes the token on its standard input into a 0600 file, logs gh in from it, removes it, sets gh as
# git's credential helper, and says who gh answers as. The file goes on every way out: a failed login ends the
# script under `set -e`, and its EXIT trap still removes the file.
night_token_script() {
  printf 'set -eu; umask 077; export HOME=%s; export PATH="$HOME/.local/bin:$PATH"; trap "rm -f %s" EXIT; cat > %s; gh auth login --with-token --insecure-storage < %s; rm -f %s; gh auth setup-git; gh api user --jq .id' \
    "${CONTAINER_HOME}" "${NIGHT_TOKEN_DROP}" "${NIGHT_TOKEN_DROP}" "${NIGHT_TOKEN_DROP}" "${NIGHT_TOKEN_DROP}"
}

# The token step: the token on standard input at every hop, gh logged in from it in the container, and gh there
# answering as the bot recorded at setup (R4, R1).
night_token_step() {
  local said owner
  owner="$(json_field "${NIGHT_OWNER_FILE}" 'id')" || { failed 'night token' "${NIGHT_OWNER_FILE} names no id"; return 1; }
  said="$(in_the_container_from "${NIGHT_TOKEN_FILE}" "${CONTAINER}" sh -c "$(night_token_script)" 2> /dev/null)" \
    || { failed 'night token' 'gh in the container would not log in from the token on standard input, or once logged in would not set itself up for git or say who it is'; return 1; }
  if [ "$(tail -1 <<< "${said}")" != "${owner}" ]; then
    failed 'night token' "gh in the container answers as '$(tail -1 <<< "${said}")', not the bot (${owner})"
    return 1
  fi
  ok 'night token' "gh in the container answers as the bot (${owner}); the token came on standard input at every hop, and its file is removed"
}

# The night's steps after every member is proven in the checkout, in order; the first failure ends them.
night_steps() {
  night_stop_step || return 1
  night_clean_start_step || return 1
  night_restart_step || return 1
  night_token_step || return 1
  NIGHT_READY=1
  log "the night is ready: ${MEMBERS[*]} are up in ${NIGHT_CLONE} with the bot's login"
}

# The close: the night's repository deleted, whatever happened, once the container is gone. Its lines go in the log.
night_close() {
  local said status=0 line
  if [ -z "${NIGHT_OPENED}" ]; then return 0; fi
  said="$("${NIGHT_THROWAWAY}" close "${NIGHT_DIR}" 2>&1)" || status=$?
  while IFS= read -r line; do [ -z "${line}" ] || log "  ${line}"; done <<< "${said}"
  if [ "${status}" -ne 0 ]; then failed 'night close' "the throwaway repository was not proven gone (exit ${status}); see the lines above"; return 1; fi
  ok 'night close' 'the throwaway repository is gone'
}

# The night's stand-ins, beside the proof's own in `dir`: the throwaway script, curl, martha's `init`, and the podman
# answers for the night's own execs (night-podman, which the stand-in podman asks first and which answers 99 for an
# exec that is not the night's). Each answers from the case's folder; nothing here is shipped.
write_night_stand_ins() {
  local dir="$1"
  cat > "${dir}/throwaway" << 'THROWAWAY'
#!/usr/bin/env bash
# keep_a_throwaway_repository.sh, as far as the proof can tell: open makes the run folder with a first commit and the
# record the night reads; close says the repository is gone. Each is noted in the calls, in order.
set -u
standin="${MARTHA_CLEAN_INSTALL_STAND_IN:?}"
printf 'throwaway %s\n' "$1" >> "${standin}/calls"
case "$1" in
  open)
    if [ -f "${standin}/night.open-fails" ]; then echo 'FAIL who: the calls answer as another account' >&2; exit 1; fi
    mkdir -p "$2/first"
    git -C "$2/first" init -q -b main
    printf '# A throwaway repository\n' > "$2/first/README.md"
    git -C "$2/first" add README.md
    git -C "$2/first" -c user.name=x -c user.email=x@example.invalid commit -qm first
    printf 'FULL_NAME=synthetic-bot/martha-live-x\nID=77\nBASE=%s\nBRANCH=main\nPACKAGE=synthetic-bot/martha-live-x#1\n' \
      "$(git -C "$2/first" rev-parse HEAD)" > "$2/repository.env"
    echo 'ok make: synthetic-bot/martha-live-x (id 77), private'
    ;;
  close) echo 'ok close: synthetic-bot/martha-live-x deleted, and its id answers 404' ;;
esac
THROWAWAY
  cat > "${dir}/curl" << 'CURL'
#!/usr/bin/env bash
# curl, as far as the night's fetch can tell: the file it is asked to write holds words naming the address.
standin="${MARTHA_CLEAN_INSTALL_STAND_IN:?}"
out='' url=''
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done
printf 'curl %s\n' "${url}" >> "${standin}/calls"
printf 'the bytes of %s\n' "${url}" > "${out}"
CURL
  cat > "${dir}/martha" << 'MARTHA'
#!/usr/bin/env bash
# martha init, as far as the night's clone can tell: the crew declared in the folder it runs in.
if [ "${1:-}" = init ]; then : > the-stand-in-init-ran; fi
MARTHA
  cat > "${dir}/night-podman" << 'NIGHTPODMAN'
#!/usr/bin/env bash
# The stand-in podman's answers for the night's own execs, from the case's folder as the container's home; 99 for
# anything else, which the stand-in podman then answers itself. Every tmux session starts the stand-in member on a
# pipe of its own, its screen kept in the case's folder, and every process started here is noted so `rm` ends it.
standin="${MARTHA_CLEAN_INSTALL_STAND_IN:?}"
here="$(dirname "$0")"
. "${here}/member.facts"
in_home() { sed "s#${home}#${standin}/home#g"; }
words="$*"
if [ "${1:-}" = rm ]; then
  while read -r pid; do kill "${pid}" 2> /dev/null || true; done < "${standin}/night.pids" 2> /dev/null
  exit 99
fi
[ "${1:-}" = exec ] || exit 99
shift
user=node
input=''
while [ $# -gt 0 ]; do
  case "$1" in
    -i) input=1; shift ;;
    --user) user="$2"; shift 2 ;;
    -*) shift ;;
    *) shift; break ;;
  esac
done
# The container's process list: its idle process, a zombie, what the case's night.left holds, and the listing itself.
if [ "${1:-}" = ps ]; then
  printf '    1 Ss   the-idle-process\n   88 Z    [claude] <defunct>\n'
  cat "${standin}/night.left" 2> /dev/null || true
  printf '   99 R    %s\n' "$*"
  exit 0
fi
case "${words}" in
  *'cat > /root/night-debs/'*)
    [ "${user}" = root ] || exit 1
    cat > "${standin}/root.${words##*/}"
    ;;
  *'dpkg -i'*)
    [ "${user}" = root ] || exit 1
    for deb in ${words#*dpkg -i }; do
      case "${deb}" in /root/night-debs/*) [ -f "${standin}/root.${deb##*/}" ] || exit 1 ;; '&&') break ;; esac
    done
    : > "${standin}/tmux.installed"
    ;;
  *'tar -xzf -'*) cat > "${standin}/gh.tarball" ;;
  *'tmux -V && gh --version'*)
    [ -f "${standin}/tmux.installed" ] && [ -f "${standin}/gh.tarball" ] || exit 127
    printf 'tmux 3.3a\ngh version 2.104.0 (2026-11-12)\n'
    ;;
  *'git clone'*)
    [ -n "${input}" ] || exit 1
    PATH="${here}:${PATH}" sh -c "$(printf '%s' "${@: -1}" | in_home)"
    ;;
  *'find . -mindepth 1'*) sh -c "$(printf '%s' "${@: -1}" | in_home)" ;;
  *' find '*' -xdev'*)
    # A case whose night.plants-in-clone exists stands for a file in the clone the run did not put there; the file
    # names the clone, in the case's folder.
    if [ -f "${standin}/night.plants-in-clone" ]; then : > "$(cat "${standin}/night.plants-in-clone")/CLAUDE.md"; fi
    find "${standin}/home" -xdev | sed "s#^${standin}/home#${home}#"
    ;;
  *'tmux -L night new-session'*)
    # The session's command waits on its gate, as the run's does: the stand-in member starts only once the gate the
    # command names is there. Then it draws as the host does: its started line, and then a full-screen draw (the
    # alternate screen) that leaves that line off the pane, where the folder question's words are placed by moving the
    # cursor rather than by spaces.
    name=''
    while [ $# -gt 0 ]; do if [ "$1" = -s ]; then name="$2"; fi; command="$1"; shift; done
    gate="$(printf '%s' "${command}" | sed -n 's/^while \[ ! -e \([^ ]*\) \].*/\1/p' | in_home)"
    mkfifo "${standin}/tmux.${name}.keys"
    sleep 600 > "${standin}/tmux.${name}.keys" &
    printf '%s\n' "$!" >> "${standin}/night.pids"
    : > "${standin}/tmux.${name}.screen"
    (
      if [ -n "${gate}" ]; then until [ -e "${gate}" ]; do sleep 0.1; done; fi
      "${here}/member" "martha start ${name}" < "${standin}/tmux.${name}.keys" 2>&1 \
        | sed -u -e "s/\(${started} [0-9]*\)/\1"$'\033[?1049h\033[2J'"/" -e "/Quick safety check/s/ /"$'\033[1C'"/g"
    ) >> "${standin}/tmux.${name}.screen" &
    printf '%s\n' "$!" >> "${standin}/night.pids"
    ;;
  *'tmux -L night pipe-pane'*)
    # Kept from now on, as tmux keeps it: what the pane drew before the pipe began is not in it.
    name=''
    while [ $# -gt 0 ]; do if [ "$1" = -t ]; then name="$2"; fi; command="$1"; shift; done
    kept="$(printf '%s' "${command#cat >> }" | in_home)"
    tail -c 0 -F "${standin}/tmux.${name}.screen" >> "${kept}" 2> /dev/null &
    printf '%s\n' "$!" >> "${standin}/night.pids"
    ;;
  *'tmux -L night capture-pane'*)
    # Only what is on the pane: what the full-screen draw left there, never what it replaced.
    drawn="$(tr -d '\r' < "${standin}/tmux.${@: -1}.screen")"
    printf '%s\n' "${drawn##*$'\033[?1049h'}"
    ;;
  *'.night-screens'*)
    # The run's own execs on the folder that keeps the sessions' bytes: made, a gate touched, a kept file read.
    mapped=()
    for word in "$@"; do mapped+=("$(printf '%s' "${word}" | in_home)"); done
    "${mapped[@]}"
    ;;
  *'tmux -L night send-keys'*)
    name=''
    keys=()
    while [ $# -gt 0 ]; do
      case "$1" in -t) name="$2"; shift 2 ;; send-keys | -L | night | tmux) shift ;; *) keys+=("$1"); shift ;; esac
    done
    for key in "${keys[@]}"; do
      case "${key}" in Down) printf '\033[B' ;; Enter) printf '\r' ;; *) printf '%s' "${key}" ;; esac
    done > "${standin}/tmux.${name}.keys"
    ;;
  *'.night-token'*)
    # The token script itself, in the case's home, with the stand-in gh first on its PATH.
    [ -n "${input}" ] || exit 1
    PATH="${here}/night-bin:${PATH}" sh -c "$(printf '%s' "${@: -1}" | in_home)"
    ;;
  *) exit 99 ;;
esac
NIGHTPODMAN
  mkdir -p "${dir}/night-bin"
  cat > "${dir}/night-bin/gh" << 'GH'
#!/usr/bin/env bash
# gh in the container, as far as the token script can tell: the login keeps what it reads (or fails, when the case's
# night.gh-login-fails exists), and `api user` answers the case's id.
standin="${MARTHA_CLEAN_INSTALL_STAND_IN:?}"
case "${1:-} ${2:-}" in
  'auth login') [ ! -f "${standin}/night.gh-login-fails" ] || exit 1; cat > "${standin}/container.token" ;;
  'auth setup-git') ;;
  'api user') cat "${standin}/night.gh.id" 2> /dev/null || printf '4242\n' ;;
  *) exit 1 ;;
esac
GH
  chmod +x "${dir}/throwaway" "${dir}/curl" "${dir}/martha" "${dir}/night-podman" "${dir}/night-bin/gh"
}

# A night case: the proof's own case, its setup files (a bot with id 4242, a token nobody else holds) and its pins
# for the stand-in curl's words, each the sha256 of what it writes. `flag`, when given, is one more file of the case's.
night_case() {
  local standin="$1" flag="${2:-}" name digest url
  a_case "${standin}"
  printf '%s\n' "$(json_field "${RELEASE_PACKAGE}" 'version')" > "${standin}/version.words"
  mkdir -p "${standin}/live"
  printf '%s\n' "${NIGHT_SELF_TEST_TOKEN}" > "${standin}/live/token"
  chmod 600 "${standin}/live/token"
  printf '{"login":"synthetic-bot","id":4242}\n' > "${standin}/live/owner.json"
  while read -r name digest url; do
    printf '%s sha256:%s %s\n' "${name}" "$(printf 'the bytes of %s\n' "${url}" | sha256sum | cut -d' ' -f1)" "${url}"
  done < <(printf '%s\n' "${NIGHT_DEB_PINS[@]}" "${NIGHT_GH_PIN}") > "${standin}/pins"
  if [ -n "${flag}" ]; then : > "${standin}/${flag}"; fi
}

# A night case run with --night, its setup and stand-ins named, that must exit `expected`.
night_expect() {
  local expected="$1" standin="$2"
  MARTHA_LIVE_DIR="${standin}/live" MARTHA_CLEAN_INSTALL_THROWAWAY="${STAND_INS}/throwaway" \
    MARTHA_CLEAN_INSTALL_NIGHT_PINS="${standin}/pins" expect_status "${expected}" "${standin}" 'a-host' --night "${standin}/run"
}

# Whether the night's repository was closed after the container went: the run's close line after its tear-down.
night_closed_after_tear_down() {
  local out="$1/out" torn closed
  torn="$(grep -n '^ok tear down: ' "${out}" | head -1 | cut -d: -f1 || true)"
  closed="$(grep -n '^ok night close: ' "${out}" | head -1 | cut -d: -f1 || true)"
  [ -n "${closed}" ] && { [ -z "${torn}" ] || [ "${torn}" -lt "${closed}" ]; } \
    || { echo "the self-test: ${1##*/} did not delete the night's repository after the container went" >&2; return 1; }
}

# The night's cases: one that gets ready, and one for each guard that must stop it by name.
night_self_test() {
  local root="$1" standin failures=0 deb
  NIGHT_SELF_TEST_TOKEN='github_pat_a-word-only-the-night-cases-hold'
  write_night_stand_ins "${STAND_INS}"
  sed -i 's#^case "${1:-}" in$#if [ -x "$(dirname "$0")/night-podman" ]; then "$(dirname "$0")/night-podman" "$@"; s=$?; [ "${s}" -eq 99 ] || exit "${s}"; fi\ncase "${1:-}" in#' "${STAND_INS}/podman"
  grep -q 'night-podman' "${STAND_INS}/podman" || { echo 'the self-test: the stand-in podman does not ask the night first' >&2; return 1; }
  nfail() { echo "the self-test: $1" >&2; failures=$((failures + 1)); }

  # A night that gets ready: the tools in on standard input, dpkg as root, the clone from the bundle with a plain
  # origin, both places approved, the members stopped and started again in tmux in the clone, the token on standard
  # input only, gh there answering as the bot, and the repository deleted after the container.
  standin="${root}/night-ready"; night_case "${standin}" member.trust
  night_expect 0 "${standin}" || failures=$((failures + 1))
  asked_for '^the night is ready: ' "${standin}/out" || nfail 'a night that got ready did not say so'
  night_closed_after_tear_down "${standin}" || failures=$((failures + 1))
  head -1 "${standin}/calls" | grep -qx 'throwaway open' || nfail 'the night did not make its repository first'
  for deb in "${NIGHT_DEB_PINS[@]}"; do [ -f "${standin}/root.${deb%% *}" ] || nfail "${deb%% *} was not passed in to root"; done
  [ -f "${standin}/gh.tarball" ] || nfail 'gh was not passed in'
  asked_for '^exec --user root .* dpkg -i ' "${standin}/calls" || nfail 'dpkg did not run as root'
  [ "$(git -C "${standin}/home/${NIGHT_CLONES}/synthetic-bot/martha-live-x" remote get-url origin 2> /dev/null)" = 'https://github.com/synthetic-bot/martha-live-x.git' ] \
    || nfail "the clone's origin is not the repository's plain address"
  asked_for 'martha approve && cd .*martha-live-x && martha approve && cd ' "${standin}/out" || nfail 'the owner'"'"'s command does not approve both places'
  asked_for '^  2. approve the checkout, then the throwaway clone: type yes where martha approve asks, nothing where it asks nothing$' "${standin}/out" \
    || nfail 'the owner'"'"'s steps do not follow approve in both places'
  for name in "${SELF_TEST_MEMBERS[@]}"; do
    asked_for "tmux -L night new-session -d -s ${name} .*cd ${CONTAINER_HOME}/${NIGHT_CLONES}/synthetic-bot/martha-live-x; martha start " "${standin}/calls" \
      || nfail "${name} was not started again by its own command, in the clone, in tmux"
  done
  # Each member's folder question answered twice: in the checkout, then again in the clone.
  [ "$(grep -c $'\033\[B' "${standin}/typed" 2> /dev/null)" = "$((2 * ${#SELF_TEST_MEMBERS[@]}))" ] \
    || nfail "the folder question was not answered for each member in the clone"
  [ "$(cat "${standin}/container.token" 2> /dev/null)" = "${NIGHT_SELF_TEST_TOKEN}" ] || nfail 'the token did not reach the container on standard input'
  [ ! -e "${standin}/home/${NIGHT_TOKEN_DROP#"${CONTAINER_HOME}/"}" ] || nfail "the token's file was left in the home"
  if grep -qF -- "${NIGHT_SELF_TEST_TOKEN}" "${standin}/calls" "${standin}/out" "${standin}/err"; then nfail 'the token was an argument, or reached the log'; fi

  # gh in the container will not log in: named, and the token's file still goes from the home.
  standin="${root}/night-login-fails"; night_case "${standin}" night.gh-login-fails
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for '^FAIL night token: gh in the container would not log in' "${standin}/out" || nfail 'a failed gh login was not named'
  [ ! -e "${standin}/home/${NIGHT_TOKEN_DROP#"${CONTAINER_HOME}/"}" ] || nfail "a failed gh login left the token's file in the home"
  night_closed_after_tear_down "${standin}" || failures=$((failures + 1))

  # A pinned file whose bytes are not its pin: refused by name before any container is made, and the repository goes.
  standin="${root}/night-bad-bytes"; night_case "${standin}"
  sed -i '1s/sha256:[0-9a-f]*/sha256:0000000000000000000000000000000000000000000000000000000000000000/' "${standin}/pins"
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for '^FAIL night fetch: .* not the pinned sha256:0000' "${standin}/out" || nfail 'bytes that are not their pin were not refused by name'
  if grep -q '^create ' "${standin}/calls"; then nfail 'a container was made after a pin was refused'; fi
  night_closed_after_tear_down "${standin}" || failures=$((failures + 1))

  # R3: the clone holds a file the run did not put there: named, no token placed, no member started there.
  standin="${root}/night-unclean-start"; night_case "${standin}" night.plants-in-clone
  printf '%s\n' "${standin}/home/${NIGHT_CLONES}/synthetic-bot/martha-live-x" > "${standin}/night.plants-in-clone"
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL night clean start: .*martha-live-x/CLAUDE.md: in the clone, and the run did not put it there" "${standin}/out" \
    || nfail 'a stranger file in the clone was not named'
  [ ! -e "${standin}/container.token" ] || nfail 'a token was placed after an unclean start'
  if grep -q 'new-session' "${standin}/calls"; then nfail 'a member was started in an unclean clone'; fi
  night_closed_after_tear_down "${standin}" || failures=$((failures + 1))

  # A member's own process left after the stop, and apart from it a host session alone (a claude a member started,
  # outliving its martha): each named by its command line, and no token placed.
  standin="${root}/night-member-left"; night_case "${standin}"
  printf '   57 Sl   node %s/.local/bin/martha start builder\n' "${CONTAINER_HOME}" > "${standin}/night.left"
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL night stop: still running in the container after the stop: .*martha start builder" "${standin}/out" || nfail 'a member left running was not named'
  [ ! -e "${standin}/container.token" ] || nfail 'a token was placed with a member left running'
  standin="${root}/night-host-left"; night_case "${standin}"
  printf '   58 Sl   claude\n' > "${standin}/night.left"
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL night stop: still running in the container after the stop: claude$" "${standin}/out" || nfail 'a host session left running was not named'
  [ ! -e "${standin}/container.token" ] || nfail 'a token was placed with a host session left running'

  # R1 in the container: gh there answers as another account.
  standin="${root}/night-other-account"; night_case "${standin}"
  printf '99\n' > "${standin}/night.gh.id"
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for "^FAIL night token: gh in the container answers as '99', not the bot (4242)" "${standin}/out" || nfail 'gh answering as another account was not named'
  night_closed_after_tear_down "${standin}" || failures=$((failures + 1))

  # The repository could not be made: nothing is pulled or made, and the close still runs.
  standin="${root}/night-open-fails"; night_case "${standin}" night.open-fails
  night_expect 1 "${standin}" || failures=$((failures + 1))
  asked_for '^FAIL night open: ' "${standin}/out" || nfail 'a failed open was not named'
  if grep -q '^pull ' "${standin}/calls"; then nfail 'an image was pulled after the open failed'; fi
  grep -qx 'throwaway close' "${standin}/calls" || nfail 'the close did not run after a failed open'

  # The owner never signs in: exit 4, and the repository still goes.
  standin="${root}/night-no-sign-in"; night_case "${standin}"
  rm -f "${standin}/home/${OWNER_SESSION_ENDED#"${CONTAINER_HOME}/"}"
  night_expect 4 "${standin}" || failures=$((failures + 1))
  night_closed_after_tear_down "${standin}" || failures=$((failures + 1))

  # --night with no run folder is refused with the arguments.
  expect_status 2 "${root}" 'a-host' --night || failures=$((failures + 1))

  for standin in night-ready night-login-fails night-bad-bytes night-unclean-start night-member-left night-host-left night-other-account night-no-sign-in; do
    if [ -e "${root}/${standin}/container.present" ]; then nfail "the ${standin} run left its container behind"; fi
  done
  return $((failures > 0))
}
