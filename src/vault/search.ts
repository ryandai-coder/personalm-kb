import { readNote, listNotes } from "./reader";

export interface SearchOptions {
  maxResults?: number;
  filterTags?: string[];
  filterType?: string;
  filterSensitivity?: string;
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

export async function searchVault(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
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
    const searchText = (note.content + " " + JSON.stringify(note.frontmatter)).toLowerCase();

    for (const kw of keywords) {
      const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const matches = searchText.match(regex);
      if (matches) score += matches.length;
    }

    const created = note.frontmatter?.created_at as string | undefined;
    if (created) {
      const ageDays = (Date.now() - new Date(created).getTime()) / (1000 * 60 * 60 * 24);
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

export async function fullTextSearch(query: string, options: FullTextOptions = {}): Promise<FullTextResult[]> {
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

      results.push({ filePath, score: matchScore, lineNumber: i + 1, excerpt });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}
