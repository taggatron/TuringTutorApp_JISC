// Auto-inject CSRF token into state-changing same-origin fetch requests
(function () {
  let csrfToken = '';
  let tokenFetched = false;

  const getToken = async () => {
    if (tokenFetched) return;
    tokenFetched = true;
    try {
      const resp = await fetch('/csrf-token', { credentials: 'same-origin' });
      if (resp.ok) {
        const data = await resp.json();
        csrfToken = data.csrfToken || '';
      }
    } catch (_) {
      // CSRF token not required in serverless / guest mode
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
        if (!tokenFetched) {
          await getToken();
        }
        init.headers = new Headers(init.headers || {});
        if (csrfToken) {
          init.headers.set('X-CSRF-Token', csrfToken);
        }
        if (!('credentials' in init)) init.credentials = 'same-origin';
      }
    } catch (e) {
      console.warn('CSRF wrapper encountered an error; forwarding request unmodified.', e);
    }
    return origFetch(input, init);
  };
})();
