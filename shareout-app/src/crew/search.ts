import type { Env } from '../types';

// Web-search provider, swappable. DuckDuckGo needs no key (default); set
// BRAVE_SEARCH_API_KEY to upgrade to Brave's JSON API. Add other keyed
// providers here without touching the web_search tool.

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, limit: number): Promise<SearchResult[]>;
}

interface DdgRelatedTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DdgRelatedTopic[];
}

/**
 * No-key default: DuckDuckGo's Instant Answer API. Returns the entity abstract
 * plus related topics — useful for facts/entities, but it does NOT do broad web
 * results (those need a keyed provider). Degrades to an empty list rather than
 * failing, so the model learns "nothing found" and can say so.
 */
class DuckDuckGoProvider implements SearchProvider {
  readonly name = 'duckduckgo';

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const url =
      'https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&t=shareout&q=' +
      encodeURIComponent(query);
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'ShareOut-Crew/1.0' } });
    if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
    const d = (await res.json()) as {
      Heading?: string;
      AbstractText?: string;
      AbstractURL?: string;
      RelatedTopics?: DdgRelatedTopic[];
    };

    const results: SearchResult[] = [];
    if (d.AbstractText && d.AbstractURL) {
      results.push({ title: d.Heading || query, url: d.AbstractURL, snippet: d.AbstractText });
    }
    const walk = (topics: DdgRelatedTopic[]) => {
      for (const t of topics) {
        if (results.length >= limit) return;
        if (t.Topics) walk(t.Topics);
        else if (t.Text && t.FirstURL) results.push({ title: t.Text.split(' - ')[0], url: t.FirstURL, snippet: t.Text });
      }
    };
    if (Array.isArray(d.RelatedTopics)) walk(d.RelatedTopics);
    return results.slice(0, limit);
  }
}

/** Keyed upgrade — Brave Search JSON API. Used when BRAVE_SEARCH_API_KEY is set. */
class BraveProvider implements SearchProvider {
  readonly name = 'brave';
  constructor(private key: string) {}

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const url = `https://api.search.brave.com/res/v1/web/search?count=${Math.min(limit, 20)}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': this.key },
    });
    if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
    const data = (await res.json()) as {
      web?: { results?: Array<{ title: string; url: string; description?: string }> };
    };
    return (data.web?.results || [])
      .slice(0, limit)
      .map((r) => ({ title: r.title, url: r.url, snippet: r.description || '' }));
  }
}

export function getSearchProvider(env: Env): SearchProvider {
  if (env.BRAVE_SEARCH_API_KEY) return new BraveProvider(env.BRAVE_SEARCH_API_KEY);
  return new DuckDuckGoProvider();
}
