#!/usr/bin/env bash
# forge-launcher.sh — Interactive launcher that guides a user through the full
# Agent Forge lifecycle in one session:
#   1. Pre-flight check      — verify required tools
#   2. Select harness        — GitHub Copilot | opencode | Claude Code | generic
#   3. Create repository     — gh repo create (GitHub) or git init (others)
#   4. Bootstrap Agent Forge — run bootstrap.sh into the new repo
#   5. Capture idea          — write IDEA.md
#   6. Commit + push         — commit bootstrapped forge and IDEA.md
#   7. Launch auto-build     — harness-specific instructions or CLI spawn
#   8. Completion summary
#
# Usage:
#   ./scripts/forge-launcher.sh [--non-interactive]
#
# Options:
#   --non-interactive   Skip all interactive prompts (for CI/testing only).
#                       Requires environment variables to be set — see docs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP_SH="$SCRIPT_DIR/bootstrap.sh"

NON_INTERACTIVE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive) NON_INTERACTIVE=true; shift ;;
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
  echo "${CYAN}${BOLD}  McFuzzy Agent Forge — Launcher${RESET}"
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

# ---------------------------------------------------------------------------
# Step 1: Pre-flight check
# ---------------------------------------------------------------------------
preflight_check() {
  step "Step 1 of 8: Pre-flight check"

  local missing=()

  if command -v git &>/dev/null; then
    ok "git $(git --version | awk '{print $3}')"
  else
    fail "git not found — install Git before running this launcher."
    missing+=(git)
  fi

  if command -v gh &>/dev/null; then
    ok "gh $(gh --version 2>/dev/null | head -1 | awk '{print $3}')"
    GH_AVAILABLE=true
  else
    warn "gh (GitHub CLI) not found — GitHub harness repo creation will be unavailable."
    GH_AVAILABLE=false
  fi

  if command -v opencode &>/dev/null; then
    ok "opencode $(opencode --version 2>/dev/null | head -1 || echo '(installed)')"
    OPENCODE_AVAILABLE=true
  else
    warn "opencode not found — opencode harness auto-launch will be unavailable."
    OPENCODE_AVAILABLE=false
  fi

  if command -v claude &>/dev/null; then
    ok "claude $(claude --version 2>/dev/null | head -1 || echo '(installed)')"
    CLAUDE_AVAILABLE=true
  else
    warn "claude not found — Claude Code harness auto-launch will be unavailable."
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
  step "Step 2 of 8: Select agent harness"

  echo ""
  echo "  Which agent harness will this project use?"
  echo ""
  echo "    1) GitHub Copilot   (harness: github,  dir: .github/)"
  echo "    2) opencode         (harness: agents,  dir: .agents/)"
  echo "    3) Claude Code      (harness: claude,  dir: .claude/)"
  echo "    4) Generic .agents  (harness: agents,  dir: .agents/)  [default]"
  echo ""

  local choice
  prompt choice "Select [1-4]" "4"

  case "$choice" in
    1) HARNESS="github";  HARNESS_LABEL="GitHub Copilot" ;;
    2) HARNESS="agents";  HARNESS_LABEL="opencode" ;;
    3) HARNESS="claude";  HARNESS_LABEL="Claude Code" ;;
    4) HARNESS="agents";  HARNESS_LABEL="Generic .agents" ;;
    *) warn "Unrecognised choice '$choice', defaulting to generic .agents"
       HARNESS="agents"; HARNESS_LABEL="Generic .agents" ;;
  esac

  ok "Harness: ${HARNESS_LABEL} (--harness ${HARNESS})"
}

# ---------------------------------------------------------------------------
# Step 3: Create repository
# ---------------------------------------------------------------------------
create_repo() {
  step "Step 3 of 8: Create repository"

  local repo_name
  prompt repo_name "Repository name (no spaces)" ""
  [[ -n "$repo_name" ]] || { fail "Repository name cannot be empty."; exit 1; }

  local repo_description
  prompt repo_description "Short description (optional)" ""

  local repo_visibility
  prompt repo_visibility "Visibility — public or private" "private"
  repo_visibility="${repo_visibility,,}"
  [[ "$repo_visibility" == "public" || "$repo_visibility" == "private" ]] || repo_visibility="private"

  # Resolve where to put the new repo
  local parent_dir
  prompt parent_dir "Parent directory for the new repo" "$(pwd)"
  parent_dir="${parent_dir:-$(pwd)}"
  parent_dir="$(realpath -m "$parent_dir")"

  REPO_DIR="$parent_dir/$repo_name"

  if [[ "$HARNESS" == "github" && "$GH_AVAILABLE" == true ]]; then
    info "Creating GitHub repository '$repo_name' ($repo_visibility) …"
    local gh_args=(repo create "$repo_name" "--${repo_visibility}" --clone)
    [[ -n "$repo_description" ]] && gh_args+=(--description "$repo_description")
    gh "${gh_args[@]}"
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
      warn "gh is not installed — skipped remote creation."
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
  step "Step 4 of 8: Bootstrap Agent Forge"

  info "Running bootstrap.sh → $REPO_DIR (--harness $HARNESS) …"
  "$BOOTSTRAP_SH" "$REPO_DIR" --harness "$HARNESS" --force
  ok "Agent Forge templates bootstrapped."
}

# ---------------------------------------------------------------------------
# Step 5: Capture idea
# ---------------------------------------------------------------------------
capture_idea() {
  step "Step 5 of 8: Capture your project idea"

  local idea_file="$REPO_DIR/IDEA.md"

  echo ""
  echo "  Describe your project idea below."
  echo "  This will be saved to IDEA.md and used as the starting prompt"
  echo "  for forge-auto-build."
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
    warn "No idea text entered. IDEA.md will be created as a placeholder."
    IDEA_TEXT="*(Replace this with your project idea before running forge-auto-build.)*"
  fi

  {
    echo "# Project Idea"
    echo ""
    echo "$IDEA_TEXT"
    echo ""
    echo "---"
    echo ""
    echo "> Generated by forge-launcher on $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "> Use this file as input for: \`@workspace /forge-auto-build\`"
  } > "$idea_file"

  ok "Idea saved to: $idea_file"
}

# ---------------------------------------------------------------------------
# Step 6: Commit bootstrapped forge + idea
# ---------------------------------------------------------------------------
commit_bootstrap() {
  step "Step 6 of 8: Commit bootstrapped forge and idea"

  git -C "$REPO_DIR" add .
  git -C "$REPO_DIR" commit -m "chore: bootstrap agent forge"
  ok "Committed: 'chore: bootstrap agent forge'"

  if [[ "$REMOTE_CREATED" == true ]]; then
    info "Pushing to remote …"
    git -C "$REPO_DIR" push -u origin HEAD 2>/dev/null || \
      git -C "$REPO_DIR" push -u origin "$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)"
    ok "Pushed to remote."
  else
    warn "No remote configured — skipping push. Add a remote and run 'git push -u origin HEAD' manually."
  fi
}

# ---------------------------------------------------------------------------
# Step 7: Launch auto-build
# ---------------------------------------------------------------------------
launch_autobuild() {
  step "Step 7 of 8: Launch auto-build"

  echo ""
  echo "  The repository is bootstrapped and ready for forge-auto-build."
  echo ""

  case "$HARNESS" in
    github)
      info "Open the repository in GitHub Copilot Chat and run:"
      echo ""
      echo "    ${BOLD}@workspace /forge-auto-build$(cat "$REPO_DIR/IDEA.md" | grep -v '^#' | grep -v '^---' | grep -v '^>' | grep -v '^$' | head -1)${RESET}"
      echo ""
      info "The skill will present a pre-flight summary. Type ${BOLD}GO${RESET} to start the full pipeline."
      ;;
    claude)
      if [[ "$CLAUDE_AVAILABLE" == true ]]; then
        prompt_yn "Launch claude in the new repository now?"
        if [[ "${REPLY_YN,,}" == "y" ]]; then
          info "Launching claude in: $REPO_DIR"
          (cd "$REPO_DIR" && claude .) &
          ok "claude launched. Use /forge-auto-build in the Claude Code chat to start the pipeline."
        else
          info "To launch manually:"
          echo "    cd \"$REPO_DIR\" && claude ."
          echo "    Then: ${BOLD}/forge-auto-build <your idea>${RESET}"
        fi
      else
        warn "claude CLI is not installed. Install it from https://claude.ai/code then run:"
        echo "    cd \"$REPO_DIR\" && claude ."
        echo "    Then: ${BOLD}/forge-auto-build <your idea>${RESET}"
      fi
      ;;
    agents)
      if [[ "$OPENCODE_AVAILABLE" == true && "$HARNESS_LABEL" == "opencode" ]]; then
        prompt_yn "Launch opencode in the new repository now?"
        if [[ "${REPLY_YN,,}" == "y" ]]; then
          info "Launching opencode in: $REPO_DIR"
          (cd "$REPO_DIR" && opencode .) &
          ok "opencode launched. Use /forge-auto-build in the chat to start the pipeline."
        else
          info "To launch manually:"
          echo "    cd \"$REPO_DIR\" && opencode ."
          echo "    Then: ${BOLD}/forge-auto-build <your idea>${RESET}"
        fi
      else
        info "Open the repository in your agent harness and run:"
        echo ""
        echo "    ${BOLD}@workspace /forge-auto-build <your idea>${RESET}"
        echo ""
        info "Agent templates are in:"
        case "$HARNESS" in
          agents) echo "    $REPO_DIR/.agents/agents/" ;;
          github) echo "    $REPO_DIR/.github/agents/" ;;
          claude) echo "    $REPO_DIR/.claude/agents/" ;;
        esac
      fi
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Step 8: Completion summary
# ---------------------------------------------------------------------------
completion_summary() {
  step "Step 8 of 8: Summary"

  echo ""
  echo "${GREEN}${BOLD}════════════════════════════════════════════════════════${RESET}"
  echo "${GREEN}${BOLD}  forge-launcher: Complete${RESET}"
  echo "${GREEN}${BOLD}════════════════════════════════════════════════════════${RESET}"
  echo ""
  echo "  Repository  : $REPO_DIR"
  echo "  Harness     : $HARNESS_LABEL (--harness $HARNESS)"
  echo "  Remote      : $( [[ "$REMOTE_CREATED" == true ]] && echo "yes" || echo "none configured" )"
  echo "  Idea file   : $REPO_DIR/IDEA.md"
  echo ""
  echo "  Next steps:"
  echo ""
  echo "  1. Open the project in your agent harness."
  echo "  2. Run the auto-build skill:"
  echo ""
  echo "       ${BOLD}@workspace /forge-auto-build${RESET}  (paste your idea or reference IDEA.md)"
  echo ""
  echo "  3. Review the pre-flight summary that the skill presents."
  echo "  4. Type ${BOLD}GO${RESET} to start the fully autonomous pipeline."
  echo ""
  echo "  References:"
  echo "   • Prompt playbook : $REPO_DIR/docs/prompt-playbook.md"
  echo "   • forge-auto-build: $REPO_DIR/.agents/skills/forge-auto-build/SKILL.md"
  echo "       (path may vary by harness)"
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
  OPENCODE_AVAILABLE=false
  CLAUDE_AVAILABLE=false

  preflight_check
  select_harness
  create_repo
  bootstrap_forge
  capture_idea
  commit_bootstrap
  launch_autobuild
  completion_summary
}

main "$@"
