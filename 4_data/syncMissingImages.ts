import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
    // Ignore errors for missing files
  }
  return null;
}

async function recoverMissingImages() {
  console.log('[RECOVERY] Initializing missing image sync...');
  const client = await pool.connect();
  
  try {
    const res = await client.query('SELECT id FROM game.cards ORDER BY id');
    const cards = res.rows;
    console.log(`[RECOVERY] Found ${cards.length} cards in database. Checking Wiki for assets...`);

    let uploadedCount = 0;
    let failedCount = 0;

    for (const card of cards) {
      const cardId = card.id;
      const rawWikiFileName = cardId.replace('-S', ''); // Revert Shining ID to Wiki filename format
      const r2Key = `cards/${cardId}.webp`;

      try {
        let targetUrl = await fetchFileUrlFromWiki(`${rawWikiFileName}.png`);
        
        if (targetUrl) {
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
            if (uploadedCount % 25 === 0) console.log(`[RECOVERY] Uploaded ${uploadedCount} images...`);
          } else {
            failedCount++;
          }
        } else {
          failedCount++;
        }
      } catch (err) {
        failedCount++;
      }

      await delay(500); // 500ms delay to prevent Wiki/R2 rate limits
    }

    console.log(`[SUCCESS] Recovery complete. Uploaded ${uploadedCount} missing images. ${failedCount} files were not found on the wiki.`);
  } catch (err) {
    console.error('[ERROR]', err);
  } finally {
    client.release();
    await pool.end();
  }
}

recoverMissingImages().catch(console.error);