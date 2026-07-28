import { describe, it, expect } from 'vitest';
import {
  parseCatalog,
  parseEntry,
  buildLineage,
  traverseLineage,
  buildManifest,
  searchEntries,
  buildFacets,
  type CatalogFile,
} from '../../../src/catalog';

const SOURCE = `---
kind: source
id: events_silver.chat_sent
title: Chat Sent
domain: chat
status: certified
owner: data-platform
connection: snowflake-prod
fqn: analytics-platform.events_silver.chat_sent
tags: [tier.silver, PII.None, domain.chat]
terms: [active-user]
upstream: [warehouse.clustered_events]
downstream: [pipelines.chat_metrics]
aspects: [quality]
last_updated: 2026-06-30
---

# Chat Sent

External source feeding the metrics pipeline.`;

const DATASET = `---
kind: dataset
id: art_5d2e74a1.daily_metrics
title: Daily Metrics
domain: growth
status: draft
artifact: art_5d2e74a1
store: table:daily_metrics
tags: [tier.gold]
upstream: [events_silver.chat_sent]
last_updated: 2026-06-30
---

Artifact-native dataset built from chat_sent.`;

const TERM = `---
kind: term
id: active-user
title: Active User
---

A user active in the trailing 24h window.`;

function files(): CatalogFile[] {
  return [
    { path: 'chat_sent.md', content: SOURCE },
    { path: 'daily_metrics.md', content: DATASET },
    { path: 'glossary/active-user.md', content: TERM },
  ];
}

describe('parseEntry', () => {
  it('parses required core plus optional fields and arrays', () => {
    const { entry, issue } = parseEntry('chat_sent.md', SOURCE);
    expect(issue).toBeUndefined();
    expect(entry).toMatchObject({
      kind: 'source',
      id: 'events_silver.chat_sent',
      title: 'Chat Sent',
      domain: 'chat',
      status: 'certified',
      owner: 'data-platform',
      connection: 'snowflake-prod',
      tags: ['tier.silver', 'PII.None', 'domain.chat'],
      terms: ['active-user'],
      upstream: ['warehouse.clustered_events'],
      downstream: ['pipelines.chat_metrics'],
      aspects: ['quality'],
      lastUpdated: '2026-06-30',
    });
    expect(entry?.body.startsWith('# Chat Sent')).toBe(true);
  });

  it('accepts a minimal entry with only the required core', () => {
    const { entry, issue } = parseEntry('x.md', '---\nkind: metric\nid: m1\ntitle: M\n---\n');
    expect(issue).toBeUndefined();
    expect(entry).toMatchObject({ kind: 'metric', id: 'm1', title: 'M', tags: [], upstream: [] });
  });

  it('accepts the event kind (raw analytics events)', () => {
    const { entry, issue } = parseEntry('e.md', '---\nkind: event\nid: ev1\ntitle: chat_sent\n---');
    expect(issue).toBeUndefined();
    expect(entry?.kind).toBe('event');
  });

  it('rejects missing required fields', () => {
    expect(parseEntry('x.md', '---\nid: a\ntitle: B\n---').issue?.message).toContain('kind');
    expect(parseEntry('x.md', '---\nkind: table\ntitle: B\n---').issue?.message).toContain('id');
    expect(parseEntry('x.md', '---\nkind: table\nid: a\n---').issue?.message).toContain('title');
  });

  it('rejects unknown kind and status', () => {
    expect(parseEntry('x.md', '---\nkind: wat\nid: a\ntitle: B\n---').issue?.message).toContain('kind');
    expect(
      parseEntry('x.md', '---\nkind: table\nid: a\ntitle: B\nstatus: nope\n---').issue?.message
    ).toContain('status');
  });

  it('rejects missing frontmatter', () => {
    expect(parseEntry('x.md', 'no frontmatter here').issue?.message).toContain('frontmatter');
  });

  it('preserves unknown frontmatter keys in extra', () => {
    const { entry } = parseEntry('x.md', '---\nkind: table\nid: a\ntitle: B\ncustom_field: 7\n---');
    expect(entry?.extra).toEqual({ custom_field: 7 });
  });
});

describe('parseCatalog', () => {
  it('parses all entries and skips non-markdown', () => {
    const { entries, issues } = parseCatalog([
      ...files(),
      { path: 'manifest.yaml', content: 'type: manifest' },
    ]);
    expect(entries).toHaveLength(3);
    expect(issues).toHaveLength(0);
  });

  it('isolates a file with malformed YAML as an issue without breaking the load', () => {
    const { entries, issues } = parseCatalog([
      { path: 'good.md', content: SOURCE },
      // empty inline list nested into a flow list — invalid YAML, the real acme case
      { path: 'bad.md', content: '---\nkind: table\nid: b\ntitle: B\ndownstream: [pipeline.[]]\n---\nx' },
    ]);
    expect(entries.map(e => e.id)).toEqual(['events_silver.chat_sent']);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('bad.md');
  });

  it('flags duplicate ids', () => {
    const { entries, issues } = parseCatalog([
      { path: 'a.md', content: SOURCE },
      { path: 'b.md', content: SOURCE },
    ]);
    expect(entries).toHaveLength(1);
    expect(issues[0].message).toContain('duplicate id');
  });
});

describe('buildLineage', () => {
  it('builds cross-plane edges and marks missing nodes absent', () => {
    const { entries } = parseCatalog(files());
    const g = buildLineage(entries);
    expect(g.edges).toContainEqual({ from: 'events_silver.chat_sent', to: 'art_5d2e74a1.daily_metrics' });
    expect(g.edges).toContainEqual({ from: 'warehouse.clustered_events', to: 'events_silver.chat_sent' });
    const present = g.nodes.find(n => n.id === 'events_silver.chat_sent');
    const absent = g.nodes.find(n => n.id === 'warehouse.clustered_events');
    expect(present?.present).toBe(true);
    expect(absent?.present).toBe(false);
  });
});

describe('traverseLineage', () => {
  it('walks downstream and upstream', () => {
    const { entries } = parseCatalog(files());
    expect(traverseLineage(entries, 'events_silver.chat_sent', 'downstream')).toContain(
      'art_5d2e74a1.daily_metrics'
    );
    expect(traverseLineage(entries, 'art_5d2e74a1.daily_metrics', 'upstream')).toContain(
      'events_silver.chat_sent'
    );
  });
});

describe('buildManifest', () => {
  it('computes counts, kpis, orphans and dangling refs', () => {
    const { entries } = parseCatalog(files());
    const m = buildManifest(entries, { nowMs: Date.parse('2026-07-01T00:00:00Z') });
    expect(m.counts.entries).toBe(3);
    expect(m.counts.byKind).toMatchObject({ source: 1, dataset: 1, term: 1 });
    expect(m.kpis.documentedPct).toBe(100);
    expect(m.kpis.certifiedPct).toBe(50);
    expect(m.dangling).toContain('warehouse.clustered_events');
    expect(m.dangling).toContain('pipelines.chat_metrics');
    expect(m.orphans).toHaveLength(0);
  });

  it('flags stale entries past the window', () => {
    const { entries } = parseCatalog(files());
    const m = buildManifest(entries, { nowMs: Date.parse('2026-12-31T00:00:00Z'), staleDays: 90 });
    expect(m.stale.length).toBeGreaterThan(0);
  });

  it('flags entries with no lineage as orphans (terms excluded)', () => {
    const { entries } = parseCatalog([
      { path: 'lonely.md', content: '---\nkind: table\nid: lonely\ntitle: Lonely\n---' },
      { path: 'glossary/active-user.md', content: TERM },
    ]);
    const m = buildManifest(entries, { nowMs: Date.now() });
    expect(m.orphans).toEqual(['lonely']);
  });
});

describe('searchEntries + buildFacets', () => {
  it('filters by facet and free text', () => {
    const { entries } = parseCatalog(files());
    expect(searchEntries(entries, { kind: 'source' })).toHaveLength(1);
    expect(searchEntries(entries, { status: 'draft' })).toHaveLength(1);
    expect(searchEntries(entries, { tag: 'tier.gold' })).toHaveLength(1);
    expect(searchEntries(entries, { q: 'pipeline' }).map(e => e.id)).toContain('events_silver.chat_sent');
    expect(searchEntries(entries, { domain: 'growth', q: 'chat_sent' })).toHaveLength(1);
  });

  it('tallies facet values by frequency', () => {
    const { entries } = parseCatalog(files());
    const facets = buildFacets(entries);
    expect(facets.kind.map(f => f.value).sort()).toEqual(['dataset', 'source', 'term']);
    expect(facets.status).toContainEqual({ value: 'certified', count: 1 });
    expect(facets.tag.find(f => f.value === 'tier.silver')?.count).toBe(1);
  });
});
