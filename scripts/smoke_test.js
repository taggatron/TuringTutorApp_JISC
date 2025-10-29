import http from 'http';

const base = 'http://localhost:3000';
const username = 'smoketestauto123';
const password = 'Sm0keT3stPass!';

async function fetchJson(path, opts = {}){
  const res = await fetch(base + path, { ...opts, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try{ json = JSON.parse(text); } catch(e) { json = text; }
  return { res, body: json, raw: text };
}

(async ()=>{
  try{
    // 1) GET CSRF token
    const r1 = await fetch(base + '/csrf-token');
    const setCookie = r1.headers.get('set-cookie');
    const data = await r1.json();
    const token = data && data.csrfToken;
    console.log('csrf token:', token);
    console.log('set-cookie header:', setCookie);

    const cookieHeader = setCookie ? setCookie.split(/, (?=[^ ;]+=)/).map(s=>s.split(';')[0]).join('; ') : '';

    // Try login first (user may already exist). If login fails, attempt register then login.
    let loginRes = await fetch(base + '/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
        'Cookie': cookieHeader,
      },
      body: JSON.stringify({ username, password })
    });
    let loginJson = await loginRes.json().catch(()=>null);
    console.log('/login (initial) status', loginRes.status, 'body:', loginJson);

    if (!loginJson || !loginJson.success) {
      // Attempt to register
      const registerRes = await fetch(base + '/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token,
          'Cookie': cookieHeader,
        },
        body: JSON.stringify({ username, password })
      });
      const registerJson = await registerRes.json().catch(()=>null);
      console.log('/register status', registerRes.status, 'body:', registerJson);

      // Try login again
      loginRes = await fetch(base + '/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token,
          'Cookie': cookieHeader,
        },
        body: JSON.stringify({ username, password })
      });
      loginJson = await loginRes.json().catch(()=>null);
      console.log('/login (after register) status', loginRes.status, 'body:', loginJson);
    }

    // 4) exit code based on success
    if (loginJson && loginJson.success) {
      console.log('SMOKE TEST: PASS (login succeeded)');
      process.exit(0);
    } else {
      console.error('SMOKE TEST: FAIL');
      process.exit(2);
    }
  } catch (err) {
    console.error('Smoke test error', err);
    process.exit(3);
  }
})();
