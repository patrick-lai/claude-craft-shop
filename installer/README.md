# fishstack-mod

Installs [fishStack](https://github.com/patrick-lai/claude-fish-stack-mod) into Claude Code, and removes it again.

```bash
npx -y fishstack-mod install
npx -y fishstack-mod uninstall
```

`install` copies the plugin into Claude Code's config directory (`$CLAUDE_CONFIG_DIR`, or `~/.claude`) and enables it. `uninstall` reverses that. Before any change, both `settings.json` and `installed_plugins.json` are backed up to `plugins/.fishstack-backup/`. Restart Claude Code afterwards, then open the pane with `/fs`.

This writes Claude Code's plugin files directly, not through `claude plugin`. If a future Claude Code version changes that format, reinstall the plugin with `/plugin` instead.
