function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (match, dec) => {
      try { return String.fromCharCode(parseInt(dec, 10)); } catch (_) { return ''; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      try { return String.fromCharCode(parseInt(hex, 16)); } catch (_) { return ''; }
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function parsePubMedResults(html, pubmedUrl) {
  let queryTerm = '';
  try {
    const u = new URL(pubmedUrl);
    queryTerm = decodeURIComponent(u.searchParams.get('term') || u.searchParams.get('q') || '');
  } catch (_) {}

  const resultCards = [];
  // Match each docsum-content or docsum-wrap
  const cardRegex = /<div\b[^>]*class=["'][^"']*\bdocsum-wrap\b[^"']*["'][\s\S]*?(?=<div\b[^>]*class=["'][^"']*\bdocsum-wrap\b[^"']*["']|<div\b[^>]*class=["'][^"']*\bpagination-bar\b[^"']*["']|$)/gi;

  let match;
  while ((match = cardRegex.exec(html)) !== null) {
    const cardHtml = match[0];

    // Extract Title & Link
    const titleMatch = cardHtml.match(/<a\b[^>]*class=["'][^"']*\bdocsum-title\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;

    let rawHref = titleMatch[1];
    let paperUrl = rawHref;
    if (paperUrl.startsWith('/')) {
      paperUrl = 'https://pubmed.ncbi.nlm.nih.gov' + paperUrl;
    }

    let rawTitle = titleMatch[2];
    let cleanTitle = rawTitle.replace(/<(?!\/?(b|strong|em)\b)[^>]+>/gi, ' ');
    cleanTitle = decodeHtmlEntities(cleanTitle).replace(/\s+/g, ' ').trim();

    // Extract Authors
    const authorMatch = cardHtml.match(/<span\b[^>]*class=["'][^"']*\bfull-authors\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
                        cardHtml.match(/<span\b[^>]*class=["'][^"']*\bdocsum-authors\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    let authorText = authorMatch ? decodeHtmlEntities(authorMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';

    // Extract Journal Citation & Year
    const journalMatch = cardHtml.match(/<span\b[^>]*class=["'][^"']*\bfull-journal-citation\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
                         cardHtml.match(/<span\b[^>]*class=["'][^"']*\bdocsum-journal-citation\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    let journalText = journalMatch ? decodeHtmlEntities(journalMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';

    // Extract PMID
    const pmidMatch = cardHtml.match(/<span\b[^>]*class=["'][^"']*\bdocsum-pmid\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
                      cardHtml.match(/PMID:\s*<span[^>]*>(\d+)<\/span>/i) ||
                      paperUrl.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i);
    let pmid = pmidMatch ? pmidMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // Extract Free Resource / PMC badge
    const freeMatch = cardHtml.match(/<span\b[^>]*class=["'][^"']*\bfree-resources\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    let freeBadge = freeMatch ? decodeHtmlEntities(freeMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';

    // Extract Snippet / Abstract preview
    const snippetMatch = cardHtml.match(/<div\b[^>]*class=["'][^"']*(?:full-view-snippet|docsum-snippet|short-view-snippet)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    let snippetText = snippetMatch ? decodeHtmlEntities(snippetMatch[1].replace(/<(?!\/?(b|strong|em)\b)[^>]+>/gi, ' ')).replace(/\s+/g, ' ').trim() : '';

    if (cleanTitle && cleanTitle.length > 3) {
      resultCards.push({
        title: cleanTitle,
        url: paperUrl,
        authorText,
        journalText,
        pmid,
        freeBadge,
        snippetText
      });
    }
  }

  if (resultCards.length === 0) return null;

  const headerHtml = `
    <div class="pubmed-header-banner">
      <div class="pubmed-header-tag">PubMed Biomedical & Clinical Index</div>
      <div class="pubmed-header-query">Showing peer-reviewed clinical & life sciences literature for: <em>"${escapeHtmlAttr(queryTerm || 'Search Query')}"</em></div>
    </div>
  `;

  const itemsHtml = resultCards.map((card) => {
    return `
      <div class="pubmed-paper-card">
        <div class="pubmed-card-top">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="pubmed-source-badge">
              🏥 PubMed · NIH / NLM
            </span>
            ${card.pmid ? `<span class="pubmed-pmid-badge">PMID: ${escapeHtmlAttr(card.pmid)}</span>` : ''}
          </div>
          ${card.freeBadge ? `<span class="pubmed-free-badge">✓ ${escapeHtmlAttr(card.freeBadge)}</span>` : ''}
        </div>

        <h3 class="pubmed-card-title">
          <a href="${escapeHtmlAttr(card.url)}" target="_blank" rel="noopener noreferrer">
            ${card.title}
          </a>
        </h3>

        ${card.authorText ? `<div class="pubmed-card-authors">${escapeHtmlAttr(card.authorText)}</div>` : ''}
        ${card.journalText ? `<div class="pubmed-card-journal">${escapeHtmlAttr(card.journalText)}</div>` : ''}

        ${card.snippetText ? `<p class="pubmed-card-snippet">${card.snippetText}</p>` : ''}

        <div class="pubmed-card-actions">
          <a href="${escapeHtmlAttr(card.url)}" target="_blank" rel="noopener noreferrer" class="pubmed-btn-primary">
            View on PubMed ↗
          </a>
          <a href="https://scholar.google.com/scholar?q=${encodeURIComponent(card.title.replace(/<[^>]+>/g, ''))}" target="_blank" rel="noopener noreferrer" class="pubmed-btn-secondary">
            Search on Google Scholar ↗
          </a>
        </div>
      </div>
    `;
  }).join('');

  return headerHtml + itemsHtml;
}

function escapeHtmlAttr(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function runTest() {
  const url = 'https://pubmed.ncbi.nlm.nih.gov/?term=NICE%20guidelines%20asthma%20management';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  const html = await res.text();
  const parsed = parsePubMedResults(html, url);
  console.log('Result length:', parsed?.length);
  console.log('--- Sample Parsed PubMed Output (first 1200 chars) ---');
  console.log(parsed.slice(0, 1200));
}

runTest().catch(console.error);
