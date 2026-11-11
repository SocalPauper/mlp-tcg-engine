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

async function findImageViaPageScrape(cardId: string): Promise<string | null> {
  try {
    const rawCardId = cardId.replace('-S', '');
    
    // 1. Search the Wiki for the exact page title using the Card ID
    const searchUrl = `${WIKI_API}?action=query&list=search&srsearch=${encodeURIComponent(rawCardId)}&format=json&origin=*`;
    const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': 'EquestriaClashEngine/1.0' } });
    const searchData = await searchRes.json();
    
    if (!searchData.query?.search?.length) return null;
    const pageTitle = searchData.query.search[0].title;

    // 2. Ask the Wiki API what images are embedded on that specific page
    const parseUrl = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageTitle)}&prop=images&format=json&origin=*`;
    const parseRes = await fetch(parseUrl, { headers: { 'User-Agent': 'EquestriaClashEngine/1.0' } });
    const parseData = await parseRes.json();
    const images = parseData.parse?.images || [];

    // Filter out UI icons or common wiki assets
    const validImages = images.filter((img: string) => 
      !img.toLowerCase().includes('icon') && 
      !img.toLowerCase().includes('logo') &&
      (img.toLowerCase().endsWith('.png') || img.toLowerCase().endsWith('.jpg') || img.toLowerCase().endsWith('.jpeg'))
    );

    if (!validImages.length) return null;

    // 3. Resolve the actual URL for the first valid image attached to the page
    const fileTitle = `File:${validImages[0]}`;
    const fileUrl = `${WIKI_API}?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
    const fileRes = await fetch(fileUrl, { headers: { 'User-Agent': 'EquestriaClashEngine/1.0' } });
    const fileData = await fileRes.json();
    
    const pages = fileData.query?.pages || {};
    for (const pid in pages) {
      if (pages[pid].imageinfo && pages[pid].imageinfo[0]?.url) {
        return pages[pid].imageinfo[0].url;
      }
    }
  } catch (err) {
    // Suppress
  }
  return null;
}

async function runDeepScan() {
  console.log('[DEEP SCAN] Initializing advanced Wiki page scraper...');
  const client = await pool.connect();
  
  try {
    const res = await client.query('SELECT id FROM game.cards ORDER BY id');
    const cards = res.rows;
    
    let uploadedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const card of cards) {
      const cardId = card.id;
      const r2Key = `cards/${cardId}.webp`;
      const publicR2Url = `https://${cleanPubUrl}/${r2Key}`;

      try {
        const checkRes = await fetch(publicR2Url, { method: 'HEAD' });
        if (checkRes.ok) {
          skippedCount++;
          continue; 
        }
      } catch (err) {}

      console.log(`[SEARCHING] Scraping wiki page for missing card: ${cardId}...`);
      const targetUrl = await findImageViaPageScrape(cardId);
      
      if (targetUrl && !/[\u4e00-\u9fa5]/.test(targetUrl)) {
        try {
          const imgRes = await fetch(targetUrl, { headers: { 'User-Agent': 'EquestriaClashEngine/1.0' } });
          if (imgRes.ok) {
            const arrayBuffer = await imgRes.arrayBuffer();
            const webpBuffer = await sharp(Buffer.from(arrayBuffer))
              .resize({ width: 480, withoutEnlargement: true })
              .webp({ quality: 80, effort: 4 })
              .toBuffer();

            await r2Client.send(new PutObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME,
              Key: r2Key,
              Body: webpBuffer,
              ContentType: 'image/webp',
            }));
            
            uploadedCount++;
            console.log(`[RECOVERED] Extracted hidden art for ${cardId}`);
          } else {
            failedCount++;
          }
        } catch (err) {
          failedCount++;
        }
      } else {
        failedCount++;
        console.log(`[GHOST CARD] Absolutely no art exists on the Wiki for ${cardId}`);
      }

      await delay(500); // 500ms delay to keep the MediaWiki API happy
    }

    console.log(`\n[SUCCESS] Deep Scan complete.`);
    console.log(`- Skipped (Already in R2): ${skippedCount}`);
    console.log(`- Uploaded Missing Images: ${uploadedCount}`);
    console.log(`- Wiki Pages Missing Art: ${failedCount}`);
  } catch (err) {
    console.error('[ERROR]', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runDeepScan().catch(console.error);