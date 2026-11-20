export function getCardFoilClass(
  card:
    | {
        id?: string | null;
        card_id?: string | null;
        rarity?: string | null;
      }
    | null
    | undefined
): string {
  if (!card) return '';
  const id = String(card.id || card.card_id || '')
    .trim()
    .toUpperCase();
  const rar = String(card.rarity || '')
    .trim()
    .toUpperCase();

  // Tier 1 Crown Chase: Diamond Rare (DR), Gold Rare (GR), and Shining Alternate Arts (-S)
  if (id.endsWith('-S') || rar === 'DR' || rar === 'DIAMOND' || rar === 'GR') {
    return 'foil-shining foil-diamond-gold';
  }

  // Tier 2 High Chase: Crystal Rare (CR) and Ultra Rare (UR)
  if (rar === 'CR' || rar === 'UR') {
    return 'foil-ur foil-crystal-ur';
  }

  // Tier 3 Parallel Foil: Special Parallel Rare (SPR) and Super Secret Rare (SSR)
  if (rar === 'SPR' || rar === 'SSR') {
    return 'foil-spr-ssr';
  }

  // Tier 4 Holofoil: Super Rare (SR)
  if (rar === 'SR') {
    return 'foil-sr';
  }

  return '';
}
