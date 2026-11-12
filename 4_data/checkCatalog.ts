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
    accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY || ''
  }
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'equestria-clash-assets';
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_URL || 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev';

async function uploadToR2(buffer: Buffer, fileName: string) {
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

async function runDirectSync() {
  console.log('[SYNC] Pulling all unverified cards from database...');
  // Targets any card missing a valid Cloudflare R2 link
  const { rows: cards } = await pool.query("SELECT id, name, image_url FROM game.cards WHERE image_url IS NULL OR image_url NOT LIKE '%pub-%' ORDER BY id ASC");
  
  console.log(`[SYNC] Found ${cards.length} cards requiring master asset resolution.`);

  let fixedCount = 0;
  for (const card of cards) {
    const cardId = card.id;
    console.log(`\n--- Processing [${cardId}] ${card.name} ---`);
    
    let targetId = cardId;
    let isShining = false;
    if (cardId.endsWith('-S')) {
      targetId = cardId.replace(/-S$/, '');
      isShining = true;
    }

    const code = targetId.split('-')[1] || '';
    let directUrl = '';

    if (cardId.startsWith('BP04-')) {
      const variantCode = isShining ? `X${code}` : code;
      directUrl = `https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhvXs9KIf5OrB7CSCFq6Ly9BoiRTUIUtqnRBqp3rrC9Qv_CRsmCrypJ833jZYG5Y62v_f7h4hkWa7iM1BV2KJXwVEELoOFX-BeTabol8DgY9PJvaXpxURp7dNpc9Lu0r0UZC1yMPDOEf2VAOMjkH/s1600/MLP-Kayou-Trading-Card-Game-Booster-Pack-Hearth%27s-Warming-Eve-${variantCode}.jpg`;
    } else if (cardId.startsWith('SD01')) {
      const charMap: Record<string, string> = {
        'SD01A': 'Twilight-Sparkle',
        'SD01B': 'Fluttershy',
        'SD01C': 'Pinkie-Pie',
        'SD01D': 'Applejack',
        'SD01E': 'Rainbow-Dash',
        'SD01F': 'Rarity'
      };
      const prefix = cardId.split('-')[0];
      const charName = charMap[prefix] || 'Twilight-Sparkle';
      const variantCode = isShining ? `X${code}` : code;
      directUrl = `https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEiWnLSPCw_RJUENQ0H4gp6BAq8Ll-38oj755ZGVxIzyP671jFuNCmGjKIj6cZwCUdHZt-s66am4vVSuPIEe0Lu2Jt8Juq8dtf_6MmGPGHI9uhmDA0Vl1jzjePryKlgG6T2UAHR0SyqgK1SLV0-UwPfgyvdpDVZ0B5rsWIO50GFvRrO1bFlFXTSYTzV-M2QU/s1600/MLP-Kayou-Trading-Card-Game-Friendships-Begin-${charName}-${variantCode}.jpg`;
    } else if (cardId.startsWith('GR-') || cardId.startsWith('TK-')) {
      directUrl = `https://data.mlpmerch.com/kayou-cards/subset/other/promotional/images/${cardId}.jpg`;
    }

    if (!directUrl) {
      console.log(`[SKIPPED] No direct URL rule for ${cardId}`);
      continue;
    }

    try {
      console.log(`Fetching: ${directUrl}`);
      const res = await fetch(directUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) {
        console.log(`[FAILED] Server returned ${res.status}. Falling back to base card if shining.`);
        if (isShining) {
           // Fallback to base card image if variant asset is missing
           const baseCardRes = await pool.query("SELECT image_url FROM game.cards WHERE id = $1", [targetId]);
           if (baseCardRes.rows.length > 0 && baseCardRes.rows[0].image_url) {
              await pool.query('UPDATE game.cards SET image_url = $1 WHERE id = $2', [baseCardRes.rows[0].image_url, cardId]);
              console.log(`[FALLBACK FIXED] Mapped -S variant to base asset URL.`);
              fixedCount++;
           }
        }
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer[0] === 0x3C) {
        console.log(`[SKIPPED] Got HTML error page instead of image.`);
        continue;
      }

      const webpBuffer = await sharp(buffer).webp({ quality: 90 }).toBuffer();
      const finalUrl = await uploadToR2(webpBuffer, `${cardId}.webp`);
      
      await pool.query('UPDATE game.cards SET image_url = $1 WHERE id = $2', [finalUrl, cardId]);
      console.log(`[FIXED] R2 Link: ${finalUrl}`);
      fixedCount++;

    } catch (err) {
      console.error(`[ERROR] Failed processing ${cardId}:`, err);
    }

    await new Promise(resolve => setTimeout(resolve, 150));
  }

  console.log(`\n[COMPLETE] Successfully resolved ${fixedCount} cards.`);
  await pool.end();
}

runDirectSync();