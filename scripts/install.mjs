#!/usr/bin/env node
/**
 * Install dsh-tokenslash into a DSH profile on this machine.
 *
 * Usage:
 *   node scripts/install.mjs [--profile <name>] [--from local|npm|github]
 *                            [--version <semver>] [--ref <commit>] [--dry-run]
 *
 * Defaults: --profile desktop --from local (the repository this script lives in).
 *
 * The script runs `pnpm add <spec>` inside the profile directory and then
 * appends `dsh-tokenslash` to `dsh.profile.bundles` in the profile manifest —
 * the same registration `dsh plugin add` performs when pnpm exits 0. Unlike
 * `dsh plugin`, it also works for the `desktop` profile, which the bare CLI
 * rejects ("managed exclusively by the Electron application").
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "dsh-tokenslash";
const GITHUB_REPO = "JessenReinhart/dsh-tokenslash";
const WIN = process.platform === "win32";
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `Usage: node scripts/install.mjs [options]

Options:
  -p, --profile <name>   target DSH profile (default: desktop)
  -f, --from <source>    local | npm | github (default: local)
      --version <semver> version to install with --from npm (default: latest)
      --ref <commit>     git ref to pin with --from github (default: HEAD)
      --dry-run          print what would happen, change nothing
  -h, --help             show this help

Examples:
  node scripts/install.mjs                          # install this clone into desktop
  node scripts/install.mjs --profile web --from npm # install the published package
  node scripts/install.mjs --from github --ref v1.0.0
`;

function fail(message) {
  process.stderr.write(`install: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { profile: "desktop", from: "local", version: null, ref: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) fail(`${arg} needs a value\n${USAGE}`);
      return next;
    };
    if (arg === "--profile" || arg === "-p") options.profile = value();
    else if (arg.startsWith("--profile=")) options.profile = arg.slice("--profile=".length);
    else if (arg === "--from" || arg === "-f") options.from = value();
    else if (arg.startsWith("--from=")) options.from = arg.slice("--from=".length);
    else if (arg === "--version") options.version = value();
    else if (arg.startsWith("--version=")) options.version = arg.slice("--version=".length);
    else if (arg === "--ref") options.ref = value();
    else if (arg.startsWith("--ref=")) options.ref = arg.slice("--ref=".length);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else fail(`unknown argument ${arg}\n${USAGE}`);
  }
  if (!["local", "npm", "github"].includes(options.from)) fail(`--from must be local, npm or github\n${USAGE}`);
  if (options.version && options.from !== "npm") fail("--version only applies to --from npm");
  if (options.ref && options.from !== "github") fail("--ref only applies to --from github");
  const name = options.profile;
  if (!name || name === "." || name === ".." || name === "node_modules" || name.includes("/") || name.includes("\\")) {
    fail(`invalid profile name ${JSON.stringify(name)}`);
  }
  return options;
}

function resolveHome() {
  const env = process.env.DSH_HOME;
  if (env && env.trim() !== "") return env.trim();
  return join(homedir(), ".dsh");
}

function buildSpec(options) {
  if (options.from === "npm") return options.version ? `${PACKAGE_NAME}@${options.version}` : PACKAGE_NAME;
  if (options.from === "github") return `github:${GITHUB_REPO}${options.ref ? `#${options.ref}` : ""}`;
  return `file:${PACKAGE_DIR.split(/[\\/]/).join("/")}`;
}

function findPnpm() {
  if (spawnSync("pnpm", ["--version"], { shell: WIN, stdio: "ignore", windowsHide: true }).status === 0) {
    return { command: "pnpm", prefix: [] };
  }
  if (spawnSync("corepack", ["pnpm", "--version"], { shell: WIN, stdio: "ignore", windowsHide: true }).status === 0) {
    return { command: "corepack", prefix: ["pnpm"] };
  }
  return null;
}

const options = parseArgs(process.argv.slice(2));
const profileDir = join(resolveHome(), "profiles", options.profile);
const manifestPath = join(profileDir, "package.json");
const spec = buildSpec(options);

if (!existsSync(manifestPath)) {
  fail(`profile "${options.profile}" is not initialized at ${profileDir}\n` +
    `install: boot it once first (open DSH Desktop, or run: dsh --profile ${options.profile} --help), then re-run`);
}

const runner = findPnpm();
if (runner === null) fail("pnpm not found on PATH; install it (npm install -g pnpm) and re-run");

process.stdout.write(`install: profile  ${profileDir}\ninstall: source   ${spec}\n`);
if (options.dryRun) {
  process.stdout.write("install: dry run, nothing changed\n");
  process.exit(0);
}

const result = spawnSync(runner.command, [...runner.prefix, "add", spec], {
  cwd: profileDir,
  stdio: "inherit",
  shell: WIN,
  windowsHide: true
});
if ((result.status ?? 1) !== 0) {
  const hint = options.from === "github"
    ? `\ninstall: git-hosted plugins may need their build allowed: add the key pnpm printed under allowBuilds in ${join(profileDir, "pnpm-workspace.yaml")}, then re-run`
    : "";
  fail(`pnpm add failed in ${profileDir}${hint}`);
}

const installedDir = join(profileDir, "node_modules", PACKAGE_NAME);
if (!existsSync(installedDir)) fail(`pnpm finished but ${installedDir} is missing`);
const installed = JSON.parse(readFileSync(join(realpathSync(installedDir), "package.json"), "utf8"));
if (installed.dsh?.bundle?.patch === undefined) {
  fail(`installed ${PACKAGE_NAME} declares no dsh.bundle.patch in its package.json; wrong package?`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.dsh ??= {};
manifest.dsh.profile ??= {};
const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : (manifest.dsh.profile.bundles = []);
if (!bundles.includes(PACKAGE_NAME)) {
  bundles.push(PACKAGE_NAME);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`install: registered ${PACKAGE_NAME} in dsh.profile.bundles\n`);
} else {
  process.stdout.write(`install: ${PACKAGE_NAME} already listed in dsh.profile.bundles\n`);
}
process.stdout.write(`install: done — reload DSH (Ctrl+R / F5) or restart DSH Desktop\n`);
