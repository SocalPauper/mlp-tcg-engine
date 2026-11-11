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
    // Suppress errors to keep terminal clean
  }
  return null;
}

async function recoverMissingImages() {
  console.log('[SMART RECOVERY] Initializing missing image sync...');
  const client = await pool.connect();
  
  try {
    const res = await client.query('SELECT id FROM game.cards ORDER BY id');
    const cards = res.rows;
    console.log(`[SMART RECOVERY] Checking ${cards.length} cards against Cloudflare R2...`);

    let uploadedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const card of cards) {
      const cardId = card.id;
      const r2Key = `cards/${cardId}.webp`;
      const publicR2Url = `https://${cleanPubUrl}/${r2Key}`;

      // 1. Check if image already exists in your R2 bucket
      try {
        const checkRes = await fetch(publicR2Url, { method: 'HEAD' });
        if (checkRes.ok) {
          skippedCount++;
          continue; // Image exists, skip processing
        }
      } catch (err) {
         // Network error on check, proceed to try downloading anyway
      }

      // 2. If missing, try different file extensions on the Wiki
      const rawWikiFileName = cardId.replace('-S', ''); 
      const extensions = ['png', 'jpg', 'jpeg'];
      let targetUrl: string | null = null;

      for (const ext of extensions) {
        targetUrl = await fetchFileUrlFromWiki(`${rawWikiFileName}.${ext}`);
        if (targetUrl) break; // Stop checking if we found a match
      }
      
      if (targetUrl && !/[\u4e00-\u9fa5]/.test(targetUrl)) {
        try {
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
            
            uploadedCount++;
            console.log(`[RECOVERED] Successfully grabbed and uploaded ${cardId}`);
          } else {
            failedCount++;
            console.log(`[FAILED] Wiki returned bad response for ${cardId}`);
          }
        } catch (err) {
          failedCount++;
          console.log(`[FAILED] Error processing ${cardId}`);
        }
      } else {
        failedCount++;
        console.log(`[NOT FOUND] No image found on Wiki for ${cardId}`);
      }

      await delay(400); // Safer delay
    }

    console.log(`\n[SUCCESS] Smart Recovery complete.`);
    console.log(`- Skipped (Already in R2): ${skippedCount}`);
    console.log(`- Uploaded Missing Images: ${uploadedCount}`);
    console.log(`- Still Missing/Failed: ${failedCount}`);
  } catch (err) {
    console.error('[ERROR]', err);
  } finally {
    client.release();
    await pool.end();
  }
}

recoverMissingImages().catch(console.error);