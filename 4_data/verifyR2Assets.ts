import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
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
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
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

async function scrapeTcgMatch(cardId: string): Promise<string | null> {
  try {
    const searchUrl = `https://tcgmatch.cl/cartas/busqueda?q=${encodeURIComponent(cardId)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    let productPageUrl: string | null = null;

    // Step 1: Find the product catalog page link from search results
    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('/producto/catalogo/')) {
        productPageUrl = href.startsWith('http') ? href : `https://tcgmatch.cl${href}`;
        return false; // break on first match
      }
    });

    if (!productPageUrl) return null;

    // Step 2: Visit the product catalog page to extract the high-res CDN asset
    const productRes = await fetch(productPageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!productRes.ok) return null;

    const productHtml = await productRes.text();
    const p$ = cheerio.load(productHtml);
    let highResImage: string | null = null;

    p$('img').each((_, el) => {
      const src = p$(el).attr('src') || p$(el).attr('data-src') || '';
      if (src && (src.includes('kayouofficial.com') || src.includes('uploads') || src.includes('wp-content'))) {
        highResImage = src.startsWith('http') ? src : `https://tcgmatch.cl${src}`;
        return false; // break on main product image
      }
    });

    if (highResImage && (await testUrl(highResImage))) {
      return highResImage;
    }
  } catch (err) {
    console.error(`[ERROR] TCGmatch scrape failed for ${cardId}:`, err);
  }
  return null;
}

async function scrapeWikiArt(cardId: string, cardName: string): Promise<string | null> {
  const cleanId = cardId.replace('-S', '');
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
    // Wiki fallback error
  }
  return null;
}

async function runPipeline() {
  console.log('[PIPELINE] Step 1: Pulling every card from database...');
  const { rows: cards } = await pool.query('SELECT id, name, image_url FROM game.cards ORDER BY id ASC');
  console.log(`[PIPELINE] Found ${cards.length} cards in DB.`);

  let uploadedCount = 0;
  let missingCount = 0;

  for (const card of cards) {
    const cardId = card.id;
    const fileName = `${cardId}.webp`;
    
    console.log(`\n--- Processing [${cardId}] ${card.name} ---`);

    // STEP 2: Query TCGmatch via 2-step navigation, fall back to Miraheze Wiki
    let rawAssetUrl = await scrapeTcgMatch(cardId);
    if (rawAssetUrl) {
      console.log(`[TCGMATCH] Retrieved pristine English scan from TCGmatch.`);
    } else {
      console.log(`[WIKI] TCGmatch missed. Falling back to Miraheze Wiki...`);
      rawAssetUrl = await scrapeWikiArt(cardId, card.name);
    }

    let finalAssetUrl: string | null = null;

    if (rawAssetUrl) {
      console.log(`[OPTIMIZER] Downloading asset from ${rawAssetUrl} and converting to standardized WebP...`);
      try {
        const imgRes = await fetch(rawAssetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (imgRes.ok) {
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          const webpBuffer = await sharp(buffer).webp({ quality: 85 }).toBuffer();

          // STEP 3: Upload fresh WebP to R2 keeping variant naming (e.g. ID or ID-S)
          finalAssetUrl = await uploadToR2(webpBuffer, fileName);
          console.log(`[UPLOAD] Successfully uploaded ${fileName} to R2.`);
          uploadedCount++;
        }
      } catch (dlErr) {
        console.error(`[ERROR] Failed downloading/processing image for ${cardId}:`, dlErr);
      }
    }

    // STEP 4: Update DB association
    if (finalAssetUrl) {
      await pool.query('UPDATE game.cards SET image_url = $1 WHERE id = $2', [finalAssetUrl, cardId]);
      console.log(`[DB] Associated ${cardId} with R2 asset.`);
    } else {
      console.log(`[WARNING] Could not locate or generate asset for ${cardId}`);
      missingCount++;
    }

    // Rate limiting delay
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n========================================');
  console.log('[PIPELINE] Step 5: Testing all database links...');
  console.log('========================================');

  const { rows: verifyCards } = await pool.query('SELECT id, name, image_url FROM game.cards ORDER BY id ASC');
  let brokenLinks = 0;

  for (const card of verifyCards) {
    const ok = await testUrl(card.image_url);
    if (!ok) {
      console.log(`[BROKEN LINK] [${card.id}] ${card.name} -> ${card.image_url}`);
      brokenLinks++;
    }
  }

  console.log('\n========================================');
  console.log(`[PIPELINE COMPLETE] Newly Uploaded & Synced: ${uploadedCount}`);
  console.log(`[PIPELINE COMPLETE] Unresolved Missing: ${missingCount}`);
  console.log(`[PIPELINE COMPLETE] Broken Links Detected: ${brokenLinks}`);
  console.log('========================================\n');

  await pool.end();
}

runPipeline();