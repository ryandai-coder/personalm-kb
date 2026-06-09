import fs from "fs/promises";
import { resolve } from "path";
import { config } from "../config";
import { logger } from "../utils/logger";

const sysDir = resolve(config.vault.path, "_system");

export interface NoteEntry {
  id?: string;
  file_path: string;
  type?: string;
  created_at?: string;
  updated_at?: string;
  tags?: string[];
  linked?: string[];
  sensitivity?: string;
  evidence?: string;
  title?: string;
  summary?: string;
  word_count?: number;
}

export interface AuditEntry {
  id?: string;
  action: string;
  filePath?: string;
  file_path?: string;
  detail?: Record<string, unknown>;
  timestamp?: string;
}

export interface AuditRecord {
  id: string;
  action: string;
  file_path: string;
  detail: Record<string, unknown>;
  timestamp: string;
}

export interface StoredNote {
  id: string;
  file_path: string;
  type: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  linked: string[];
  sensitivity: string;
  evidence: string;
  title: string;
  summary: string;
  word_count: number;
}

export interface CorrectionEntry {
  level: string;
  section?: string;
  oldText?: string;
  old_text?: string;
  newText?: string;
  new_text?: string;
  userQuote?: string;
  user_quote?: string;
  createdAt?: string;
  created_at?: string;
}

export interface FollowupEntry {
  triggerNoteId?: string;
  trigger_note_id?: string;
  question: string;
  status?: string;
  scheduledAt?: string;
  scheduled_at?: string;
  createdAt?: string;
  created_at?: string;
}

let noteIndex: StoredNote[] = [];
let dirty = false;

const paths = {
  index: resolve(sysDir, "index.json"),
  audit: resolve(sysDir, "audit.jsonl"),
  corrections: resolve(sysDir, "corrections.jsonl"),
  followups: resolve(sysDir, "followups.jsonl"),
};

export async function initStore(): Promise<void> {
  await fs.mkdir(sysDir, { recursive: true });
  try {
    const raw = await fs.readFile(paths.index, "utf-8");
    noteIndex = JSON.parse(raw) as StoredNote[];
    logger.info(`Loaded ${noteIndex.length} notes from index`);
  } catch {
    noteIndex = [];
    logger.info("Fresh note index initialized");
  }
}

export function upsertNote(note: NoteEntry): void {
  const idx = noteIndex.findIndex((n) => n.id === note.id);
  const entry: StoredNote = {
    id: note.id || `note-${Date.now()}`,
    file_path: note.file_path,
    type: note.type || "note",
    created_at: note.created_at || new Date().toISOString(),
    updated_at: note.updated_at || new Date().toISOString(),
    tags: note.tags || [],
    linked: note.linked || [],
    sensitivity: note.sensitivity || "low",
    evidence: note.evidence || "L1",
    title: note.title || "",
    summary: note.summary || "",
    word_count: note.word_count || 0,
  };
  if (idx >= 0) noteIndex[idx] = entry;
  else noteIndex.push(entry);
  dirty = true;
}

export function queryNotes(opts: {
  type?: string;
  tags?: string[];
  sensitivity?: string;
  since?: string;
  limit?: number;
} = {}): StoredNote[] {
  let results = [...noteIndex];
  const { type, tags, sensitivity, since, limit = 50 } = opts;
  if (type) results = results.filter((n) => n.type === type);
  if (sensitivity) results = results.filter((n) => n.sensitivity === sensitivity);
  if (since) results = results.filter((n) => n.created_at >= since);
  if (tags?.length) results = results.filter((n) => tags.some((t) => n.tags.includes(t)));
  results.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return results.slice(0, limit);
}

export function getNoteById(id: string): StoredNote | null {
  return noteIndex.find((n) => n.id === id) || null;
}

export function getNotesByFilePath(filePath: string): StoredNote[] {
  return noteIndex.filter((n) => n.file_path === filePath);
}

export function noteCount(): number {
  return noteIndex.length;
}

export async function logAuditEntry(entry: AuditEntry): Promise<string> {
  const record: AuditRecord = {
    id: entry.id || `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    action: entry.action,
    file_path: entry.filePath || entry.file_path || "",
    detail: entry.detail || {},
    timestamp: entry.timestamp || new Date().toISOString(),
  };
  const line = JSON.stringify(record) + "\n";
  await fs.appendFile(paths.audit, line, "utf-8");
  return record.id;
}

export async function getLatestAuditEntry(action?: string): Promise<AuditRecord | null> {
  try {
    const raw = await fs.readFile(paths.audit, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries = lines.map((l) => JSON.parse(l) as AuditRecord).reverse();
    if (action) return entries.find((e) => e.action === action) || null;
    return entries[0] || null;
  } catch {
    return null;
  }
}

export async function getRecentAuditEntries(limit = 20): Promise<AuditRecord[]> {
  try {
    const raw = await fs.readFile(paths.audit, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines
      .map((l) => JSON.parse(l) as AuditRecord)
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function recordCorrection(correction: CorrectionEntry): Promise<void> {
  const record = {
    level: correction.level,
    section: correction.section || null,
    old_text: correction.oldText || correction.old_text || null,
    new_text: correction.newText || correction.new_text || null,
    user_quote: correction.userQuote || correction.user_quote || null,
    created_at: correction.createdAt || correction.created_at || new Date().toISOString(),
  };
  await fs.appendFile(paths.corrections, JSON.stringify(record) + "\n", "utf-8");
}

export async function createFollowup(followup: FollowupEntry): Promise<string> {
  const record = {
    id: `followup-${Date.now()}`,
    trigger_note_id: followup.triggerNoteId || followup.trigger_note_id || "",
    question: followup.question,
    status: followup.status || "pending",
    scheduled_at: followup.scheduledAt || followup.scheduled_at || null,
    created_at: followup.createdAt || followup.created_at || new Date().toISOString(),
  };
  await fs.appendFile(paths.followups, JSON.stringify(record) + "\n", "utf-8");
  return record.id;
}

export async function getPendingFollowups(): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(paths.followups, "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((f) => f.status === "pending");
  } catch {
    return [];
  }
}

export async function updateFollowupStatus(id: string, status: string): Promise<void> {
  const raw = await fs.readFile(paths.followups, "utf-8");
  const lines = raw.trim().split("\n").filter(Boolean);
  const updated = lines.map((l) => {
    const f = JSON.parse(l) as Record<string, unknown>;
    if (f.id === id) f.status = status;
    return JSON.stringify(f);
  });
  await fs.writeFile(paths.followups, updated.join("\n") + "\n", "utf-8");
}

export async function flushIndex(): Promise<void> {
  if (!dirty) return;
  await fs.writeFile(paths.index, JSON.stringify(noteIndex, null, 2), "utf-8");
  dirty = false;
}

let flushTimer: ReturnType<typeof setInterval> | undefined;

export function startAutoFlush(intervalMs = 30000): void {
  flushTimer = setInterval(() => {
    flushIndex().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Index flush error:", msg);
    });
  }, intervalMs);
}

export function stopAutoFlush(): void {
  if (flushTimer) clearInterval(flushTimer);
}

export async function clearIndex(): Promise<void> {
  noteIndex = [];
  dirty = true;
  await flushIndex();
}

export function closeStore(): Promise<void> {
  stopAutoFlush();
  return flushIndex();
}
