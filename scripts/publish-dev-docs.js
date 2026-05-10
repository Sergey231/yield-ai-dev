const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

/**
 * Publish Yield AI frontend dev docs into the sibling `yield-ai-docs` repo.
 *
 * Source:   <this-repo>/docs/**
 * Target:   ../yield-ai-docs/docs/dev/frontend/**
 *
 * This script:
 * - copies .md/.mdx files (preserving relative paths)
 * - overwrites existing files (idempotent)
 * - does NOT delete unrelated docs in the target repo
 */

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

function isDocFile(name) {
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".mdx");
}

async function walkDocs(dir) {
  /** @type {string[]} */
  const out = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Skip typical noise directories.
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
      out.push(...(await walkDocs(full)));
    } else if (e.isFile() && isDocFile(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function relPosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const sourceRoot = path.join(repoRoot, "docs");
  const targetRoot = path.resolve(repoRoot, "..", "yield-ai-docs", "docs", "dev", "frontend");

  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`docs directory not found: ${sourceRoot}`);
  }

  await ensureDir(targetRoot);

  const files = await walkDocs(sourceRoot);
  let written = 0;

  for (const src of files) {
    const rel = relPosix(sourceRoot, src);
    const dst = path.join(targetRoot, rel);
    await ensureDir(path.dirname(dst));
    await fsp.copyFile(src, dst);
    written++;
    process.stdout.write(`generated: ${rel}\n`);
  }

  process.stdout.write(`done: ${written} files -> ${targetRoot}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

