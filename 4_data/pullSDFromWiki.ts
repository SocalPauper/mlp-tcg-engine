import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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

async function uploadToR2(buffer: Buffer, fileName: string): Promise<string> {
  const key = `cards/${fileName}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000'
  }));
  return `${R2_PUBLIC_BASE}/cards/${fileName}`;
}

async function processAndUploadImage(url: string, fileName: string, cardId: string): Promise<string | null> {
  try {
    const imgRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!imgRes.ok) return null;
    
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const image = sharp(buffer);
    const metadata = await image.metadata();
    
    // Landscape whitelist for Scene and Prop cards
    const isLandscapeScene = cardId.match(/-(C0[6-9]|ER\d+|SPR\d+)$/i);
    
    if (metadata.width && metadata.height && metadata.width >= metadata.height) {
      if (!isLandscapeScene) {
        console.log(`[FILTER] Rejected landscape/grid image.`);
        return null; 
      }
    }
    
    const targetWidth = isLandscapeScene ? 840 : 600;
    const targetHeight = isLandscapeScene ? 600 : 840;
    
    const webpBuffer = await image
      .resize(targetWidth, targetHeight, { fit: 'cover', position: 'center', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    
    return await uploadToR2(webpBuffer, fileName);
  } catch (err) {
    console.error(`[ERROR] Processing image ${fileName} failed:`, err);
    return null;
  }
}

// Bypasses HTML scraping entirely by using the MediaWiki API to search for the raw File uploads
async function scrapeWikiArtViaAPI(cardId: string): Promise<string | null> {
  const cleanId = cardId.replace(/-S$/i, ''); // Base ID for the search query
  
  // 1. Search the 'File:' namespace (srnamespace=6) for the exact card ID
  const searchUrl = `https://kayoumylittleponycardgame.miraheze.org/w/api.php?action=query&list=search&srnamespace=6&srsearch="${cleanId}"&format=json`;
  
  try {
    const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!searchRes.ok) return null;
    
    const searchData = await searchRes.json();
    if (!searchData.query || !searchData.query.search || searchData.query.search.length === 0) {
      return null;
    }

    // Prioritize the exact match if checking for an '-S' variant, otherwise take the best match
    let fileTitle = searchData.query.search[0].title;
    for (const item of searchData.query.search) {
      if (item.title.toLowerCase().includes(cardId.toLowerCase())) {
        fileTitle = item.title;
        break;
      }
    }

    // 2. Resolve the File title to its direct image URL
    const imgInfoUrl = `https://kayoumylittleponycardgame.miraheze.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=url&format=json`;
    const infoRes = await fetch(imgInfoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!infoRes.ok) return null;
    
    const infoData = await infoRes.json();
    const pages = infoData.query.pages;
    const pageId = Object.keys(pages)[0];
    
    if (pageId === "-1" || !pages[pageId].imageinfo) {
      return null;
    }

    const finalUrl = pages[pageId].imageinfo[0].url;
    
    if (await testUrl(finalUrl)) {
      return finalUrl;
    }
    
    return null;
  } catch (err) {
    console.error(`[API ERROR] Fetching wiki API for ${cardId} failed.`);
    return null;
  }
}

async function runWikiAPIPipeline() {
  console.log('[WIKI API PIPELINE] Pulling unassigned SD01 cards from database...');
  const { rows: cards } = await pool.query(
    "SELECT id, name, image_url FROM game.cards WHERE id LIKE 'SD01%' AND image_url IS NULL ORDER BY id ASC"
  );
  console.log(`[WIKI API PIPELINE] Found ${cards.length} unassigned SD01 cards to target.`);

  if (cards.length === 0) {
    console.log('[WIKI API PIPELINE] No unassigned SD01 cards found. Exiting.');
    await pool.end();
    return;
  }

  let uploadedCount = 0;
  let missingCount = 0;

  for (const card of cards) {
    const cardId = card.id;
    const fileName = `${cardId}.webp`;

    console.log(`\n--- Processing [${cardId}] ${card.name} ---`);

    const wikiImgUrl = await scrapeWikiArtViaAPI(cardId);

    if (!wikiImgUrl) {
      console.log(`[WARNING] API could not locate uploaded File for ${cardId}`);
      missingCount++;
      continue;
    }

    console.log(`[WIKI API] Found direct file URL, processing through sharp...`);
    const finalAssetUrl = await processAndUploadImage(wikiImgUrl, fileName, cardId);

    if (finalAssetUrl) {
      await pool.query('UPDATE game.cards SET image_url = $1 WHERE id = $2', [finalAssetUrl, cardId]);
      console.log(`[DB] Associated ${cardId} with Wiki API asset.`);
      uploadedCount++;
    } else {
      console.log(`[WARNING] Process/Upload failed for ${cardId}`);
      missingCount++;
    }

    // Be kind to the MediaWiki API
    await new Promise(resolve => setTimeout(resolve, 350));
  }

  console.log('\n========================================');
  console.log(`[WIKI API PIPELINE COMPLETE] Uploaded: ${uploadedCount}`);
  console.log(`[WIKI API PIPELINE COMPLETE] Missing: ${missingCount}`);
  console.log('========================================\n');

  await pool.end();
}

runWikiAPIPipeline();