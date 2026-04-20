import type { DocumentLabelReference } from "../app/markdown/labels";
import type { BibStore } from "./bibtex-parser";
import type { CitationBacklink, CitationCluster } from "./csl-processor";

export function collectCitationClusters(
  references: readonly DocumentLabelReference[],
  store: BibStore,
): CitationCluster[] {
  const clusters = new Map<string, DocumentLabelReference[]>();

  for (const reference of references) {
    if (!store.has(reference.id)) {
      continue;
    }
    const key = `${reference.clusterFrom}:${reference.clusterTo}`;
    const bucket = clusters.get(key) ?? [];
    bucket.push(reference);
    clusters.set(key, bucket);
  }

  return [...clusters.values()]
    .map((bucket) => [...bucket].sort((left, right) => left.clusterIndex - right.clusterIndex))
    .sort((left, right) => left[0].clusterFrom - right[0].clusterFrom)
    .map((bucket) => ({
      ids: bucket.map((reference) => reference.id),
      locators: bucket.map((reference) => reference.locator),
    }));
}

export function collectCitedIdsFromClusters(clusters: readonly CitationCluster[]): string[] {
  const seen = new Set<string>();
  const citedIds: string[] = [];

  for (const cluster of clusters) {
    for (const id of cluster.ids) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      citedIds.push(id);
    }
  }

  return citedIds;
}

export function collectCitationBacklinksFromReferences(
  references: readonly DocumentLabelReference[],
  store: BibStore,
): ReadonlyMap<string, readonly CitationBacklink[]> {
  const backlinks = new Map<string, CitationBacklink[]>();
  const buckets = new Map<string, DocumentLabelReference[]>();

  for (const reference of references) {
    if (!store.has(reference.id)) {
      continue;
    }
    const key = `${reference.clusterFrom}:${reference.clusterTo}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(reference);
    buckets.set(key, bucket);
  }

  let occurrence = 0;
  const orderedBuckets = [...buckets.values()]
    .map((bucket) => [...bucket].sort((left, right) => left.clusterIndex - right.clusterIndex))
    .sort((left, right) => left[0].clusterFrom - right[0].clusterFrom);

  for (const bucket of orderedBuckets) {
    occurrence += 1;
    const uniqueIds = bucket
      .map((reference) => reference.id)
      .filter((id, index, ids) => ids.indexOf(id) === index);

    const backlink: CitationBacklink = {
      occurrence,
      from: bucket[0].clusterFrom,
      to: bucket[0].clusterTo,
    };

    for (const id of uniqueIds) {
      const existing = backlinks.get(id);
      if (existing) {
        existing.push(backlink);
      } else {
        backlinks.set(id, [backlink]);
      }
    }
  }

  return backlinks;
}
