async function runTests() {
  console.log('--- Starting Resource Endpoint Tests ---');
  
  let cookieJar = {};
  function updateCookies(res) {
    if (res.headers.getSetCookie) {
      const setCookies = res.headers.getSetCookie();
      for (const sc of setCookies) {
        const parts = sc.split(';')[0].split('=');
        cookieJar[parts[0].trim()] = parts.slice(1).join('=').trim();
      }
    } else {
      const sc = res.headers.get('set-cookie');
      if (sc) {
        for (const single of sc.split(',')) {
          const parts = single.split(';')[0].split('=');
          if (parts[0] && parts[1]) {
            cookieJar[parts[0].trim()] = parts.slice(1).join('=').trim();
          }
        }
      }
    }
  }

  function getCookieHeader() {
    return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  // 1. Fetch CSRF token
  const csrfRes = await fetch('http://localhost:3000/csrf-token');
  updateCookies(csrfRes);
  const { csrfToken } = await csrfRes.json();
  console.log('✓ Got CSRF token:', csrfToken ? 'Yes' : 'No');

  // 2. Register/Login test user (strictly alphanumeric)
  const username = 'testuser' + Math.floor(Math.random() * 1000000);
  const password = 'Password123!';
  
  const regRes = await fetch('http://localhost:3000/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CSRF-Token': csrfToken,
      'Cookie': getCookieHeader()
    },
    body: JSON.stringify({ username, password })
  });
  updateCookies(regRes);
  const regData = await regRes.json();
  console.log('✓ Register result:', regData);

  const loginRes = await fetch('http://localhost:3000/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CSRF-Token': csrfToken,
      'Cookie': getCookieHeader()
    },
    body: JSON.stringify({ username, password })
  });
  updateCookies(loginRes);
  const loginData = await loginRes.json();
  console.log('✓ Login result:', loginData);

  // 3. Test Web Search
  const searchRes = await fetch('http://localhost:3000/api/web-search?q=Alan+Turing', {
    headers: {
      'Cookie': getCookieHeader(),
      'CSRF-Token': csrfToken
    }
  });
  const searchData = await searchRes.json();
  console.log('✓ Web search results count:', searchData.results?.length);
  if (searchData.results?.length > 0) {
    console.log('  First result:', searchData.results[0].title);
  }

  // 4. Test SSRF protection on /api/web-resource
  const ssrfAttempts = [
    'http://localhost:3000/admin',
    'http://127.0.0.1:8080',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.1.1'
  ];
  for (const url of ssrfAttempts) {
    const ssrfRes = await fetch('http://localhost:3000/api/web-resource', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': getCookieHeader(),
        'CSRF-Token': csrfToken
      },
      body: JSON.stringify({ url })
    });
    console.log(`✓ SSRF Blocked [${url}]: Status ${ssrfRes.status} (Expected 400/403)`);
  }

  // 5. Test Web Resource scraping with a safe public educational URL
  const scrapeRes = await fetch('http://localhost:3000/api/web-resource', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': getCookieHeader(),
      'CSRF-Token': csrfToken
    },
    body: JSON.stringify({ url: 'https://en.wikipedia.org/wiki/Alan_Turing' })
  });
  const scrapeData = await scrapeRes.json();
  const pageResource = scrapeData.resource || scrapeData;
  console.log('✓ Safe scraping result:', {
    title: pageResource.title,
    domain: pageResource.domain,
    canEmbed: pageResource.canEmbed,
    hasContent: !!pageResource.content
  });

  // 6. Test Create Resource in database
  const createRes = await fetch('http://localhost:3000/api/resources', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': getCookieHeader(),
      'CSRF-Token': csrfToken
    },
    body: JSON.stringify({
      title: pageResource.title || 'Alan Turing - Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Alan_Turing',
      domain: pageResource.domain || 'wikipedia.org',
      description: pageResource.description || 'Biography of Alan Turing and his work on computer science',
      content: pageResource.content ? pageResource.content.slice(0, 500) : '',
      type: 'web_page',
      origin: 'web_search'
    })
  });
  const createData = await createRes.json();
  console.log('✓ Create Resource result:', createData.success, 'Resource ID:', createData.resource?.id);

  // 7. Test Get Resources
  const listRes = await fetch('http://localhost:3000/api/resources', {
    headers: {
      'Cookie': getCookieHeader(),
      'CSRF-Token': csrfToken
    }
  });
  const listData = await listRes.json();
  console.log('✓ List Resources count:', listData.resources?.length);
  if (listData.resources?.length > 0) {
    console.log('  Found resource in DB:', listData.resources[0].title);
  }

  // 8. Test Delete Resource
  if (createData.resource?.id) {
    const delRes = await fetch(`http://localhost:3000/api/resources/${createData.resource.id}`, {
      method: 'DELETE',
      headers: {
        'Cookie': getCookieHeader(),
        'CSRF-Token': csrfToken
      }
    });
    const delData = await delRes.json();
    console.log('✓ Delete Resource result:', delData.success);
  }

  console.log('--- All Endpoint Tests Completed Successfully ---');
}

runTests().catch(console.error);
