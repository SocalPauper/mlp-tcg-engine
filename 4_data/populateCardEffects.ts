import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com')
    ? { rejectUnauthorized: false }
    : undefined,
});

const VALID_GAME_KEYWORD_REGEX =
  /\b(Appear|Farewell|Adventure|Pre-?Plan|Inspo|Inspiration|When|Choose|Draw|Retire|Cost|Adorn|Only|Reveal|Discard|Put|Switch|Move|Each|All|While|If|Turn|Rival|Hand|Deck|Scene|Story|Plan|Treat|Present|Win|Mane)\b/i;

function normalizeOcrText(raw: string): string {
  let cleaned = raw
    .replace(/\r?\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    // Normalize Japanese corner brackets 「Name」
    .replace(/[\[\(「｢]\s*([A-Za-z0-9 .'-]+?)\s*[\]\)」｣]/g, '「$1」')
    // Normalize printed red/black keyword pills
    .replace(/\bPre[\s-]*plan\b/gi, 'Pre-Plan:')
    .replace(/\bAppear\b(?!\s*:)/gi, 'Appear:')
    .replace(/\bFarewell\b(?!\s*:)/gi, 'Farewell:')
    .replace(/\bAdventure\b(?!\s*:)(?=\s+[A-Z])/g, 'Adventure:')
    .replace(/\bInspo\s*Boost\b(?!\s*:)/gi, 'Inspo Boost:')
    .replace(/\bInspiration\s*Boost\b(?!\s*:)/gi, 'Inspiration Boost:')
    .replace(/\bMane\s*Ability\b(?!\s*:)/gi, 'Mane Ability:')
    .replace(/:\s*:/g, ':')
    // Fix common OCR symbol slips in Kayou card phrasing
    .replace(/\bAdventure:\s*Area\b/gi, 'Adventure Area')
    .replace(/\bScene:\s*Area\b/gi, 'Scene Area')
    .replace(/\bRetirement:\s*Area\b/gi, 'Retirement Area')
    .replace(/\bStory:\s*Area\b/gi, 'Story Area')
    .replace(/[—–]\s*(\d+)\s*Inspiration/gi, '-$1 Inspiration')
    .replace(/\+\s*(\d+)\s*Inspiration/gi, '+$1 Inspiration')
    // Strip footer card-code & copyright noise
    .replace(/\b(?:SD\d+|BP\d+|TK\d+)[A-Z0-9-]*\b.*$/i, '')
    .replace(/1st\s*Edition.*$/i, '')
    .replace(/©\s*\d{4}\s*Hasbro\.?/gi, '')
    // Trim stray leading/trailing non-alphanumeric OCR artifacts (hyphen placed at end of class)
    .replace(/^[^A-Za-z0-9「+(-]+/, '')
    .replace(/[^A-Za-z0-9.」)!?]+$/, '')
    .trim();

  if (!VALID_GAME_KEYWORD_REGEX.test(cleaned)) {
    return '';
  }

  return cleaned;
}

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL missing in root .env');
  }

  const client = await pool.connect();
  const worker = await createWorker('eng');

  try {
    console.log('1. Clearing all existing effect_text values in game.cards...');
    await client.query(`UPDATE game.cards SET effect_text = ''`);

    const { rows: cards } = await client.query<{
      id: string;
      name: string;
      card_type: string;
      image_url: string | null;
    }>(`
      SELECT id, name, card_type, image_url
      FROM game.cards
      WHERE image_url IS NOT NULL AND TRIM(image_url) <> ''
      ORDER BY id ASC
    `);

    console.log(`2. Scanning all ${cards.length} cards from R2...`);

    let abilityCount = 0;
    let vanillaCount = 0;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      try {
        const res = await fetch(card.image_url!);
        if (!res.ok) {
          console.warn(`[${i + 1}/${cards.length}] ⚠️ HTTP ${res.status} for ${card.id}`);
          continue;
        }

        const imgBuffer = Buffer.from(await res.arrayBuffer());
        const meta = await sharp(imgBuffer).metadata();
        const width = meta.width || 500;
        const height = meta.height || 700;

        const isStory =
          String(card.card_type || '').toLowerCase() === 'story' || width > height;

        // Tight crop isolated strictly to the rules text box
        const cropRegion = isStory
          ? {
              left: Math.floor(width * 0.08),
              top: Math.floor(height * 0.67),
              width: Math.floor(width * 0.84),
              height: Math.floor(height * 0.23),
            }
          : {
              left: Math.floor(width * 0.09),
              top: Math.floor(height * 0.725),
              width: Math.floor(width * 0.82),
              height: Math.floor(height * 0.18),
            };

        const processedBox = await sharp(imgBuffer)
          .extract(cropRegion)
          .resize({ width: cropRegion.width * 2 })
          .grayscale()
          .linear(1.3, -25)
          .sharpen()
          .toBuffer();

        const {
          data: { text },
        } = await worker.recognize(processedBox);

        const parsedEffect = normalizeOcrText(text);

        if (parsedEffect) {
          await client.query(`UPDATE game.cards SET effect_text = $1 WHERE id = $2`, [
            parsedEffect,
            card.id,
          ]);
          abilityCount++;
          console.log(`[${i + 1}/${cards.length}] ✅ ${card.id} (${card.name}): "${parsedEffect}"`);
        } else {
          vanillaCount++;
        }
      } catch (err: any) {
        console.error(`[${i + 1}/${cards.length}] ❌ Error on ${card.id}:`, err.message);
      }
    }

    console.log(
      `\nComplete! Populated ${abilityCount} cards with clean ability text and left ${vanillaCount} vanilla cards blank.`
    );
  } finally {
    await worker.terminate();
    client.release();
    await pool.end();
  }
}

run();