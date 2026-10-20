#!/usr/bin/env bash
set -u
mkdir -p platform-artifacts
export CI=true
export npm_config_cache=/workspace/.cache/npm
export ELECTRON_CACHE=/workspace/.cache/electron
export PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright
export XDG_CACHE_HOME=/workspace/.cache
export XDG_CONFIG_HOME=/workspace/.config
export XDG_RUNTIME_DIR=/workspace/.runtime
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
step() {
  local name="$1"
  shift
  printf 'START %s\n' "$name"
  "$@" >"platform-artifacts/$name.log" 2>&1
  local status=$?
  printf '%s\t%s\n' "$name" "$status" >>platform-artifacts/status.tsv
  printf 'END %s status=%s\n' "$name" "$status"
  return "$status"
}
{ uname -a; cat /etc/os-release; id; node --version; npm --version; df -h /workspace; } >platform-artifacts/environment.log
step npm-ci npm ci --no-audit --no-fund || exit 11
node --input-type=module -e 'import fs from "node:fs";const facts={playwright:JSON.parse(fs.readFileSync("node_modules/@playwright/test/package.json")).version,electron:JSON.parse(fs.readFileSync("node_modules/electron/package.json")).version,browsers:JSON.parse(fs.readFileSync("node_modules/playwright-core/browsers.json")).browsers};fs.writeFileSync("platform-artifacts/dependency-versions.json",JSON.stringify(facts,null,2));'
if node --input-type=module -e 'import fs from "node:fs";const browsers=JSON.parse(fs.readFileSync("node_modules/playwright-core/browsers.json")).browsers.filter(b=>["chromium","chromium-headless-shell","ffmpeg"].includes(b.name));process.exit(browsers.every(b=>fs.existsSync(`/ms-playwright/${b.name.replaceAll("-","_")}-${b.revision}`))?0:1)'; then
  export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
  printf 'Exact browser revisions available in image.\n' >platform-artifacts/browser-install.log
  printf 'browser-install\t0\n' >>platform-artifacts/status.tsv
else
  step browser-install npx playwright install chromium || exit 12
fi
step build npm run build || exit 13
step unit npm test
step browser npx playwright test --config app/scripts/platforms/linux-playwright.config.ts
step electron xvfb-run --auto-servernum --server-args='-screen 0 1560x1040x24' node app/scripts/platforms/electron-smoke.mjs
find dist -type f -print0 | sort -z | xargs -0 sha256sum >platform-artifacts/dist-sha256.txt
find platform-artifacts -type f ! -name artifact-sha256.txt -print0 | sort -z | xargs -0 sha256sum >platform-artifacts/artifact-sha256.txt
cat platform-artifacts/status.tsv
awk -F '\t' '$2 != 0 { failed=1 } END { exit failed }' platform-artifacts/status.tsv
