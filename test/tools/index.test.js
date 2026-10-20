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

  test("indexes a Lua file with requires, functions, methods, and tables", async () => {
    const file = await writeTempFile(
      "module.lua",
      [
        'local http = require("http")',
        'local json = require "cjson"',
        "",
        "-- Single-line comment",
        "--[[ Multi-line",
        "     comment block --]]",
        "",
        "local Config = {",
        "  timeout = 5000,",
        "  retries = 3,",
        "}",
        "",
        "local function helper(x, y)",
        "  if x > y then",
        "    return x",
        "  end",
        "  return y",
        "end",
        "",
        "function Config.new(opts)",
        "  local self = {}",
        "  return setmetatable(self, { __index = Config })",
        "end",
        "",
        "function Config:run(task)",
        "  for i = 1, 10 do",
        "    print(i)",
        "  end",
        "  return true",
        "end",
        "",
        "local anonymous = function(a)",
        "  return a * 2",
        "end",
      ].join("\n")
    );

    const res = await indexFile(file);
    assert.equal(res.language, "lua");
    assert.equal(res.lines, 34);
    assert.ok(res.symbolsCount >= 5);

    const reqSym = res.symbols.find((s) => s.kind === "requires");
    assert.ok(reqSym, "requires symbol found");
    assert.equal(reqSym.start, 1);
    assert.equal(reqSym.end, 2);

    const tableSym = res.symbols.find((s) => s.kind === "table");
    assert.ok(tableSym, "table symbol found");
    assert.match(tableSym.signature, /local Config =/);
    assert.equal(tableSym.start, 8);
    assert.equal(tableSym.end, 11);

    const helperSym = res.symbols.find((s) => s.signature.includes("function helper"));
    assert.ok(helperSym, "helper function found");
    assert.equal(helperSym.kind, "function");
    assert.equal(helperSym.start, 13);
    assert.equal(helperSym.end, 18);

    const methodDotSym = res.symbols.find((s) => s.signature.includes("Config.new"));
    assert.ok(methodDotSym, "Config.new method found");
    assert.equal(methodDotSym.kind, "method");
    assert.equal(methodDotSym.start, 20);
    assert.equal(methodDotSym.end, 23);

    const methodColonSym = res.symbols.find((s) => s.signature.includes("Config:run"));
    assert.ok(methodColonSym, "Config:run method found");
    assert.equal(methodColonSym.kind, "method");
    assert.equal(methodColonSym.start, 25);
    assert.equal(methodColonSym.end, 30);

    const anonSym = res.symbols.find((s) => s.signature.includes("anonymous = function"));
    assert.ok(anonSym, "anonymous function found");
    assert.equal(anonSym.start, 32);
    assert.equal(anonSym.end, 34);
  });

  test("indexes an HTML / Thymeleaf template with elements and inline scripts", async () => {
    const file = await writeTempFile(
      "template.html",
      [
        "<!DOCTYPE html>",
        '<html xmlns:th="http://www.thymeleaf.org">',
        "<head>",
        "  <title>Test</title>",
        "</head>",
        "<body>",
        '  <form id="iqryCond">',
        '    <div id="gridWrapper">',
        '      <div id="basic-grid"></div>',
        "    </div>",
        "  </form>",
        '  <script th:inline="javascript">',
        "    function fn_initBasicGrid() {",
        "      console.log('init');",
        "    }",
        "    const fn_save = () => {",
        "      return true;",
        "    };",
        "  </script>",
        "</body>",
        "</html>",
      ].join("\n")
    );

    const res = await indexFile(file);
    assert.equal(res.language, "html");
    assert.equal(res.lines, 21);
    assert.ok(res.symbolsCount >= 4);

    const elements = res.symbols.filter((s) => s.kind === "element");
    assert.ok(elements.length >= 3, "should extract key elements by id");
    assert.ok(elements.some((e) => e.signature.includes('id="iqryCond"')));
    assert.ok(elements.some((e) => e.signature.includes('id="basic-grid"')));

    const funcs = res.symbols.filter((s) => s.kind === "function");
    assert.ok(funcs.length >= 2, "should extract functions inside inline script");
    assert.ok(funcs.some((f) => f.signature.includes("fn_initBasicGrid")));
    assert.ok(funcs.some((f) => f.signature.includes("fn_save")));
  });

  test("indexes a Java file with package, imports, class, methods, and constructor", async () => {
    const file = await writeTempFile(
      "UserService.java",
      [
        "package com.example.service;",
        "",
        "import java.util.List;",
        "import java.util.Optional;",
        "",
        "public class UserService {",
        "    private final UserRepository repo;",
        "",
        "    public UserService(UserRepository repo) {",
        "        this.repo = repo;",
        "    }",
        "",
        "    public Optional<User> findById(String id) {",
        "        return repo.findById(id);",
        "    }",
        "",
        "    public List<User> findAll() {",
        "        return repo.findAll();",
        "    }",
        "}",
      ].join("\n")
    );

    const res = await indexFile(file);
    assert.equal(res.language, "java");
    assert.equal(res.lines, 20);
    assert.ok(res.symbolsCount >= 5);

    const pkg = res.symbols.find((s) => s.kind === "package");
    assert.ok(pkg, "package symbol found");
    assert.equal(pkg.signature, "package com.example.service;");

    const imports = res.symbols.find((s) => s.kind === "imports");
    assert.ok(imports, "imports found");
    assert.equal(imports.start, 3);
    assert.equal(imports.end, 4);

    const cls = res.symbols.find((s) => s.kind === "class");
    assert.ok(cls, "class found");
    assert.match(cls.signature, /public class UserService/);

    const ctor = res.symbols.find((s) => s.kind === "constructor");
    assert.ok(ctor, "constructor found");
    assert.match(ctor.signature, /UserService\(UserRepository repo\)/);

    const methods = res.symbols.filter((s) => s.kind === "method");
    assert.equal(methods.length, 2, "methods found");
    assert.ok(methods.some((m) => m.signature.includes("findById")));
    assert.ok(methods.some((m) => m.signature.includes("findAll")));
  });

  test("indexes Java interface, record, enum, and annotations", async () => {
    const file = await writeTempFile(
      "Types.java",
      [
        "package com.example.model;",
        "",
        "public interface UserContract {",
        "    void execute();",
        "}",
        "",
        "public record UserDto(String id, String name) {",
        "    public String format() {",
        "        return id + \":\" + name;",
        "    }",
        "}",
        "",
        "public enum Status {",
        "    ACTIVE, INACTIVE;",
        "    public boolean isActive() {",
        "        return this == ACTIVE;",
        "    }",
        "}",
        "",
        "public @interface Validated {",
        "    String value() default \"\";",
        "}",
      ].join("\n")
    );

    const res = await indexFile(file);
    assert.equal(res.language, "java");

    const iface = res.symbols.find((s) => s.kind === "interface");
    assert.ok(iface, "interface found");

    const record = res.symbols.find((s) => s.kind === "record");
    assert.ok(record, "record found");

    const enumSym = res.symbols.find((s) => s.kind === "enum");
    assert.ok(enumSym, "enum found");

    const annot = res.symbols.find((s) => s.kind === "annotation");
    assert.ok(annot, "annotation found");

    const methods = res.symbols.filter((s) => s.kind === "method");
    assert.ok(methods.length >= 2, "methods inside types found");
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

  test("indexes YAML file with sections, keys, lists, and anchors", async () => {
    const file = await writeTempFile(
      "config.yaml",
      [
        "version: 1",
        "server:",
        "  host: localhost",
        "  port: 8080",
        "  features:",
        "    - auth",
        "    - cache",
        "defaults: &defaults",
        "  timeout: 30",
        "ref: *defaults",
        "database:",
        "  url: postgres://db",
        "  pool: 5",
      ].join("\n")
    );

    const res = await indexFile(file);
    assert.equal(res.language, "yaml");
    assert.ok(res.symbols.some((s) => s.kind === "section" && s.signature.includes("server:")), "server section");
    assert.ok(res.symbols.some((s) => s.kind === "key" && s.signature.includes("host:")) || res.symbols.some((s) => s.kind === "section" && s.signature.includes("host:")), "host key");
    assert.ok(res.symbols.some((s) => s.kind === "list" && s.signature.includes("- auth")), "auth list item");
    assert.ok(res.symbols.some((s) => s.kind === "anchor" && s.signature.includes("&defaults")), "anchor definition");
    assert.ok(res.symbols.some((s) => s.signature.includes("*defaults")), "anchor reference");
  });

  test("indexes TOML file with tables, array of tables, and keys", async () => {
    const file = await writeTempFile(
      "config.toml",
      [
        "title = \"My App\"",
        "version = \"1.2.3\"",
        "",
        "[server]",
        "host = \"localhost\"",
        "port = 8080",
        "",
        "[[routes]]",
        "path = \"/\"",
        "handler = \"home\"",
        "",
        "[[routes]]",
        "path = \"/api\"",
        "handler = \"api\"",
      ].join("\n")
    );

    const res = await indexFile(file);
    assert.equal(res.language, "toml");
    assert.ok(res.symbols.some((s) => s.kind === "key" && s.signature.includes("title =")), "title key");
    assert.ok(res.symbols.some((s) => s.kind === "table" && s.signature.includes("[server]")), "server table");
    assert.ok(res.symbols.some((s) => s.kind === "key" && s.signature.includes("host =")), "host key");
    assert.ok(res.symbols.some((s) => s.kind === "array_table" && s.signature.includes("[[routes]]")), "routes array table");
  });

  test("filters symbols by case-insensitive keyword", async () => {
    const file = await writeTempFile(
      "filter.ts",
      [
        "export function handleAuth() {}",
        "function helper() {}",
        "export const authToken = 'x';",
        "class Service {}",
      ].join("\n")
    );

    const res = await indexFile(file, { filter: "auth" });
    assert.equal(res.language, "typescript");
    assert.ok(res.symbols.length > 0, "some symbols matched");
    assert.ok(res.symbols.every((s) => s.signature.toLowerCase().includes("auth")), "all matches contain auth");
    assert.match(res.skeletonText, /handleAuth|authToken/);
  });

  test("supports string filter positional argument", async () => {
    const file = await writeTempFile(
      "filter2.ts",
      [
        "export function handleAuth() {}",
        "function helper() {}",
        "export const authToken = 'x';",
        "class Service {}",
      ].join("\n")
    );

    const res = await indexFile(file, "export");
    assert.ok(res.symbols.length > 0, "some symbols matched");
    assert.ok(res.symbols.every((s) => s.signature.includes("export")), "all matches contain export");
  });

  test("returns no-match message when filter matches nothing", async () => {
    const file = await writeTempFile(
      "nomatch.ts",
      [
        "export function handleAuth() {}",
        "function helper() {}",
      ].join("\n")
    );

    const res = await indexFile(file, { filter: "nonexistent_symbol_xyz" });
    assert.equal(res.symbols.length, 0);
    assert.match(res.skeletonText, /no structural symbols matched filter: "nonexistent_symbol_xyz"/);
  });

  test("errors on missing file", async () => {
    await assert.rejects(() => indexFile(path.join(os.tmpdir(), "definitely-not-here-xyz.js")));
  });
});
