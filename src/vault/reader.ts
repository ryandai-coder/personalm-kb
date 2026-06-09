import fs from "fs/promises";
import { Dirent } from "fs";
import { resolve, relative } from "path";
import matter from "gray-matter";
import { config } from "../config";

const vaultPath = config.vault.path;

export interface NoteData {
  path: string;
  frontmatter: Record<string, unknown>;
  content: string;
  raw: string;
}

export function vaultAbsolute(relPath: string): string {
  return resolve(vaultPath, relPath);
}

export function vaultRelative(absPath: string): string {
  return relative(vaultPath, absPath);
}

export async function readNote(relPath: string): Promise<NoteData | null> {
  const absPath = vaultAbsolute(relPath);
  try {
    const raw = await fs.readFile(absPath, "utf-8");
    const parsed = matter(raw);
    return {
      path: relPath,
      frontmatter: parsed.data as Record<string, unknown>,
      content: parsed.content,
      raw,
    };
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function readRaw(relPath: string): Promise<string | null> {
  const absPath = vaultAbsolute(relPath);
  try {
    return await fs.readFile(absPath, "utf-8");
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function listNotes(subDir = ""): Promise<string[]> {
  const base = vaultAbsolute(subDir);
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith("_") && entry.name !== "_system") continue;
        await walk(full);
      } else if (entry.name.endsWith(".md")) {
        files.push(vaultRelative(full));
      }
    }
  }

  await walk(base);
  return files;
}

export async function readNotes(paths: string[]): Promise<NoteData[]> {
  const results = await Promise.allSettled(paths.map((p) => readNote(p)));
  return results
    .filter((r): r is PromiseFulfilledResult<NoteData> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value);
}

export async function noteExists(relPath: string): Promise<boolean> {
  try {
    await fs.access(vaultAbsolute(relPath));
    return true;
  } catch {
    return false;
  }
}
