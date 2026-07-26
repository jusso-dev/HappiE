export type SourceItem = {
  url: string;
  title?: string;
  external_id?: string;
  index: number;
};

export function selectSourceItems(
  items: SourceItem[],
  lastSeenExternalId: string,
  limit: number,
) {
  if (!lastSeenExternalId) {
    const selected = items.slice(0, limit);
    return { items: selected, observedExternalId: selected[0]?.external_id };
  }
  const anchorIndex = items.findIndex((item) => item.external_id === lastSeenExternalId);
  if (anchorIndex < 0) {
    const selected = items.slice(0, limit);
    return { items: selected, observedExternalId: selected[0]?.external_id };
  }
  const discovered = items.slice(0, anchorIndex);
  const selected = discovered.slice(-limit);
  return {
    items: selected,
    observedExternalId: selected[0]?.external_id || lastSeenExternalId,
  };
}
