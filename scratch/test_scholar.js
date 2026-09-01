import { fetchWebResource } from '../server/services/webScraper.js';

async function testScholar() {
  const url = 'https://scholar.google.com/scholar?q=Higher%20Education%20AI%20assessment%20academic%20integrity%20JISC';
  const result = await fetchWebResource(url);
  console.log('Result success:', result.success);
  console.log('Title:', result.resource?.title);
  console.log('Domain:', result.resource?.domain);
  console.log('\n--- Content Preview (first 2000 chars) ---');
  console.log(result.resource?.content?.slice(0, 2000));
}

testScholar().catch(console.error);
