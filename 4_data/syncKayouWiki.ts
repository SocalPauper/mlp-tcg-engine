import dotenv from 'dotenv';
import { pool } from './db.js';

dotenv.config();

const WIKI_API = 'https://kayoumylittleponycardgame.miraheze.org/w/api.php';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWikiAllPages(): Promise<string[]> {
  const titles: string[] = [];
  let aplcontinue: string | null = null;
  do {
    const queryUrl = new URL(WIKI_API);
    queryUrl.searchParams.set('action', 'query');
    queryUrl.searchParams.set('list', 'allpages');
    queryUrl.searchParams.set('aplimit', '500');
    queryUrl.searchParams.set('format', 'json');
    if (aplcontinue) queryUrl.searchParams.set('apcontinue', aplcontinue);

    const res = await fetch(queryUrl.toString(), {
      headers: { 'User-Agent': 'EquestriaClashEngine/1.0 (admin@socalpauper.com)' },
    });
    if (!res.ok) break;

    const data: any = await res.json();
    const list = data.query?.allpages || [];
    for (const page of list) {
      if (page.title) titles.push(page.title);
    }
    aplcontinue = data.continue?.apcontinue || null;
  } while (aplcontinue);
  return titles;
}

async function fetchWikiPageWikitext(pageTitle: string): Promise<string> {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext&format=json&origin=*`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'EquestriaClashEngine/1.0' },
  });
  if (!response.ok) return '';
  const data: any = await response.json();
  return data.parse?.wikitext?.['*'] || '';
}

async function runDataSync() {
  console.log('[DATA SYNC] Scraping full card metadata with automated fallback cleaning...');
  const allPageTitles = await fetchWikiAllPages();
  const cardPageTitles = allPageTitles.filter(title => /^[A-Z0-9]+-[A-Z0-9]+/.test(title) || /^※[A-Z0-9]+-[A-Z0-9]+/.test(title));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const title of cardPageTitles) {
      const titleMatch = title.match(/^(※?[A-Z0-9]+-[A-Z0-9]+)/);
      if (!titleMatch) continue;
      
      const cardId = titleMatch[1].trim();
      let cardName = title.replace(/^(※?[A-Z0-9]+-[A-Z0-9]+)/, '').trim();
      
      if (!cardName || cardName === '') {
        if (cardId === 'SD01-SPR04') cardName = 'Mountain Climbing Path';
        else if (cardId === 'SD01-SPR09') cardName = 'Delivered Letter';
        else cardName = `Card ${cardId}`;
      }

      const wikitext = await fetchWikiPageWikitext(title);
      const getField = (field: string) => {
        const regex = new RegExp(`\\|\\s*${field}\\s*=\\s*(.*?)(?=\\n\\||\\n\\})`, 'is');
        const match = wikitext.match(regex);
        return match ? match[1].trim().replace(/<br\s*\/?>/gi, '\n').replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1') : '';
      };

      const rawCost = getField('Cost of Force of Harmony');
      const rawInspiration = getField('Inspiration'); 
      const keywords = getField('Keywords');
      const ability = getField('Ability') || getField('Effect') || '';
      
      const traitsString = keywords ? keywords.split(',').map(k => k.trim()).join(', ') : 'Pony';

      const cost = parseInt(rawCost) || 0;
      const power = parseInt(rawInspiration) || 0;
      const defense = parseInt(rawInspiration) || 0;
      const setCode = cardId.replace('※', '').split('-')[0];

      const safeImageKey = `https://${process.env.R2_PUBLIC_URL}/cards/${cardId.replace('※', 'shining-')}.webp`;

      await client.query(`
        INSERT INTO public.cards (
          id, name, set_code, cost, power, defense, traits, effect_text, image_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          set_code = EXCLUDED.set_code,
          cost = EXCLUDED.cost,
          power = EXCLUDED.power,
          defense = EXCLUDED.defense,
          traits = EXCLUDED.traits,
          effect_text = EXCLUDED.effect_text,
          image_url = EXCLUDED.image_url;
      `, [cardId, cardName, setCode, cost, power, defense, traitsString, ability, safeImageKey]);

      await delay(50);
    }

    await client.query('COMMIT');
    console.log('[SUCCESS] Data sync and attribute automation complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ERROR]', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runDataSync().catch(console.error);