async function inspectWiki() {
  const res = await fetch('https://en.wikipedia.org/wiki/Alan_Turing', {
    headers: { 'User-Agent': 'TuringTutorWebResearch/1.0 (Educational Assistant; mailto:admin@southdevon.ac.uk)' }
  });
  const html = await res.text();
  
  const idx = html.indexOf('{"wt":');
  console.log('Index of {"wt":', idx);
  if (idx !== -1) {
    console.log('\nContext around {"wt": (500 chars before and after):');
    console.log(html.slice(Math.max(0, idx - 200), idx + 400));
  }
}

inspectWiki().catch(console.error);
