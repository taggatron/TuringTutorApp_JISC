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

function parseScholarResults(html, scholarUrl) {
  let queryTerm = '';
  try {
    const u = new URL(scholarUrl);
    queryTerm = decodeURIComponent(u.searchParams.get('q') || '');
  } catch (_) {}

  const resultCards = [];
  const cardRegex = /<div\b[^>]*class=["'][^"']*\bgs_r\b[^"']*["'][\s\S]*?(?=<div\b[^>]*class=["'][^"']*\bgs_r\b[^"']*["']|<div\b[^>]*id=["']gs_res_ccl_bot["']|$)/gi;
  
  let match;
  while ((match = cardRegex.exec(html)) !== null) {
    const cardHtml = match[0];

    const titleMatch = cardHtml.match(/<h3\b[^>]*class=["'][^"']*\bgs_rt\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i);
    if (!titleMatch) continue;

    let rawTitle = titleMatch[1];
    const hrefMatch = rawTitle.match(/href=["']([^"']+)["']/i);
    let paperUrl = hrefMatch ? hrefMatch[1] : '';
    if (paperUrl.startsWith('/')) {
      paperUrl = 'https://scholar.google.com' + paperUrl;
    }

    let cleanTitle = rawTitle.replace(/<span\b[^>]*class=["'][^"']*gs_ct[12]["'][^>]*>[\s\S]*?<\/span>/gi, '')
                             .replace(/<(?!\/?(b|strong|em)\b)[^>]+>/gi, ' ');
    cleanTitle = decodeHtmlEntities(cleanTitle).replace(/\s+/g, ' ').trim();

    const authorMatch = cardHtml.match(/<div\b[^>]*class=["'][^"']*\bgs_a\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    let authorText = authorMatch ? decodeHtmlEntities(authorMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';

    const snippetMatch = cardHtml.match(/<div\b[^>]*class=["'][^"']*\bgs_rs\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    let snippetText = snippetMatch ? decodeHtmlEntities(snippetMatch[1].replace(/<(?!\/?(b|strong|em)\b)[^>]+>/gi, ' ')).replace(/\s+/g, ' ').trim() : '';

    const pdfMatch = cardHtml.match(/<div\b[^>]*class=["'][^"']*\bgs_or_ggsm\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    let pdfUrl = pdfMatch ? pdfMatch[1] : '';
    let pdfLabel = pdfMatch ? decodeHtmlEntities(pdfMatch[2].replace(/<[^>]+>/g, '')).trim() : '';

    const citedMatch = cardHtml.match(/<a\b[^>]*href=["'][^"']*cites=[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    let citedText = citedMatch ? decodeHtmlEntities(citedMatch[1].replace(/<[^>]+>/g, '')).trim() : '';

    if (cleanTitle && cleanTitle.length > 3) {
      resultCards.push({
        title: cleanTitle,
        url: paperUrl || scholarUrl,
        authorText,
        snippetText,
        pdfUrl,
        pdfLabel,
        citedText
      });
    }
  }

  if (resultCards.length === 0) return null;

  const headerHtml = `
    <div class="scholar-header-banner">
      <div class="scholar-header-tag">Google Scholar Research Index</div>
      <div class="scholar-header-query">Showing peer-reviewed academic papers for: <em>"${queryTerm || 'Search Query'}"</em></div>
    </div>
  `;

  const itemsHtml = resultCards.map((card) => {
    let domainStr = '';
    try {
      if (card.url && card.url.startsWith('http')) {
        domainStr = new URL(card.url).hostname.replace(/^www\./, '');
      }
    } catch (_) {}

    return `
      <div class="scholar-paper-card">
        <div class="scholar-card-top">
          <span class="scholar-source-badge">
            📄 Academic Paper ${domainStr ? `· ${domainStr}` : ''}
          </span>
          ${card.citedText ? `<span class="scholar-cited-badge">⭐ ${card.citedText}</span>` : ''}
        </div>

        <h3 class="scholar-card-title">
          <a href="${card.url}" target="_blank" rel="noopener noreferrer">
            ${card.title}
          </a>
        </h3>

        ${card.authorText ? `<div class="scholar-card-authors">${card.authorText}</div>` : ''}

        ${card.snippetText ? `<p class="scholar-card-snippet">${card.snippetText}</p>` : ''}

        <div class="scholar-card-actions">
          ${card.url && card.url !== scholarUrl ? `
            <a href="${card.url}" target="_blank" rel="noopener noreferrer" class="scholar-btn-primary">
              Read Full Paper ↗
            </a>
          ` : ''}
          ${card.pdfUrl ? `
            <a href="${card.pdfUrl}" target="_blank" rel="noopener noreferrer" class="scholar-btn-pdf">
              📥 ${card.pdfLabel || 'Download PDF'}
            </a>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  return headerHtml + itemsHtml;
}

async function runTest() {
  const url = 'https://scholar.google.com/scholar?q=Higher%20Education%20AI%20assessment%20academic%20integrity%20JISC';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  const html = await res.text();
  const parsed = parseScholarResults(html, url);
  console.log('--- Parsed Output Sample (first 1200 chars) ---');
  console.log(parsed.slice(0, 1200));
}

runTest().catch(console.error);
