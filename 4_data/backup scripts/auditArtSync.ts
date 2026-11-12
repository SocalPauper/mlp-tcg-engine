import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import { pool } from './db.js';

dotenv.config();

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET_KEY!,
  },
});

async function auditArtMapping() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT id, name, image_url FROM cards;');
    const cards = res.rows;

    console.log(`[AUDIT] Checking R2 asset existence for ${cards.length} cards...`);
    let missingArtCount = 0;
    let matchedArtCount = 0;

    for (const card of cards) {
      // Recreate the safe key format matching our scraper (replacing ※ with shining-)
      const safeFileName = card.id.replace('※', 'shining-');
      const expectedKey = `cards/${safeFileName}.webp`;

      try {
        await r2Client.send(new HeadObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: expectedKey,
        }));
        matchedArtCount++;
      } catch (err) {
        missingArtCount++;
        console.warn(`[MISSING ASSET] Card ID ${card.id} (${card.name}) lacks R2 key: ${expectedKey}`);
      }
    }

    console.log('\n====================================================');
    console.log(`[AUDIT COMPLETE] Total Cards: ${cards.length}`);
    console.log(`[MATCHED] Found in R2: ${matchedArtCount}`);
    console.log(`[MISSING] Lacking R2 Asset: ${missingArtCount}`);
    console.log('====================================================\n');
  } finally {
    client.release();
    await pool.end();
  }
}

auditArtMapping().catch(console.error);