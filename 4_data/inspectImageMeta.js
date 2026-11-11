import dotenv from 'dotenv';
dotenv.config();

const WIKI_API = 'https://kayoumylittleponycardgame.miraheze.org/w/api.php';

async function inspectCardImage() {
  // Query image info for BP01-C01
  const queryUrl = new URL(WIKI_API);
  queryUrl.searchParams.set('action', 'query');
  queryUrl.searchParams.set('titles', 'File:BP01-C01.webp|File:BP01-C01.png|File:BP01-C01.jpg');
  queryUrl.searchParams.set('prop', 'imageinfo|categories');
  queryUrl.searchParams.set('iiprop', 'url|extmetadata|mediatype');
  queryUrl.searchParams.set('format', 'json');
  queryUrl.searchParams.set('origin', '*');

  const res = await fetch(queryUrl.toString(), {
    headers: { 'User-Agent': 'EquestriaClashEngine/1.0' },
  });
  const data = await res.json();
  
  const pages = data.query?.pages || {};
  for (const pageId in pages) {
    const page = pages[pageId];
    console.log(`--- Page: ${page.title} ---`);
    if (page.imageinfo) {
      console.log('Image URL:', page.imageinfo[0].url);
    }
    if (page.categories) {
      console.log('Categories:', page.categories.map(c => c.title));
    }
  }
}

inspectCardImage().catch(console.error);