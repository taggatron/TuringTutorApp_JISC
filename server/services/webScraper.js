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
  const sanitizedReaderHtml = extractSanitizedArticle(rawBody);

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
 * Extracts and sanitizes article / document content into a safe reader representation.
 */
function extractSanitizedArticle(html) {
  if (!html) return '';

  let s = html;

  // Strip entire tags including content: script, style, noscript, iframe, object, embed, svg, canvas, audio, video, form, header, footer, nav
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  s = s.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');
  s = s.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ');
  s = s.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, ' ');
  s = s.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, ' ');
  s = s.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ');
  s = s.replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, ' ');
  s = s.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ');
  s = s.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ');
  s = s.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ');

  // Focus on <article> or <main> if available
  const articleMatch = s.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
                       s.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
                       s.match(/<div\b[^>]*class=["'][^"']*(?:article|content|body|post)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

  let targetContent = articleMatch ? articleMatch[1] : s;

  // Remove dangerous attributes (on*, style, data-, etc.)
  targetContent = targetContent.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  targetContent = targetContent.replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  targetContent = targetContent.replace(/\s+(href|src)\s*=\s*(?:"|')?\s*(?:javascript:|data:|vbscript:)[^"'\s>]*(?:"|')?/gi, '');

  // Keep only safe semantic tags: p, h1, h2, h3, h4, ul, ol, li, blockquote, strong, em, b, i, a, br, table, thead, tbody, tr, th, td
  const allowedTags = /<\/?(p|h1|h2|h3|h4|ul|ol|li|blockquote|strong|em|b|i|a|br|table|thead|tbody|tr|th|td)(\s+[^>]*)?>/gi;
  const tokens = [];
  let lastIdx = 0;
  let match;

  while ((match = allowedTags.exec(targetContent)) !== null) {
    // text before tag
    const plainText = targetContent.substring(lastIdx, match.index);
    if (plainText) {
      tokens.push(plainText.replace(/<[^>]+>/g, ' '));
    }
    // clean attributes of allowed tag
    const tag = match[1].toLowerCase();
    const isClosing = match[0].startsWith('</');
    if (isClosing) {
      tokens.push(`</${tag}>`);
    } else if (tag === 'a') {
      const hrefMatch = match[0].match(/href=["']([^"']+)["']/i);
      const safeHref = (hrefMatch && !/^(?:javascript|data):/i.test(hrefMatch[1])) ? hrefMatch[1] : '#';
      tokens.push(`<a href="${safeHref}" target="_blank" rel="noopener noreferrer">`);
    } else if (tag === 'br') {
      tokens.push('<br/>');
    } else {
      tokens.push(`<${tag}>`);
    }
    lastIdx = allowedTags.lastIndex;
  }
  const remaining = targetContent.substring(lastIdx);
  if (remaining) {
    tokens.push(remaining.replace(/<[^>]+>/g, ' '));
  }

  let cleaned = tokens.join('');
  // Collapse excessive empty tags
  cleaned = cleaned.replace(/<(p|h[1-4]|li)>\s*<\/\1>/gi, '');
  // Limit length to ~12000 chars
  if (cleaned.length > 12000) {
    cleaned = cleaned.slice(0, 12000) + '... <p><em>[Content excerpt truncated for reader view]</em></p>';
  }

  return cleaned.trim();
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
