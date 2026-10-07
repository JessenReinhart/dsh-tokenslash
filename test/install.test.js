import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const installScript = path.join(rootDir, "scripts", "install.mjs");

test("installation script: dry-run completes without crash", async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-home-test-"));
  const desktopProfile = path.join(tmpHome, "profiles", "desktop");
  await fs.mkdir(desktopProfile, { recursive: true });

  const mockManifest = {
    name: "desktop-profile",
    version: "1.0.0",
    dsh: {
      profile: {
        bundles: []
      }
    }
  };
  await fs.writeFile(
    path.join(desktopProfile, "package.json"),
    JSON.stringify(mockManifest, null, 2),
    "utf8"
  );

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [installScript, "--dry-run"],
    {
      env: {
        ...process.env,
        DSH_HOME: tmpHome
      }
    }
  );

  assert.equal(stderr, "");
  assert.match(stdout, /install: dry run, nothing changed/);
  assert.match(stdout, /dsh-tokenslash/);

  await fs.rm(tmpHome, { recursive: true, force: true });
});

test("installation sanity: package defines valid dsh bundle patch and cordis contract", async () => {
  const pkgJsonRaw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
  const pkg = JSON.parse(pkgJsonRaw);

  assert.equal(pkg.name, "dsh-tokenslash");
  assert.ok(pkg.dsh, "must have dsh field");
  assert.ok(pkg.dsh.bundle, "must have dsh.bundle");
  assert.equal(typeof pkg.dsh.bundle.patch, "string", "bundle patch must be defined");

  const patchFile = path.join(rootDir, pkg.dsh.bundle.patch);
  const patchExists = await fs.stat(patchFile).then(() => true).catch(() => false);
  assert.ok(patchExists, `patch file ${pkg.dsh.bundle.patch} must exist`);

  const mainModule = await import(pathToFileURL(path.join(rootDir, pkg.main || "lib/index.js")));
  assert.equal(typeof mainModule.apply, "function", "plugin must export apply");
  assert.equal(typeof mainModule.Config, "function", "plugin must export Config");
  assert.ok(Array.isArray(mainModule.inject), "plugin must export inject array");
});
