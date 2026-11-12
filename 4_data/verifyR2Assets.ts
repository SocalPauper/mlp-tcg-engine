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

async function processAndUploadImage(url: string, fileName: string): Promise<string | null> {
  try {
    const imgRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!imgRes.ok) return null;
    
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    
    // Convert to WebP and resize to unified 600x840 TCG standard
    const webpBuffer = await sharp(buffer)
      .resize(600, 840, { fit: 'cover', position: 'center' })
      .webp({ quality: 85 })
      .toBuffer();
    
    return await uploadToR2(webpBuffer, fileName);
  } catch (err) {
    console.error(`[ERROR] Processing image ${fileName} failed:`, err);
    return null;
  }
}

function getMlpMerchDetailUrls(cardId: string): string[] {
  // Normalize card ID, translate ※ to 'x', and drop '-S' (foil marker)
  const normalized = cardId.toLowerCase().replace(/※/g, 'x').replace(/-s$/i, '');
  const cleanNum = normalized.replace(/[^a-z0-9]/g, '');
  
  let prefix = '';
  let numberPart = cleanNum;
  const urls: string[] = [];

  if (cleanNum.startsWith('bp01')) { prefix = 'bpfw'; numberPart = cleanNum.substring(4); }
  else if (cleanNum.startsWith('bp02')) { prefix = 'bpd'; numberPart = cleanNum.substring(4); }
  else if (cleanNum.startsWith('bp03')) { prefix = 'bpnn'; numberPart = cleanNum.substring(4); }
  else if (cleanNum.startsWith('bp04')) { prefix = 'bphwe'; numberPart = cleanNum.substring(4); }
  else if (cleanNum.startsWith('sd01a')) { prefix = 'fbts'; numberPart = cleanNum.substring(5); urls.push(`https://data.mlpmerch.com/kayou-cards/details/kctcgfbt${numberPart}/`); } 
  else if (cleanNum.startsWith('sd01b')) { prefix = 'fbf'; numberPart = cleanNum.substring(5); }
  else if (cleanNum.startsWith('sd01c')) { prefix = 'fbppc'; numberPart = cleanNum.substring(5); urls.push(`https://data.mlpmerch.com/kayou-cards/details/kctcgfbpp${numberPart}/`); } 
  else if (cleanNum.startsWith('sd01d')) { prefix = 'fba'; numberPart = cleanNum.substring(5); }
  else if (cleanNum.startsWith('sd01e')) { prefix = 'fbrd'; numberPart = cleanNum.substring(5); }
  else if (cleanNum.startsWith('sd01f')) { prefix = 'fbr'; numberPart = cleanNum.substring(5); }
  else if (cleanNum.startsWith('sd01')) { prefix = 'fbbp'; numberPart = cleanNum.substring(4); }

  if (prefix) {
    urls.unshift(`https://data.mlpmerch.com/kayou-cards/details/kctcg${prefix}${numberPart}/`);
  }
  
  return urls;
}

async function scrapeMlpMerch(cardId: string): Promise<{ front: string | null, back: string | null }> {
  try {
    const urls = getMlpMerchDetailUrls(cardId);
    
    for (const detailUrl of urls) {
      const res = await fetch(detailUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        
        let frontUrl: string | null = null;
        let backUrl: string | null = null;
        const potentialImages: string[] = [];

        $('img').each((_, el) => {
          const src = $(el).attr('src') || $(el).attr('data-src') || '';
          if (src.includes('blogger.googleusercontent.com')) {
            potentialImages.push(src);
          }
        });

        for (let img of potentialImages) {
          // Force max resolution by replacing the thumbnail size directory with /s1600/
          const parts = img.split('/');
          if (parts.length > 2) {
            parts[parts.length - 2] = 's1600';
            img = parts.join('/');
          }
          
          const lowerImg = img.toLowerCase();
          // Filter out generic Blogger icons
          if (lowerImg.includes('kayou') || lowerImg.includes('mlp') || lowerImg.includes('card')) {
            if (!frontUrl) {
              frontUrl = img;
            } else if (!backUrl && img !== frontUrl) {
              backUrl = img;
            }
          }
        }

        if (frontUrl) return { front: frontUrl, back: backUrl };
      }
    }
  } catch (err) {
    console.error(`[ERROR] MLPMerch scrape failed for ${cardId}:`, err);
  }
  return { front: null, back: null };
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
    // Silent fail to next fallback
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
    
    if (card.image_url) continue;

    console.log(`\n--- Processing [${cardId}] ${card.name} ---`);

    let rawAssetUrls = await scrapeMlpMerch(cardId);
    let frontAssetUrl = rawAssetUrls.front;

    if (rawAssetUrls.back && !isCardBackUploaded) {
      console.log(`[INIT] Uploading global CardBack.webp...`);
      const backUpload = await processAndUploadImage(rawAssetUrls.back, 'CardBack.webp');
      if (backUpload) {
        isCardBackUploaded = true;
        console.log(`[SUCCESS] CardBack.webp secured in R2.`);
      }
    }

    if (frontAssetUrl) {
      console.log(`[MLPMERCH] Retrieved pristine scan from data.mlpmerch.com.`);
    } else {
      frontAssetUrl = await scrapeTcgMatch(cardId);
      if (frontAssetUrl) {
        console.log(`[TCGMATCH] MLPMerch missed. Retrieved scan from TCGmatch.`);
      } else {
        console.log(`[WIKI] MLPMerch and TCGmatch missed. Falling back to Miraheze Wiki...`);
        frontAssetUrl = await scrapeWikiArt(cardId, card.name);
      }
    }

    let finalAssetUrl: string | null = null;

    if (frontAssetUrl) {
      console.log(`[OPTIMIZER] Converting to WebP and uploading to R2...`);
      finalAssetUrl = await processAndUploadImage(frontAssetUrl, fileName);
      if (finalAssetUrl) uploadedCount++;
    }

    if (finalAssetUrl) {
      await pool.query('UPDATE game.cards SET image_url = $1 WHERE id = $2', [finalAssetUrl, cardId]);
      console.log(`[DB] Associated ${cardId} with R2 asset.`);
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