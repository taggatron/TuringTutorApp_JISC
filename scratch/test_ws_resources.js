import WebSocket from 'ws';

async function testWsResources() {
  console.log('--- Testing WebSocket Resource Attachment ---');

  // 1. Get CSRF & Authenticate
  const csrfRes = await fetch('http://localhost:3000/csrf-token');
  const rawCookies = csrfRes.headers.getSetCookie ? csrfRes.headers.getSetCookie() : [csrfRes.headers.get('set-cookie')];
  let cookieJar = {};
  for (const sc of rawCookies) {
    if (!sc) continue;
    const parts = sc.split(';')[0].split('=');
    cookieJar[parts[0].trim()] = parts.slice(1).join('=').trim();
  }
  const { csrfToken } = await csrfRes.json();

  const username = 'testwsuser' + Math.floor(Math.random() * 100000);
  const password = 'Password123!';

  await fetch('http://localhost:3000/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CSRF-Token': csrfToken,
      'Cookie': Object.entries(cookieJar).map(([k,v]) => `${k}=${v}`).join('; ')
    },
    body: JSON.stringify({ username, password })
  });

  const loginRes = await fetch('http://localhost:3000/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CSRF-Token': csrfToken,
      'Cookie': Object.entries(cookieJar).map(([k,v]) => `${k}=${v}`).join('; ')
    },
    body: JSON.stringify({ username, password })
  });
  if (loginRes.headers.getSetCookie) {
    for (const sc of loginRes.headers.getSetCookie()) {
      const parts = sc.split(';')[0].split('=');
      cookieJar[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
  }

  const cookieHeader = Object.entries(cookieJar).map(([k,v]) => `${k}=${v}`).join('; ');

  // 2. Create a test resource
  const createRes = await fetch('http://localhost:3000/api/resources', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
      'CSRF-Token': csrfToken
    },
    body: JSON.stringify({
      title: 'NICE Clinical Guidelines: Asthma',
      url: 'https://www.nice.org.uk/guidance/ng80',
      domain: 'nice.org.uk',
      description: 'Official clinical guidelines for diagnosing and managing chronic asthma in adults and children.',
      content: 'Asthma diagnosis should be based on clinical history, spirometry with bronchodilator reversibility test, and fractional exhaled nitric oxide (FeNO) test.',
      type: 'web_page',
      origin: 'web_search'
    })
  });
  const createData = await createRes.json();
  console.log('✓ Created test resource ID:', createData.resource?.id);

  // 3. Connect via WebSocket
  const ws = new WebSocket('ws://localhost:3000', {
    headers: {
      'Cookie': cookieHeader
    }
  });

  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('✓ WebSocket connected with user session');
      // Send message with attached resource
      ws.send(JSON.stringify({
        content: 'What are the diagnostic tests for asthma based on the attached guideline?',
        resource_ids: [createData.resource.id]
      }));
    });

    let receivedHistory = false;
    let receivedChunks = 0;

    ws.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'message') {
        receivedChunks++;
        if (receivedChunks === 1) {
          console.log('✓ Streaming response started from Azure OpenAI model...');
        }
      } else if (parsed.type === 'history') {
        console.log('✓ Received session history, messages count:', parsed.data?.messages?.length);
        receivedHistory = true;
      }
    });

    // Wait 7 seconds then finish
    setTimeout(() => {
      ws.close();
      resolve();
    }, 7000);

    ws.on('error', reject);
  });

  console.log('✓ WebSocket test completed successfully');
}

testWsResources().catch(console.error);
