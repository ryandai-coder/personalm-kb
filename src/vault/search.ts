import { readNote, listNotes } from "./reader";
import { embed, loadEmbeddingCache, cosineSimilarity } from "./embeddings";
import { logger } from "../utils/logger";

export interface SearchOptions {
  maxResults?: number;
  filterTags?: string[];
  filterType?: string;
  filterSensitivity?: string;
  /** Search mode: "hybrid" (default), "semantic", or "keyword" */
  mode?: "hybrid" | "semantic" | "keyword";
}

export interface SearchResult {
  filePath: string;
  score: number;
  frontmatter: Record<string, unknown>;
  excerpt: string;
}

export interface FullTextOptions {
  maxResults?: number;
  contextLines?: number;
}

export interface FullTextResult {
  filePath: string;
  score: number;
  lineNumber: number;
  excerpt: string;
}

// ---- Semantic Search ----

export async function semanticSearch(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { maxResults = 10, filterTags, filterType, filterSensitivity } = options;

  const allFiles = await listNotes();
  const cache = await loadEmbeddingCache();

  if (Object.keys(cache).length === 0) {
    logger.debug("No embeddings cached, returning empty");
    return [];
  }

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(query);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to embed query: ${msg}`);
    return [];
  }

  const scored: Array<{ filePath: string; score: number }> = [];

  for (const filePath of allFiles) {
    const entry = cache[filePath];
    if (!entry?.embedding) continue;

    // Apply filters
    const note = await readNote(filePath);
    if (!note) continue;

    const noteTags = (note.frontmatter?.tags as string[]) || [];
    if (filterTags?.length && !filterTags.some((t) => noteTags.includes(t))) continue;
    if (filterType && note.frontmatter?.type !== filterType) continue;
    if (filterSensitivity && note.frontmatter?.sensitivity !== filterSensitivity) continue;

    const similarity = cosineSimilarity(queryEmbedding, entry.embedding);

    // Recency boost: newer notes get a slight bump
    let recencyBoost = 1.0;
    const created = note.frontmatter?.created_at as string | undefined;
    if (created) {
      const ageDays = (Date.now() - new Date(created).getTime()) / (1000 * 60 * 60 * 24);
      recencyBoost = Math.max(0.85, 1 - ageDays / 500); // gentler than keyword decay
    }

    const finalScore = similarity * recencyBoost;
    if (finalScore > 0.1) {
      // minimum threshold
      scored.push({ filePath, score: finalScore });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const results: SearchResult[] = [];
  for (const { filePath, score } of scored.slice(0, maxResults)) {
    const note = await readNote(filePath);
    if (!note) continue;
    results.push({
      filePath,
      score: Math.round(score * 100) / 100,
      frontmatter: note.frontmatter,
      excerpt: note.content.slice(0, 300).trim(),
    });
  }

  return results;
}

// ---- Keyword Search (original, kept for hybrid) ----

async function keywordSearch(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { maxResults = 10, filterTags, filterType, filterSensitivity } = options;
  const allFiles = await listNotes();
  const results: SearchResult[] = [];

  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);

  for (const filePath of allFiles) {
    const note = await readNote(filePath);
    if (!note) continue;

    const noteTags = (note.frontmatter?.tags as string[]) || [];
    if (filterTags?.length && !filterTags.some((t) => noteTags.includes(t))) continue;
    if (filterType && note.frontmatter?.type !== filterType) continue;
    if (filterSensitivity && note.frontmatter?.sensitivity !== filterSensitivity) continue;

    let score = 0;
    const searchText = (
      note.content +
      " " +
      JSON.stringify(note.frontmatter)
    ).toLowerCase();

    for (const kw of keywords) {
      const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const matches = searchText.match(regex);
      if (matches) score += matches.length;
    }

    const created = note.frontmatter?.created_at as string | undefined;
    if (created) {
      const ageDays =
        (Date.now() - new Date(created).getTime()) / (1000 * 60 * 60 * 24);
      score *= Math.max(0.5, 1 - ageDays / 365);
    }

    if (score > 0) {
      results.push({
        filePath,
        score,
        frontmatter: note.frontmatter,
        excerpt: note.content.slice(0, 300).trim(),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// ---- Hybrid Search (default) ----

/**
 * Main vault search. Default mode is "hybrid": combines semantic + keyword
 * results, deduplicates by filePath, and normalizes scores into 0–1 range.
 */
export async function searchVault(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const mode = options.mode || "hybrid";
  const maxResults = options.maxResults || 10;

  if (mode === "semantic") {
    return semanticSearch(query, options);
  }

  if (mode === "keyword") {
    return keywordSearch(query, options);
  }

  // Hybrid: run both and merge
  const [semanticResults, keywordResults] = await Promise.all([
    semanticSearch(query, options).catch(() => [] as SearchResult[]),
    keywordSearch(query, options),
  ]);

  // Merge: union by filePath, sum normalized scores
  const merged = new Map<string, SearchResult>();

  // Normalize semantic scores to [0, 1]
  const maxSemScore = semanticResults.length
    ? Math.max(...semanticResults.map((r) => r.score))
    : 1;
  for (const r of semanticResults) {
    merged.set(r.filePath, {
      ...r,
      score: maxSemScore > 0 ? r.score / maxSemScore : 0,
    });
  }

  // Normalize keyword scores and merge
  const maxKwScore = keywordResults.length
    ? Math.max(...keywordResults.map((r) => r.score))
    : 1;
  for (const r of keywordResults) {
    const normalized = maxKwScore > 0 ? r.score / maxKwScore : 0;
    const existing = merged.get(r.filePath);
    if (existing) {
      // Weight: semantic 0.6, keyword 0.4
      existing.score = existing.score * 0.6 + normalized * 0.4;
      // Use keyword excerpt if it's more specific (shorter but non-empty)
      if (
        r.excerpt &&
        r.excerpt.length < existing.excerpt.length &&
        r.excerpt.length > 20
      ) {
        existing.excerpt = r.excerpt;
      }
    } else {
      merged.set(r.filePath, { ...r, score: normalized * 0.4 });
    }
  }

  const results = [...merged.values()];
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// ---- Full-text search (line-level) ----

export async function fullTextSearch(
  query: string,
  options: FullTextOptions = {}
): Promise<FullTextResult[]> {
  const { maxResults = 5, contextLines = 2 } = options;
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!keywords.length) return [];

  const allFiles = await listNotes();
  const results: FullTextResult[] = [];

  for (const filePath of allFiles) {
    const note = await readNote(filePath);
    if (!note) continue;

    const lines = note.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      let matchScore = 0;
      for (const kw of keywords) {
        if (line.includes(kw)) matchScore++;
      }
      if (matchScore === 0) continue;

      const start = Math.max(0, i - contextLines);
      const end = Math.min(lines.length, i + contextLines + 1);
      const excerpt = lines.slice(start, end).join("\n");

      results.push({
        filePath,
        score: matchScore,
        lineNumber: i + 1,
        excerpt,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}
