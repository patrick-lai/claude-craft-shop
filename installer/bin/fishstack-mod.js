#!/usr/bin/env node
// fishstack-mod: copies the fishStack plugin into Claude Code's config dir and enables it, or takes it back out.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PACKAGE = 'claude-fish-stack-mod'
const PLUGIN = 'fishstack'
const KEY = `${PLUGIN}@${PACKAGE}`

const USAGE = `Usage:
  npx -y fishstack-mod install     copy fishStack into Claude Code and enable it
  npx -y fishstack-mod uninstall   remove fishStack from Claude Code

Restart Claude Code afterwards.`

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

function paths() {
  const root = configDir()
  const plugins = path.join(root, 'plugins')
  return {
    settings: path.join(root, 'settings.json'),
    installed: path.join(plugins, 'installed_plugins.json'),
    cacheDir: path.join(plugins, 'cache', PACKAGE, PLUGIN),
    backupDir: path.join(plugins, '.fishstack-backup'),
  }
}

// Throws on malformed JSON, so a bad file stops the run before anything is written.
function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

function backup(p) {
  fs.mkdirSync(p.backupDir, { recursive: true })
  for (const file of [p.settings, p.installed]) {
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(p.backupDir, path.basename(file)))
  }
}

function pluginSource() {
  const manifest = require.resolve(`${PACKAGE}/package.json`)
  return { dir: path.dirname(manifest), version: require(manifest).version }
}

function install() {
  const p = paths()
  const src = pluginSource()

  let settings
  let installed
  try {
    settings = readJson(p.settings, {})
    installed = readJson(p.installed, { version: 2, plugins: {} })
  } catch (err) {
    console.error(`fishstack-mod: could not read Claude Code's config (${err.message}). Nothing was changed.`)
    return 1
  }
  installed.plugins ??= {}

  backup(p)

  const installPath = path.join(p.cacheDir, src.version)
  fs.rmSync(installPath, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(installPath), { recursive: true })
  fs.cpSync(src.dir, installPath, { recursive: true })

  const now = new Date().toISOString()
  const prior = installed.plugins[KEY]?.[0]
  installed.plugins[KEY] = [
    { scope: 'user', installPath, version: src.version, installedAt: prior?.installedAt ?? now, lastUpdated: now },
  ]
  settings.enabledPlugins = { ...(settings.enabledPlugins ?? {}), [KEY]: true }

  writeJson(p.installed, installed)
  writeJson(p.settings, settings)

  for (const version of fs.readdirSync(p.cacheDir)) {
    if (version !== src.version) fs.rmSync(path.join(p.cacheDir, version), { recursive: true, force: true })
  }

  console.log(`fishStack ${src.version} installed into ${configDir()}.`)
  console.log('Restart Claude Code, then open the pane with /fs.')
  return 0
}

function uninstall() {
  const p = paths()

  let settings
  let installed
  try {
    settings = readJson(p.settings, {})
    installed = readJson(p.installed, { version: 2, plugins: {} })
  } catch (err) {
    console.error(`fishstack-mod: could not read Claude Code's config (${err.message}). Nothing was changed.`)
    return 1
  }
  installed.plugins ??= {}

  const registered = KEY in installed.plugins || KEY in (settings.enabledPlugins ?? {})
  if (!registered && !fs.existsSync(p.cacheDir)) {
    console.log('fishStack is not installed.')
    return 0
  }

  backup(p)

  delete installed.plugins[KEY]
  if (settings.enabledPlugins) delete settings.enabledPlugins[KEY]

  // Unregister before deleting files, so a failure never leaves a registration pointing at nothing.
  writeJson(p.installed, installed)
  writeJson(p.settings, settings)
  fs.rmSync(p.cacheDir, { recursive: true, force: true })

  console.log('fishStack removed. Restart Claude Code.')
  return 0
}

function main(argv) {
  const [command] = argv
  try {
    if (command === 'install') return install()
    if (command === 'uninstall') return uninstall()
  } catch (err) {
    console.error(`fishstack-mod: ${err.message}`)
    return 1
  }
  console.log(USAGE)
  return command === undefined || command === '--help' || command === '-h' ? 0 : 1
}

process.exitCode = main(process.argv.slice(2))
