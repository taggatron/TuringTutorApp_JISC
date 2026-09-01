/**
 * Web Search Service (Phase 1)
 *
 * Encapsulated search provider for student-directed research queries.
 *
 * FUTURE EXTENSION POINT (Phase 2):
 * When integrating Azure OpenAI Responses API `web_search` or Bing Grounding,
 * replace or extend `searchWeb(query)` to delegate to the Azure grounding client
 * while returning the identical standardized result schema:
 * {
 *   query: string,
 *   results: Array<{ title: string, url: string, domain: string, snippet: string }>
 * }
 */

export async function searchWeb(query, limit = 8) {
  if (!query || typeof query !== 'string') {
    return { query: '', results: [] };
  }

  const cleanQuery = query.trim().slice(0, 300);
  if (!cleanQuery) return { query: '', results: [] };

  try {
    // Phase 1 Search Provider:
    // Query Wikipedia & open academic knowledge endpoints + DuckDuckGo Instant Answers
    // to provide high-quality educational and web search results.
    const results = [];

    // 1. Wikipedia API Search for Academic/Educational concepts
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(cleanQuery)}&limit=${limit}&namespace=0&format=json`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      const wikiRes = await fetch(wikiUrl, {
        headers: { 'User-Agent': 'TuringTutor/1.0 (Academic Research Assistant; JISC/SDC)' },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (wikiRes.ok) {
        const [, titles, snippets, urls] = await wikiRes.json();
        if (Array.isArray(titles)) {
          for (let i = 0; i < titles.length; i++) {
            if (urls[i] && titles[i]) {
              results.push({
                title: titles[i],
                url: urls[i],
                domain: 'en.wikipedia.org',
                snippet: snippets[i] || `Educational resource on ${titles[i]} from Wikipedia.`
              });
            }
          }
        }
      }
    } catch (wikiErr) {
      console.debug('[WebSearch] Wikipedia query error:', wikiErr && wikiErr.message ? wikiErr.message : wikiErr);
    }

    // 2. Open Search / DuckDuckGo Instant Answer API for General Web Grounding
    try {
      const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_html=1&skip_disambig=1`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      const ddgRes = await fetch(ddgUrl, {
        headers: { 'User-Agent': 'TuringTutor/1.0 (Academic Research Assistant; JISC/SDC)' },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (ddgRes.ok) {
        const ddgData = await ddgRes.json();
        if (ddgData.AbstractURL && ddgData.Heading) {
          const domain = safeDomain(ddgData.AbstractURL);
          // Only add if not already in results
          if (!results.some(r => r.url === ddgData.AbstractURL)) {
            results.unshift({
              title: ddgData.Heading,
              url: ddgData.AbstractURL,
              domain: domain || 'web',
              snippet: ddgData.AbstractText || ddgData.Abstract || 'Summary from reference source.'
            });
          }
        }

        // Related topics
        if (Array.isArray(ddgData.RelatedTopics)) {
          for (const topic of ddgData.RelatedTopics) {
            if (topic.FirstURL && topic.Text) {
              if (!results.some(r => r.url === topic.FirstURL) && results.length < limit) {
                results.push({
                  title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 60),
                  url: topic.FirstURL,
                  domain: safeDomain(topic.FirstURL),
                  snippet: topic.Text
                });
              }
            }
          }
        }
      }
    } catch (ddgErr) {
      console.debug('[WebSearch] DDG query error:', ddgErr && ddgErr.message ? ddgErr.message : ddgErr);
    }

    // If no direct results were found from API endpoints, generate fallback search navigation targets
    if (results.length === 0) {
      results.push(
        {
          title: `Search: "${cleanQuery}" on PubMed (Biomedical & Life Sciences)`,
          url: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(cleanQuery)}`,
          domain: 'pubmed.ncbi.nlm.nih.gov',
          snippet: `Search peer-reviewed medical and scientific literature for "${cleanQuery}".`
        },
        {
          title: `Search: "${cleanQuery}" on NHS Health A to Z`,
          url: `https://www.nhs.uk/search/results?q=${encodeURIComponent(cleanQuery)}`,
          domain: 'nhs.uk',
          snippet: `Search NHS clinical guidance, conditions, tests, and treatments for "${cleanQuery}".`
        },
        {
          title: `Search: "${cleanQuery}" on Google Scholar`,
          url: `https://scholar.google.com/scholar?q=${encodeURIComponent(cleanQuery)}`,
          domain: 'scholar.google.com',
          snippet: `Search scholarly articles, theses, books, and conference papers for "${cleanQuery}".`
        }
      );
    }

    return {
      query: cleanQuery,
      results: results.slice(0, limit)
    };
  } catch (err) {
    console.error('[WebSearch] Error executing web search:', err);
    return {
      query: cleanQuery,
      results: []
    };
  }
}

function safeDomain(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch (_) {
    return 'web';
  }
}
