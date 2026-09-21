/** Keep the saved active branch, rather than mixing edited/regenerated alternatives. */
export function activeBranch<T extends { parent?: string | null }>(mapping: Record<string, T>, currentNode: unknown): Record<string, T> {
  if (typeof currentNode !== 'string' || !mapping[currentNode]) {
    throw new Error('Cannot identify the current conversation branch. Reopen the chat and try again.');
  }
  const path: [string, T][] = [];
  const seen = new Set<string>();
  let id: string | null | undefined = currentNode;
  while (id) {
    if (seen.has(id) || !mapping[id]) throw new Error('The conversation branch is incomplete. Please reload the chat.');
    seen.add(id);
    const node: T = mapping[id];
    path.push([id, node]);
    id = node.parent;
  }
  return Object.fromEntries(path.reverse());
}
