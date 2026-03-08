import { readdir, readFile, realpath } from "fs/promises";
import { join, relative, resolve } from "path";
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
  const realDir = await realpath(dir);
  if (!realDir.startsWith(base)) {
    return [];
  }
  const entries = await readdir(realDir, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const fullPath = join(realDir, entry.name);
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
      const candidatePath = resolve(dir, name);
      if (!candidatePath.startsWith(dir)) continue;
      const content = await readFile(candidatePath, "utf-8");
      return content;
    } catch {
      // try next
    }
  }
  return "(No README found)";
}

export function validateLocalPath(localPath: string, allowedBasePath: string): string {
  const normalizedBase = resolve(allowedBasePath);
  const normalizedPath = resolve(normalizedBase, localPath);

  if (!normalizedPath.startsWith(normalizedBase + "/") && normalizedPath !== normalizedBase) {
    throw new Error("Path is outside the allowed directory.");
  }

  return normalizedPath;
}

export async function getLocalData(safePath: string): Promise<GithubData> {
  const resolvedPath = await realpath(safePath);

  const allPaths = await walkDir(resolvedPath, resolvedPath);
  const fileTree = allPaths.join("\n");
  const readme = await findReadme(resolvedPath);

  return {
    defaultBranch: "main",
    fileTree,
    readme,
  };
}
