import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";

const EXCLUDED = [
  "node_modules/",
  "vendor/",
  "venv/",
  ".venv/",
  ".min.",
  ".pyc",
  ".pyo",
  ".pyd",
  ".so",
  ".dll",
  ".class",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".ico",
  ".svg",
  ".ttf",
  ".woff",
  ".webp",
  "__pycache__/",
  ".cache/",
  ".tmp/",
  "yarn.lock",
  "poetry.lock",
  "*.log",
  ".vscode/",
  ".idea/",
  "target/",
  ".git/",
];

function shouldInclude(path: string): boolean {
  const lp = path.toLowerCase();
  return !EXCLUDED.some((p) => lp.includes(p));
}

async function walkDir(dir: string, base: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = relative(base, full).replace(/\\/g, "/");
    if (!shouldInclude(rel + (e.isDirectory() ? "/" : ""))) continue;
    if (e.isDirectory()) {
      paths.push(rel + "/");
      paths.push(...(await walkDir(full, base)));
    } else {
      paths.push(rel);
    }
  }
  return paths;
}

export async function scanDirectory(dirPath: string): Promise<{
  fileTree: string;
  readme: string;
  fileCount: number;
}> {
  await stat(dirPath); // throws if path doesn't exist
  const paths = await walkDir(dirPath, dirPath);
  const fileTree = paths.join("\n");
  const readme = await findReadme(dirPath);
  return { fileTree, readme, fileCount: paths.length };
}

async function findReadme(dir: string): Promise<string> {
  for (const name of ["README.md", "readme.md", "Readme.md"]) {
    try {
      return await readFile(join(dir, name), "utf-8");
    } catch {
      // try next
    }
  }
  return "(No README found)";
}
