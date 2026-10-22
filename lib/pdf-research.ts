/** Expose saved Deep Research reports as ordinary messages for PDF export.
 * Call only after active-branch selection. Never export arbitrary widget state.
 */
export function withResearchReports<T extends { message?: unknown }>(mapping: Record<string, T>): Record<string, T> {
  const record = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const reportFor = (node: T): Record<string, unknown> | undefined => {
    const message = record(node.message);
    const sdk = record(record(message?.metadata)?.chatgpt_sdk);
    if (typeof sdk?.widget_state !== 'string') return;
    let state: unknown;
    try { state = JSON.parse(sdk.widget_state); } catch { return; }
    const report = record(record(state)?.report_message);
    const content = record(report?.content);
    if (record(report?.author)?.role !== 'assistant' || content?.content_type !== 'text'
      || !Array.isArray(content.parts) || !content.parts.every(part => typeof part === 'string')
      || !content.parts.some(part => part.trim())) return;
    return report;
  };
  const seenIds = new Set<string>();
  const seenText = new Set<string>();
  const textOf = (message: Record<string, unknown>) => {
    const parts = record(message.content)?.parts;
    return Array.isArray(parts) && parts.every(part => typeof part === 'string') ? parts.join('\n\n') : undefined;
  };
  // Reports already present as normal assistant messages must not be duplicated.
  for (const node of Object.values(mapping)) {
    const message = record(node.message);
    if (record(message?.author)?.role !== 'assistant') continue;
    if (typeof message?.id === 'string') seenIds.add(message.id);
    const text = message && textOf(message);
    if (text) seenText.add(text);
  }
  const result: Record<string, T> = {};
  for (const [key, node] of Object.entries(mapping)) {
    result[key] = node;
    const report = reportFor(node);
    if (!report) continue;
    const text = textOf(report)!;
    if ((typeof report.id === 'string' && seenIds.has(report.id)) || seenText.has(text)) continue;
    if (typeof report.id === 'string') seenIds.add(report.id);
    seenText.add(text);
    let reportKey = `${key}:research-report`;
    while (reportKey in mapping || reportKey in result) reportKey += ':';
    result[reportKey] = { ...node, message: report };
  }
  return result;
}
