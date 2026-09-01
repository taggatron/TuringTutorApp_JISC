import dns from 'dns';
import net from 'net';

/**
 * Validates if an IP address is a private, loopback, link-local, or reserved address
 * to prevent Server-Side Request Forgery (SSRF).
 *
 * @param {string} ip - IP address to validate
 * @returns {boolean} - true if IP is safe/public, false if private/reserved
 */
export function isPublicIp(ip) {
  if (!ip || typeof ip !== 'string') return false;

  // IPv4 Check
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;

    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return false;
    // 10.0.0.0/8 (Private)
    if (parts[0] === 10) return false;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return false;
    // 169.254.0.0/16 (Link-local & Cloud Metadata e.g. 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return false;
    // 172.16.0.0/12 (Private 172.16.0.0 - 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    // 192.168.0.0/16 (Private)
    if (parts[0] === 192 && parts[1] === 168) return false;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return false;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return false;
    // 198.18.0.0/15 (Benchmarking)
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return false;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (parts[0] >= 224) return false;

    return true;
  }

  // IPv6 Check
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // Loopback (::1) or Unspecified (::)
    if (normalized === '::1' || normalized === '::') return false;
    // IPv4-mapped (::ffff:0:0/96)
    if (normalized.startsWith('::ffff:')) {
      const v4Part = normalized.substring(7);
      return isPublicIp(v4Part);
    }
    // Unique local (fc00::/7)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return false;
    // Link-local (fe80::/10)
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return false;
    // Multicast (ff00::/8)
    if (normalized.startsWith('ff')) return false;

    return true;
  }

  return false;
}

/**
 * Validates a target URL against SSRF attacks.
 *
 * @param {string} rawUrl - URL to validate
 * @returns {Promise<{ valid: boolean, parsedUrl?: URL, error?: string }>}
 */
export async function validateSafeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string' };
  }

  let formatted = rawUrl.trim();
  if (!/^https?:\/\//i.test(formatted)) {
    formatted = 'https://' + formatted;
  }

  let parsed;
  try {
    parsed = new URL(formatted);
  } catch (_) {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Whitelist only HTTP and HTTPS
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTP and HTTPS protocols are permitted' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and internal names
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.corp') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home') ||
    hostname === '0.0.0.0'
  ) {
    return { valid: false, error: 'Access to local or internal hostnames is restricted' };
  }

  // Resolve hostname DNS and verify IP
  try {
    const lookupRes = await dns.promises.lookup(hostname, { all: true });
    if (!lookupRes || lookupRes.length === 0) {
      return { valid: false, error: 'Could not resolve domain name' };
    }

    for (const record of lookupRes) {
      if (!isPublicIp(record.address)) {
        return { valid: false, error: 'Access to private or restricted network addresses is blocked' };
      }
    }
  } catch (dnsErr) {
    return { valid: false, error: `Domain resolution failed: ${dnsErr.message || 'Unknown DNS error'}` };
  }

  return { valid: true, parsedUrl: parsed };
}

/**
 * Fetches and extracts sanitized content and metadata from a web resource.
 *
 * @param {string} targetUrl - Web URL to scrape
 * @returns {Promise<{ success: boolean, resource?: object, error?: string }>}
 */
export async function fetchWebResource(targetUrl) {
  const urlCheck = await validateSafeUrl(targetUrl);
  if (!urlCheck.valid) {
    return { success: false, error: urlCheck.error };
  }

  let currentUrl = urlCheck.parsedUrl.toString();
  const maxRedirects = 3;
  let redirectCount = 0;
  let finalResponse = null;

  while (redirectCount <= maxRedirects) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

    try {
      const res = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'TuringTutor/1.0 (Academic Research Assistant; JISC/SDC; +https://turingtutor.ac.uk)',
          'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate'
        },
        redirect: 'manual',
        signal: controller.signal
      });

      clearTimeout(timeout);

      // Handle redirects with strict SSRF validation for each hop
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          return { success: false, error: 'Too many redirects' };
        }

        const location = res.headers.get('location');
        const nextUrl = new URL(location, currentUrl).toString();
        const nextCheck = await validateSafeUrl(nextUrl);
        if (!nextCheck.valid) {
          return { success: false, error: `Redirect to unsafe destination blocked: ${nextCheck.error}` };
        }

        currentUrl = nextUrl;
        continue;
      }

      if (!res.ok) {
        return { success: false, error: `Remote website responded with HTTP status ${res.status}` };
      }

      finalResponse = res;
      break;
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        return { success: false, error: 'Request timed out while connecting to the website' };
      }
      return { success: false, error: 'Unable to reach the specified URL' };
    }
  }

  if (!finalResponse) {
    return { success: false, error: 'Failed to retrieve response from website' };
  }

  // Validate Content-Type
  const contentType = (finalResponse.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !contentType.includes('text/plain')) {
    return {
      success: false,
      error: `Unsupported content type (${contentType.split(';')[0] || 'binary'}). Only HTML/web pages are supported.`
    };
  }

  // Check frame restriction headers
  const xfo = (finalResponse.headers.get('x-frame-options') || '').toUpperCase();
  const csp = (finalResponse.headers.get('content-security-policy') || '').toLowerCase();
  const cannotEmbed = xfo === 'DENY' || xfo === 'SAMEORIGIN' || csp.includes('frame-ancestors');

  // Read response body with size limit (max 2.5 MB)
  let rawBody = '';
  const maxBytes = 2.5 * 1024 * 1024;
  let receivedBytes = 0;

  try {
    const reader = finalResponse.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.length;
      if (receivedBytes > maxBytes) {
        rawBody += decoder.decode(value.slice(0, maxBytes - (receivedBytes - value.length)));
        break;
      }
      rawBody += decoder.decode(value, { stream: true });
    }
  } catch (readErr) {
    return { success: false, error: 'Error reading webpage response data' };
  }

  // Extract metadata and sanitized content
  const domain = new URL(currentUrl).hostname.replace(/^www\./, '');
  const title = extractTitle(rawBody, domain);
  const description = extractDescription(rawBody);
  const favicon = extractFavicon(rawBody, currentUrl);
  const sanitizedReaderHtml = extractSanitizedArticle(rawBody, currentUrl);

  return {
    success: true,
    resource: {
      title,
      url: currentUrl,
      domain,
      description,
      content: sanitizedReaderHtml,
      favicon,
      canEmbed: !cannotEmbed,
      dateAccessed: new Date().toISOString()
    }
  };
}

/**
 * Extracts page title from HTML.
 */
function extractTitle(html, fallbackDomain) {
  const ogMatch = html.match(/<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                  html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  if (ogMatch && ogMatch[1].trim()) return decodeHtmlEntities(ogMatch[1].trim());

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1].trim()) {
    const t = decodeHtmlEntities(titleMatch[1].replace(/<\/?[^>]+>/g, '').trim());
    return t.replace(/\s+/g, ' ');
  }

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match && h1Match[1].trim()) {
    return decodeHtmlEntities(h1Match[1].replace(/<\/?[^>]+>/g, '').trim()).slice(0, 120);
  }

  return `Resource from ${fallbackDomain}`;
}

/**
 * Extracts meta description from HTML.
 */
function extractDescription(html) {
  const ogDesc = html.match(/<meta\s+[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
                 html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
  if (ogDesc && ogDesc[1].trim()) return decodeHtmlEntities(ogDesc[1].trim()).slice(0, 300);

  const metaDesc = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                   html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
  if (metaDesc && metaDesc[1].trim()) return decodeHtmlEntities(metaDesc[1].trim()).slice(0, 300);

  return '';
}

/**
 * Extracts favicon URL from HTML.
 */
function extractFavicon(html, baseUrl) {
  const iconMatch = html.match(/<link\s+[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i) ||
                    html.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i);
  if (iconMatch && iconMatch[1]) {
    try {
      return new URL(iconMatch[1].trim(), baseUrl).toString();
    } catch (_) {}
  }
  try {
    return new URL('/favicon.ico', baseUrl).toString();
  } catch (_) {
    return '';
  }
}

/**
 * Extracts and sanitizes article / document content into a clean, distraction-free reader representation.
 */
function extractSanitizedArticle(html, baseUrl = '') {
  if (!html) return '';

  let s = html;

  // 1. Remove all HTML comments first (prevents premature tag matching or broken regex on comment arrows)
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // 2. Strip non-content structural elements completely
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

  // 5. Clean out all complex attributes and data-* JSON attributes from tags, keeping safe clean hrefs
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

    // Remove footnote/cite link elements
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
      // Paragraph: ignore noise lines
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

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
