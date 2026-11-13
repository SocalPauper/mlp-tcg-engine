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
    accessKeyId: process.env.R2_ACCESS_KEY || '',
    secretAccessKey: process.env.R2_SECRET_KEY || ''
  }
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'mlp-tcg-assets';
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_URL || 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev';

let isCardBackUploaded = false;

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
    
    // Whitelist horizontal Scene cards (C06-C09, ER) and Prop cards (SPR)
    const isLandscapeScene = cardId.match(/-(C0[6-9]|ER\d+|SPR\d+)$/i);
    
    // ANTI-GRID FILTER: Reject landscape images UNLESS they are recognized Scene/Prop cards
    if (metadata.width && metadata.height && metadata.width >= metadata.height) {
      if (!isLandscapeScene) {
        console.log(`[FILTER] Rejected landscape/grid image from ${url}`);
        return null; 
      }
    }
    
    const targetWidth = isLandscapeScene ? 840 : 600;
    const targetHeight = isLandscapeScene ? 600 : 840;
    
    const webpBuffer = await image
      .resize(targetWidth, targetHeight, { fit: 'cover', position: 'center' })
      .webp({ quality: 85 })
      .toBuffer();
    
    return await uploadToR2(webpBuffer, fileName);
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
    
    // Brute-force across starter deck detail pages exclusively (No master gallery pages)
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
    } catch (err) {
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
  } catch (err) {
  }
  return null;
}

async function scrapeWikiArt(cardId: string, cardName: string): Promise<string | null> {
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

async function runPipeline() {
  console.log('[PIPELINE] Step 1: Pulling every card from database...');
  const { rows: cards } = await pool.query('SELECT id, name, image_url FROM game.cards ORDER BY id ASC');
  console.log(`[PIPELINE] Found ${cards.length} cards in DB.`);

  let uploadedCount = 0;
  let missingCount = 0;

  for (const card of cards) {
    const cardId = card.id;
    const fileName = `${cardId}.webp`;
    
    if (card.image_url) continue;

    console.log(`\n--- Processing [${cardId}] ${card.name} ---`);
    let finalAssetUrl: string | null = null;

    const mlpData = await scrapeMlpMerch(cardId);
    
    if (mlpData.back && !isCardBackUploaded) {
      console.log(`[INIT] Uploading global CardBack.webp...`);
      const backUpload = await processAndUploadImage(mlpData.back, 'CardBack.webp', 'BACK');
      if (backUpload) {
        isCardBackUploaded = true;
        console.log(`[SUCCESS] CardBack.webp secured in R2.`);
      }
    }

    for (const candidate of mlpData.fronts) {
      finalAssetUrl = await processAndUploadImage(candidate, fileName, cardId);
      if (finalAssetUrl) {
        console.log(`[MLPMERCH] Retrieved pristine scan. Uploaded to R2.`);
        break; 
      }
    }

    if (!finalAssetUrl) {
      const tcgUrl = await scrapeTcgMatch(cardId);
      if (tcgUrl) {
        console.log(`[TCGMATCH] MLPMerch missed/rejected. Trying TCGmatch...`);
        finalAssetUrl = await processAndUploadImage(tcgUrl, fileName, cardId);
      }
    }

    if (!finalAssetUrl) {
      console.log(`[WIKI] TCGmatch missed/rejected. Falling back to Miraheze Wiki...`);
      const wikiUrl = await scrapeWikiArt(cardId, card.name);
      if (wikiUrl) {
        finalAssetUrl = await processAndUploadImage(wikiUrl, fileName, cardId);
      }
    }

    if (finalAssetUrl) {
      await pool.query('UPDATE game.cards SET image_url = $1 WHERE id = $2', [finalAssetUrl, cardId]);
      console.log(`[DB] Associated ${cardId} with R2 asset.`);
      uploadedCount++;
    } else {
      console.log(`[WARNING] Could not locate or generate asset for ${cardId}`);
      missingCount++;
    }

    await new Promise(resolve => setTimeout(resolve, 350));
  }

  console.log('\n========================================');
  console.log(`[PIPELINE COMPLETE] Newly Uploaded & Synced: ${uploadedCount}`);
  console.log(`[PIPELINE COMPLETE] Unresolved Missing: ${missingCount}`);
  console.log('========================================\n');

  await pool.end();
}

runPipeline();