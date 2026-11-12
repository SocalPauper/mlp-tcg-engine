import dotenv from 'dotenv';
import { pool } from './db.js';
dotenv.config();
const WIKI_API = 'https://kayoumylittleponycardgame.miraheze.org/w/api.php';
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function fetchWikiAllPages() {
    const titles = [];
    let aplcontinue = null;
    let pageBatch = 1;
    do {
        const queryUrl = new URL(WIKI_API);
        queryUrl.searchParams.set('action', 'query');
        queryUrl.searchParams.set('list', 'allpages');
        queryUrl.searchParams.set('aplimit', '500');
        queryUrl.searchParams.set('format', 'json');
        if (aplcontinue)
            queryUrl.searchParams.set('apcontinue', aplcontinue);
        console.log(`[API] Fetching wiki page batch ${pageBatch}...`);
        const res = await fetch(queryUrl.toString(), {
            headers: { 'User-Agent': 'EquestriaClashEngine/1.0 (admin@socalpauper.com)' },
        });
        if (!res.ok) {
            console.warn(`[API] Failed to fetch pages batch: ${res.status} ${res.statusText}`);
            break;
        }
        const data = await res.json();
        const list = data.query?.allpages || [];
        for (const page of list) {
            if (page.title)
                titles.push(page.title);
        }
        aplcontinue = data.continue?.apcontinue || null;
        pageBatch++;
    } while (aplcontinue);
    console.log(`[API] Finished discovery. Total wiki pages found: ${titles.length}`);
    return titles;
}
async function fetchWikiPageWikitext(pageTitle) {
    const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext&format=json&origin=*`;
    const response = await fetch(url, {
        headers: { 'User-Agent': 'EquestriaClashEngine/1.0' },
    });
    if (!response.ok)
        return '';
    const data = await response.json();
    return data.parse?.wikitext?.['*'] || '';
}
async function runDataSync() {
    console.log('[DATA SYNC] Scraping full card database with sanitized IDs and robust parsing...');
    const allPageTitles = await fetchWikiAllPages();
    const cardPageTitles = allPageTitles.filter(title => /^[※]?[A-Z0-9]+-[A-Z0-9]+/.test(title));
    const targetPages = cardPageTitles;
    console.log(`[DATA SYNC] Total card pages targeted: ${targetPages.length}. Starting database upserts...`);
    const client = await pool.connect();
    try {
        await client.query(`
      ALTER TABLE game.cards ADD COLUMN IF NOT EXISTS set_code VARCHAR(100);
      ALTER TABLE game.cards ADD COLUMN IF NOT EXISTS cost INT DEFAULT 0;
      ALTER TABLE game.cards ADD COLUMN IF NOT EXISTS power INT DEFAULT 0;
      ALTER TABLE game.cards ADD COLUMN IF NOT EXISTS defense INT DEFAULT 0;
      ALTER TABLE game.cards ADD COLUMN IF NOT EXISTS traits TEXT;
      ALTER TABLE game.cards ADD COLUMN IF NOT EXISTS effect_text TEXT;
      ALTER TABLE game.cards ADD COLUMN IF NOT EXISTS flavor_text TEXT;
      ALTER TABLE game.cards ADD COLUMN IF NOT EXISTS element TEXT;
      ALTER TABLE game.cards ADD COLUMN IF NOT EXISTS rarity TEXT;
      ALTER TABLE game.cards ADD COLUMN IF NOT EXISTS artist VARCHAR(100);

      ALTER TABLE game.cards ALTER COLUMN rarity TYPE TEXT;
      ALTER TABLE game.cards ALTER COLUMN element TYPE TEXT;
      ALTER TABLE game.cards ALTER COLUMN set_code TYPE VARCHAR(100);
    `);
        console.log('[DB MIGRATE] game.cards schema verified/updated successfully.');
        await client.query('BEGIN');
        const validElements = new Set(['Magic', 'Honesty', 'Kindness', 'Laughter', 'Generosity', 'Loyalty']);
        const validRarities = new Set(['C', 'U', 'R', 'SR', 'SSR', 'UR', 'PR', 'P', 'SEC']);
        let count = 0;
        for (const title of targetPages) {
            const titleMatch = title.match(/^([※]?[A-Z0-9]+-[A-Z0-9]+)/);
            if (!titleMatch)
                continue;
            // Sanitize ID completely by stripping the shining symbol
            const cardId = titleMatch[1].replace(/※/g, '').trim();
            let setCode = cardId.split('-')[0]; // Enforce strict parent set prefix (e.g. BP04)
            let cardName = title.replace(/^([※]?[A-Z0-9]+-[A-Z0-9]+)/, '').trim();
            const wikitext = await fetchWikiPageWikitext(title);
            const templateMatch = wikitext.match(/\{\{([a-zA-Z0-9_-]+)\s*\|([\s\S]*?)\}\}/);
            const templateName = templateMatch ? templateMatch[1].toLowerCase() : '';
            const rawParams = [];
            const namedParams = {};
            if (templateMatch && templateMatch[2]) {
                const parts = templateMatch[2].split('|');
                for (const part of parts) {
                    const trimmed = part.trim();
                    const eqIdx = trimmed.indexOf('=');
                    if (eqIdx > 0) {
                        const key = trimmed.substring(0, eqIdx).trim().toLowerCase();
                        const val = trimmed.substring(eqIdx + 1).trim();
                        namedParams[key] = val;
                    }
                    else {
                        rawParams.push(trimmed);
                    }
                }
            }
            const cleanParam = (val) => {
                if (!val)
                    return '';
                let cleaned = val.replace(/<!--[\s\S]*?-->/g, '').trim();
                const nestedMatch = cleaned.match(/\{\{([^\|}]+)(?:\|([^}]+))?\}\}/);
                if (nestedMatch) {
                    const macro = nestedMatch[1].trim();
                    const arg = nestedMatch[2] ? nestedMatch[2].trim() : '';
                    if (validElements.has(macro))
                        return macro;
                    if (validElements.has(arg))
                        return arg;
                    return arg || macro;
                }
                return cleaned
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/\[\[(?:[^\]]*\|)?([^\]]+)\]\]/g, '$1')
                    .trim();
            };
            let rarity = namedParams['rarity'] || 'C';
            let traits = namedParams['trait'] || namedParams['traits'] || 'Pony';
            let element = namedParams['element'] || namedParams['color'] || null;
            let cost = parseInt(namedParams['cost']) || 0;
            let power = parseInt(namedParams['power']) || 0;
            let ability = namedParams['effect'] || namedParams['ability'] || '';
            let flavor = namedParams['flavor'] || '';
            if (templateName.includes('character')) {
                if (rawParams[1] && validRarities.has(rawParams[1].toUpperCase()))
                    rarity = rawParams[1].toUpperCase();
                if (!cardName && rawParams[3])
                    cardName = cleanParam(rawParams[3]);
                if (!traits && rawParams[4])
                    traits = cleanParam(rawParams[4]);
                const numericValues = cost > 0 ? [cost] : [];
                const textTokens = [];
                for (let i = 0; i < rawParams.length; i++) {
                    const val = cleanParam(rawParams[i]);
                    if (!val)
                        continue;
                    if (!element && validElements.has(val)) {
                        element = val;
                    }
                    else if (/^\d+$/.test(val)) {
                        numericValues.push(parseInt(val, 10));
                    }
                    else if (i > 4) {
                        textTokens.push(val);
                    }
                }
                if (cost === 0 && numericValues.length >= 1)
                    cost = numericValues[0];
                if (power === 0 && numericValues.length >= 2)
                    power = numericValues[1];
                if (!ability && textTokens.length > 0)
                    ability = textTokens.join('\n');
            }
            if (!cardName)
                cardName = `Card ${cardId}`;
            const defense = power;
            if (!element) {
                if (cardName.includes('Twilight Sparkle'))
                    element = 'Magic';
                else if (cardName.includes('Applejack'))
                    element = 'Honesty';
                else if (cardName.includes('Fluttershy'))
                    element = 'Kindness';
                else if (cardName.includes('Pinkie Pie'))
                    element = 'Laughter';
                else if (cardName.includes('Rarity'))
                    element = 'Generosity';
                else if (cardName.includes('Rainbow Dash'))
                    element = 'Loyalty';
            }
            const safeImageKey = `https://${process.env.R2_PUBLIC_URL}/cards/${cardId}.webp`;
            await client.query(`
        INSERT INTO game.cards (
          id, name, set_code, cost, power, defense, traits, effect_text, flavor_text, element, rarity, image_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          set_code = EXCLUDED.set_code,
          cost = EXCLUDED.cost,
          power = EXCLUDED.power,
          defense = EXCLUDED.defense,
          traits = EXCLUDED.traits,
          effect_text = EXCLUDED.effect_text,
          flavor_text = EXCLUDED.flavor_text,
          element = EXCLUDED.element,
          rarity = EXCLUDED.rarity,
          image_url = EXCLUDED.image_url;
      `, [cardId, cardName, setCode, cost, power, defense, traits, ability, flavor || null, element, rarity, safeImageKey]);
            count++;
            if (count % 50 === 0) {
                console.log(`[PROGRESS] Synced ${count}/${targetPages.length} cards...`);
            }
            await delay(20);
        }
        await client.query('COMMIT');
        console.log('[SUCCESS] Full card database synchronization complete with sanitized IDs!');
    }
    catch (err) {
        await client.query('ROLLBACK');
        console.error('[ERROR]', err);
    }
    finally {
        client.release();
        await pool.end();
    }
}
runDataSync().catch(console.error);
