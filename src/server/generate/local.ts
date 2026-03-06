import { readdir, readFile, stat } from "fs/promises";
import { join, relative } from "path";
import type { GithubData } from "./github";

const EXCLUDED_PATTERNS = [
  "node_modules/",
  "vendor/",
  "venv/",
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

function shouldIncludeFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return !EXCLUDED_PATTERNS.some((pattern) => lowerPath.includes(pattern));
}

async function walkDir(dir: string, base: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(base, fullPath).replace(/\\/g, "/");

    if (!shouldIncludeFile(relPath + (entry.isDirectory() ? "/" : ""))) {
      continue;
    }

    if (entry.isDirectory()) {
      paths.push(relPath + "/");
      const subPaths = await walkDir(fullPath, base);
      paths.push(...subPaths);
    } else {
      paths.push(relPath);
    }
  }

  return paths;
}

async function findReadme(dir: string): Promise<string> {
  const candidates = ["README.md", "readme.md", "Readme.md", "README.txt", "README", "CLAUDE.md"];
  for (const name of candidates) {
    try {
      const content = await readFile(join(dir, name), "utf-8");
      return content;
    } catch {
      // try next
    }
  }
  return "(No README found)";
}

export async function getLocalData(localPath: string): Promise<GithubData> {
  await stat(localPath); // throws if path doesn't exist

  const allPaths = await walkDir(localPath, localPath);
  const fileTree = allPaths.join("\n");
  const readme = await findReadme(localPath);

  return {
    defaultBranch: "main",
    fileTree,
    readme,
  };
}
