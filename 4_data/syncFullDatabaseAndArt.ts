import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { pool } from './db.js';

dotenv.config();

const WIKI_API = 'https://kayoumylittleponycardgame.miraheze.org/w/api.php';
const TARGET_WIDTH = 480;
const WEBP_QUALITY = 80;

const cleanPubUrl = (process.env.R2_PUBLIC_URL || '').replace(/^https?:\/\//, '');
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY || '',
    secretAccessKey: process.env.R2_SECRET_KEY || '',
  },
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
      headers: { 'User-Agent': 'EquestriaClashEngine/1.0' },
    });
    if (!res.ok) break;
    const data = await res.json();
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
  const data = await response.json();
  return data.parse?.wikitext?.['*'] || '';
}

async function fetchFileUrlFromWiki(filename: string): Promise<string | null> {
  if (!filename) return null;
  const url = `${WIKI_API}?action=query&titles=File:${encodeURIComponent(filename)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'EquestriaClashEngine/1.0' } });
    const data = await res.json();
    const pages = data.query?.pages || {};
    for (const pid in pages) {
      if (pages[pid].imageinfo && pages[pid].imageinfo[0]?.url) {
        return pages[pid].imageinfo[0].url;
      }
    }
  } catch (err: any) {
    console.warn(`[API WARN] Could not resolve file ${filename}: ${err.message}`);
  }
  return null;
}

async function runMasterSync() {
  console.log('[MASTER SYNC] Initializing Master Scraper v2.5 (Event Stats & Mane Character Detection)...');

  const allPageTitles = await fetchWikiAllPages();
  const cardPageTitles = allPageTitles.filter(title => /^[※]?[A-Z0-9]+-[A-Z0-9]+/.test(title));
  console.log(`[MASTER SYNC] Discovered ${cardPageTitles.length} card pages to process.`);

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS game;
      CREATE TABLE IF NOT EXISTS game.cards (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        card_type VARCHAR(64),
        element TEXT,
        rarity TEXT,
        power INT4 DEFAULT 0,
        image_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        effect_text TEXT,
        traits TEXT,
        set_code VARCHAR(100),
        cost INT4 DEFAULT 0,
        defense INT4 DEFAULT 0,
        flavor_text TEXT,
        artist VARCHAR(100),
        card_number VARCHAR(64)
      );
    `);

    await client.query('BEGIN');

    const validElements = new Set(['Magic', 'Honesty', 'Kindness', 'Laughter', 'Generosity', 'Loyalty']);
    const validRarities = new Set(['C', 'U', 'R', 'SR', 'SSR', 'UR', 'PR', 'P', 'SEC']);
    
    let count = 0;
    let skippedChinese = 0;
    let uploadedArt = 0;

    for (const title of cardPageTitles) {
      const titleMatch = title.match(/^([※]?[A-Z0-9]+-[A-Z0-9]+)/);
      if (!titleMatch) continue;

      const isShining = title.includes('※');
      const rawCardId = titleMatch[1].replace(/※/g, '').trim();
      const cardId = isShining ? `${rawCardId}-S` : rawCardId;
      const setCode = rawCardId.split('-')[0];
      
      let cardName = title.replace(/^([※]?[A-Z0-9]+-[A-Z0-9]+)/, '').trim();
      if (isShining && !cardName.includes('Shining')) {
          cardName = `Shining ${cardName}`.trim();
      }

      const wikitext = await fetchWikiPageWikitext(title);

      if (/[\u4e00-\u9fa5]/.test(title) || /[\u4e00-\u9fa5]/.test(wikitext)) {
        skippedChinese++;
        continue;
      }

      const templateMatch = wikitext.match(/\{\{([a-zA-Z0-9_-]+)\s*\|([\s\S]*?)\}\}/);
      const templateName = templateMatch ? templateMatch[1].toLowerCase() : '';
      const rawParams: string[] = [];
      const namedParams: Record<string, string> = {};

      if (templateMatch && templateMatch[2]) {
        const parts = templateMatch[2].split('|');
        for (const part of parts) {
          const trimmed = part.trim();
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.substring(0, eqIdx).trim().toLowerCase();
            const val = trimmed.substring(eqIdx + 1).trim();
            namedParams[key] = val;
          } else {
            rawParams.push(trimmed);
          }
        }
      }

      if (namedParams['image-lang'] === 'Chinese' || namedParams['variant-cn-suffix'] || wikitext.includes('_cn')) {
        skippedChinese++;
        continue;
      }

      const cleanParam = (val: string) => {
        if (!val) return '';
        let cleaned = val.replace(/<!--[\s\S]*?-->/g, '').trim();
        const nestedMatch = cleaned.match(/\{\{([^\|}]+)(?:\|([^}]+))?\}\}/);
        if (nestedMatch) {
          const macro = nestedMatch[1].trim();
          const arg = nestedMatch[2] ? nestedMatch[2].trim() : '';
          if (validElements.has(macro)) return macro;
          if (validElements.has(arg)) return arg;
          return arg || macro;
        }
        return cleaned
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/\[\[(?:[^\]]*\|)?([^\]]+)\]\]/g, '$1')
          .trim();
      };

      let cardType = namedParams['type'] || namedParams['card_type'] || '';
      if (!cardType) {
        if (templateName.includes('event')) cardType = 'Event';
        else if (templateName.includes('item')) cardType = 'Item';
        else if (templateName.includes('mane')) cardType = 'Mane Character';
        else if (templateName.includes('friend')) cardType = 'Friend Character';
        else cardType = 'Character';
      }

      let rarity = namedParams['rarity'] || 'C';
      let traits = namedParams['trait'] || namedParams['traits'] || '';
      let element = namedParams['element'] || namedParams['color'] || null;
      
      let cost = parseInt(namedParams['cost'] || namedParams['c'] || '', 10);
      if (isNaN(cost)) cost = 0;
      
      let power = parseInt(namedParams['power'] || namedParams['pwr'] || namedParams['p'] || '', 10);
      if (isNaN(power)) power = 0;
      
      let ability = namedParams['effect'] || namedParams['ability'] || '';
      let flavor = namedParams['flavor'] || '';

      // Universal positional parsing to catch missed numbers across ALL card types
      if (rawParams[1] && validRarities.has(rawParams[1].toUpperCase())) {
        rarity = rawParams[1].toUpperCase();
      }
      if (!cardName && rawParams[3]) {
        cardName = cleanParam(rawParams[3]);
      }
      if (!traits && rawParams[4]) {
        traits = cleanParam(rawParams[4]);
      }
      
      const numericTokens: number[] = [];
      const textTokens: string[] = [];
      
      for (let i = 0; i < rawParams.length; i++) {
        const val = cleanParam(rawParams[i]);
        if (!val) continue;
        if (!element && validElements.has(val)) {
          element = val;
        } else if (/^\d+$/.test(val)) {
          if (i < 4) continue; // Skip collector numbers
          numericTokens.push(parseInt(val, 10));
        } else if (i > 4 && isNaN(Number(val))) {
          textTokens.push(val);
        }
      }
      
      if (cost === 0 && numericTokens.length > 0) cost = numericTokens[0];
      
      if (cardType.includes('Character')) {
          if (power === 0 && numericTokens.length > 1) power = numericTokens[1];
      }

      // Auto-detect full art Mane Characters: If it's a character but lacks printed Cost/Power bubbles
      if (cardType === 'Character' && cost === 0 && power === 0) {
         cardType = 'Mane Character';
      }

      if (!traits && cardType.includes('Character')) traits = 'Pony';
      if (!ability && textTokens.length > 0) ability = textTokens.join('\n');
      if (!cardName) cardName = `Card ${cardId}`;
      
      const defense = power;

      if (!element) {
        if (cardName.includes('Twilight Sparkle')) element = 'Magic';
        else if (cardName.includes('Applejack')) element = 'Honesty';
        else if (cardName.includes('Fluttershy')) element = 'Kindness';
        else if (cardName.includes('Pinkie Pie')) element = 'Laughter';
        else if (cardName.includes('Rarity')) element = 'Generosity';
        else if (cardName.includes('Rainbow Dash')) element = 'Loyalty';
      }

      const r2Key = `cards/${cardId}.webp`;
      const publicR2Url = `https://${cleanPubUrl}/${r2Key}`;
      
      const rawWikiFileName = titleMatch[1].trim();
      let specificImageFile = namedParams['image'] || namedParams['art'] || `${rawWikiFileName}.png`;
      specificImageFile = specificImageFile.replace(/^(?:File:|Image:)/i, '').replace(/\[\[|\]\]/g, '').trim();

      if (process.env.R2_BUCKET_NAME) {
        try {
          let targetUrl = await fetchFileUrlFromWiki(specificImageFile);
          if (!targetUrl) {
            targetUrl = await fetchFileUrlFromWiki(`${rawWikiFileName}.png`);
          }

          if (targetUrl && !/[\u4e00-\u9fa5]/.test(targetUrl)) {
            const imgRes = await fetch(targetUrl, { headers: { 'User-Agent': 'EquestriaClashEngine/1.0' } });
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
              uploadedArt++;
            }
          }
        } catch (err: any) {
          console.warn(`[R2 FAIL] ${cardId}: ${err.message}`);
        }
      }

      // Updated SQL Query to insert card_type
      await client.query(`
        INSERT INTO game.cards (
          id, card_number, name, card_type, set_code, cost, power, defense, traits, effect_text, flavor_text, element, rarity, image_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          card_type = EXCLUDED.card_type,
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
      `, [cardId, cardId, cardName, cardType, setCode, cost, power, defense, traits, ability, flavor || null, element, rarity, publicR2Url]);

      count++;
      if (count % 25 === 0) {
        console.log(`[PROGRESS] Synchronized ${count} clean cards...`);
      }

      await delay(15);
    }

    await client.query('COMMIT');
    console.log(`[SUCCESS] Master sync completed! Synced ${count} clean cards, uploaded ${uploadedArt} art assets, skipped ${skippedChinese} Chinese cards.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ERROR]', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runMasterSync().catch(console.error);