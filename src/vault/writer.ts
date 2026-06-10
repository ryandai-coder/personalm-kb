import fs from "fs/promises";
import { dirname } from "path";
import { createHash } from "crypto";
import { vaultAbsolute, readRaw } from "./reader";
import { logger } from "../utils/logger";

// Lazy-import embeddings to avoid circular deps at module load
async function triggerEmbed(filePath: string, content: string): Promise<void> {
  try {
    const { embedNote, loadEmbeddingCache, saveEmbeddingCache } = await import("./embeddings");
    const cache = await loadEmbeddingCache();
    await embedNote(filePath, content, cache);
    await saveEmbeddingCache(cache);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`Background embedding skipped: ${msg}`);
  }
}

export interface AuditAdapter {
  logWrite(entry: { filePath: string; action: string; detail: Record<string, unknown> }): Promise<void>;
}

export interface FrontmatterMeta {
  id?: string;
  type?: string;
  created_at?: string;
  updated_at?: string;
  tags?: string[];
  linked?: string[];
  sensitivity?: string;
  source?: string;
  evidence?: string;
  [key: string]: unknown;
}

export interface WriteNoteParams {
  path: string;
  section?: string | null;
  content: string;
  frontmatter?: FrontmatterMeta;
  audit?: AuditAdapter;
}

export interface WriteNoteResult {
  filePath: string;
  auditId?: string;
}

export interface WriteTemplatedParams {
  template: string;
  path: string;
  fields?: Record<string, string>;
  frontmatter?: FrontmatterMeta;
  audit?: AuditAdapter;
}

export function generateNoteId(prefix = ""): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  return `${date}-${time}${prefix ? `-${prefix}` : ""}`;
}

export function buildFrontmatter(meta: FrontmatterMeta = {}): string {
  const now = new Date().toISOString().replace(/\.\d{3}/, "");
  const defaults: FrontmatterMeta = {
    id: generateNoteId(),
    type: "note",
    created_at: now,
    updated_at: now,
    tags: [],
    linked: [],
    sensitivity: "low",
    source: "cli",
    evidence: "L1",
  };

  const fm = { ...defaults, ...meta };

  // Ensure linked is an array
  let linked = fm.linked;
  if (typeof linked === "string") linked = [linked];
  fm.linked = linked;

  const lines = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined || value === null || value === "") continue;
    if ((key === "tags" || key === "linked") && Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v: string) => `"${v}"`).join(", ")}]`);
    } else if (typeof value === "string") {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---\n");
  return lines.join("\n");
}

interface AuditDetailCreate {
  action: "create";
  filePath: string;
  contentHash: string;
  frontmatter: FrontmatterMeta;
  auditId?: string;
}

interface AuditDetailAppend {
  action: "append";
  filePath: string;
  contentHash: string;
  section: string | null;
  byteOffsetBefore: number;
  auditId?: string;
}

export async function writeNote(params: WriteNoteParams): Promise<WriteNoteResult> {
  const {
    path: relPath,
    section,
    content,
    frontmatter: fmMeta = {},
    audit,
  } = params;

  const absPath = vaultAbsolute(relPath);
  const exists = await fileExists(absPath);

  let auditDetail: AuditDetailCreate | AuditDetailAppend;

  if (!exists) {
    await fs.mkdir(dirname(absPath), { recursive: true });
    const fm = buildFrontmatter(fmMeta);
    const body = section ? `${section}\n\n${content}\n` : `${content}\n`;
    const fileContent = fm + body;
    await fs.writeFile(absPath, fileContent, "utf-8");
    logger.info(`Created: ${relPath}`);
    auditDetail = {
      action: "create",
      filePath: relPath,
      contentHash: hashContent(content),
      frontmatter: fmMeta,
    };
  } else {
    const currentRaw = await readRaw(relPath);
    if (!currentRaw) throw new Error(`Cannot read existing file: ${relPath}`);

    const lineBefore = currentRaw.length;

    let newContent: string;
    if (section && currentRaw.includes(section)) {
      const lines = currentRaw.split("\n");
      const headingIdx = lines.findIndex((l) => l.trim() === section);
      if (headingIdx >= 0) {
        let insertIdx = headingIdx + 1;
        while (insertIdx < lines.length && lines[insertIdx].startsWith("##")) {
          insertIdx++;
        }
        let endIdx = insertIdx;
        while (endIdx < lines.length && !lines[endIdx].startsWith("##")) {
          endIdx++;
        }
        lines.splice(endIdx, 0, "", content);
        newContent = lines.join("\n");
      } else {
        newContent = currentRaw + "\n" + section + "\n\n" + content + "\n";
      }
    } else if (section) {
      newContent = currentRaw.trimEnd() + "\n\n" + section + "\n\n" + content + "\n";
    } else {
      newContent = currentRaw.trimEnd() + "\n\n" + content + "\n";
    }

    await fs.writeFile(absPath, newContent, "utf-8");
    logger.info(`Updated: ${relPath}${section ? " → " + section : ""}`);

    auditDetail = {
      action: "append",
      filePath: relPath,
      contentHash: hashContent(content),
      section: section || null,
      byteOffsetBefore: lineBefore,
    };
  }

  if (audit) {
    await audit.logWrite({
      filePath: relPath,
      action: auditDetail.action,
      detail: { ...auditDetail, auditId: undefined },
    });
  }

  // Background: update embedding cache (don't block response)
  const finalContent = exists ? (await readRaw(relPath)) || content : content;
  triggerEmbed(relPath, finalContent);

  return {
    filePath: relPath,
    auditId: "auditId" in auditDetail ? auditDetail.auditId : undefined,
  };
}

export async function writeTemplatedNote(params: WriteTemplatedParams): Promise<WriteNoteResult> {
  const { template, path: relPath, fields = {}, frontmatter = {}, audit } = params;
  const content = fillTemplate(template, fields);
  return writeNote({ path: relPath, content, frontmatter, audit });
}

function fillTemplate(template: string, fields: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(fields)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "");
  }
  return result;
}

export async function removeLines(relPath: string, lineStart: number, lineEnd: number): Promise<boolean> {
  const absPath = vaultAbsolute(relPath);
  const raw = await fs.readFile(absPath, "utf-8");
  const lines = raw.split("\n");
  const newLines = [...lines.slice(0, lineStart), ...lines.slice(lineEnd)];
  await fs.writeFile(absPath, newLines.join("\n"), "utf-8");
  return true;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}
