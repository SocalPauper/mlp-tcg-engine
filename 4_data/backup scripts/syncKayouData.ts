import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const WIKI_API = 'https://kayoumylittleponycardgame.miraheze.org/w/api.php';
const TARGET_WIDTH = 480;
const WEBP_QUALITY = 80;

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET_KEY!,
  }
});

interface WikiImage {
  name: string;
  url: string;
}

async function fetchAllWikiImages(): Promise<WikiImage[]> {
  const images: WikiImage[] = [];
  let aicontinue: string | null = null;

  do {
    const queryUrl = new URL(WIKI_API);
    queryUrl.searchParams.set('action', 'query');
    queryUrl.searchParams.set('list', 'allimages');
    queryUrl.searchParams.set('ailimit', '500');
    queryUrl.searchParams.set('format', 'json');
    if (aicontinue) queryUrl.searchParams.set('aicontinue', aicontinue);

    const res = await fetch(queryUrl.toString(), {
      headers: { 'User-Agent': 'EquestriaClashEngine/1.0 (admin@socalpauper.com)' },
    });
    if (!res.ok) break;

    const data: any = await res.json();
    const list = data.query?.allimages || [];
    for (const item of list) {
      if (item.name && item.url) {
        images.push({ name: item.name, url: item.url });
      }
    }
    aicontinue = data.continue?.aicontinue || null;
  } while (aicontinue);

  return images;
}

async function fileExistsInR2(key: string): Promise<boolean> {
  try {
    await r2Client.send(new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    }));
    return true;
  } catch (err: any) {
    return false;
  }
}

async function runAutonomousImageSync() {
  console.log('[AUTONOMOUS R2 IMAGE SYNC] Starting sync & local directory fallback...');
  
  // 1. Sync from local fallback directory first if it exists
  const localDir = path.resolve(process.cwd(), '4_data', 'assets', 'cards');
  if (fs.existsSync(localDir)) {
    const files = fs.readdirSync(localDir);
    console.log(`[LOCAL FALLBACK] Scanning ${files.length} files in local directory...`);
    
    for (const file of files) {
      if (!file.match(/\.(png|jpg|jpeg|webp)$/i)) continue;
      const cleanMatch = file.match(/^(※?[A-Z0-9]+-[A-Z0-9]+)/i);
      if (!cleanMatch) continue;

      const rawId = cleanMatch[1];
      const normalizedId = rawId.replace('※', 'shining-');
      const r2Key = `cards/${normalizedId}.webp`;

      if (await fileExistsInR2(r2Key)) continue;

      try {
        const filePath = path.join(localDir, file);
        const fileBuffer = fs.readFileSync(filePath);
        const webpBuffer = await sharp(fileBuffer)
          .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY, effort: 4 })
          .toBuffer();

        await r2Client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: r2Key,
          Body: webpBuffer,
          ContentType: 'image/webp',
        }));
        console.log(`[LOCAL UPLOADED] ${file} -> ${r2Key}`);
      } catch (err: any) {
        console.warn(`[LOCAL SKIP] Failed to process ${file}: ${err.message}`);
      }
    }
  }

  // 2. Continue with live wiki discovery & online sync
  const allImages = await fetchAllWikiImages();
  for (const img of allImages) {
    const match = img.name.match(/^(※?[A-Z0-9]+-[A-Z0-9]+)/i);
    if (!match) continue;

    const cardId = match[1].toUpperCase();
    const safeFileName = cardId.replace('※', 'shining-');
    const r2Key = `cards/${safeFileName}.webp`;

    if (await fileExistsInR2(r2Key)) continue;

    try {
      const res = await fetch(img.url, {
        headers: { 'User-Agent': 'EquestriaClashEngine/1.0 (admin@socalpauper.com)' },
      });
      if (!res.ok) continue;
      const arrayBuffer = await res.arrayBuffer();

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

      console.log(`[WIKI UPLOADED] ${cardId} -> ${r2Key}`);
    } catch (err: any) {
      console.warn(`[WIKI FAILED] ${cardId}: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 60));
  }
  console.log('[SUCCESS] Autonomous image synchronization complete.');
}

runAutonomousImageSync().catch(console.error);