async function inspectPubMed() {
  const url = 'https://pubmed.ncbi.nlm.nih.gov/?term=NICE%20guidelines%20asthma%20management';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  const html = await res.text();
  console.log('Status:', res.status, 'HTML length:', html.length);

  // Check for PubMed result card elements
  console.log('Has docsum-content:', html.includes('docsum-content'));
  console.log('Has docsum-title:', html.includes('docsum-title'));
  console.log('Has full-docsum:', html.includes('full-docsum'));
  console.log('Has docsum-authors:', html.includes('docsum-authors'));
  console.log('Has docsum-journal-citation:', html.includes('docsum-journal-citation'));
  console.log('Has docsum-snippet:', html.includes('docsum-snippet') || html.includes('full-view-snippet') || html.includes('short-view-snippet'));

  // Find sample result
  const idx = html.indexOf('class="docsum-content"');
  if (idx !== -1) {
    console.log('\n--- First docsum sample (1500 chars) ---');
    console.log(html.slice(idx - 100, idx + 1400));
  } else {
    console.log('Sample body:', html.slice(0, 1000));
  }
}

inspectPubMed().catch(console.error);
