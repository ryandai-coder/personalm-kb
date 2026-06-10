export { readNote, readRaw, readNotes, listNotes, noteExists, vaultAbsolute, vaultRelative } from "./reader";
export { writeNote, writeTemplatedNote, removeLines, generateNoteId, buildFrontmatter } from "./writer";
export { searchVault, fullTextSearch, semanticSearch } from "./search";
export { embed, embedNote, syncEmbeddings, reindexAll, loadEmbeddingCache, saveEmbeddingCache, cosineSimilarity } from "./embeddings";
