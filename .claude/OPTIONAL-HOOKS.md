# Optional / heavy hooks (not auto-enabled)

The following repos ship hooks that run on EVERY tool call and were built for
Claude Code's plugin system (${CLAUDE_PLUGIN_ROOT}). They are vendored under
`.claude/plugins/` but NOT wired into settings.local.json, because they spawn
Node on every Bash/Write/Edit and would slow/spam these projects.

To enable ECC's full hook suite, the supported path is to install ECC as a real
plugin (so ${CLAUDE_PLUGIN_ROOT} resolves):
    cd .claude/plugins/ECC && ./install.sh      # or install.ps1 on Windows

Currently ENABLED (safe, SessionStart-class):
  - superpowers  hooks/run-hook.cmd session-start
  - last30days   hooks/scripts/check-config.sh
  - ponytail     hooks/ponytail-activate.js (SessionStart), ponytail-mode-tracker.js (UserPromptSubmit)

All skills (.claude/skills/) and slash-commands (.claude/commands/) from all 7
repos are installed and active regardless of hooks.
