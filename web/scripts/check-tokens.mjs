import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(".");
const sourceDirs = ["app", "components", "lib", "scripts", "test", "worker"];
const ignored = new Set(["node_modules", ".next", ".git"]);
const files = [];

async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collect(entryPath);
    } else if (/\.(css|ts|tsx|mjs)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
}

for (const sourceDir of sourceDirs) {
  try {
    await collect(path.join(rootDir, sourceDir));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const cssPath = path.join(rootDir, "app/globals.css");
const css = await readFile(cssPath, "utf8");
const rootMatch = css.match(/:root\s*\{([\s\S]*?)\n\}/);
if (!rootMatch) throw new Error("Could not find :root in app/globals.css");

const declared = new Set([...rootMatch[1].matchAll(/--([\w-]+)\s*:/g)].map((match) => match[1]));
const referenced = new Set();
for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/var\(--([\w-]+)\)/g)) referenced.add(match[1]);
}

const undeclared = [...referenced].filter((token) => !declared.has(token)).sort();
const unused = [...declared].filter((token) => !referenced.has(token)).sort();
console.log(`undeclared: ${undeclared.length ? undeclared.join(", ") : "[]"}\nunused: ${unused.length ? unused.join(", ") : "[]"}`);
if (undeclared.length || unused.length) process.exit(1);
