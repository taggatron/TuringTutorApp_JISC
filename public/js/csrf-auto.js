// Auto-inject CSRF token into state-changing same-origin fetch requests
(function () {
  let csrfToken = '';
  const getToken = async () => {
    try {
      const resp = await fetch('/csrf-token', { credentials: 'same-origin' });
      const data = await resp.json();
      csrfToken = data.csrfToken || '';
    } catch (e) {
      console.warn('CSRF token fetch failed:', e);
    }
  };

  // Kick off token fetch immediately
  getToken();

  const METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const origFetch = window.fetch.bind(window);

  window.fetch = async function (input, init = {}) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const isSameOrigin = !/^https?:\/\//i.test(url) || url.startsWith(window.location.origin);
      const method = (init.method || 'GET').toUpperCase();

      if (isSameOrigin && METHODS.has(method)) {
        if (!csrfToken) {
          await getToken();
        }
        init.headers = new Headers(init.headers || {});
        if (csrfToken) {
          init.headers.set('X-CSRF-Token', csrfToken);
        }
        // Always send credentials for same-origin so cookies are included
        if (!('credentials' in init)) init.credentials = 'same-origin';
      }
    } catch (e) {
      console.warn('CSRF wrapper encountered an error; forwarding request unmodified.', e);
    }
    return origFetch(input, init);
  };
})();
