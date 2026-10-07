// lib/tools/index.js
// Source code skeleton indexing tool for dsh-tokenslash, inspired by Maki.
// Extracts high-level symbols, function signatures, and line ranges [start-end]
// to reduce context token usage by 70-90% compared to reading full files.

import fs from "node:fs/promises";
import path from "node:path";

const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB cap

const EXT_TO_LANG = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".pyw": "python",
  ".rs": "rust",
  ".go": "go",
  ".lua": "lua",
  ".md": "markdown",
  ".markdown": "markdown",
  ".json": "json",
  ".jsonc": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
};

/**
 * Clean signature line by removing trailing opening brace or excess whitespace
 */
function cleanSignature(line) {
  return line.replace(/\{\s*$/, "").trim();
}

/**
 * Parse JS/TS files into structural symbols with line ranges
 */
function parseJsTs(lines) {
  const symbols = [];
  let inBlockComment = false;
  let importStart = null;
  let importCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Multi-line comment tracking
    if (inBlockComment) {
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) {
        inBlockComment = true;
      }
      continue;
    }
    if (trimmed.startsWith("//") || trimmed === "") {
      continue;
    }

    // Imports grouping
    if (/^import\b/.test(trimmed)) {
      if (importStart === null) {
        importStart = lineNum;
        importCount = 0;
      }
      importCount++;
      // Check if import statement continues onto following lines (up to next statement start)
      let j = i;
      while (j < lines.length && !lines[j].includes(";")) {
        j++;
        if (j < lines.length && /^(?:import|export|const|let|var|function|class|type|interface)\b/.test(lines[j].trim())) {
          j--; // do not consume next declaration line
          break;
        }
      }
      if (j >= lines.length) j = lines.length - 1;
      i = j;
      continue;
    } else if (importStart !== null) {
      const endLine = Math.min(lines.length, Math.max(importStart, lineNum - 1));
      symbols.push({
        start: importStart,
        end: endLine,
        kind: "imports",
        indent: 0,
        signature: `imports (${importCount} statement${importCount > 1 ? "s" : ""})`,
      });
      importStart = null;
      importCount = 0;
    }

    // Export default / named export declarations
    const isExport = /^export\s+/.test(trimmed);
    const declText = isExport ? trimmed.replace(/^export\s+(default\s+)?/, "") : trimmed;

    // Class declaration
    const classMatch = declText.match(/^(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)(?:\s+extends\s+[A-Za-z0-9_$.]+)?(?:\s+implements\s+[A-Za-z0-9_$,\s]+)?/);
    if (classMatch) {
      const endLine = findBraceEnd(lines, i);
      const indent = rawLine.search(/\S/);
      symbols.push({
        start: lineNum,
        end: endLine,
        kind: "class",
        indent: Math.max(0, indent),
        signature: `${isExport ? "export " : ""}${cleanSignature(trimmed)}`,
      });
      continue;
    }

    // Interface / Type / Enum
    const typeMatch = declText.match(/^(?:interface|type|enum)\s+([A-Za-z0-9_$]+)/);
    if (typeMatch) {
      const endLine = declText.includes("{") ? findBraceEnd(lines, i) : lineNum;
      const indent = rawLine.search(/\S/);
      symbols.push({
        start: lineNum,
        end: endLine,
        kind: "type",
        indent: Math.max(0, indent),
        signature: `${isExport ? "export " : ""}${cleanSignature(trimmed)}`,
      });
      continue;
    }

    // Functions
    const funcMatch = declText.match(/^(?:async\s+)?function(?:\s*\*|\s+)\s*([A-Za-z0-9_$]+)?\s*\(([^)]*)\)/);
    if (funcMatch) {
      const endLine = findBraceEnd(lines, i);
      const indent = rawLine.search(/\S/);
      symbols.push({
        start: lineNum,
        end: endLine,
        kind: "function",
        indent: Math.max(0, indent),
        signature: `${isExport ? "export " : ""}${cleanSignature(trimmed)}`,
      });
      continue;
    }

    // Const/let arrow function or function expression: const foo = async (...) => ...
    const varFuncMatch = declText.match(/^(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/);
    if (varFuncMatch) {
      const endLine = trimmed.includes("{") ? findBraceEnd(lines, i) : lineNum;
      const indent = rawLine.search(/\S/);
      symbols.push({
        start: lineNum,
        end: endLine,
        kind: "function",
        indent: Math.max(0, indent),
        signature: `${isExport ? "export " : ""}${cleanSignature(trimmed)}`,
      });
      continue;
    }

    // Class methods, getters, setters, constructors (indented inside class)
    const methodMatch = rawLine.match(/^(\s+)(?:(?:public|private|protected|static|async|override)\s+)*(?:(?:get|set)\s+)?([A-Za-z0-9_$#]+)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\s*\{/);
    if (methodMatch) {
      const indent = methodMatch[1].length;
      const endLine = findBraceEnd(lines, i);
      symbols.push({
        start: lineNum,
        end: endLine,
        kind: "method",
        indent,
        signature: cleanSignature(trimmed),
      });
      continue;
    }
  }

  if (importStart !== null) {
    symbols.push({
      start: importStart,
      end: lines.length,
      kind: "imports",
      indent: 0,
      signature: `imports (${importCount} statement${importCount > 1 ? "s" : ""})`,
    });
  }

  return symbols;
}

/**
 * Find line where opening brace `{` balances back to 0
 */
function findBraceEnd(lines, startIndex) {
  let depth = 0;
  let seenOpen = false;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === "{") {
        depth++;
        seenOpen = true;
      } else if (char === "}") {
        depth--;
        if (seenOpen && depth <= 0) {
          return i + 1; // 1-based
        }
      }
    }
    // If the declaration ended on the same line without a brace block
    if (!seenOpen && line.includes(";")) {
      return startIndex + 1;
    }
  }
  return lines.length;
}

/**
 * Parse Python files into structural symbols with line ranges based on indentation
 */
function parsePython(lines) {
  const symbols = [];
  let importStart = null;
  let importCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("#") || trimmed === "") {
      continue;
    }

    // Imports
    if (/^(?:import\s+|from\s+)/.test(trimmed)) {
      if (importStart === null) {
        importStart = lineNum;
        importCount = 0;
      }
      importCount++;
      continue;
    } else if (importStart !== null) {
      symbols.push({
        start: importStart,
        end: lineNum - 1,
        kind: "imports",
        indent: 0,
        signature: `imports (${importCount} statement${importCount > 1 ? "s" : ""})`,
      });
      importStart = null;
      importCount = 0;
    }

    // Class or def
    const match = rawLine.match(/^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z0-9_]+)\s*(?:\(([^)]*)\))?\s*:/);
    if (match) {
      const indent = match[1].length;
      const kind = match[2] === "class" ? "class" : indent > 0 ? "method" : "function";
      // Find end by indentation of subsequent non-empty non-comment lines
      let endLine = lineNum;
      for (let j = i + 1; j < lines.length; j++) {
        const nextRaw = lines[j];
        const nextTrimmed = nextRaw.trim();
        if (nextTrimmed === "" || nextTrimmed.startsWith("#")) continue;
        const nextIndent = nextRaw.search(/\S/);
        if (nextIndent <= indent) {
          break;
        }
        endLine = j + 1;
      }
      symbols.push({
        start: lineNum,
        end: endLine,
        kind,
        indent,
        signature: cleanSignature(trimmed),
      });
    }
  }

  if (importStart !== null) {
    symbols.push({
      start: importStart,
      end: lines.length,
      kind: "imports",
      indent: 0,
      signature: `imports (${importCount} statement${importCount > 1 ? "s" : ""})`,
    });
  }

  return symbols;
}

/**
 * Parse Rust files
 */
function parseRust(lines) {
  const symbols = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("//") || trimmed === "") continue;

    const match = trimmed.match(/^(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(fn|struct|enum|trait|impl|type)\s+([A-Za-z0-9_]+)/);
    if (match) {
      const endLine = findBraceEnd(lines, i);
      const indent = Math.max(0, rawLine.search(/\S/));
      symbols.push({
        start: lineNum,
        end: endLine,
        kind: match[1],
        indent,
        signature: cleanSignature(trimmed),
      });
    }
  }
  return symbols;
}

/**
 * Parse Go files
 */
function parseGo(lines) {
  const symbols = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("//") || trimmed === "") continue;

    const funcMatch = trimmed.match(/^func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\(/);
    const typeMatch = trimmed.match(/^type\s+([A-Za-z0-9_]+)\s+(?:struct|interface)/);
    if (funcMatch || typeMatch) {
      const endLine = findBraceEnd(lines, i);
      const indent = Math.max(0, rawLine.search(/\S/));
      symbols.push({
        start: lineNum,
        end: endLine,
        kind: funcMatch ? "function" : "type",
        indent,
        signature: cleanSignature(trimmed),
      });
    }
  }
  return symbols;
}

/**
 * Find the closing `end` for a Lua block.
 */
function findLuaEnd(lines, startIndex) {
  let depth = 0;
  let inBlockComment = false;

  for (let i = startIndex; i < lines.length; i++) {
    let line = lines[i].trim();
    if (inBlockComment) {
      if (line.includes("]]")) inBlockComment = false;
      continue;
    }
    if (line.startsWith("--[[")) {
      if (!line.includes("]]")) inBlockComment = true;
      continue;
    }

    // Strip comments and string literals so block keywords are not miscounted.
    line = line
      .replace(/--.*$/, "")
      .replace(/"(?:[^"\\]|\\.)*"/g, "\"\"")
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    if (!line) continue;

    // `function`, `then`, and `do` open `end`-terminated blocks.
    depth += (line.match(/\b(?:function|then|do)\b/g) || []).length;
    depth -= (line.match(/\bend\b/g) || []).length;
    if (depth <= 0) return i + 1;
  }
  return lines.length;
}

/**
 * Parse Lua files into functions, methods, tables, and require groups.
 */
function parseLua(lines) {
  const symbols = [];
  let requireStart = null;
  let requireCount = 0;
  let inBlockComment = false;

  const flushRequires = (endLine) => {
    if (requireStart === null) return;
    symbols.push({
      start: requireStart,
      end: endLine,
      kind: "requires",
      indent: 0,
      signature: `requires (${requireCount} statement${requireCount === 1 ? "" : "s"})`,
    });
    requireStart = null;
    requireCount = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (inBlockComment) {
      if (trimmed.includes("]]")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("--[[")) {
      flushRequires(lineNum - 1);
      if (!trimmed.includes("]]")) inBlockComment = true;
      continue;
    }
    if (!trimmed || trimmed.startsWith("--")) {
      flushRequires(lineNum - 1);
      continue;
    }

    const requireMatch = trimmed.match(/^(?:local\s+[\w,\s]+\s*=\s*)?require\s*\(?\s*["'][^"']+["']\s*\)?/);
    if (requireMatch) {
      if (requireStart === null) requireStart = lineNum;
      requireCount++;
      continue;
    }
    flushRequires(lineNum - 1);

    const functionMatch = trimmed.match(/^(?:local\s+)?function\s+([\w.:]+)\s*\(([^)]*)\)/);
    const assignedFunctionMatch = trimmed.match(/^(?:local\s+)?([\w.:]+)\s*=\s*function\s*\(([^)]*)\)/);
    const match = functionMatch || assignedFunctionMatch;
    if (match) {
      const name = match[1];
      symbols.push({
        start: lineNum,
        end: findLuaEnd(lines, i),
        kind: name.includes(":") || name.includes(".") ? "method" : "function",
        indent: Math.max(0, rawLine.search(/\S/)),
        signature: cleanSignature(trimmed),
      });
      continue;
    }

    const tableMatch = trimmed.match(/^(?:local\s+)?([A-Za-z_]\w*)\s*=\s*\{/);
    if (tableMatch) {
      symbols.push({
        start: lineNum,
        end: findBraceEnd(lines, i),
        kind: "table",
        indent: Math.max(0, rawLine.search(/\S/)),
        signature: cleanSignature(trimmed),
      });
    }
  }

  flushRequires(lines.length);
  return symbols;
}

/**
 * Parse Markdown files into header hierarchy
 */
function parseMarkdown(lines) {
  const symbols = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const trimmed = lines[i].trim();
    const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      const level = match[1].length;
      let endLine = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const nextMatch = lines[j].trim().match(/^(#{1,6})\s+/);
        if (nextMatch && nextMatch[1].length <= level) {
          endLine = j;
          break;
        }
      }
      symbols.push({
        start: lineNum,
        end: endLine,
        kind: `h${level}`,
        indent: (level - 1) * 2,
        signature: trimmed,
      });
    }
  }
  return symbols;
}

/**
 * Parse JSON files into top-level keys
 */
function parseJson(content, lines) {
  const symbols = [];
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null) {
      const keys = Object.keys(parsed);
      for (const k of keys) {
        // Find line where key appears
        const regex = new RegExp(`^\\s*"${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`);
        const idx = lines.findIndex((l) => regex.test(l));
        const val = parsed[k];
        const valSummary = Array.isArray(val)
          ? `Array(${val.length})`
          : typeof val === "object" && val !== null
          ? `Object(${Object.keys(val).length} keys)`
          : typeof val;
        symbols.push({
          start: idx >= 0 ? idx + 1 : 1,
          end: idx >= 0 ? idx + 1 : 1,
          kind: "key",
          indent: 2,
          signature: `"${k}": ${valSummary}`,
        });
      }
    }
  } catch {
    // If not valid JSON, ignore
  }
  return symbols;
}

/**
 * Format symbols array into human-readable & LLM-friendly index text
 */
export function formatSkeleton(symbols, meta) {
  const header = `${meta.path} (${meta.lines} lines, ${(meta.bytes / 1024).toFixed(1)} KB) [language: ${meta.language}]`;
  if (!symbols || symbols.length === 0) {
    return `${header}\n(no structural symbols detected; file can be read directly)`;
  }

  const lines = [header];
  for (const s of symbols) {
    const range = s.start === s.end ? `[${s.start}]` : `[${s.start}-${s.end}]`;
    const indentStr = " ".repeat(s.indent || 0);
    lines.push(`${String(s.start).padStart(4, " ")}: ${indentStr}${s.signature} ${range}`);
  }

  return lines.join("\n");
}

/**
 * Index a file path and return structured skeleton
 */
export async function indexFile(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const stat = await fs.stat(resolved);

  if (stat.isDirectory()) {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const listing = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n");
    return {
      path: filePath,
      language: "directory",
      bytes: stat.size,
      lines: entries.length,
      skeletonText: `Directory: ${filePath} (${entries.length} entries)\n${listing}`,
      symbols: [],
    };
  }

  if (stat.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File too large (${stat.size} bytes, limit ${MAX_FILE_SIZE_BYTES} bytes). Use read with offset and limit.`);
  }

  const content = await fs.readFile(resolved, "utf8");
  const rawLines = content.split(/\r?\n/);
  const totalLines = rawLines.length;
  const ext = path.extname(resolved).toLowerCase();
  const language = EXT_TO_LANG[ext] || "unknown";

  let symbols = [];
  if (language === "javascript" || language === "typescript") {
    symbols = parseJsTs(rawLines);
  } else if (language === "python") {
    symbols = parsePython(rawLines);
  } else if (language === "rust") {
    symbols = parseRust(rawLines);
  } else if (language === "go") {
    symbols = parseGo(rawLines);
  } else if (language === "lua") {
    symbols = parseLua(rawLines);
  } else if (language === "markdown") {
    symbols = parseMarkdown(rawLines);
  } else if (language === "json") {
    symbols = parseJson(content, rawLines);
  }

  const meta = {
    path: filePath,
    language,
    lines: totalLines,
    bytes: stat.size,
  };

  const skeletonText = formatSkeleton(symbols, meta);
  const skeletonBytes = Buffer.byteLength(skeletonText, "utf8");
  const reductionPercent = Math.max(0, Math.round((1 - skeletonBytes / Math.max(1, stat.size)) * 100));

  return {
    path: filePath,
    language,
    lines: totalLines,
    bytes: stat.size,
    symbolsCount: symbols.length,
    reductionPercent: `${reductionPercent}%`,
    skeletonText,
    symbols,
  };
}

export default { indexFile, formatSkeleton };
