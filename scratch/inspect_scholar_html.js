async function inspectScholarHtml() {
  const url = 'https://scholar.google.com/scholar?q=Higher%20Education%20AI%20assessment%20academic%20integrity%20JISC';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8'
    }
  });
  const html = await res.text();
  console.log('HTML status:', res.status, 'HTML length:', html.length);
  
  // Check for search result elements in Google Scholar
  console.log('Contains gs_r (results):', html.includes('gs_r'));
  console.log('Contains gs_rt (titles):', html.includes('gs_rt'));
  console.log('Contains gs_a (authors):', html.includes('gs_a'));
  console.log('Contains gs_rs (snippets):', html.includes('gs_rs'));
  console.log('Contains gs_bdy (body):', html.includes('gs_bdy'));
  console.log('Contains gs_top (top):', html.includes('gs_top'));

  // Let's find first gs_r snippet
  const idx = html.indexOf('class="gs_r');
  if (idx !== -1) {
    console.log('\nFirst result snippet:\n', html.slice(idx, idx + 1200));
  } else {
    console.log('\nPage content sample:\n', html.slice(0, 1000));
  }
}

inspectScholarHtml().catch(console.error);
