#!/usr/bin/env bash
# forge-launcher.sh -Interactive launcher that guides a user through the full
# Agent Forge lifecycle in one session:
#   1. Pre-flight check      -verify required tools
#   2. Select harness        -GitHub Copilot | opencode | Claude Code | generic
#   3. Create repository     -gh repo create (GitHub) or git init (others)
#   4. Bootstrap Agent Forge -run bootstrap.sh into the new repo
#   5. Capture idea          -write IDEA.md
#   6. Add PRD / research    -optional: copy/paste PRD and seed docs into docs/
#   7. Commit + push         -commit bootstrapped forge, IDEA.md, PRD, and seed docs
#   8. Launch auto-build     -harness-specific instructions or CLI spawn
#   9. Completion summary
#
# Usage:
#   ./scripts/forge-launcher.sh [--non-interactive] [--headless] [--draft] [--dry-run]
#
# Options:
#   --non-interactive   Skip all interactive prompts (for CI/testing only).
#                       Requires environment variables to be set -see docs.
#   --headless          Instead of opening an interactive CLI, drive the queued
#                       skill directly from the terminal via `opencode run` or
#                       `copilot -p --yolo`. Configure with FORGE_RUN_WITH and
#                       FORGE_WORKFLOW_ENGINE (see docs/forge-launcher.md).
#   --draft             In the interactive flow, pre-answer "yes" to the optional
#                       auto-draft stages: generate the PRD and/or agent team
#                       non-interactively (with review boundaries), then choose
#                       how to run the workflow engine. Non-interactive runs use
#                       FORGE_AUTO_DRAFT=1 instead.
#   --dry-run           Print the headless command without executing it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP_SH="$SCRIPT_DIR/bootstrap.sh"

NON_INTERACTIVE=false
HEADLESS=false
DRY_RUN=false
DRAFT=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    --headless|--run)  HEADLESS=true; shift ;;
    --dry-run)         DRY_RUN=true; shift ;;
    --draft)           DRAFT=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------
tput_safe() { tput "$@" 2>/dev/null || true; }
BOLD="$(tput_safe bold)"
RESET="$(tput_safe sgr0)"
GREEN="$(tput_safe setaf 2)"
YELLOW="$(tput_safe setaf 3)"
CYAN="$(tput_safe setaf 6)"
RED="$(tput_safe setaf 1)"

print_header() {
  echo ""
  echo "${CYAN}${BOLD}════════════════════════════════════════════════════════${RESET}"
  echo "${CYAN}${BOLD}  McFuzzy Agent Forge -Launcher${RESET}"
  echo "${CYAN}${BOLD}════════════════════════════════════════════════════════${RESET}"
  echo ""
}

step() { echo ""; echo "${BOLD}▶ $1${RESET}"; }
ok()   { echo "  ${GREEN}✔${RESET}  $1"; }
warn() { echo "  ${YELLOW}⚠${RESET}  $1"; }
fail() { echo "  ${RED}✖${RESET}  $1"; }
info() { echo "  $1"; }

prompt() {
  local var_name="$1"
  local message="$2"
  local default="${3:-}"
  if [[ "$NON_INTERACTIVE" == true ]]; then
    # In non-interactive mode the caller must have set the variable already
    [[ -n "${!var_name:-}" ]] || { fail "Non-interactive mode: \$$var_name is not set."; exit 1; }
    return
  fi
  local prompt_str
  if [[ -n "$default" ]]; then
    prompt_str="${message} [${default}]: "
  else
    prompt_str="${message}: "
  fi
  read -rp "$prompt_str" "$var_name"
  if [[ -z "${!var_name:-}" && -n "$default" ]]; then
    printf -v "$var_name" '%s' "$default"
  fi
}

prompt_path() {
  # Like prompt(), but uses `read -e` so bash readline enables Tab completion
  # for existing file/directory paths. Falls back to plain line input when
  # stdin is not a terminal, so piped/CI input still works.
  local var_name="$1"
  local message="$2"
  local default="${3:-}"
  if [[ "$NON_INTERACTIVE" == true ]]; then
    [[ -n "${!var_name:-}" ]] || { fail "Non-interactive mode: \$$var_name is not set."; exit 1; }
    return
  fi
  local prompt_str
  if [[ -n "$default" ]]; then
    prompt_str="${message} [${default}]: "
  else
    prompt_str="${message}: "
  fi
  read -e -r -p "$prompt_str" "$var_name"
  if [[ -z "${!var_name:-}" && -n "$default" ]]; then
    printf -v "$var_name" '%s' "$default"
  fi
}

expand_env() {
  # Expands $VAR and ${VAR} references in a typed path without eval.
  # Unknown variables expand to empty (matching shell behaviour).
  local s="$1" out="" prefix var value
  while [[ "$s" =~ ^([^$]*)\$\{([A-Za-z_][A-Za-z0-9_]*)\}(.*)$ ]]; do
    prefix="${BASH_REMATCH[1]}"; var="${BASH_REMATCH[2]}"; s="${BASH_REMATCH[3]}"
    out+="$prefix${!var:-}"
  done
  while [[ "$s" =~ ^([^$]*)\$([A-Za-z_][A-Za-z0-9_]*)(.*)$ ]]; do
    prefix="${BASH_REMATCH[1]}"; var="${BASH_REMATCH[2]}"; s="${BASH_REMATCH[3]}"
    out+="$prefix${!var:-}"
  done
  out+="$s"
  printf '%s' "$out"
}

expand_path() {
  # Normalises a user-typed path: trims whitespace, expands $VAR references,
  # then expands a leading ~ / ~/ / ~user to the home directory.
  local path="${1:-}"
  path="$(printf '%s' "$path" | xargs)"
  path="$(expand_env "$path")"
  case "$path" in
    "~") printf '%s' "$HOME"; return ;;
    "~/"*) printf '%s/%s' "$HOME" "${path#\~/}"; return ;;
    "~"*)
      local user rest home
      user="${path%%/*}"; user="${user#\~}"
      if [[ "$path" == */* ]]; then rest="${path#*/}"; else rest=""; fi
      home="$(getent passwd "$user" 2>/dev/null | cut -d: -f6)"
      [[ -n "$home" ]] || home="/home/$user"
      if [[ -n "$rest" ]]; then printf '%s/%s' "$home" "$rest"; else printf '%s' "$home"; fi
      return ;;
  esac
  printf '%s' "$path"
}

resolve_input_file() {
  # Expands a user-typed path (via expand_path), normalises it (collapses "..",
  # resolves relative-to-CWD), and checks it is an existing regular file. Sets
  # REPLY_PATH to the resolved path and returns 0 on success. On failure, sets
  # REPLY_REASON to a diagnostic and returns 1.
  local raw="$1"
  REPLY_PATH="$(expand_path "$raw")"
  if [[ -z "$REPLY_PATH" ]]; then
    REPLY_REASON="empty path"
    return 1
  fi
  REPLY_PATH="$(realpath -m "$REPLY_PATH")"
  if [[ -e "$REPLY_PATH" ]]; then
    if [[ -f "$REPLY_PATH" ]]; then
      REPLY_REASON=""
      return 0
    fi
    REPLY_REASON="not a regular file: $REPLY_PATH"
    return 1
  fi
  REPLY_REASON="file not found: $REPLY_PATH"
  return 1
}

prompt_yn() {
  # Sets global REPLY_YN to "y" or "n"
  local message="$1"
  local default="${2:-n}"
  if [[ "$NON_INTERACTIVE" == true ]]; then
    REPLY_YN="${FORGE_YN_DEFAULT:-$default}"
    return
  fi
  read -rp "${message} [y/N]: " REPLY_YN
  REPLY_YN="${REPLY_YN:-$default}"
}

shell_quote() {
  printf '%q' "$1"
}

proc_alive() {
  # True while $1 is a running (non-zombie) process. Zombie-safe: a finished
  # background child shows as 'Z' until reaped, which would otherwise stall the
  # heartbeat loop below. Falls back to kill -0 when ps is unavailable.
  if command -v ps &>/dev/null; then
    local stat
    stat="$(ps -o stat= -p "$1" 2>/dev/null)" || return 1
    [[ "$stat" != *Z* ]]
  else
    kill -0 "$1" 2>/dev/null
  fi
}

run_in_repo() {
  ( cd "$REPO_DIR" && "$@" )
}

run_with_heartbeat() {
  # Runs a long-running command with its output left visible (it streams
  # normally) plus a periodic "still running… Ns" line so users don't think the
  # launcher is hung. Disabled (runs the command directly) when stdout is not a
  # terminal or --dry-run is set, so CI/piped output stays clean.
  local label="$1"; shift
  if [[ ! -t 1 || "$DRY_RUN" == true ]]; then
    "$@"
    return $?
  fi
  local interval="${FORGE_HEARTBEAT_INTERVAL:-15}"
  local start; start="$(date +%s)"
  "$@" &
  local pid=$!
  local last=0
  while proc_alive "$pid"; do
    sleep 1
    local now; now="$(date +%s)"
    local elapsed=$((now - start))
    if (( elapsed >= interval && elapsed - last >= interval )); then
      last=$elapsed
      printf '  %s (still running… %ss)\n' "$label" "$elapsed"
    fi
  done
  wait "$pid"
  return $?
}

launch_cli_in_terminal() {
  local cli_name="$1"
  local repo_dir="$2"
  shift 2
  local args=("$@")

  local launch_script="cd $(shell_quote "$repo_dir") && $(shell_quote "$cli_name")"
  local arg
  for arg in "${args[@]}"; do
    launch_script+=" $(shell_quote "$arg")"
  done
  launch_script+="; exec bash"

  if command -v gnome-terminal &>/dev/null; then
    gnome-terminal --working-directory="$repo_dir" -- bash -lc "$launch_script" >/dev/null 2>&1 &
  elif command -v x-terminal-emulator &>/dev/null; then
    x-terminal-emulator -e bash -lc "$launch_script" >/dev/null 2>&1 &
  elif command -v konsole &>/dev/null; then
    konsole --workdir "$repo_dir" -e bash -lc "$launch_script" >/dev/null 2>&1 &
  elif command -v mate-terminal &>/dev/null; then
    mate-terminal --working-directory="$repo_dir" -- bash -lc "$launch_script" >/dev/null 2>&1 &
  else
    warn "No supported desktop terminal emulator found. Open a terminal manually and run:"
    echo "    cd \"$repo_dir\" && $cli_name ${args[*]:-}"
    return 1
  fi

  return 0
}

autobuild_command() {
  # forge-auto-build requires an existing PRD. If one was captured (or a
  # decomposed PRD layout already exists), queue the build. Otherwise queue
  # forge-auto-build-prd to create the PRD first.
  if [[ "$PRD_ADDED" == true ]] || [[ -f "$REPO_DIR/docs/PRD.md" ]] || [[ -f "$REPO_DIR/docs/product-vision.md" ]]; then
    echo "/forge-auto-build Use docs/PRD.md as the project PRD"
  else
    echo "/forge-auto-build-prd Use docs/IDEA.md as the project idea"
  fi
}

# The skill invocation message used by the headless terminal command.
headless_skill_msg() {
  if [[ "$PRD_ADDED" == true ]] || [[ -f "$REPO_DIR/docs/PRD.md" ]] || [[ -f "$REPO_DIR/docs/product-vision.md" ]]; then
    if [[ "${FORGE_WORKFLOW_ENGINE:-0}" == "1" ]]; then
      echo "/forge-auto-build Use docs/PRD.md as the project PRD. GO --workflow-engine"
    else
      echo "/forge-auto-build Use docs/PRD.md as the project PRD. GO"
    fi
  else
    echo "/forge-auto-build-prd Use docs/IDEA.md as the project idea. Headless mode: auto-proceed with default assumptions and approve the PRD."
  fi
}

# The non-interactive terminal runner (opencode run --auto or copilot -p --yolo).
headless_runner() {
  local runner="${FORGE_RUN_WITH:-}"
  [[ -n "$runner" ]] || runner="$( [[ "$HARNESS" == "github" ]] && echo "copilot" || echo "opencode" )"
  echo "$runner"
}

# Builds the `opencode run --auto` / `copilot -p --yolo` command that drives a
# skill message non-interactively from the terminal.
headless_cmd_for() {
  local skill_msg="$1"
  local runner; runner="$(headless_runner)"
  case "$runner" in
    copilot) echo "copilot -p \"$skill_msg\" --yolo" ;;
    *) echo "opencode run --auto \"$skill_msg\"" ;;
  esac
}

# Builds the non-interactive terminal command that drives the queued skill via
# `opencode run --auto` or `copilot -p --yolo`, so no interactive CLI is needed.
headless_build_command() {
  headless_cmd_for "$(headless_skill_msg)"
}

# Executes a skill message non-interactively in the repository (or prints it
# with --dry-run). Used by the --headless queued-skill run and the optional
# auto-draft stages.
run_skill_headless() {
  local skill_msg="$1"
  local cmd_str; cmd_str="$(headless_cmd_for "$skill_msg")"

  echo "    ${BOLD}${cmd_str}${RESET}"
  if [[ "$DRY_RUN" == true ]]; then
    warn "Dry-run: command printed, not executed."
    return 0
  fi

  local runner; runner="$(headless_runner)"
  local -a cmd
  case "$runner" in
    copilot) cmd=(copilot -p "$skill_msg" --yolo) ;;
    *) cmd=(opencode run --auto "$skill_msg") ;;
  esac
  run_with_heartbeat "Running the skill (may take a while)" run_in_repo "${cmd[@]}"
}

# Executes the queued headless build (used by --headless mode).
run_headless_build() {
  run_skill_headless "$(headless_skill_msg)"
}

# ---------------------------------------------------------------------------
# Optional auto-draft flow (idea -> PRD -> agent team -> engine), driven
# non-interactively through the harness CLI with review boundaries in between.
# ---------------------------------------------------------------------------

has_prd() {
  [[ -f "$REPO_DIR/docs/PRD.md" ]] || [[ -f "$REPO_DIR/docs/product-vision.md" ]]
}

harness_agents_dir() {
  case "$HARNESS" in
    github)   echo "$REPO_DIR/.github/agents" ;;
    claude)   echo "$REPO_DIR/.claude/agents" ;;
    opencode) echo "$REPO_DIR/.opencode/agents" ;;
    *)        echo "$REPO_DIR/.agents/agents" ;;
  esac
}

has_generated_team() {
  local agents_dir; agents_dir="$(harness_agents_dir)"
  # At least one project-specific agent beyond the bootstrapped forge templates.
  local count
  count="$(find "$agents_dir" -maxdepth 1 -name '*.md' ! -name 'forge-team-builder.md' ! -name 'project-orchestrator.md' ! -name 'workflow-orchestrator.md' 2>/dev/null | wc -l)"
  [[ "${count:-0}" -gt 0 ]]
}

prd_source_for_team() {
  # Returns the PRD source for the team auto-draft. Prefers the decomposed
  # representation (vision + features) when it exists so forge-build-agent-team
  # runs in Vision + Features mode and builds the team from the features;
  # otherwise falls back to the monolithic docs/PRD.md.
  if [[ -f "$REPO_DIR/docs/product-vision.md" ]] && compgen -G "$REPO_DIR/docs/features/*.md" >/dev/null; then
    echo "the decomposed PRD representation (docs/product-vision.md + docs/features/*.md)"
  else
    echo "docs/PRD.md"
  fi
}

draft_commit() {
  # Commits the artifacts produced by an auto-draft stage so the repo stays
  # reviewable. Skips when nothing changed.
  local message="$1"
  git -C "$REPO_DIR" add .
  if git -C "$REPO_DIR" diff --cached --quiet -- . 2>/dev/null; then
    warn "No changes to commit after auto-draft."
    return
  fi
  git -C "$REPO_DIR" commit -m "$message" >/dev/null
  ok "Committed: '$message'"
}

auto_draft_prd() {
  # idea -> PRD (or decomposed PRD). Runs forge-auto-build-prd headless and
  # records default assumptions for every unknown (Open Questions).
  if has_prd; then
    return 0
  fi
  if [[ "$NON_INTERACTIVE" == true ]]; then
    [[ "${FORGE_AUTO_DRAFT:-0}" == "1" ]] || return 0
  else
    local default="n"; [[ "$DRAFT" == true ]] && default="y"
    prompt_yn "Generate the PRD from docs/IDEA.md automatically now (headless, auto-proceed with best answers)?" "$default"
    [[ "${REPLY_YN,,}" == "y" ]] || return 0
  fi

  echo ""
  info "Auto-drafting the PRD from docs/IDEA.md (headless) …"
  run_skill_headless "/forge-auto-build-prd Use docs/IDEA.md as the project idea. Headless mode: auto-proceed with default assumptions and approve the PRD."
  draft_commit "docs: add auto-drafted PRD"

  if has_prd; then
    PRD_ADDED=true
    ok "PRD generated."
    echo ""
    echo "  Review it before continuing:"
    echo "    - $REPO_DIR/docs/PRD.md"
    echo "    - $( [[ -f "$REPO_DIR/docs/product-vision.md" ]] && echo "$REPO_DIR/docs/product-vision.md (decomposed) + docs/features/*.md" || echo "docs/PRD.md is monolithic (no decomposition)")"
  else
    warn "The auto-draft did not produce docs/PRD.md or the decomposed layout. Review the run output and re-run manually if needed."
  fi
}

auto_draft_team() {
  # PRD -> agent team + skills. Runs forge-build-agent-team headless so the user
  # can review the generated team before any build execution.
  if has_prd; then
    if [[ "$NON_INTERACTIVE" == true ]]; then
      [[ "${FORGE_AUTO_DRAFT:-0}" == "1" ]] || return 0
    else
      local default="n"; [[ "$DRAFT" == true ]] && default="y"
      prompt_yn "Generate the agent team from the PRD automatically now (headless)?" "$default"
      [[ "${REPLY_YN,,}" == "y" ]] || return 0
    fi

    echo ""
    info "Auto-drafting the agent team from the PRD (headless) …"
    local prd_source; prd_source="$(prd_source_for_team)"
    run_skill_headless "/forge-build-agent-team Use $prd_source to build the agent team. Auto-proceed with default assumptions and no questions."
    draft_commit "feat: generate auto-drafted agent team"

    if has_generated_team; then
      ok "Agent team generated."
      echo ""
      echo "  Review the generated team before building:"
      echo "    - Agents : $(harness_agents_dir)/"
      echo "    - Skills : $(dirname "$(harness_agents_dir)")/skills/"
    else
      warn "The auto-draft did not produce project-specific agent files under $(harness_agents_dir)/."
    fi
    engine_decision
  fi
}

engine_decision() {
  # After team generation: offer to run the workflow engine now (detached),
  # print the command to run later, or skip.
  echo ""
  echo "  The agent team is ready. You can run the build now through the"
  echo "  workflow engine, run it later, or build manually."
  echo ""
  if [[ "$NON_INTERACTIVE" == true ]]; then
    [[ "${FORGE_AUTO_DRAFT:-0}" == "1" ]] || return 0
    print_engine_command
    return 0
  fi
  echo "    1) Run the workflow-engine build now (detached)"
  echo "    2) Print the engine command to run later"
  echo "    3) Skip - I will launch the CLI / build manually"
  echo ""
  local engine_choice
  prompt engine_choice "Select [1-3]" "2"
  case "$engine_choice" in
    1) run_engine_detached ;;
    2) print_engine_command ;;
    *) info "Skipping the engine for now. Run the build manually or use the printed command later." ;;
  esac
}

print_engine_command() {
  local engine_script="$SCRIPT_DIR/forge-engine-run.sh"
  local harness="${FORGE_ENGINE_HARNESS:-opencode}"
  echo "    ${BOLD}${engine_script} --repo \"$REPO_DIR\" --harness $harness --yes${RESET}"
  echo ""
  info "Run it from anywhere later to execute the build through the workflow engine."
}

run_engine_detached() {
  local engine_script="$SCRIPT_DIR/forge-engine-run.sh"
  local harness="${FORGE_ENGINE_HARNESS:-opencode}"
  if [[ "$DRY_RUN" == true ]]; then
    warn "Dry-run: would start the engine detached:"
    print_engine_command
    return 0
  fi
  ( nohup "$engine_script" --repo "$REPO_DIR" --harness "$harness" --yes \
      >> "$REPO_DIR/docs/engine-run.log" 2>&1 & )
  ENGINE_STARTED=true
  ok "Engine started detached. Log: $REPO_DIR/docs/engine-run.log"
  echo ""
  info "The engine runs in the background, even after this launcher exits."
  info "Monitor progress from another terminal with:"
  echo "    ${BOLD}tail -f $REPO_DIR/docs/engine-run.log${RESET}"
  echo "    ${BOLD}tail -f $REPO_DIR/docs/PROGRESS.md${RESET}"
}

auto_draft_menu() {
  # Offered at Step 8 in interactive runs (and FORGE_AUTO_DRAFT runs): generate
  # the PRD and/or agent team non-interactively, with review boundaries.
  if [[ ! -f "$REPO_DIR/docs/IDEA.md" ]]; then
    return 0
  fi
  auto_draft_prd
  auto_draft_team
}

# ---------------------------------------------------------------------------
# Step 1: Pre-flight check
# ---------------------------------------------------------------------------
preflight_check() {
  step "Step 1 of 9: Pre-flight check"

  local missing=()

  if command -v git &>/dev/null; then
    ok "git $(git --version | awk '{print $3}')"
  else
    fail "git not found -install Git before running this launcher."
    missing+=(git)
  fi

  if command -v gh &>/dev/null; then
    ok "gh $(gh --version 2>/dev/null | head -1 | awk '{print $3}')"
    GH_AVAILABLE=true
  else
    warn "gh (GitHub CLI) not found -GitHub harness repo creation will be unavailable."
    GH_AVAILABLE=false
  fi

  if command -v copilot &>/dev/null; then
    ok "copilot $(copilot --version 2>/dev/null | head -1 || echo '(installed)')"
    COPILOT_AVAILABLE=true
  else
    warn "copilot not found -GitHub Copilot CLI auto-launch will be unavailable."
    COPILOT_AVAILABLE=false
  fi

  if command -v opencode &>/dev/null; then
    ok "opencode $(opencode --version 2>/dev/null | head -1 || echo '(installed)')"
    OPENCODE_AVAILABLE=true
  else
    warn "opencode not found -opencode harness auto-launch will be unavailable."
    OPENCODE_AVAILABLE=false
  fi

  if command -v claude &>/dev/null; then
    ok "claude $(claude --version 2>/dev/null | head -1 || echo '(installed)')"
    CLAUDE_AVAILABLE=true
  else
    warn "claude not found -Claude Code harness auto-launch will be unavailable."
    CLAUDE_AVAILABLE=false
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo ""
    fail "Required tools are missing: ${missing[*]}. Install them and re-run."
    exit 1
  fi

  if [[ ! -x "$BOOTSTRAP_SH" ]]; then
    fail "bootstrap.sh not found or not executable: $BOOTSTRAP_SH"
    exit 1
  fi

  ok "bootstrap.sh found"
}

# ---------------------------------------------------------------------------
# Step 2: Select harness
# ---------------------------------------------------------------------------
select_harness() {
  step "Step 2 of 9: Select agent harness"

  echo ""
  echo "  Which agent harness will this project use?"
  echo ""
  echo "    1) GitHub Copilot   (harness: github,    dir: .github/)"
  echo "    2) opencode         (harness: opencode,  dir: .opencode/)"
  echo "    3) Claude Code      (harness: claude,    dir: .claude/)"
  echo "    4) Generic .agents  (harness: agents,    dir: .agents/)  [default]"
  echo ""

  local choice
  if [[ "$NON_INTERACTIVE" == true ]]; then
    choice="${FORGE_HARNESS_CHOICE:-4}"
  else
    prompt choice "Select [1-4]" "4"
  fi

  case "$choice" in
    1) HARNESS="github";    HARNESS_LABEL="GitHub Copilot" ;;
    2) HARNESS="opencode";  HARNESS_LABEL="opencode" ;;
    3) HARNESS="claude";    HARNESS_LABEL="Claude Code" ;;
    4) HARNESS="agents";    HARNESS_LABEL="Generic .agents" ;;
    *) warn "Unrecognised choice '$choice', defaulting to generic .agents"
       HARNESS="agents"; HARNESS_LABEL="Generic .agents" ;;
  esac

  ok "Harness: ${HARNESS_LABEL} (--harness ${HARNESS})"
}

# ---------------------------------------------------------------------------
# Step 3: Create repository
# ---------------------------------------------------------------------------
create_repo() {
  step "Step 3 of 9: Create repository"

  local repo_name repo_description repo_visibility parent_dir

  if [[ "$NON_INTERACTIVE" == true ]]; then
    repo_name="${FORGE_REPO_NAME:-}"
    [[ -n "$repo_name" ]] || { fail "Non-interactive mode: \$FORGE_REPO_NAME is not set."; exit 1; }
    repo_description="${FORGE_REPO_DESCRIPTION:-}"
    repo_visibility="${FORGE_REPO_VISIBILITY:-private}"
    parent_dir="${FORGE_REPO_PARENT_DIR:-$(pwd)}"
  else
    prompt repo_name "Repository name (no spaces)" ""
    [[ -n "$repo_name" ]] || { fail "Repository name cannot be empty."; exit 1; }
    prompt repo_description "Short description (optional)" ""
    prompt repo_visibility "Visibility -public or private" "private"
    parent_dir="$(pwd)"
    prompt_path parent_dir "Parent directory for the new repo" "$(pwd)"
  fi

  [[ -n "$repo_name" ]] || { fail "Repository name cannot be empty."; exit 1; }
  repo_visibility="${repo_visibility,,}"
  [[ "$repo_visibility" == "public" || "$repo_visibility" == "private" ]] || repo_visibility="private"
  parent_dir="${parent_dir:-$(pwd)}"
  parent_dir="$(expand_path "$parent_dir")"
  parent_dir="$(realpath -m "$parent_dir")"

  REPO_DIR="$parent_dir/$repo_name"

  if [[ "$HARNESS" == "github" && "$GH_AVAILABLE" == true ]]; then
    info "Creating GitHub repository '$repo_name' ($repo_visibility) …"
    local gh_args=(repo create "$repo_name" "--${repo_visibility}" --clone)
    [[ -n "$repo_description" ]] && gh_args+=(--description "$repo_description")
    run_with_heartbeat "Creating GitHub repository…" gh "${gh_args[@]}"
    # gh clones into a subdirectory named after the repo
    REPO_DIR="$(pwd)/$repo_name"
    ok "GitHub repo created and cloned to: $REPO_DIR"
    REMOTE_CREATED=true
  else
    info "Initialising local Git repository at: $REPO_DIR"
    mkdir -p "$REPO_DIR"
    git -C "$REPO_DIR" init
    if [[ -n "$repo_description" ]]; then
      echo "# $repo_name" > "$REPO_DIR/README.md"
      echo "" >> "$REPO_DIR/README.md"
      echo "$repo_description" >> "$REPO_DIR/README.md"
    fi
    ok "Local git repository initialised: $REPO_DIR"
    REMOTE_CREATED=false

    if [[ "$HARNESS" == "github" && "$GH_AVAILABLE" == false ]]; then
      warn "gh is not installed -skipped remote creation."
      warn "Run 'gh repo create' or 'git remote add origin <url>' manually."
    else
      prompt_yn "Add a Git remote for this repository now?"
      if [[ "${REPLY_YN,,}" == "y" ]]; then
        local remote_url
        prompt remote_url "Remote URL (e.g. https://github.com/user/repo.git)" ""
        if [[ -n "$remote_url" ]]; then
          git -C "$REPO_DIR" remote add origin "$remote_url"
          ok "Remote 'origin' added: $remote_url"
          REMOTE_CREATED=true
        fi
      fi
    fi
  fi
}

# ---------------------------------------------------------------------------
# Step 4: Bootstrap Agent Forge
# ---------------------------------------------------------------------------
bootstrap_forge() {
  step "Step 4 of 9: Bootstrap Agent Forge"

  info "Running bootstrap.sh → $REPO_DIR (--harness $HARNESS) …"
  run_with_heartbeat "Bootstrapping Agent Forge (copying templates)…" "$BOOTSTRAP_SH" "$REPO_DIR" --harness "$HARNESS" --force
  ok "Agent Forge templates bootstrapped."
}

# ---------------------------------------------------------------------------
# Step 5: Capture idea
# ---------------------------------------------------------------------------
capture_idea() {
  step "Step 5 of 9: Capture your project idea"

  local idea_file_root="$REPO_DIR/IDEA.md"
  local idea_file_docs="$REPO_DIR/docs/IDEA.md"

  echo ""
  echo "  Describe your project idea below."
  echo "  This will be saved to docs/IDEA.md (and mirrored to IDEA.md)"
  echo "  and used as the starting prompt"
  echo "  for forge-auto-build-prd (which turns it into docs/PRD.md)."
  echo ""
  echo "  Enter your idea (press Ctrl+D on an empty line when finished):"
  echo "  ──────────────────────────────────────────────────────────────"

  if [[ "$NON_INTERACTIVE" == true ]]; then
    [[ -n "${FORGE_IDEA:-}" ]] || { fail "Non-interactive mode: \$FORGE_IDEA is not set."; exit 1; }
    IDEA_TEXT="$FORGE_IDEA"
  else
    IDEA_TEXT=""
    while IFS= read -r line || [[ -n "$line" ]]; do
      IDEA_TEXT+="$line"$'\n'
    done
    # Remove trailing newline
    IDEA_TEXT="${IDEA_TEXT%$'\n'}"
  fi

  if [[ -z "$IDEA_TEXT" ]]; then
    warn "No idea text entered. docs/IDEA.md will be created as a placeholder."
    IDEA_TEXT="*(Replace this with your project idea before running forge-auto-build-prd.)*"
  fi

  mkdir -p "$REPO_DIR/docs"

  {
    echo "# Project Idea"
    echo ""
    echo "$IDEA_TEXT"
    echo ""
    echo "---"
    echo ""
    echo "> Generated by forge-launcher on $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "> Use this file as input for: \`@workspace /forge-auto-build-prd Use docs/IDEA.md as the project idea\`"
  } > "$idea_file_docs"

  cp "$idea_file_docs" "$idea_file_root"

  ok "Idea saved to: $idea_file_docs"
  info "Compatibility copy written to: $idea_file_root"
}

# ---------------------------------------------------------------------------
# Step 6: Add PRD and research / seed documents (optional but recommended)
# ---------------------------------------------------------------------------
add_prd_and_research() {
  step "Step 6 of 9: Add PRD and research / seed documents (optional -recommended)"

  local docs_dir="$REPO_DIR/docs"
  local research_dir="$docs_dir/research"
  PRD_ADDED=false
  RESEARCH_ADDED=false

  echo ""
  echo "  ${BOLD}Why this step matters:${RESET}"
  echo "  Starting with a well-defined PRD produces a far more accurate and"
  echo "  complete build than starting from an idea alone.  Research / seed"
  echo "  documents (design specs, market research, technical notes, etc.) give"
  echo "  the pipeline additional context that improves every downstream stage."
  echo ""

  # --- PRD ---------------------------------------------------------------
  if [[ "$NON_INTERACTIVE" == true ]]; then
    if [[ -n "${FORGE_PRD_FILE:-}" ]]; then
      if resolve_input_file "$FORGE_PRD_FILE"; then
        mkdir -p "$docs_dir"
        cp "$REPLY_PATH" "$docs_dir/PRD.md"
        ok "PRD copied from \$FORGE_PRD_FILE → docs/PRD.md"
        PRD_ADDED=true
      else
        warn "FORGE_PRD_FILE is set but $REPLY_REASON -skipping PRD."
      fi
    fi
  else
    echo "  Do you have an existing PRD to add?"
    echo ""
    echo "    1) Yes -provide a file path to copy in as docs/PRD.md"
    echo "    2) Yes -paste the PRD content directly"
    echo "    3) No  -skip (the pipeline will build a PRD from docs/IDEA.md first)"
    echo ""
    local prd_choice
    prompt prd_choice "Select [1-3]" "3"

    case "$prd_choice" in
      1)
        local prd_src
        prompt_path prd_src "Path to your PRD file" ""
        if resolve_input_file "$prd_src"; then
          mkdir -p "$docs_dir"
          cp "$REPLY_PATH" "$docs_dir/PRD.md"
          ok "PRD copied → docs/PRD.md"
          PRD_ADDED=true
        else
          warn "$REPLY_REASON -skipping PRD."
        fi
        ;;
      2)
        echo ""
        echo "  Paste your PRD content below."
        echo "  Press Ctrl+D on an empty line when finished:"
        echo "  ──────────────────────────────────────────────────────────────"
        local prd_text=""
        while IFS= read -r line || [[ -n "$line" ]]; do
          prd_text+="$line"$'\n'
        done
        prd_text="${prd_text%$'\n'}"
        if [[ -n "$prd_text" ]]; then
          mkdir -p "$docs_dir"
          printf '%s\n' "$prd_text" > "$docs_dir/PRD.md"
          ok "PRD saved → docs/PRD.md"
          PRD_ADDED=true
        else
          warn "No content entered -skipping PRD."
        fi
        ;;
      *)
        info "Skipping PRD -the pipeline will build a PRD from docs/IDEA.md first (via forge-auto-build-prd)."
        ;;
    esac
  fi

  # --- Research / seed documents -----------------------------------------
  if [[ "$NON_INTERACTIVE" == true ]]; then
    if [[ -n "${FORGE_RESEARCH_FILES:-}" ]]; then
      mkdir -p "$research_dir"
      IFS=',' read -ra _research_files <<< "$FORGE_RESEARCH_FILES"
      for _f in "${_research_files[@]}"; do
        _f="$(echo "$_f" | xargs)"  # trim leading/trailing whitespace
        if resolve_input_file "$_f"; then
          cp "$REPLY_PATH" "$research_dir/"
          ok "Research doc copied: $(basename "$REPLY_PATH") → docs/research/"
          RESEARCH_ADDED=true
        else
          warn "FORGE_RESEARCH_FILES: $REPLY_REASON -skipping."
        fi
      done
    fi
  else
    echo ""
    prompt_yn "Do you have research or seed documents to add (design specs, market research, technical notes…)?" "n"
    if [[ "${REPLY_YN,,}" == "y" ]]; then
      mkdir -p "$research_dir"
      echo ""
      echo "  Enter file paths one per line (Tab to complete existing paths)."
      echo "  Press Ctrl+D on an empty line when done:"
      echo "  ──────────────────────────────────────────────────────────────"
      while IFS= read -e -r -p "  path> " res_path || [[ -n "$res_path" ]]; do
        res_path="$(echo "$res_path" | xargs)"  # trim leading/trailing whitespace
        [[ -z "$res_path" ]] && continue
        if resolve_input_file "$res_path"; then
          cp "$REPLY_PATH" "$research_dir/"
          ok "Research doc copied: $(basename "$REPLY_PATH") → docs/research/"
          RESEARCH_ADDED=true
        else
          warn "$REPLY_REASON -skipping."
        fi
      done
    else
      info "Skipping research documents."
    fi
  fi
}

# ---------------------------------------------------------------------------
# Step 7: Commit bootstrapped forge + idea
commit_bootstrap() {
  step "Step 7 of 9: Commit bootstrapped forge and idea"

  git -C "$REPO_DIR" add .
  git -C "$REPO_DIR" commit -m "chore: bootstrap agent forge"
  ok "Committed: 'chore: bootstrap agent forge'"

  if [[ "$REMOTE_CREATED" == true ]]; then
    info "Pushing to remote …"
    run_with_heartbeat "Pushing to remote…" git -C "$REPO_DIR" push -u origin HEAD 2>/dev/null || \
      run_with_heartbeat "Pushing to remote…" git -C "$REPO_DIR" push -u origin "$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)"
    ok "Pushed to remote."
  else
    warn "No remote configured -skipping push. Add a remote and run 'git push -u origin HEAD' manually."
  fi
}

# ---------------------------------------------------------------------------
# Step 7: Launch auto-build
# ---------------------------------------------------------------------------
launch_autobuild() {
  step "Step 8 of 9: Launch auto-build"

  echo ""
  if [[ "$PRD_ADDED" == true ]] || [[ -f "$REPO_DIR/docs/PRD.md" ]] || [[ -f "$REPO_DIR/docs/product-vision.md" ]]; then
    echo "  The repository is bootstrapped and ready for forge-auto-build."
    echo "  forge-auto-build will generate the agent team, then execute the build"
    echo "  (add 'GO --workflow-engine' at its pre-flight gate to run via the"
    echo "  workflow engine instead of the prompt-driven orchestrator)."
  else
    echo "  The repository is bootstrapped. forge-auto-build-prd will turn your idea"
    echo "  into a reviewed PRD, then forge-auto-build will generate the agent team"
    echo "  and execute the build."
  fi
  echo ""

  if [[ "$HEADLESS" == true ]]; then
    info "Headless mode: driving the queued skill directly from the terminal"
    echo "  (no interactive CLI session will be opened)."
    echo ""
    run_headless_build
    return 0
  fi

  # Optional auto-draft flow: generate the PRD and/or agent team non-interactively
  # (with review boundaries), then decide how to run the workflow engine.
  auto_draft_menu

  if [[ "$ENGINE_STARTED" == true ]]; then
    echo ""
    info "The workflow engine is already running this build in the background."
    info "Skipping the interactive CLI launch prompt - no need to run forge-auto-build."
    return 0
  fi

  case "$HARNESS" in
    github)
      if [[ "$COPILOT_AVAILABLE" == true ]]; then
        prompt_yn "Launch GitHub Copilot CLI in the new repository now?"
        if [[ "${REPLY_YN,,}" == "y" ]]; then
          info "Launching GitHub Copilot CLI in: $REPO_DIR"
          if launch_cli_in_terminal "copilot" "$REPO_DIR"; then
            ok "GitHub Copilot CLI launched in a separate terminal."
            echo "    Then run: ${BOLD}$(autobuild_command)${RESET}"
          else
            warn "GitHub Copilot CLI did not open automatically. Run:"
            echo "    cd \"$REPO_DIR\" && copilot"
            echo "    Then: ${BOLD}$(autobuild_command)${RESET}"
          fi
        else
          info "To launch manually:"
          echo "    cd \"$REPO_DIR\" && copilot"
          echo "    Then: ${BOLD}$(autobuild_command)${RESET}"
        fi
      else
        info "Open the repository in GitHub Copilot Chat and run:"
        echo ""
        echo "    ${BOLD}@workspace $(autobuild_command)${RESET}"
        echo ""
        info "The skill will present a pre-flight summary. Type ${BOLD}GO${RESET} to start the pipeline (use ${BOLD}GO --workflow-engine${RESET} for the workflow-engine build path)."
      fi
      ;;
    claude)
      if [[ "$CLAUDE_AVAILABLE" == true ]]; then
        prompt_yn "Launch claude in the new repository now?"
        if [[ "${REPLY_YN,,}" == "y" ]]; then
          info "Launching claude in: $REPO_DIR"
          if launch_cli_in_terminal "claude" "$REPO_DIR" "."; then
            ok "claude launched in a separate terminal."
            echo "    Then run: ${BOLD}$(autobuild_command)${RESET}"
          else
            warn "claude did not open automatically. Run:"
            echo "    cd \"$REPO_DIR\" && claude ."
            echo "    Then: ${BOLD}$(autobuild_command)${RESET}"
          fi
        else
          info "To launch manually:"
          echo "    cd \"$REPO_DIR\" && claude ."
          echo "    Then: ${BOLD}$(autobuild_command)${RESET}"
        fi
      else
        warn "claude CLI is not installed. Install it from https://claude.ai/code then run:"
        echo "    cd \"$REPO_DIR\" && claude ."
        echo "    Then: ${BOLD}$(autobuild_command)${RESET}"
      fi
      ;;
    agents)
      info "Open the repository in your agent harness and run:"
      echo ""
      echo "    ${BOLD}@workspace $(autobuild_command)${RESET}"
      echo ""
      info "Agent templates are in:"
      echo "    $REPO_DIR/.agents/agents/"
      ;;
    opencode)
      if [[ "$OPENCODE_AVAILABLE" == true ]]; then
        prompt_yn "Launch opencode in the new repository now?"
        if [[ "${REPLY_YN,,}" == "y" ]]; then
          info "Launching opencode in: $REPO_DIR"
          if launch_cli_in_terminal "opencode" "$REPO_DIR" "."; then
            ok "opencode launched in a separate terminal."
            echo "    Then run: ${BOLD}$(autobuild_command)${RESET}"
          else
            warn "opencode did not open automatically. Run:"
            echo "    cd \"$REPO_DIR\" && opencode ."
            echo "    Then: ${BOLD}$(autobuild_command)${RESET}"
          fi
        else
          info "To launch manually:"
          echo "    cd \"$REPO_DIR\" && opencode ."
          echo "    Then: ${BOLD}$(autobuild_command)${RESET}"
        fi
      else
        warn "opencode CLI is not installed. Install it from https://opencode.ai then run:"
        echo "    cd \"$REPO_DIR\" && opencode ."
        echo "    Then: ${BOLD}$(autobuild_command)${RESET}"
      fi
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Step 8: Completion summary
# ---------------------------------------------------------------------------
completion_summary() {
  step "Step 9 of 9: Summary"

  echo ""
  echo "${GREEN}${BOLD}════════════════════════════════════════════════════════${RESET}"
  echo "${GREEN}${BOLD}  forge-launcher: Complete${RESET}"
  echo "${GREEN}${BOLD}════════════════════════════════════════════════════════${RESET}"
  echo ""
  echo "  Repository  : $REPO_DIR"
  echo "  Harness     : $HARNESS_LABEL (--harness $HARNESS)"
  echo "  Remote      : $( [[ "$REMOTE_CREATED" == true ]] && echo "yes" || echo "none configured" )"
  echo "  Idea file   : $REPO_DIR/docs/IDEA.md"
  echo "  PRD         : $( [[ "$PRD_ADDED" == true ]] && echo "$REPO_DIR/docs/PRD.md" || echo "none (will be built from docs/IDEA.md by forge-auto-build-prd)" )"
  echo "  Research    : $( [[ "$RESEARCH_ADDED" == true ]] && echo "$REPO_DIR/docs/research/" || echo "none" )"
  if [[ "$HEADLESS" == true ]]; then
    echo "  Mode        : headless (terminal-driven; no interactive CLI)"
  fi
  echo ""
  echo "  Next steps:"
  echo ""
  if [[ "$ENGINE_STARTED" == true ]]; then
    local engine_harness="${FORGE_ENGINE_HARNESS:-opencode}"
    echo "  1. The workflow engine is building the project in the background"
    echo "     (it keeps running after this launcher exits)."
    echo "  2. Monitor progress from another terminal:"
    echo ""
    echo "       ${BOLD}tail -f $REPO_DIR/docs/engine-run.log${RESET}"
    echo "       ${BOLD}tail -f $REPO_DIR/docs/PROGRESS.md${RESET}"
    echo ""
    echo "  3. Re-run or resume the engine later if needed:"
    echo ""
    echo "       ${BOLD}$SCRIPT_DIR/forge-engine-run.sh --repo \"$REPO_DIR\" --harness $engine_harness --yes${RESET}"
  else
    echo "  1. Open the project in your agent harness."
    echo "  2. Run the queued pipeline command:"
    echo ""
    echo "       ${BOLD}@workspace $(autobuild_command)${RESET}"
    echo ""
    echo "  3. Review the pre-flight summary that the skill presents."
    echo "  4. Type ${BOLD}GO${RESET} to start the autonomous pipeline (add ${BOLD}--workflow-engine${RESET} to"
    echo "     run the build through the workflow engine once the agent team is generated)."
  fi
  echo ""
  echo "  References:"
  echo "   • Prompt playbook : $REPO_DIR/docs/prompt-playbook.md"
  local skills_root
  case "$HARNESS" in
    github)   skills_root=".github" ;;
    claude)   skills_root=".claude" ;;
    opencode) skills_root=".opencode" ;;
    *)        skills_root=".agents" ;;
  esac
  echo "   • forge-auto-build    : $REPO_DIR/$skills_root/skills/forge-auto-build/SKILL.md"
  echo "   • forge-auto-build-prd: $REPO_DIR/$skills_root/skills/forge-auto-build-prd/SKILL.md"
  echo "       (paths may vary by harness)"
  echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  print_header

  # Declare globals used across steps
  HARNESS="agents"
  HARNESS_LABEL="Generic .agents"
  REPO_DIR=""
  REMOTE_CREATED=false
  GH_AVAILABLE=false
  COPILOT_AVAILABLE=false
  OPENCODE_AVAILABLE=false
  CLAUDE_AVAILABLE=false
  PRD_ADDED=false
  RESEARCH_ADDED=false
  FORGE_RUN_WITH="${FORGE_RUN_WITH:-}"
  FORGE_WORKFLOW_ENGINE="${FORGE_WORKFLOW_ENGINE:-0}"
  FORGE_AUTO_DRAFT="${FORGE_AUTO_DRAFT:-0}"
  ENGINE_STARTED=false

  preflight_check
  select_harness
  create_repo
  bootstrap_forge
  capture_idea
  add_prd_and_research
  commit_bootstrap
  launch_autobuild
  completion_summary
}

main "$@"
