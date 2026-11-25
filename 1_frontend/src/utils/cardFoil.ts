export function getCardFoilClass(card: {
  id?: string | null;
  card_id?: string | null;
  rarity?: string | null;
} | null | undefined): string {
  if (!card) return '';
  const id = String(card.id || card.card_id || '').trim().toUpperCase();
  const rar = String(card.rarity || '').trim().toUpperCase();

  // Shining Foil (-S), Diamond Rare (DR), and Gold Rare (GR)
  if (id.endsWith('-S') || rar === 'DR' || rar === 'DIAMOND' || rar === 'GR') {
    return 'foil-shining';
  }
  // Ultra Rare (UR) and Crystal Rare (CR)
  if (rar === 'UR' || rar === 'CR') {
    return 'foil-ur';
  }
  // Super Rare (SR) and Super Secret Rare (SSR)
  if (rar === 'SR' || rar === 'SSR') {
    return 'foil-sr';
  }
  return '';
}