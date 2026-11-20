#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function readUtf8(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), "utf8");
}

function writeUtf8IfChanged(relPath, nextContent, prevContent) {
  if (nextContent === prevContent) {
    return false;
  }
  fs.writeFileSync(path.join(rootDir, relPath), nextContent, "utf8");
  return true;
}

function resolveTargetVersion() {
  const arg = process.argv[2]?.trim();
  if (arg) {
    return arg.replace(/^v/i, "");
  }
  const pkg = JSON.parse(readUtf8("package.json"));
  return String(pkg.version || "").trim();
}

const version = resolveTargetVersion();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`[sync-version] Invalid version: "${version}". Expected semver like 1.1.5`);
  process.exit(1);
}

const updated = [];

// 1. package.json
{
  const rel = "package.json";
  const prev = readUtf8(rel);
  const next = prev.replace(/("version"\s*:\s*")([^"]+)(")/, `$1${version}$3`);
  if (writeUtf8IfChanged(rel, next, prev)) updated.push(rel);
}

// 2. package-lock.json (root version + packages[""].version)
{
  const rel = "package-lock.json";
  if (fs.existsSync(path.join(rootDir, rel))) {
    const prev = readUtf8(rel);
    let next = prev.replace(
      /("name"\s*:\s*"AccountVault"\s*,\s*\r?\n\s*"version"\s*:\s*")([^"]+)(")/g,
      `$1${version}$3`
    );
    if (writeUtf8IfChanged(rel, next, prev)) updated.push(rel);
  }
}

// 3. src-tauri/Cargo.toml ([package] version)
{
  const rel = "src-tauri/Cargo.toml";
  const prev = readUtf8(rel);
  const next = prev.replace(
    /(\[package\]\s*\r?\nname\s*=\s*"account-vault"\s*\r?\nversion\s*=\s*")([^"]+)(")/,
    `$1${version}$3`
  );
  if (writeUtf8IfChanged(rel, next, prev)) updated.push(rel);
}

// 4. src-tauri/Cargo.lock (account-vault package only)
{
  const rel = "src-tauri/Cargo.lock";
  if (fs.existsSync(path.join(rootDir, rel))) {
    const prev = readUtf8(rel);
    const next = prev.replace(
      /(\[\[package\]\]\s*\r?\nname\s*=\s*"account-vault"\s*\r?\nversion\s*=\s*")([^"]+)(")/,
      `$1${version}$3`
    );
    if (writeUtf8IfChanged(rel, next, prev)) updated.push(rel);
  }
}

// 5. src-tauri/tauri.conf.json
{
  const rel = "src-tauri/tauri.conf.json";
  const prev = readUtf8(rel);
  const next = prev.replace(/("version"\s*:\s*")([^"]+)(")/, `$1${version}$3`);
  if (writeUtf8IfChanged(rel, next, prev)) updated.push(rel);
}

// 6. src-tauri/gen/android/app/build.gradle.kts (fallback versionName)
{
  const rel = "src-tauri/gen/android/app/build.gradle.kts";
  if (fs.existsSync(path.join(rootDir, rel))) {
    const prev = readUtf8(rel);
    const next = prev.replace(
      /(tauriProperties\.getProperty\(\s*"tauri\.android\.versionName"\s*,\s*")([^"]+)("\s*\))/,
      `$1${version}$3`
    );
    if (writeUtf8IfChanged(rel, next, prev)) updated.push(rel);
  }
}

// 7. browser-extension/manifest.json
{
  const rel = "browser-extension/manifest.json";
  const prev = readUtf8(rel);
  const next = prev.replace(/("version"\s*:\s*")([^"]+)(")/, `$1${version}$3`);
  if (writeUtf8IfChanged(rel, next, prev)) updated.push(rel);
}

// 8. src/App.vue (fallback appVersion)
{
  const rel = "src/App.vue";
  if (fs.existsSync(path.join(rootDir, rel))) {
    const prev = readUtf8(rel);
    const next = prev.replace(
      /(const\s+appVersion\s*=\s*ref\(\s*pkg\.version\s*\|\|\s*")([^"]+)("\s*\))/,
      `$1${version}$3`
    );
    if (writeUtf8IfChanged(rel, next, prev)) updated.push(rel);
  }
}

if (updated.length > 0) {
  console.log(`[sync-version] Synced version ${version} to:\n  - ${updated.join("\n  - ")}`);
} else {
  console.log(`[sync-version] All files are already at version ${version}.`);
}
