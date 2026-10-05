#!/usr/bin/env node
/**
 * Publish dsh-tokenslash to the npm registry (author workflow).
 *
 * Usage:
 *   node scripts/publish.mjs [--tag <tag>] [--dry-run] [--skip-tests]
 *
 * Requires an authenticated npm session (`npm login`) or an npm token in the
 * environment. End users installing the plugin do NOT need this script —
 * they run scripts/install.mjs instead.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";

const USAGE = `Usage: node scripts/publish.mjs [options]

Options:
      --tag <tag>     npm dist-tag to publish under (default: latest)
      --dry-run       pack and validate without uploading
      --skip-tests    skip the pre-publish test run
  -h, --help          show this help
`;

function fail(message) {
  process.stderr.write(`publish: ${message}\n`);
  process.exit(1);
}

function run(command, args) {
  process.stdout.write(`publish: > ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, { cwd: PACKAGE_DIR, stdio: "inherit", shell: WIN, windowsHide: true });
  if ((result.status ?? 1) !== 0) fail(`${command} ${args.join(" ")} exited with code ${result.status ?? 1}`);
}

const argv = process.argv.slice(2);
let tag = "latest";
let dryRun = false;
let skipTests = false;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--tag") tag = argv[++i] ?? fail("--tag needs a value");
  else if (arg.startsWith("--tag=")) tag = arg.slice("--tag=".length);
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "--skip-tests") skipTests = true;
  else if (arg === "--help" || arg === "-h") {
    process.stdout.write(USAGE);
    process.exit(0);
  } else fail(`unknown argument ${arg}\n${USAGE}`);
}

const manifestPath = join(PACKAGE_DIR, "package.json");
if (!existsSync(manifestPath)) fail(`missing ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.private === true) fail("package.json still has \"private\": true — remove it before publishing");

if (!skipTests) run("npm", ["test"]);

const whoami = spawnSync("npm", ["whoami"], { cwd: PACKAGE_DIR, stdio: "pipe", shell: WIN, windowsHide: true });
if (!dryRun && whoami.status !== 0) {
  fail("not logged in to npm; run `npm login` (or set an npm token) first");
}
const user = (whoami.stdout ?? "").toString().trim();
if (user) process.stdout.write(`publish: publishing as ${user}\n`);

run("npm", ["publish", "--access", "public", "--tag", tag, ...(dryRun ? ["--dry-run"] : [])]);
process.stdout.write(`publish: ${manifest.name}@${manifest.version} ${dryRun ? "validated (dry run)" : `published to tag ${tag}`}\n`);
