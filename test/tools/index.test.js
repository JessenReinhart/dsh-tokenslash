import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { indexFile } from "../../lib/tools/index.js";

async function writeTempFile(name, content) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tokenslash-index-"));
  const file = path.join(dir, name);
  await fs.writeFile(file, content, "utf8");
  return file;
}

describe("tokenslash_index", () => {
  test("indexes a JS/TS file with imports, classes, and methods", async () => {
    const file = await writeTempFile(
      "sample.ts",
      [
        "import { foo } from './foo';",
        "import * as bar from 'bar';",
        "",
        "// comment",
        "export class Manager {",
        "  constructor(config) {",
        "    this.config = config;",
        "  }",
        "",
        "  async start() {",
        "    await foo();",
        "  }",
        "}",
        "",
        "export function helper(a, b) {",
        "  return a + b;",
        "}",
      ].join("\n")
    );

    const res = await indexFile(file);
    assert.equal(res.language, "typescript");
    assert.equal(res.lines, 17);
    assert.ok(res.symbolsCount >= 4);

    const importSym = res.symbols.find((s) => s.kind === "imports");
    assert.ok(importSym, "imports symbol found");
    assert.equal(importSym.start, 1);

    const classSym = res.symbols.find((s) => s.kind === "class");
    assert.ok(classSym, "class symbol found");
    assert.match(classSym.signature, /class Manager/);

    const methodSym = res.symbols.filter((s) => s.kind === "method");
    assert.ok(methodSym.length >= 2, "methods found");

    const funcSym = res.symbols.find((s) => s.kind === "function");
    assert.ok(funcSym, "function symbol found");
    assert.match(funcSym.signature, /helper/);
  });

  test("indexes Python files with def/class", async () => {
    const file = await writeTempFile(
      "sample.py",
      [
        "import os",
        "import sys",
        "",
        "class Foo:",
        "    def __init__(self):",
        "        pass",
        "",
        "    def bar(self, x):",
        "        return x * 2",
        "",
        "def helper():",
        "    return 1",
      ].join("\n")
    );

    const res = await indexFile(file);
    assert.equal(res.language, "python");
    const classSym = res.symbols.find((s) => s.kind === "class");
    assert.ok(classSym, "class found");
    assert.match(classSym.signature, /class Foo/);
    const methods = res.symbols.filter((s) => s.kind === "method");
    assert.ok(methods.length >= 2, "methods found");
    const funcs = res.symbols.filter((s) => s.kind === "function");
    assert.ok(funcs.length >= 1, "functions found");
  });

  test("indexes Markdown files into header hierarchy", async () => {
    const file = await writeTempFile(
      "README.md",
      [
        "# Title",
        "some text",
        "",
        "## Section A",
        "content",
        "## Section B",
        "content",
        "### Sub",
        "content",
      ].join("\n")
    );

    const res = await indexFile(file);
    assert.equal(res.language, "markdown");
    assert.equal(res.symbolsCount, 4);
    assert.equal(res.symbols[0].kind, "h1");
    assert.equal(res.symbols[1].kind, "h2");
    assert.equal(res.symbols[3].kind, "h3");
  });

  test("indexes directory listing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tokenslash-dir-"));
    await fs.writeFile(path.join(dir, "a.js"), "console.log(1)");
    await fs.writeFile(path.join(dir, "b.txt"), "hi");
    await fs.mkdir(path.join(dir, "sub"));

    const res = await indexFile(dir);
    assert.equal(res.language, "directory");
    assert.match(res.skeletonText, /a\.js/);
    assert.match(res.skeletonText, /b\.txt/);
    assert.match(res.skeletonText, /sub\//);
  });

  test("errors on missing file", async () => {
    await assert.rejects(() => indexFile(path.join(os.tmpdir(), "definitely-not-here-xyz.js")));
  });
});
