import dotenv from 'dotenv';
dotenv.config();

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function deepScanCard(cardId: string, cardName: string) {
  // Format the name into a MediaWiki URL slug (spaces to underscores, encode quotes/special chars)
  const formattedName = cardName ? cardName.replace(/\s+/g, '_').replace(/'/g, '%27') : '';
  const wikiUrl = formattedName 
    ? `https://kayoumylittleponycardgame.miraheze.org/wiki/${cardId}_${formattedName}`
    : `https://kayoumylittleponycardgame.miraheze.org/wiki/${cardId}`;

  console.log(`[SEARCHING] Scraping wiki page: ${wikiUrl}...`);

  try {
    let res = await fetch(wikiUrl);
    
    // Fallback to just the ID if the slug URL fails
    if (!res.ok) {
      const fallbackUrl = `https://kayoumylittleponycardgame.miraheze.org/wiki/${cardId}`;
      res = await fetch(fallbackUrl);
    }

    if (!res.ok) {
      console.log(`[GHOST CARD] Page not found on Wiki for ${cardId}`);
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    let imageUrl: string | null = null;
    let englishImageUrl: string | null = null;

    // Scan all images on the page for English variants or exact ID matches
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      const alt = $(el).attr('alt') || '';
      
      if (src) {
        let fullUrl = src.startsWith('http') ? src : `https:${src}`;
        if (fullUrl.includes('/thumb/')) {
          fullUrl = fullUrl.replace('/thumb/', '/').substring(0, fullUrl.lastIndexOf('/'));
        }

        const lowerSrc = fullUrl.toLowerCase();
        const lowerAlt = alt.toLowerCase();

        if (lowerSrc.includes('english') || lowerAlt.includes('english')) {
          englishImageUrl = fullUrl;
        } else if (lowerSrc.includes(cardId.toLowerCase())) {
          imageUrl = fullUrl;
        }
      }
    });

    const finalImage = englishImageUrl || imageUrl;

    if (finalImage) {
      console.log(`[RECOVERED] Extracted art for ${cardId}: ${finalImage}`);
      return finalImage;
    } else {
      console.log(`[GHOST CARD] No art found on Wiki for ${cardId}`);
      return null;
    }

  } catch (err) {
    console.error(`[ERROR] Failed scraping ${cardId}:`, err);
    return null;
  }
}

async function runDeepScan() {
  console.log('[DEEP SCAN] Initializing advanced Wiki page scraper...');
  
  const { rows: cards } = await pool.query(`
    SELECT id, name, image_url FROM game.cards 
    WHERE id LIKE '%-ER%' OR id LIKE '%-C2%' OR id LIKE '%-C3%' OR id LIKE '%-C4%'
  `);

  console.log(`[DEEP SCAN] Found ${cards.length} cards to verify.`);

  for (const card of cards) {
    const recoveredUrl = await deepScanCard(card.id, card.name);
    if (recoveredUrl) {
      await pool.query(`UPDATE game.cards SET image_url = $1 WHERE id = $2`, [recoveredUrl, card.id]);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('[DEEP SCAN] Scan complete!');
  await pool.end();
}

runDeepScan();