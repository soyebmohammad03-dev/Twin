/** Whole-word (not substring), case-insensitive match — shared by the heuristic extraction provider and retrieval's query-entity detection so both use one exact definition of "this name appears in this text". */
export function containsWholeWord(haystackLower: string, needle: string): boolean {
  const escaped = needle.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
  return pattern.test(haystackLower);
}
