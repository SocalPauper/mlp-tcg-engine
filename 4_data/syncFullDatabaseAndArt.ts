import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { pool } from './db.js';

dotenv.config();

const WIKI_API = 'https://kayoumylittleponycardgame.miraheze.org/w/api.php';
const TARGET_WIDTH = 480;
const WEBP_QUALITY = 80;

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET_KEY!,
  },
});

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

async function fetchAllWikiImagesMap(): Promise> {
  const imageMap = new Map<string, string>();
  let aicontinue: string | null = null;

  do {
    const queryUrl = new URL(WIKI_API);
    queryUrl.searchParams.set('action', 'query');
    queryUrl.searchParams.set('list', 'allimages');
    queryUrl.searchParams.set('ailimit', '500');
    queryUrl.searchParams.set('format', 'json');
    if (aicontinue) queryUrl.searchParams.set('aicontinue', aicontinue);

    const res = await fetch(queryUrl.toString(), {
      headers: { 'User-Agent': 'EquestriaClashEngine/1.0' },
    });
    if (!res.ok) break;

    const data: any = await res.json();
    const list = data.query?.allimages || [];
    for (const item of list) {
      if (item.name && item.url) {
        const match = item.name.match(/^(※?[A-Z0-9]+-[A-Z0-9]+)/i);
        if (match) {
          const cardId = match[1].toUpperCase().replace(/※/g, '');
          imageMap.set(cardId, item.url);
        }
      }
    }
    aicontinue = data.continue?.aicontinue || null;
  } while (aicontinue);

  return imageMap;
}

async function fileExistsInR2(key: string): Promise<boolean> {
  try {
    await r2Client.send(new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    }));
    return true;
  } catch {
    return false;
  }
}

async function runAutonomousSync() {
  console.log('[AUTONOMOUS SYNC] Starting full wiki discovery, R2 art sync, and PostgreSQL upsert...');

  const imageMap = await fetchAllWikiImagesMap();
  console.log(`[AUTONOMOUS SYNC] Discovered ${imageMap.size} card art assets from wiki.`);

  const allPageTitles = await fetchWikiAllPages();
  const cardPageTitles = allPageTitles.filter(title => /^[※]?[A-Z0-9]+-[A-Z0-9]+/.test(title));
  console.log(`[AUTONOMOUS SYNC] Discovered ${cardPageTitles.length} card pages to process.`);

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS game;
      CREATE TABLE IF NOT EXISTS game.cards (
        id VARCHAR(64) PRIMARY KEY,
        card_number VARCHAR(64),
        name TEXT NOT NULL,
        card_type VARCHAR(64),
        element VARCHAR(64),
        image_url TEXT,
        power INT DEFAULT 0,
        defense INT DEFAULT 0,
        effect_text TEXT,
        set_code VARCHAR(100),
        cost INT DEFAULT 0,
        traits TEXT,
        flavor_text TEXT,
        rarity TEXT
      );
    `);

    let syncedCount = 0;

    for (const title of cardPageTitles) {
      const titleMatch = title.match(/^([※]?[A-Z0-9]+-[A-Z0-9]+)/);
      if (!titleMatch) continue;

      const cardId = titleMatch[1].replace(/※/g, '').trim();
      const setCode = cardId.split('-')[0];
      let cardName = title.replace(/^([※]?[A-Z0-9]+-[A-Z0-9]+)/, '').trim();

      // 1. Handle R2 Art Sync for this card
      const r2Key = `cards/${cardId}.webp`;
      const publicR2Url = `https://${process.env.R2_PUBLIC_URL}/${r2Key}`;

      if (!(await fileExistsInR2(r2Key))) {
        const wikiImgUrl = imageMap.get(cardId);
        if (wikiImgUrl) {
          try {
            const imgRes = await fetch(wikiImgUrl, {
              headers: { 'User-Agent': 'EquestriaClashEngine/1.0' },
            });
            if (imgRes.ok) {
              const arrayBuffer = await imgRes.arrayBuffer();
              const webpBuffer = await sharp(Buffer.from(arrayBuffer))
                .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
                .webp({ quality: WEBP_QUALITY, effort: 4 })
                .toBuffer();

              await r2Client.send(new PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: r2Key,
                Body: webpBuffer,
                ContentType: 'image/webp',
              }));
              console.log(`[R2 UPLOADED] ${cardId}.webp`);
            }
          } catch (err: any) {
            console.warn(`[R2 FAIL] ${cardId}: ${err.message}`);
          }
        }
      }

      // 2. Parse Wikitext Metadata
      const wikitext = await fetchWikiPageWikitext(title);
      const templateMatch = wikitext.match(/\{\{([a-zA-Z0-9_-]+)\s*\|([\s\S]*?)\}\}/);
      const namedParams: Record<string, string> = {};

      if (templateMatch && templateMatch[2]) {
        for (const part of templateMatch[2].split('|')) {
          const trimmed = part.trim();
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            namedParams[trimmed.substring(0, eqIdx).trim().toLowerCase()] = trimmed.substring(eqIdx + 1).trim();
          }
        }
      }

      const rarity = namedParams['rarity'] || 'C';
      const traits = namedParams['trait'] || namedParams['traits'] || 'Pony';
      let element = namedParams['element'] || namedParams['color'] || null;
      const cost = parseInt(namedParams['cost']) || 0;
      const power = parseInt(namedParams['power']) || 0;
      const defense = power;
      const ability = namedParams['effect'] || namedParams['ability'] || '';
      const flavor = namedParams['flavor'] || '';

      if (!cardName) cardName = `Card ${cardId}`;

      if (!element) {
        if (cardName.includes('Twilight Sparkle')) element = 'Magic';
        else if (cardName.includes('Applejack')) element = 'Honesty';
        else if (cardName.includes('Fluttershy')) element = 'Kindness';
        else if (cardName.includes('Pinkie Pie')) element = 'Laughter';
        else if (cardName.includes('Rarity')) element = 'Generosity';
        else if (cardName.includes('Rainbow Dash')) element = 'Loyalty';
      }

      // 3. Upsert into PostgreSQL
      await client.query(`
        INSERT INTO game.cards (
          id, card_number, name, set_code, cost, power, defense, traits, effect_text, flavor_text, element, rarity, image_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          set_code = EXCLUDED.set_code,
          cost = EXCLUDED.cost,
          power = EXCLUDED.power,
          defense = EXCLUDED.defense,
          traits = EXCLUDED.traits,
          effect_text = EXCLUDED.effect_text,
          flavor_text = EXCLUDED.flavor_text,
          element = EXCLUDED.element,
          rarity = EXCLUDED.rarity,
          image_url = EXCLUDED.image_url;
      `, [cardId, cardId, cardName, setCode, cost, power, defense, traits, ability, flavor || null, element, rarity, publicR2Url]);

      syncedCount++;
      if (syncedCount % 25 === 0) {
        console.log(`[PROGRESS] Synchronized ${syncedCount} / ${cardPageTitles.length} cards...`);
      }

      await delay(30);
    }

    console.log(`[SUCCESS] Autonomous full database and R2 art sync completed for ${syncedCount} cards.`);
  } finally {
    client.release();
    await pool.end();
  }
}

runAutonomousSync().catch(console.error);