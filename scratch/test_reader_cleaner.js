function cleanHtmlArticle(rawHtml, baseUrl = '') {
  if (!rawHtml) return '';

  let s = rawHtml;

  // 1. Remove all HTML comments first (prevents premature tag closing)
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // 2. Remove non-content structural elements completely
  const tagsToRemove = [
    'script', 'style', 'noscript', 'iframe', 'object', 'embed', 'svg', 'canvas',
    'audio', 'video', 'form', 'header', 'footer', 'nav', 'template', 'aside'
  ];
  for (const tag of tagsToRemove) {
    const reg = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi');
    s = s.replace(reg, ' ');
  }

  // 3. Remove Wikipedia & CMS junk blocks (infoboxes, navboxes, sidebars, TOC, edit links, references)
  s = s.replace(/<table\b[^>]*class=["'][^"']*(?:infobox|navbox|sidebar|vertical-navbox|metadata|vcard|nowraplinks)[^"']*["'][\s\S]*?<\/table>/gi, ' ');
  s = s.replace(/<div\b[^>]*class=["'][^"']*(?:infobox|navbox|sidebar|shortdescription|mw-editsection|toc|catlinks|thumb|tright|tleft|noprint|searchaux|hatnote|dablink|reference-list|reflist|cookie-banner|ad-|banner)[^"']*["'][\s\S]*?<\/div>/gi, ' ');
  s = s.replace(/<div\b[^>]*id=["'](?:toc|mw-navigation|siteSub|contentSub|jump-to-nav|cookie-banner)[^"']*["'][\s\S]*?<\/div>/gi, ' ');
  s = s.replace(/<sup\b[^>]*class=["'](?:reference|noprint)[^"']*["'][\s\S]*?<\/sup>/gi, ' ');
  s = s.replace(/<span\b[^>]*class=["']mw-editsection["'][\s\S]*?<\/span>/gi, ' ');

  // 4. Extract main content container if available
  let mainContent = s;
  const mainContainers = [
    /<article\b[\s\S]*?<\/article>/i,
    /<div\b[^>]*id=["']mw-content-text["'][\s\S]*?<\/div>\s*<\/div>/i,
    /<div\b[^>]*class=["'][^"']*(?:mw-parser-output|entry-content|post-content|article-content|article-body|story-body|prose|nhsuk-u-reading-width)[^"']*["'][\s\S]*?<\/div>/i,
    /<main\b[\s\S]*?<\/main>/i
  ];
  for (const pattern of mainContainers) {
    const m = s.match(pattern);
    if (m && m[0].length > 300) {
      mainContent = m[0];
      break;
    }
  }

  // 5. Clean out all complex attributes and data-* JSON attributes from tags
  mainContent = mainContent.replace(/<([a-z1-6]+)\b([^>]*)>/gi, (match, tag, attrs) => {
    tag = tag.toLowerCase();
    if (tag === 'a') {
      const hrefMatch = attrs.match(/href=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      let rawHref = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || hrefMatch[3]) : '';
      if (rawHref && !/^(?:javascript|data):/i.test(rawHref)) {
        if (baseUrl && !/^https?:\/\//i.test(rawHref) && !rawHref.startsWith('#')) {
          try { rawHref = new URL(rawHref, baseUrl).toString(); } catch (_) {}
        }
        return `<a href="${rawHref}" target="_blank" rel="noopener noreferrer">`;
      }
      return '<a>';
    }
    return `<${tag}>`;
  });

  // 6. Extract semantic blocks (headings, paragraphs, lists, quotes)
  const blockRegex = /<(h[1-4]|p|ul|ol|blockquote)>([\s\S]*?)<\/\1>/gi;
  const blocks = [];
  let blockMatch;

  while ((blockMatch = blockRegex.exec(mainContent)) !== null) {
    const tag = blockMatch[1].toLowerCase();
    let inner = blockMatch[2];

    // Remove footnote/cite links
    inner = inner.replace(/<a\b[^>]*href=["']#(?:cite_note|cite_ref|CITEREF)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, '');
    // Remove internal tags except inline formatting (a, strong, em, b, i, code)
    inner = inner.replace(/<(?!\/?(a|strong|em|b|i|code)\b)[^>]+>/gi, ' ');
    // Clean citation markers like [1], [2], [edit], [citation needed]
    inner = inner.replace(/\[\s*\d+\s*\]/g, '');
    inner = inner.replace(/\[\s*(?:edit|citation needed)\s*\]/gi, '');
    // Clean remaining JSON / wikitext residue
    inner = inner.replace(/\{\{[^}]*\}\}/g, '');
    inner = inner.replace(/\{"[^}]*"\}/g, '');
    inner = inner.replace(/&quot;\w+&quot;:\s*\{[^}]*\}/g, '');
    // Normalize whitespace
    inner = inner.replace(/\s+/g, ' ').trim();

    if (!inner) continue;

    if (tag.startsWith('h')) {
      // Heading
      if (inner.length > 2 && inner.length < 150 && !/^(References|See also|External links|Notes|Bibliography|Further reading|Navigation menu)$/i.test(inner)) {
        blocks.push(`<${tag}>${inner}</${tag}>`);
      }
    } else if (tag === 'p') {
      // Paragraph: ignore boilerplate lines and noise
      if (inner.length >= 20 && !inner.startsWith('Coordinates:')) {
        blocks.push(`<p>${inner}</p>`);
      }
    } else if (tag === 'blockquote') {
      blocks.push(`<blockquote><p>${inner}</p></blockquote>`);
    } else if (tag === 'ul' || tag === 'ol') {
      // Extract list items
      const items = [];
      const liRegex = /<li>([\s\S]*?)<\/li>/gi;
      let liMatch;
      while ((liMatch = liRegex.exec(blockMatch[2])) !== null) {
        let liText = liMatch[1].replace(/<(?!\/?(a|strong|em|b|i)\b)[^>]+>/gi, ' ').replace(/\s+/g, ' ').trim();
        if (liText.length > 3 && liText.length < 300) items.push(`<li>${liText}</li>`);
      }
      if (items.length > 0 && items.length < 20) {
        blocks.push(`<${tag}>${items.join('')}</${tag}>`);
      }
    }
  }

  let result = blocks.join('\n\n');

  // Fallback if no structured blocks matched
  if (!result || result.length < 100) {
    let plain = mainContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    result = `<p>${plain.slice(0, 3000)}</p>`;
  }

  // Length cap for reader mode (~12,000 chars)
  if (result.length > 12000) {
    result = result.slice(0, 12000) + '... <p><em>[Content excerpt truncated for reader view]</em></p>';
  }

  return result.trim();
}

async function testAll() {
  console.log('Testing Wikipedia...');
  const res1 = await fetch('https://en.wikipedia.org/wiki/Alan_Turing', {
    headers: { 'User-Agent': 'TuringTutorWebResearch/1.0 (Educational Assistant; mailto:admin@southdevon.ac.uk)' }
  });
  const html1 = await res1.text();
  const cleaned1 = cleanHtmlArticle(html1, 'https://en.wikipedia.org/wiki/Alan_Turing');
  console.log('--- Wikipedia (First 800 chars) ---');
  console.log(cleaned1.slice(0, 800));

  console.log('\nTesting NHS Asthma...');
  const res2 = await fetch('https://www.nhs.uk/conditions/asthma/', {
    headers: { 'User-Agent': 'TuringTutorWebResearch/1.0 (Educational Assistant; mailto:admin@southdevon.ac.uk)' }
  });
  const html2 = await res2.text();
  const cleaned2 = cleanHtmlArticle(html2, 'https://www.nhs.uk/conditions/asthma/');
  console.log('--- NHS (First 800 chars) ---');
  console.log(cleaned2.slice(0, 800));
}

testAll().catch(console.error);
