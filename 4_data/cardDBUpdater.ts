import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
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

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'EquestriaClashEngine/1.0' } });
      if (res.ok) return res;
      if (res.status === 429) {
        console.warn(`[RATE LIMIT] Hit 429 on Wiki. Retrying in ${2000 * (i + 1)}ms...`);
        await delay(2000 * (i + 1));
        continue;
      }
    } catch (err) {
      if (i === retries - 1) throw err;
    }
    await delay(1000);
  }
  throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
}

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

    const res = await fetch(queryUrl.toString(), { headers: { 'User-Agent': 'EquestriaClashEngine/1.0' } });
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
  const response = await fetch(url, { headers: { 'User-Agent': 'EquestriaClashEngine/1.0' } });
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
  } catch (err) {}
  return null;
}

async function findImageViaPageScrape(cardId: string): Promise<string | null> {
  try {
    const rawCardId = cardId.replace('-S', '');
    const searchUrl = `${WIKI_API}?action=query&list=search&srsearch=${encodeURIComponent(rawCardId)}&format=json&origin=*`;
    const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': 'EquestriaClashEngine/1.0' } });
    const searchData = await searchRes.json();
    
    if (!searchData.query?.search?.length) return null;
    const pageTitle = searchData.query.search[0].title;

    const parseUrl = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageTitle)}&prop=images&format=json&origin=*`;
    const parseRes = await fetch(parseUrl, { headers: { 'User-Agent': 'EquestriaClashEngine/1.0' } });
    const parseData = await parseRes.json();
    const images = parseData.parse?.images || [];

    const validImages = images.filter((img: string) => 
      !img.toLowerCase().includes('icon') && 
      !img.toLowerCase().includes('logo') &&
      (img.toLowerCase().endsWith('.png') || img.toLowerCase().endsWith('.jpg') || img.toLowerCase().endsWith('.jpeg'))
    );

    if (!validImages.length) return null;

    return await fetchFileUrlFromWiki(validImages[0]);
  } catch (err) {}
  return null;
}

/**
 * Determines the official card type strictly based on official Kayou ID prefix rules.
 */
function determineCardType(cardId: string, templateName: string): string {
  // 1. Tokens
  if (cardId.startsWith('TK-')) {
    return 'Token';
  }

  // 2. Mane Characters (Core leaders: -RR01 through -RR06, including -S shining variants)
  if (/-(?:RR0[1-6])(-S)?$/.test(cardId)) {
    return 'Mane Character';
  }

  // 3. Scenes / Environments (-ER codes)
  if (cardId.includes('-ER') || templateName.includes('scene')) {
    return 'Scene';
  }

  // 4. Story Cards (Episode story ranges like C25–C48)
  if (/-(?:C2[5-9]|C[3-4]\d)/.test(cardId) || templateName.includes('story')) {
    return 'Story';
  }

  // 5. Events & Actions (-SPR codes)
  if (cardId.includes('-SPR') || templateName.includes('event')) {
    return 'Event';
  }

  // 6. Items
  if (templateName.includes('item')) {
    return 'Item';
  }

  // 7. Default fallback for Main Deck characters / friends
  return 'Character';
}

async function runCardDBUpdater() {
  console.log('====================================================');
  console.log('[CARD DB UPDATER] Initializing Foolproof Pipeline');
  console.log('====================================================');

  const configPath = path.resolve(process.cwd(), '4_data/allowed_sets.json');
  let adminConfig = { activeSets: [] };
  try {
    adminConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.error('[ERROR] Could not load allowed_sets.json.');
    return;
  }
  const activeSets = new Set(adminConfig.activeSets);

  const allPageTitles = await fetchWikiAllPages();
  const cardPageTitles = allPageTitles.filter(title => /^[※]?[A-Z0-9]+-[A-Z0-9]+/.test(title));
  console.log(`[PHASE 1] Discovered ${cardPageTitles.length} total card pages on wiki.`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const validElements = new Set(['Magic', 'Honesty', 'Kindness', 'Laughter', 'Generosity', 'Loyalty']);
    const validRarities = new Set(['C', 'U', 'R', 'SR', 'SSR', 'UR', 'PR', 'P', 'SEC', 'CR', 'GR', 'RR', 'SPR']);
    
    let count = 0;
    let skippedChinese = 0;
    let skippedUnapproved = 0;

    for (const title of cardPageTitles) {
      const titleMatch = title.match(/^([※]?[A-Z0-9]+-[A-Z0-9]+)/);
      if (!titleMatch) continue;

      const isShining = title.includes('※');
      const rawCardId = titleMatch[1].replace(/※/g, '').trim();
      const cardId = isShining ? `${rawCardId}-S` : rawCardId;
      const setCode = rawCardId.split('-')[0];

      if (!activeSets.has(setCode)) {
        skippedUnapproved++;
        continue;
      }
      
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
        return cleaned.replace(/<br\s*\/?>/gi, '\n').replace(/\[\[(?:[^\]]*\|)?([^\]]+)\]\]/g, '$1').trim();
      };

      let rarity = namedParams['rarity'] || 'C';
      let traits = namedParams['trait'] || namedParams['traits'] || '';
      let element = namedParams['element'] || namedParams['color'] || null;
      
      let cost = parseInt(namedParams['cost'] || namedParams['c'] || '', 10);
      if (isNaN(cost)) cost = 0;
      
      let power = parseInt(namedParams['power'] || namedParams['pwr'] || namedParams['p'] || '', 10);
      if (isNaN(power)) power = 0;
      
      let ability = namedParams['effect'] || namedParams['ability'] || '';
      let flavor = namedParams['flavor'] || '';

      if (rawParams[1] && validRarities.has(rawParams[1].toUpperCase())) rarity = rawParams[1].toUpperCase();
      if (!cardName && rawParams[3]) cardName = cleanParam(rawParams[3]);
      if (!traits && rawParams[4]) traits = cleanParam(rawParams[4]);
      
      const numericTokens: number[] = [];
      const textTokens: string[] = [];
      
      for (let i = 0; i < rawParams.length; i++) {
        const val = cleanParam(rawParams[i]);
        if (!val) continue;
        if (!element && validElements.has(val)) {
          element = val;
        } else if (/^\d+$/.test(val)) {
          if (i < 4) continue; 
          numericTokens.push(parseInt(val, 10));
        } else if (i > 4 && isNaN(Number(val))) {
          textTokens.push(val);
        }
      }
      
      if (cost === 0 && numericTokens.length > 0) cost = numericTokens[0];
      if (power === 0 && numericTokens.length > 1) power = numericTokens[1];

      // Robust ID-driven classification replacing fragile guesswork
      let cardType = namedParams['type'] || namedParams['card_type'] || '';
      if (!cardType) {
        cardType = determineCardType(cardId, templateName);
      }

      if (!traits && cardType.includes('Character')) traits = 'Pony';
      if (!ability && textTokens.length > 0) ability = textTokens.join('\n');
      if (!cardName) cardName = `Card ${cardId}`;
      const defense = power;

      if (!element) {
        const nameLower = cardName.toLowerCase();
        if (nameLower.includes('twilight sparkle') || nameLower.includes('spike') || nameLower.includes('trixie') || nameLower.includes('celestia') || nameLower.includes('luna') || nameLower.includes('cadance') || nameLower.includes('shining armor') || nameLower.includes('discord')) {
          element = 'Magic';
        } else if (nameLower.includes('applejack') || nameLower.includes('apple bloom') || nameLower.includes('big mcintosh') || nameLower.includes('granny smith') || nameLower.includes('mayor mare')) {
          element = 'Honesty';
        } else if (nameLower.includes('fluttershy') || nameLower.includes('angel') || nameLower.includes('zecora')) {
          element = 'Kindness';
        } else if (nameLower.includes('pinkie pie') || nameLower.includes('gummy') || nameLower.includes('cheese sandwich')) {
          element = 'Laughter';
        } else if (nameLower.includes('rarity') || nameLower.includes('sweetie belle') || nameLower.includes('opalescence')) {
          element = 'Generosity';
        } else if (nameLower.includes('rainbow dash') || nameLower.includes('scootaloo') || nameLower.includes('gilda') || nameLower.includes('spitfire')) {
          element = 'Loyalty';
        }
      }

      const r2Key = `cards/${cardId}.webp`;
      const publicR2Url = `https://${cleanPubUrl}/${r2Key}`;

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
      await delay(30);
    }

    await client.query('COMMIT');
    console.log(`[PHASE 1 SUCCESS] Database synced successfully. Total valid cards: ${count}.`);

    // ==========================================
    // PHASE 2: SMART RECOVERY & DEEP SCAN ART SYNC
    // ==========================================
    console.log('\n[PHASE 2] Initializing Smart Art Recovery & Deep Scan for R2...');
    const res = await client.query('SELECT id FROM game.cards ORDER BY id');
    const cards = res.rows;

    let recoveredCount = 0;
    let skippedR2Count = 0;
    let ghostCount = 0;

    for (const card of cards) {
      const cardId = card.id;
      const r2Key = `cards/${cardId}.webp`;
      const publicR2Url = `https://${cleanPubUrl}/${r2Key}`;

      try {
        const checkRes = await fetch(publicR2Url, { method: 'HEAD' });
        if (checkRes.ok) {
          skippedR2Count++;
          continue;
        }
      } catch (err) {}

      const rawWikiFileName = cardId.replace('-S', '');
      let targetUrl: string | null = null;
      for (const ext of ['png', 'jpg', 'jpeg']) {
        targetUrl = await fetchFileUrlFromWiki(`${rawWikiFileName}.${ext}`);
        if (targetUrl) break;
      }

      if (!targetUrl) {
        targetUrl = await findImageViaPageScrape(cardId);
      }

      if (targetUrl && !/[\u4e00-\u9fa5]/.test(targetUrl)) {
        try {
          const imgRes = await fetchWithRetry(targetUrl);
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
            
            recoveredCount++;
            console.log(`[RECOVERED] Uploaded art for ${cardId}`);
          }
        } catch (err) {
          ghostCount++;
        }
      } else {
        ghostCount++;
      }

      await delay(300);
    }

    console.log('====================================================');
    console.log('[CARD DB UPDATER] Complete!');
    console.log(`- Database Cards Processed: ${count}`);
    console.log(`- Already in R2 (Skipped): ${skippedR2Count}`);
    console.log(`- Newly Recovered Art Assets: ${recoveredCount}`);
    console.log(`- Ghost Cards (No Wiki Art): ${ghostCount}`);
    console.log('====================================================');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[CRITICAL ERROR]', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runCardDBUpdater().catch(console.error);