async function testPmid() {
  const url = 'https://pubmed.ncbi.nlm.nih.gov/37000000/';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  const html = await res.text();
  console.log('Status:', res.status, 'length:', html.length);
  const h1Match = html.match(/<h1[^>]*class=["'][^"']*heading-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  console.log('H1:', h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : 'none');
}

testPmid().catch(console.error);
