import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand
} from '@aws-sdk/client-s3';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY || '',
    secretAccessKey: process.env.R2_SECRET_KEY || ''
  }
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'mlp-tcg-assets';
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_URL || 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev';

let isCardBackUploaded = false;

function isStoryCard(cardId: string, cardType: string = '', cardName: string = ''): boolean {
  return (
    cardType === 'Story' ||
    cardName.includes(' - ') ||
    cardName.includes(' – ') ||
    /-(?:C2[5-9]|C[3-4]\d)$/i.test(cardId)
  );
}

async function testUrl(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.ok) return true;
    const getRes = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } });
    return getRes.ok;
  } catch {
    return false;
  }
}

async function wipeR2CardsFolder(): Promise<number> {
  let deletedTotal = 0;
  let continuationToken: string | undefined = undefined;

  do {
    const listRes = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: 'cards/',
        ContinuationToken: continuationToken
      })
    );

    const objects = (listRes.Contents || [])
      .filter(obj => obj.Key)
      .map(obj => ({ Key: obj.Key! }));

    if (objects.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET_NAME,
          Delete: { Objects: objects, Quiet: true }
        })
      );
      deletedTotal += objects.length;
    }

    continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined;
  } while (continuationToken);

  return deletedTotal;
}

async function checkExistingR2Dimensions(
  fileName: string,
  expectedWidth: number,
  expectedHeight: number
): Promise<{ status: 'OK' | 'MISSING' | 'MISMATCH'; actual?: string }> {
  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `cards/${fileName}`
      })
    );
    if (!res.Body) return { status: 'MISSING' };

    const byteArray = await res.Body.transformToByteArray();
    const buffer = Buffer.from(byteArray);
    const meta = await sharp(buffer).metadata();

    if (!meta.width || !meta.height) {
      return { status: 'MISMATCH', actual: 'corrupt/unreadable' };
    }

    if (meta.width !== expectedWidth || meta.height !== expectedHeight) {
      return { status: 'MISMATCH', actual: `${meta.width}x${meta.height}` };
    }

    return { status: 'OK', actual: `${meta.width}x${meta.height}` };
  } catch {
    return { status: 'MISSING' };
  }
}

async function uploadToR2(buffer: Buffer, fileName: string, cacheBust: boolean = true): Promise<string> {
  const key = `cards/${fileName}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000'
  }));
  const suffix = cacheBust ? `?v=${Date.now()}` : '';
  return `${R2_PUBLIC_BASE}/cards/${fileName}${suffix}`;
}

async function processAndUploadImage(
  url: string,
  fileName: string,
  cardId: string,
  cardType: string = '',
  cardName: string = '',
  cacheBust: boolean = true
): Promise<string | null> {
  try {
    const imgRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!imgRes.ok) return null;

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const image = sharp(buffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) return null;

    const story = isStoryCard(cardId, cardType, cardName);

    // Reject multi-card master gallery grids
    const aspectRatio = metadata.width / metadata.height;
    if (aspectRatio > 1.75) {
      console.log(`[FILTER] Rejected wide gallery grid image (${metadata.width}x${metadata.height}) from ${url}`);
      return null;
    }

    // Reject landscape images if the card is NOT a Story card
    if (metadata.width > metadata.height && !story) {
      console.log(`[FILTER] Rejected landscape image (${metadata.width}x${metadata.height}) for portrait card ${cardId}`);
      return null;
    }

    // Reject portrait images if the card IS a Story card
    if (metadata.height > metadata.width && story) {
      console.log(`[FILTER] Rejected portrait image (${metadata.width}x${metadata.height}) for landscape Story card ${cardId}`);
      return null;
    }

    const targetWidth = story ? 840 : 600;
    const targetHeight = story ? 600 : 840;

    // Uniformly scale entire card image to target dimensions without edge cropping
    const webpBuffer = await image
      .resize(targetWidth, targetHeight, { fit: 'fill' })
      .webp({ quality: 90 })
      .toBuffer();

    return await uploadToR2(webpBuffer, fileName, cacheBust);
  } catch (err) {
    console.error(`[ERROR] Processing image ${fileName} failed:`, err);
    return null;
  }
}

function getMlpMerchDetailUrls(cardId: string): string[] {
  const normalized = cardId.toLowerCase().replace(/※/g, 'x').replace(/-s$/i, '');
  const rawSuffix = cardId.replace(/[^a-zA-Z0-9-]/g, '').split('-').pop() || '';
  const cleanNum = normalized.replace(/[^a-z0-9]/g, '');

  let prefix = '';
  let numberPart = rawSuffix;
  const urls: string[] = [];

  if (normalized.startsWith('bp01-')) { prefix = 'bpfw'; numberPart = cleanNum.substring(4); }
  else if (normalized.startsWith('bp02-')) { prefix = 'bpd'; numberPart = cleanNum.substring(4); }
  else if (normalized.startsWith('bp03-')) { prefix = 'bpnn'; numberPart = cleanNum.substring(4); }
  else if (normalized.startsWith('bp04-')) { prefix = 'bphwe'; numberPart = cleanNum.substring(4); }
  else if (normalized.startsWith('sd01a-')) {
    prefix = 'fbts';
    numberPart = cleanNum.substring(5);
    urls.push(`https://data.mlpmerch.com/kayou-cards/details/kctcgfbt${numberPart}/`);
  }
  else if (normalized.startsWith('sd01b-')) { prefix = 'fbf'; numberPart = cleanNum.substring(5); }
  else if (normalized.startsWith('sd01c-')) {
    prefix = 'fbppc';
    numberPart = cleanNum.substring(5);
    urls.push(`https://data.mlpmerch.com/kayou-cards/details/kctcgfbpp${numberPart}/`);
  }
  else if (normalized.startsWith('sd01d-')) { prefix = 'fba'; numberPart = cleanNum.substring(5); }
  else if (normalized.startsWith('sd01e-')) { prefix = 'fbrd'; numberPart = cleanNum.substring(5); }
  else if (normalized.startsWith('sd01f-')) { prefix = 'fbr'; numberPart = cleanNum.substring(5); }
  else if (normalized.startsWith('sd01-')) {
    numberPart = rawSuffix;

    if (numberPart.toLowerCase().startsWith('er') || numberPart.toLowerCase().startsWith('rr')) {
      const allPrefixes = ['fbts', 'fbf', 'fbppc', 'fba', 'fbrd', 'fbr', 'fbbp'];
      for (const pfx of allPrefixes) {
        urls.push(`https://data.mlpmerch.com/kayou-cards/details/kctcg${pfx}${numberPart}/`);
      }
    } else {
      prefix = 'fbbp';
      urls.push(`https://data.mlpmerch.com/kayou-cards/details/kctcgfbbp${numberPart}/`);

      const numOnly = numberPart.replace(/[^0-9]/g, '');
      if (numOnly) {
        urls.push(`https://data.mlpmerch.com/kayou-cards/details/kctcgfbbp${numOnly}/`);
        urls.push(`https://data.mlpmerch.com/kayou-cards/details/kctcgfbbp${parseInt(numOnly, 10)}/`);
      }
    }
  }

  if (prefix && !normalized.startsWith('sd01-')) {
    urls.unshift(`https://data.mlpmerch.com/kayou-cards/details/kctcg${prefix}${numberPart}/`);
  }

  return urls;
}

async function scrapeMlpMerch(cardId: string): Promise<{ fronts: string[], back: string | null }> {
  const urls = getMlpMerchDetailUrls(cardId);
  const candidates: string[] = [];
  let backUrl: string | null = null;

  const cleanIdForSuffix = cardId.toLowerCase().replace(/-s$/i, '');
  const cardSuffix = cleanIdForSuffix.split('-').pop() || '';

  for (const detailUrl of urls) {
    try {
      const res = await fetch(detailUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) continue;

      const html = await res.text();
      const $ = cheerio.load(html);

      $('img').each((_, el) => {
        let src = $(el).attr('src') || $(el).attr('data-src') || '';
        if (src.includes('blogger.googleusercontent.com')) {
          const parts = src.split('/');
          if (parts.length > 2) {
            parts[parts.length - 2] = 's1600';
            src = parts.join('/');
          }

          const lowerImg = src.toLowerCase();

          if ((lowerImg.includes('kayou') || lowerImg.includes('mlp')) &&
              (lowerImg.includes(`-${cardSuffix}`) || lowerImg.includes(`${cardSuffix}.`))) {
            if (!candidates.includes(src)) candidates.push(src);
          }

          if (!backUrl && lowerImg.includes('back')) {
            backUrl = src;
          }
        }
      });
    } catch {
      continue;
    }
  }
  return { fronts: candidates, back: backUrl };
}

async function scrapeTcgMatch(cardId: string): Promise<string | null> {
  try {
    const searchUrl = `https://tcgmatch.cl/cartas/busqueda?q=${encodeURIComponent(cardId)}`;
    const res = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    let productPageUrl: string | null = null;

    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('/producto/catalogo/')) {
        productPageUrl = href.startsWith('http') ? href : `https://tcgmatch.cl${href}`;
        return false;
      }
    });

    if (!productPageUrl) return null;

    const productRes = await fetch(productPageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!productRes.ok) return null;

    const productHtml = await productRes.text();
    const p$ = cheerio.load(productHtml);
    let highResImage: string | null = null;

    p$('img').each((_, el) => {
      const src = p$(el).attr('src') || p$(el).attr('data-src') || '';
      if (src && (src.includes('kayouofficial.com') || src.includes('uploads') || src.includes('wp-content'))) {
        highResImage = src.startsWith('http') ? src : `https://tcgmatch.cl${src}`;
        return false;
      }
    });

    if (highResImage && (await testUrl(highResImage))) return highResImage;
  } catch {
  }
  return null;
}

async function scrapeWikiArtViaAPI(cardId: string): Promise<string | null> {
  const cleanId = cardId.replace(/-S$/i, '');
  const searchUrl = `https://kayoumylittleponycardgame.miraheze.org/w/api.php?action=query&list=search&srnamespace=6&srsearch="${cleanId}"&format=json`;

  try {
    const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!searchRes.ok) return null;

    const searchData: any = await searchRes.json();
    if (!searchData.query?.search?.length) return null;

    let fileTitle = searchData.query.search[0].title;
    for (const item of searchData.query.search) {
      if (item.title.toLowerCase().includes(cardId.toLowerCase())) {
        fileTitle = item.title;
        break;
      }
    }

    const imgInfoUrl = `https://kayoumylittleponycardgame.miraheze.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=url&format=json`;
    const infoRes = await fetch(imgInfoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!infoRes.ok) return null;

    const infoData: any = await infoRes.json();
    const pages = infoData.query.pages;
    const pageId = Object.keys(pages)[0];

    if (pageId === '-1' || !pages[pageId].imageinfo) return null;

    const finalUrl = pages[pageId].imageinfo[0].url;
    if (await testUrl(finalUrl)) return finalUrl;
  } catch {
  }
  return null;
}

async function scrapeWikiArtHTML(cardId: string, cardName: string): Promise<string | null> {
  const cleanId = cardId.replace(/-S$/i, '');
  try {
    const formattedName = cardName ? cardName.replace(/\s+/g, '_').replace(/'/g, '%27') : '';
    const wikiUrls = [
      formattedName ? `https://kayoumylittleponycardgame.miraheze.org/wiki/${cleanId}_${formattedName}` : null,
      `https://kayoumylittleponycardgame.miraheze.org/wiki/${cardId}`,
      `https://kayoumylittleponycardgame.miraheze.org/wiki/${cleanId}`
    ].filter(Boolean) as string[];

    for (const wikiUrl of wikiUrls) {
      const res = await fetch(wikiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);
      let wikiImg: string | null = null;

      $('img').each((_, el) => {
        const src = $(el).attr('src');
        if (src) {
          let full = src.startsWith('http') ? src : `https:${src}`;
          if (full.includes('/thumb/')) {
            full = full.replace('/thumb/', '/').substring(0, full.lastIndexOf('/'));
          }
          if (full.toLowerCase().includes(cardId.toLowerCase()) || full.toLowerCase().includes(cleanId.toLowerCase())) {
            wikiImg = full;
            return false;
          }
        }
      });
      if (wikiImg && (await testUrl(wikiImg))) return wikiImg;
    }
  } catch {
  }
  return null;
}

// ============================================================================
// STAGE 1: verifyR2Assets Pipeline
// ============================================================================
async function runVerifyR2AssetsStage(auditOnly: boolean, wipeAndRebuild: boolean) {
  console.log('\n========================================');
  console.log('[STAGE 1: VERIFY & SYNC R2 ASSETS] Starting...');
  console.log('========================================');

  if (wipeAndRebuild) {
    console.log('[WIPE] Clearing all objects under cards/ in R2 bucket...');
    const deletedCount = await wipeR2CardsFolder();
    console.log(`[WIPE] Deleted ${deletedCount} objects from R2.`);

    console.log('[WIPE] Resetting image_url = NULL in game.cards...');
    await pool.query('UPDATE game.cards SET image_url = NULL;');
    console.log('[WIPE] Database image_url column cleared. Starting fresh uniform download...\n');
  }

  console.log('[STAGE 1] Pulling all cards from database...');
  const { rows: cards } = await pool.query('SELECT id, name, card_type, image_url FROM game.cards ORDER BY id ASC');
  console.log(`[STAGE 1] Total cards in DB: ${cards.length}`);

  let okCount = 0;
  let mismatchCount = 0;
  let missingInR2Count = 0;
  let uploadedCount = 0;
  let failedCount = 0;

  for (const card of cards) {
    const cardId = card.id;
    const fileName = `${cardId}.webp`;
    const story = isStoryCard(cardId, card.card_type, card.name);
    const expectedWidth = story ? 840 : 600;
    const expectedHeight = story ? 600 : 840;

    if (!wipeAndRebuild) {
      const audit = await checkExistingR2Dimensions(fileName, expectedWidth, expectedHeight);

      if (audit.status === 'OK') {
        okCount++;
        continue;
      }

      if (audit.status === 'MISMATCH') {
        mismatchCount++;
        console.log(`[AUDIT MISMATCH] ${cardId} (${card.card_type}): R2 is ${audit.actual}, expected ${expectedWidth}x${expectedHeight}`);
      } else if (audit.status === 'MISSING') {
        missingInR2Count++;
        console.log(`[AUDIT MISSING] ${cardId} (${card.card_type}): Not found in R2`);
      }

      if (auditOnly) continue;
    }

    console.log(`\n--- [STAGE 1] Processing [${cardId}] ${card.name} (${expectedWidth}x${expectedHeight}) ---`);
    let finalAssetUrl: string | null = null;
    const mlpData = await scrapeMlpMerch(cardId);

    if (mlpData.back && !isCardBackUploaded) {
      const backUpload = await processAndUploadImage(mlpData.back, 'CardBack.webp', 'BACK', '', '', true);
      if (backUpload) {
        isCardBackUploaded = true;
        console.log('[SUCCESS] CardBack.webp secured in R2.');
      }
    }

    for (const candidate of mlpData.fronts) {
      finalAssetUrl = await processAndUploadImage(candidate, fileName, cardId, card.card_type, card.name, true);
      if (finalAssetUrl) {
        console.log(`[MLPMERCH] Uploaded ${cardId} -> ${expectedWidth}x${expectedHeight}`);
        break;
      }
    }

    if (!finalAssetUrl) {
      const tcgUrl = await scrapeTcgMatch(cardId);
      if (tcgUrl) {
        finalAssetUrl = await processAndUploadImage(tcgUrl, fileName, cardId, card.card_type, card.name, true);
        if (finalAssetUrl) console.log(`[TCGMATCH] Uploaded ${cardId} -> ${expectedWidth}x${expectedHeight}`);
      }
    }

    if (!finalAssetUrl) {
      const wikiApiUrl = await scrapeWikiArtViaAPI(cardId);
      if (wikiApiUrl) {
        finalAssetUrl = await processAndUploadImage(wikiApiUrl, fileName, cardId, card.card_type, card.name, true);
        if (finalAssetUrl) console.log(`[WIKI API] Uploaded ${cardId} -> ${expectedWidth}x${expectedHeight}`);
      }
    }

    if (!finalAssetUrl) {
      const wikiHtmlUrl = await scrapeWikiArtHTML(cardId, card.name);
      if (wikiHtmlUrl) {
        finalAssetUrl = await processAndUploadImage(wikiHtmlUrl, fileName, cardId, card.card_type, card.name, true);
        if (finalAssetUrl) console.log(`[WIKI HTML] Uploaded ${cardId} -> ${expectedWidth}x${expectedHeight}`);
      }
    }

    if (finalAssetUrl) {
      await pool.query('UPDATE game.cards SET image_url = $1 WHERE id = $2', [finalAssetUrl, cardId]);
      uploadedCount++;
    } else {
      console.log(`[WARNING] Stage 1 could not locate valid image for ${cardId}`);
      failedCount++;
    }

    await new Promise(resolve => setTimeout(resolve, 350));
  }

  console.log('\n========================================');
  console.log('[STAGE 1 COMPLETE: VERIFY R2 ASSETS]');
  if (!wipeAndRebuild) {
    console.log(`[R2 AUDIT] Valid Dimensions (OK): ${okCount}`);
    console.log(`[R2 AUDIT] Dimension Mismatches Found: ${mismatchCount}`);
    console.log(`[R2 AUDIT] Missing in R2: ${missingInR2Count}`);
  }
  if (!auditOnly) {
    console.log(`[STAGE 1] Uniformly Scaled & Uploaded: ${uploadedCount}`);
    console.log(`[STAGE 1] Unresolved / Deferred to Stage 2: ${failedCount}`);
  }
  console.log('========================================\n');
}

// ============================================================================
// STAGE 2: pullSDFromWiki MediaWiki File API Pipeline
// ============================================================================
async function runPullSDFromWikiStage(auditOnly: boolean, forceSd: boolean) {
  console.log('========================================');
  console.log('[STAGE 2: PULL SD01 FROM WIKI API] Starting...');
  console.log('========================================');

  if (auditOnly) {
    console.log('[STAGE 2] --audit-only active; skipping Stage 2 downloads.\n');
    return;
  }

  const query = forceSd
    ? "SELECT id, name, card_type, image_url FROM game.cards WHERE id LIKE 'SD01%' ORDER BY id ASC"
    : "SELECT id, name, card_type, image_url FROM game.cards WHERE id LIKE 'SD01%' AND image_url IS NULL ORDER BY id ASC";

  const { rows: cards } = await pool.query(query);
  console.log(`[STAGE 2] Found ${cards.length} SD01 cards to process.`);

  if (cards.length === 0) {
    console.log('[STAGE 2] All SD01 cards already resolved in Stage 1!');
    console.log('========================================\n');
    return;
  }

  let uploadedCount = 0;
  let missingCount = 0;

  for (const card of cards) {
    const cardId = card.id;
    const fileName = `${cardId}.webp`;

    console.log(`\n--- [STAGE 2] Processing [${cardId}] ${card.name} ---`);

    const wikiImgUrl = await scrapeWikiArtViaAPI(cardId);

    if (!wikiImgUrl) {
      console.log(`[WARNING] Wiki API could not locate uploaded File for ${cardId}`);
      missingCount++;
      continue;
    }

    console.log('[WIKI API] Found direct file URL, processing through sharp...');
    const finalAssetUrl = await processAndUploadImage(wikiImgUrl, fileName, cardId, card.card_type, card.name, true);

    if (finalAssetUrl) {
      await pool.query('UPDATE game.cards SET image_url = $1 WHERE id = $2', [finalAssetUrl, cardId]);
      console.log(`[DB] Associated ${cardId} with Wiki API asset.`);
      uploadedCount++;
    } else {
      console.log(`[WARNING] Process/Upload failed for ${cardId}`);
      missingCount++;
    }

    await new Promise(resolve => setTimeout(resolve, 350));
  }

  console.log('\n========================================');
  console.log('[STAGE 2 COMPLETE: PULL SD01 FROM WIKI API]');
  console.log(`[STAGE 2] Uploaded: ${uploadedCount}`);
  console.log(`[STAGE 2] Missing: ${missingCount}`);
  console.log('========================================\n');
}

async function runConsolidatedPipeline() {
  const auditOnly = process.argv.includes('--audit-only');
  const wipeAndRebuild = process.argv.includes('--wipe-and-rebuild');
  const forceSd = process.argv.includes('--force-sd');

  try {
    await runVerifyR2AssetsStage(auditOnly, wipeAndRebuild);
    await runPullSDFromWikiStage(auditOnly, forceSd);

    const { rows: remaining } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM game.cards WHERE image_url IS NULL;'
    );
    console.log('========================================');
    console.log('[ALL PIPELINES FINISHED]');
    console.log(`[DB STATUS] Total cards still missing image_url: ${remaining[0]?.count ?? 0}`);
    console.log('========================================\n');
  } finally {
    await pool.end();
  }
}

runConsolidatedPipeline();