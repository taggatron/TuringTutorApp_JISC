async function inspectScholarResults() {
  const url = 'https://scholar.google.com/scholar?q=Higher%20Education%20AI%20assessment%20academic%20integrity%20JISC';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  const html = await res.text();
  
  // Find gs_res_ccl_mid
  const midIdx = html.indexOf('id="gs_res_ccl_mid"');
  console.log('midIdx:', midIdx);
  if (midIdx !== -1) {
    const midHtml = html.slice(midIdx, midIdx + 4000);
    console.log('\n--- gs_res_ccl_mid sample (first 2000 chars) ---');
    console.log(midHtml.slice(0, 2000));
  }
}

inspectScholarResults().catch(console.error);
