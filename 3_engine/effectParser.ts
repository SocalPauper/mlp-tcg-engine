import {
  AdventureSlot,
  CardDefinition,
  KayouGameState,
  LaneKey,
  LanePowerBreakdown,
  PlayerState,
  PowerModifierLine,
  SceneCardInPlay,
} from './types.js';

const KNOWN_PET_NAMES = new Set([
  'angel',
  'winona',
  'philomena',
  'turtle',
  'tank',
  'owlowiscious',
  'opal',
  'opalescence',
  'gummy',
]);

const NON_CHARACTER_TYPES = new Set(['event', 'scene', 'item', 'story', 'plan']);

export function isReactiveAdventureClause(clauseText?: string): boolean {
  const text = sanitizeCardText(clauseText).replace(/^(?<!un)\btap\s*:\s*/i, '').trim();
  if (!text) return false;
  return /^(?:at\s+the\s+end\s+of|when\s+(?:this\s+character|it)\s+intervenes\s+(?:the\s+)?plan)/i.test(
    text
  );
}

export function sanitizeCardText(raw?: string): string {
  if (!raw) return '';
  return raw
    .replace(/\{\{[^}]*$/g, '')
    .replace(/\{\{|\}\}/g, '')
    .replace(/\bonly\s+only\b/gi, 'Only')
    .trim();
}

export function extractBracketKeywords(raw?: string): string[] {
  const text = sanitizeCardText(raw);
  if (!text) return [];
  const matches = Array.from(text.matchAll(/[｢\[「]([^｣\]」]+)[｣\]」]/g));
  return matches.map((m) => m[1].trim()).filter(Boolean);
}

export function detectEffectKeywords(raw?: string): string[] {
  const text = sanitizeCardText(raw);
  if (!text) return [];
  const tags: string[] = [];
  if (/\bAppear\b/i.test(text)) tags.push('Appear');
  if (/\bFarewell\b/i.test(text)) tags.push('Farewell');
  if (/\bAdventure\b/i.test(text)) tags.push('Adventure');
  if (/\bPre-?Plan\b/i.test(text)) tags.push('Pre-Plan');
  if (/\bWhenever\b/i.test(text)) tags.push('Whenever');
  if (/\bWhile\b/i.test(text)) tags.push('While (Passive)');
  if (/\bIf\b/i.test(text)) tags.push('If (Condition)');
  if (/\bOnly\b/i.test(text)) tags.push('Only (Restriction)');
  if (/\b(?:Choose|Select)\b/i.test(text)) tags.push('Choose/Select (Player Input)');
  if (/(?<!un)\btap\b/i.test(text)) tags.push('Tap');
  if (/for each/i.test(text)) tags.push('Scaling: For Each');
  if (/treat/i.test(text)) tags.push('Mechanic: Treat');
  if (/present/i.test(text)) tags.push('Mechanic: Present');
  if (/at the end of/i.test(text)) tags.push('Delayed: End of Turn');
  if (/until the end of/i.test(text)) tags.push('Duration: Until End of Turn');
  if (/top or (?:the )?bottom/i.test(text)) tags.push('Top/Bottom Deck Choice');
  for (const kw of extractBracketKeywords(text)) {
    tags.push(`Keyword: 「${kw}」`);
  }
  return Array.from(new Set(tags));
}

export function matchesCardKeywordExact(
  card: CardDefinition,
  filterText: string,
  requireCharacterType = false
): boolean {
  const alternatives = filterText
    .split(/\s+or\s+/i)
    .map((part) => part.replace(/[｢\[「｣\]」]/g, '').trim().toLowerCase())
    .filter(Boolean);

  if (alternatives.length === 0) return true;

  const cardTypeLower = String(card.type || '').trim().toLowerCase();
  const isNonCharacter = NON_CHARACTER_TYPES.has(cardTypeLower);
  if (requireCharacterType && isNonCharacter) return false;

  const cardName = String(card.name || '').trim().toLowerCase();

  for (const target of alternatives) {
    if (!isNonCharacter && cardName === target) return true;
    if (isNonCharacter) continue;

    const extraText = String((card as any).traitsText || '').toLowerCase();
    const combinedKeywords = `${card.traits || ''} ${card.type || ''} ${extraText}`.toLowerCase();

    if (target === 'pet' && KNOWN_PET_NAMES.has(cardName)) {
      return true;
    }

    const traitTokens = combinedKeywords
      .split(/[,/|•·\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (!target.includes(' ') && traitTokens.includes(target)) {
      return true;
    }

    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundaryRegex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
    if (wordBoundaryRegex.test(combinedKeywords)) return true;
  }

  return false;
}

export function extractAdornRestriction(card: CardDefinition): string | null {
  const text = sanitizeCardText(card.effectText);
  if (!text) return null;
  const adornMatch = text.match(
    /only\s+adorn\s+([｢\[「][^｣\]」]+[｣\]」](?:\s+or\s+[｢\[「][^｣\]」]+[｣\]」])*)/i
  );
  return adornMatch ? adornMatch[1].trim() : null;
}

export function extractItemGrantedAdventureClause(slot: AdventureSlot): {
  sourceCard: CardDefinition;
  clause: string;
} | null {
  for (const item of slot.items || []) {
    const text = sanitizeCardText(item.effectText);
    const granted = text.match(/adorned\s+character\s+gains\s*:?\s*"([^"]+)"/i);
    if (granted && /adventure\s*:/i.test(granted[1])) {
      const inner = extractTriggerClause(granted[1], 'Adventure') || granted[1];
      return { sourceCard: item, clause: inner };
    }
  }
  return null;
}

export function canPlayCardRestrictions(
  state: KayouGameState,
  playerId: '0' | '1',
  card: CardDefinition,
  targetLane?: LaneKey
): { allowed: boolean; reason?: string } {
  const text = sanitizeCardText(card.effectText);
  if (!text) return { allowed: true };

  const adornRequired = extractAdornRestriction(card);
  if (adornRequired && targetLane) {
    const targetChar = state.players[playerId].adventureArea[targetLane]?.character;
    if (!targetChar || !matchesCardKeywordExact(targetChar, adornRequired, true)) {
      return {
        allowed: false,
        reason: `Only adorn ${adornRequired}`,
      };
    }
  }

  const onlyMatch = text.match(/only\s+(?:use|play|activate)\s+when\s+([^.!]+)(?:[.!]|$)/i);
  if (onlyMatch) {
    const cond = onlyMatch[1].trim();
    if (!evaluateBoardCondition(state, playerId, cond)) {
      return {
        allowed: false,
        reason: `Requirement not met: ${cond}`,
      };
    }
  }

  return { allowed: true };
}

export function getEffectiveCardCost(
  player: PlayerState,
  card: CardDefinition,
  rivalPlayer?: PlayerState
): number {
  let baseCost = Math.max(0, Number(card.cost) || 0);
  if (baseCost === 0) return 0;

  const cardType = String(card.type || '').toLowerCase();
  const cardText = sanitizeCardText(card.effectText);

  const selfDiscountMatch = cardText.match(
    /(?:this\s+(?:character|item|event)\s+gets\s+)?-(\d+)\s*cost(?:\s+of\s+force\s+of\s+harmony)?\s+when\s+played\s+from\s+hand\s+(for\s+each\s+[^.]+)/i
  );
  if (selfDiscountMatch) {
    const perUnit = parseInt(selfDiscountMatch[1], 10) || 1;
    const scale = evaluateScalingMultiplier(selfDiscountMatch[2], player, rivalPlayer);
    baseCost = Math.max(0, baseCost - perUnit * scale);
  }

  if (player.nextCardCostDiscount) {
    const disc = player.nextCardCostDiscount;
    const typeMatches = !disc.cardType || cardType.includes(disc.cardType.toLowerCase());
    const nameMatches = !disc.filter || matchesCardKeywordExact(card, disc.filter);
    if (typeMatches && nameMatches) {
      baseCost = Math.max(0, baseCost - disc.amount);
    }
  }

  const leaderText = sanitizeCardText(player.leader?.effectText);
  if (
    leaderText &&
    /cost\s+(?:of\s+Force\s+of\s+Harmony\s+)?1\s+less|-\s*1\s*Cost/i.test(leaderText) &&
    ((cardType.includes('friend') && /friend/i.test(leaderText)) ||
      (cardType.includes('character') && /character/i.test(leaderText)) ||
      (cardType === 'item' && /item/i.test(leaderText)) ||
      (cardType === 'event' && /event/i.test(leaderText)))
  ) {
    baseCost = Math.max(0, baseCost - 1);
  }

  for (const sc of player.sceneArea) {
    if (!sc.isFaceUp) continue;
    const scText = sanitizeCardText(sc.card.effectText);
    if (
      /cost\s+(?:of\s+Force\s+of\s+Harmony\s+)?1\s+less|-\s*1\s*Cost/i.test(scText) &&
      ((cardType.includes('friend') && /friend/i.test(scText)) ||
        (cardType.includes('character') && /character/i.test(scText)) ||
        (cardType === 'item' && /item/i.test(scText)) ||
        (cardType === 'event' && /event/i.test(scText)))
    ) {
      baseCost = Math.max(0, baseCost - 1);
      break;
    }
  }

  return baseCost;
}

export function canPayHarmonyCost(
  player: PlayerState,
  card: CardDefinition,
  rivalPlayer?: PlayerState
): boolean {
  const requiredCost = getEffectiveCardCost(player, card, rivalPlayer);
  if (requiredCost === 0) return true;

  const readyScenes = player.sceneArea.filter((s) => !s.isExhausted);
  if (readyScenes.length < requiredCost) return false;

  const cardEl = String(card.element || 'Everyday').trim().toLowerCase();
  if (!cardEl || cardEl === 'everyday' || cardEl === 'none') {
    return true;
  }

  return readyScenes.some((s) => {
    if (!s.isFaceUp) return true;
    const sEl = String(s.card.element || 'Everyday').trim().toLowerCase();
    return sEl === cardEl || sEl === 'everyday' || sEl === 'none';
  });
}

export function exhaustScenesWithElementPriority(
  sceneArea: SceneCardInPlay[],
  card: CardDefinition,
  effectiveCost: number
): SceneCardInPlay[] {
  if (effectiveCost <= 0) return sceneArea;

  const cardEl = String(card.element || 'Everyday').trim().toLowerCase();
  const indicesToExhaust = new Set<number>();

  if (cardEl && cardEl !== 'everyday' && cardEl !== 'none') {
    const exactIdx = sceneArea.findIndex(
      (s) =>
        !s.isExhausted &&
        s.isFaceUp &&
        String(s.card.element || '').trim().toLowerCase() === cardEl
    );
    if (exactIdx !== -1) {
      indicesToExhaust.add(exactIdx);
    } else {
      const wildIdx = sceneArea.findIndex((s) => {
        if (s.isExhausted) return false;
        if (!s.isFaceUp) return true;
        const sEl = String(s.card.element || 'Everyday').trim().toLowerCase();
        return sEl === 'everyday' || sEl === 'none';
      });
      if (wildIdx !== -1) indicesToExhaust.add(wildIdx);
    }
  }

  for (let i = 0; i < sceneArea.length && indicesToExhaust.size < effectiveCost; i++) {
    if (!sceneArea[i].isExhausted) {
      indicesToExhaust.add(i);
    }
  }

  return sceneArea.map((s, idx) =>
    indicesToExhaust.has(idx) ? { ...s, isExhausted: true } : s
  );
}

export function evaluateScalingMultiplier(
  text: string,
  ownerPlayer?: PlayerState,
  rivalPlayer?: PlayerState
): number {
  if (!ownerPlayer) return 1;
  const allLanes: LaneKey[] = ['left', 'center', 'right'];

  const bracketEach = text.match(
    /for\s+each\s+([｢\[「][^｣\]」]+[｣\]」](?:\s+or\s+[｢\[「][^｣\]」]+[｣\]」])*)\s+in\s+your\s+adventure\s+area/i
  );
  if (bracketEach) {
    return allLanes.filter((l) => {
      const c = ownerPlayer.adventureArea[l].character;
      return c !== null && matchesCardKeywordExact(c, bracketEach[1], true);
    }).length;
  }

  if (/for\s+each\s+character\s+in\s+your\s+and\s+your\s+rival'?s\s+adventure\s+area/i.test(text)) {
    const mine = allLanes.filter((l) => ownerPlayer.adventureArea[l].character !== null).length;
    const theirs = rivalPlayer
      ? allLanes.filter((l) => rivalPlayer.adventureArea[l].character !== null).length
      : 0;
    return mine + theirs;
  }

  if (
    /for\s+each\s+character\s+that\s+has\s+had\s+a\s+treat\s+in\s+your\s+and\s+your\s+rival'?s\s+adventure\s+areas?/i.test(
      text
    )
  ) {
    const mine = allLanes.filter(
      (l) => ownerPlayer.adventureArea[l].character !== null && ownerPlayer.adventureArea[l].hadTreat
    ).length;
    const theirs = rivalPlayer
      ? allLanes.filter(
          (l) => rivalPlayer.adventureArea[l].character !== null && rivalPlayer.adventureArea[l].hadTreat
        ).length
      : 0;
    return mine + theirs;
  }

  if (/for\s+each\s+character\s+that\s+has\s+had\s+a\s+treat\s+in\s+your\s+adventure\s+area/i.test(text)) {
    return allLanes.filter(
      (l) => ownerPlayer.adventureArea[l].character !== null && ownerPlayer.adventureArea[l].hadTreat
    ).length;
  }

  if (/for\s+each\s+empty\s+slot\s+in\s+your\s+adventure\s+area/i.test(text)) {
    return allLanes.filter((l) => ownerPlayer.adventureArea[l].character === null).length;
  }

  if (/for\s+each\s+character\s+in\s+your\s+adventure\s+area/i.test(text)) {
    return allLanes.filter((l) => ownerPlayer.adventureArea[l].character !== null).length;
  }

  if (/for\s+each\s+scene\s+in\s+your\s+scene\s+area/i.test(text)) {
    return ownerPlayer.sceneArea.length;
  }

  if (/for\s+each\s+event\s+in\s+your\s+retirement\s+area/i.test(text)) {
    return ownerPlayer.retirement.filter((c) => String(c.type || '').toLowerCase() === 'event').length;
  }

  const retBracketEach = text.match(
    /for\s+each\s+[｢\[「]([^｣\]」]+)[｣\]」]\s+in\s+your\s+retirement\s+area/i
  );
  if (retBracketEach) {
    return ownerPlayer.retirement.filter((c) => matchesCardKeywordExact(c, retBracketEach[1])).length;
  }

  if (/for\s+each\s+plan\s+in\s+your\s+story\s+area/i.test(text)) {
    return ownerPlayer.storyStages.filter((s) => s.planCard !== null && !s.isPlanRevealed).length;
  }

  if (/for\s+each\s+plan\s+in\s+rival'?s\s+story\s+area/i.test(text) && rivalPlayer) {
    return rivalPlayer.storyStages.filter((s) => s.planCard !== null && !s.isPlanRevealed).length;
  }

  if (/for\s+each\s+present\s+in\s+your\s+and\s+your\s+rival'?s\s+adventure\s+areas?/i.test(text)) {
    const mine = allLanes.reduce((acc, l) => acc + (ownerPlayer.adventureArea[l].presents?.length || 0), 0);
    const theirs = rivalPlayer
      ? allLanes.reduce((acc, l) => acc + (rivalPlayer.adventureArea[l].presents?.length || 0), 0)
      : 0;
    return mine + theirs;
  }

  if (/for\s+each\s+card\s+in\s+your\s+hand/i.test(text)) {
    return ownerPlayer.hand.length;
  }

  return 1;
}

function areAdjacentLanes(a: LaneKey, b: LaneKey): boolean {
  return (
    (a === 'left' && b === 'center') ||
    (a === 'center' && (b === 'left' || b === 'right')) ||
    (a === 'right' && b === 'center')
  );
}

function doesPassiveTextApplyToCharacter(
  rawText: string,
  character: CardDefinition,
  lane: LaneKey,
  isOwnersTurn: boolean,
  ownerPlayer?: PlayerState,
  slot?: AdventureSlot,
  isSelfCard = false,
  isAttachedItem = false,
  rivalPlayer?: PlayerState
): number {
  const text = sanitizeCardText(rawText);
  if (!text) return 0;

  if (
    /Inspo Boost|Inspiration Boost|Pre-Plan|Appear\s*:|Farewell\s*:|When promoted|until the end of|at the end of|each character in rival'?s adventure area gets/i.test(
      text
    )
  ) {
    return 0;
  }

  const isContinuousAdventure = /^adventure\s*:\s*(?:while|this\s+character|each\s+character|adorned)/i.test(
    text
  );
  if (/^adventure\s*:/i.test(text) && !isContinuousAdventure) {
    return 0;
  }

  const powerMatch = text.match(/get[s]?\s*\+(\d+)\s*(?:Inspiration|Power)/i);
  if (!powerMatch) return 0;

  const perUnit = parseInt(powerMatch[1], 10) || 0;
  if (perUnit <= 0) return 0;

  if (/(?:during|in)\s+your\s+turn/i.test(text) && !isOwnersTurn) {
    return 0;
  }
  if (/(?:during|in)\s+rival'?s\s+turn/i.test(text) && isOwnersTurn) {
    return 0;
  }

  // Ticket #18 Fix: "While there is any Character adorned with Item in your Adventure Area"
  if (
    /while\s+there\s+(?:is|are)\s+(?:any|a|an)\s+character\s+adorned\s+with\s+(?:an\s+)?item\s+in\s+your\s+adventure\s+area/i.test(
      text
    ) &&
    ownerPlayer
  ) {
    const hasAdorned = (['left', 'center', 'right'] as LaneKey[]).some(
      (l) =>
        ownerPlayer.adventureArea[l].character !== null &&
        ownerPlayer.adventureArea[l].items.length > 0
    );
    if (!hasAdorned) return 0;
  }

  const costLess = text.match(
    /adorned\s+character\s+with\s+cost(?:\s+of\s+force\s+of\s+harmony)?\s+(\d+)\s+or\s+less/i
  );
  if (costLess && (Number(character.cost) || 0) > (parseInt(costLess[1], 10) || 0)) {
    return 0;
  }
  const costMore = text.match(
    /adorned\s+character\s+with\s+cost(?:\s+of\s+force\s+of\s+harmony)?\s+(\d+)\s+or\s+more/i
  );
  if (costMore && (Number(character.cost) || 0) < (parseInt(costMore[1], 10) || 0)) {
    return 0;
  }

  const whileBracketInAdv = text.match(
    /while\s+there\s+(?:is|are)\s+(?:any|a|an)\s+([｢\[「][^｣\]」]+[｣\]」](?:\s+or\s+[｢\[「][^｣\]」]+[｣\]」])*)\s+in\s+your\s+adventure\s+area/i
  );
  if (whileBracketInAdv && ownerPlayer) {
    const required = whileBracketInAdv[1].trim();
    const hasMatch = (['left', 'center', 'right'] as LaneKey[]).some((l) => {
      const c = ownerPlayer.adventureArea[l].character;
      return c !== null && matchesCardKeywordExact(c, required, true);
    });
    if (!hasMatch) return 0;
  }

  if (
    /while\s+there\s+(?:is|are)\s+(?:any\s+)?untapped\s+scenes?\s+in\s+your\s+scene\s+area/i.test(
      text
    ) &&
    ownerPlayer
  ) {
    if (!ownerPlayer.sceneArea.some((sc) => !sc.isExhausted)) return 0;
  }

  if (
    /while\s+there\s+(?:is|are)\s+(?:any\s+)?tapped\s+scenes?\s+in\s+your\s+scene\s+area/i.test(
      text
    ) &&
    ownerPlayer
  ) {
    if (!ownerPlayer.sceneArea.some((sc) => sc.isExhausted)) return 0;
  }

  if (/while\s+there\s+is\s+(?:any|an)\s+event\s+in\s+your\s+retirement\s+area/i.test(text) && ownerPlayer) {
    if (!ownerPlayer.retirement.some((c) => String(c.type || '').toLowerCase() === 'event')) return 0;
  }

  if (/while there is any item in your retirement/i.test(text) && ownerPlayer) {
    if (!ownerPlayer.retirement.some((c) => String(c.type || '').toLowerCase() === 'item')) return 0;
  }

  if (/while adorned with an item/i.test(text) && slot && slot.items.length === 0) return 0;
  if (/while (?:it has|adorned with|this character has) (?:a )?treat/i.test(text) && slot && slot.treats <= 0)
    return 0;
  if (/while (?:it has|adorned with) (?:a )?present/i.test(text) && slot && slot.presents.length === 0)
    return 0;
  if (/each character that has had a treat/i.test(text) && slot && !slot.hadTreat) return 0;
  if (/each character that has had a present/i.test(text) && slot && !slot.hadPresent) return 0;

  if (/this\s+character\s+gets/i.test(text) && !isSelfCard && !isAttachedItem) return 0;
  if (/adorned\s+character\s+gets/i.test(text) && !isAttachedItem) return 0;
  if (/other\s+characters?\s+in\s+your\s+adventure\s+area/i.test(text) && isAttachedItem) return 0;
  if (/characters?\s+next\s+to\s+adorned\s+character/i.test(text) && isAttachedItem) return 0;

  if (/left\s+lane/i.test(text) && lane !== 'left') return 0;
  if (/center\s+lane/i.test(text) && lane !== 'center') return 0;
  if (/right\s+lane/i.test(text) && lane !== 'right') return 0;

  const charType = String(character.type || '').toLowerCase();
  if (/your\s+friend/i.test(text) && !charType.includes('friend')) return 0;

  const elements = ['magic', 'loyalty', 'honesty', 'generosity', 'kindness', 'laughter'];
  for (const el of elements) {
    const elRegex = new RegExp(`your\\s+${el}\\s+character`, 'i');
    if (elRegex.test(text) && String(character.element || '').toLowerCase() !== el) return 0;
  }

  if (!isContinuousAdventure && !isSelfCard && !isAttachedItem) {
    const charBracketMatch = text.match(/[｢\[「]([^｣\]」]+)[｣\]」]/);
    if (charBracketMatch && !matchesCardKeywordExact(character, charBracketMatch[1], true)) {
      return 0;
    }
  }

  const multiplier = evaluateScalingMultiplier(text, ownerPlayer, rivalPlayer);
  return perUnit * multiplier;
}

export function calculateLanePowerBreakdown(
  state: KayouGameState,
  playerId: '0' | '1',
  lane: LaneKey
): LanePowerBreakdown {
  const oppId: '0' | '1' = playerId === '0' ? '1' : '0';
  const player = state.players[playerId];
  const rival = state.players[oppId];
  const slot = player.adventureArea[lane];

  if (!slot.character) {
    return { basePower: 0, modifiers: [], totalPower: 0 };
  }

  const character = slot.character;
  const basePower = Number(character.power) || 0;
  const modifiers: PowerModifierLine[] = [];
  const isOwnersTurn = state.turnPlayerId === playerId;
  const allLanes: LaneKey[] = ['left', 'center', 'right'];

  const selfBonus = doesPassiveTextApplyToCharacter(
    character.effectText || '',
    character,
    lane,
    isOwnersTurn,
    player,
    slot,
    true,
    false,
    rival
  );
  if (selfBonus > 0) {
    modifiers.push({
      sourceName: `Passive: ${character.name}`,
      sourceType: 'MANE_PASSIVE',
      amount: selfBonus,
    });
  }

  for (const item of slot.items) {
    let itemBonus = Number(item.power) || 0;
    const itemText = sanitizeCardText(item.effectText);
    const passiveItemBonus = doesPassiveTextApplyToCharacter(
      itemText,
      character,
      lane,
      isOwnersTurn,
      player,
      slot,
      false,
      true,
      rival
    );
    itemBonus += passiveItemBonus;

    if (itemBonus !== 0) {
      modifiers.push({
        sourceName: `Item: ${item.name}`,
        sourceType: 'ITEM',
        amount: itemBonus,
      });
    }
  }

  for (const otherLane of allLanes) {
    if (otherLane === lane) continue;
    const otherSlot = player.adventureArea[otherLane];
    if (!otherSlot.character) continue;

    const otherCharText = sanitizeCardText(otherSlot.character.effectText);
    if (/each\s+character\s+that\s+has\s+had\s+a\s+(?:treat|present)/i.test(otherCharText)) {
      const auraBonus = doesPassiveTextApplyToCharacter(
        otherCharText,
        character,
        lane,
        isOwnersTurn,
        player,
        slot,
        false,
        false,
        rival
      );
      if (auraBonus > 0) {
        modifiers.push({
          sourceName: `Aura: ${otherSlot.character.name}`,
          sourceType: 'MANE_PASSIVE',
          amount: auraBonus,
        });
      }
    }

    for (const otherItem of otherSlot.items) {
      const itText = sanitizeCardText(otherItem.effectText);
      const isOtherAll = /other\s+characters?\s+in\s+your\s+adventure\s+area\s+get/i.test(itText);
      const isAdjacent =
        /characters?\s+next\s+to\s+adorned\s+character\s+get/i.test(itText) &&
        areAdjacentLanes(lane, otherLane);
      if (isOtherAll || isAdjacent) {
        const m = itText.match(/get[s]?\s*\+(\d+)\s*(?:Inspiration|Power)/i);
        const amt = m ? parseInt(m[1], 10) || 0 : 0;
        if (amt > 0) {
          modifiers.push({
            sourceName: `Item Aura: ${otherItem.name}`,
            sourceType: 'ITEM',
            amount: amt,
          });
        }
      }
    }
  }

  for (const rLane of allLanes) {
    const rSlot = rival.adventureArea[rLane];
    if (!rSlot.character) continue;
    const rText = sanitizeCardText(rSlot.character.effectText);
    const debuffAura = rText.match(
      /while\s+this\s+character\s+has\s+a\s+treat,\s*each\s+character\s+in\s+rival'?s\s+adventure\s+area\s+gets\s*-(\d+)\s*(?:Inspiration|Power)/i
    );
    if (debuffAura && rSlot.treats > 0) {
      const penalty = parseInt(debuffAura[1], 10) || 1;
      modifiers.push({
        sourceName: `Rival Aura: ${rSlot.character.name}`,
        sourceType: 'INSPO_BOOST',
        amount: -penalty,
      });
    }
  }

  if (player.leader) {
    const leaderBonus = doesPassiveTextApplyToCharacter(
      player.leader.effectText || '',
      character,
      lane,
      isOwnersTurn,
      player,
      slot,
      false,
      false,
      rival
    );
    if (leaderBonus > 0) {
      modifiers.push({
        sourceName: `Main Character Passive: ${player.leader.name}`,
        sourceType: 'MANE_PASSIVE',
        amount: leaderBonus,
      });
    }
  }

  for (const sc of player.sceneArea) {
    if (!sc.isFaceUp) continue;
    const scBonus = doesPassiveTextApplyToCharacter(
      sc.card.effectText || '',
      character,
      lane,
      isOwnersTurn,
      player,
      slot,
      false,
      false,
      rival
    );
    if (scBonus > 0) {
      modifiers.push({
        sourceName: `Scene: ${sc.card.name}`,
        sourceType: 'SCENE_PASSIVE',
        amount: scBonus,
      });
    }
  }

  for (const st of player.storyStages) {
    if (!st.isStoryCompleted || !st.storyCard) continue;
    const stBonus = doesPassiveTextApplyToCharacter(
      st.storyCard.effectText || '',
      character,
      lane,
      isOwnersTurn,
      player,
      slot,
      false,
      false,
      rival
    );
    if (stBonus > 0) {
      modifiers.push({
        sourceName: `Story Stage ${st.stage}: ${st.storyCard.name}`,
        sourceType: 'STORY_PASSIVE',
        amount: stBonus,
      });
    }
  }

  if (slot.inspoBoost !== 0) {
    modifiers.push({
      sourceName: slot.inspoBoost > 0 ? 'Inspiration / Event Boosts' : 'Rival Debuffs',
      sourceType: 'INSPO_BOOST',
      amount: slot.inspoBoost,
    });
  }

  const totalPower = Math.max(
    0,
    basePower + modifiers.reduce((sum, line) => sum + line.amount, 0)
  );

  return {
    basePower,
    modifiers,
    totalPower,
  };
}

export interface DelayedTriggerSpec {
  timing: 'END_OF_YOUR_TURN' | 'END_OF_ANY_TURN';
  conditionText?: string;
  innerEffectClause: string;
}

export function extractDelayedTiming(clauseText?: string): DelayedTriggerSpec | null {
  const text = sanitizeCardText(clauseText);
  if (!text) return null;

  const endYourTurnMatch = text.match(/^at\s+the\s+end\s+of\s+your\s+turn[,:\s]+([\s\S]+)$/i);
  if (endYourTurnMatch) {
    const rest = endYourTurnMatch[1].trim();
    const condMatch = rest.match(/^if\s+([^,]+),\s*([\s\S]+)$/i);
    return {
      timing: 'END_OF_YOUR_TURN',
      conditionText: condMatch ? condMatch[1].trim() : undefined,
      innerEffectClause: condMatch ? condMatch[2].trim() : rest,
    };
  }

  const endTurnMatch = text.match(/^at\s+the\s+end\s+of\s+(?:the\s+)?turn[,:\s]+([\s\S]+)$/i);
  if (endTurnMatch) {
    const rest = endTurnMatch[1].trim();
    const condMatch = rest.match(/^if\s+([^,]+),\s*([\s\S]+)$/i);
    return {
      timing: 'END_OF_ANY_TURN',
      conditionText: condMatch ? condMatch[1].trim() : undefined,
      innerEffectClause: condMatch ? condMatch[2].trim() : rest,
    };
  }

  return null;
}

export function evaluateBoardCondition(
  state: KayouGameState,
  ownerId: '0' | '1',
  conditionText?: string
): boolean {
  if (!conditionText) return true;
  // Ticket #13 Fix: strip leading "if " so delayed trigger conditions evaluate properly
  const cond = sanitizeCardText(conditionText).replace(/^if\s+/i, '').trim();
  const oppId: '0' | '1' = ownerId === '0' ? '1' : '0';
  const player = state.players[ownerId];
  const rival = state.players[oppId];
  const allLanes: LaneKey[] = ['left', 'center', 'right'];

  const sceneMinMatch = cond.match(
    /(?:there\s+are|you\s+have)\s+(\d+)\s+or\s+more\s+scenes?\s+in\s+your\s+scene\s+area/i
  );
  if (sceneMinMatch) return player.sceneArea.length >= (parseInt(sceneMinMatch[1], 10) || 1);

  const sceneMaxMatch = cond.match(
    /(?:there\s+are|you\s+have)\s+(\d+)\s+or\s+(?:fewer|less)\s+scenes?\s+in\s+your\s+scene\s+area/i
  );
  if (sceneMaxMatch) return player.sceneArea.length <= (parseInt(sceneMaxMatch[1], 10) || 0);

  const faceUpMinMatch = cond.match(
    /(?:there\s+are|you\s+have)\s+(\d+)\s+or\s+more\s+face-up\s+scenes?\s+in\s+your\s+scene\s+area/i
  );
  if (faceUpMinMatch) {
    return player.sceneArea.filter((s) => s.isFaceUp).length >= (parseInt(faceUpMinMatch[1], 10) || 1);
  }

  if (/there\s+is\s+(?:any|a|an)\s+face-down\s+scene\s+in\s+your\s+scene\s+area/i.test(cond)) {
    return player.sceneArea.some((s) => !s.isFaceUp);
  }
  if (/there\s+is\s+(?:any|a|an)\s+face-up\s+scene\s+in\s+your\s+scene\s+area/i.test(cond)) {
    return player.sceneArea.some((s) => s.isFaceUp);
  }
  if (/there\s+is\s+(?:any|a|an)\s+empty\s+slot\s+in\s+your\s+adventure\s+area/i.test(cond)) {
    return allLanes.some((l) => player.adventureArea[l].character === null);
  }
  if (/there\s+is\s+(?:any|a|an)\s+tapped\s+character\s+in\s+your\s+adventure\s+area/i.test(cond)) {
    return allLanes.some(
      (l) => player.adventureArea[l].character !== null && player.adventureArea[l].isExhausted
    );
  }
  if (
    /there\s+is\s+(?:any|a|an)\s+character\s+adorned\s+with\s+(?:an\s+)?item\s+in\s+your\s+adventure\s+area/i.test(
      cond
    )
  ) {
    return allLanes.some(
      (l) => player.adventureArea[l].character !== null && player.adventureArea[l].items.length > 0
    );
  }
  if (/there\s+is\s+no\s+other\s+character\s+in\s+your\s+adventure\s+area/i.test(cond)) {
    return allLanes.filter((l) => player.adventureArea[l].character !== null).length <= 1;
  }
  if (/rival\s+has\s+more\s+plans\s+than\s+you\s+in\s+story\s+area/i.test(cond)) {
    const myPlans = player.storyStages.filter((s) => s.planCard !== null && !s.isPlanRevealed).length;
    const oppPlans = rival.storyStages.filter((s) => s.planCard !== null && !s.isPlanRevealed).length;
    return oppPlans > myPlans;
  }

  const rivalExactChars = cond.match(/there\s+are\s+(\d+)\s+characters?\s+in\s+rival'?s\s+adventure\s+area/i);
  if (rivalExactChars) {
    return (
      allLanes.filter((l) => rival.adventureArea[l].character !== null).length ===
      (parseInt(rivalExactChars[1], 10) || 0)
    );
  }

  const rivalMinChars = cond.match(
    /there\s+are\s+(\d+)\s+or\s+more\s+characters?\s+in\s+rival'?s\s+adventure\s+area/i
  );
  if (rivalMinChars) {
    return (
      allLanes.filter((l) => rival.adventureArea[l].character !== null).length >=
      (parseInt(rivalMinChars[1], 10) || 1)
    );
  }

  const rivalHighPower = cond.match(
    /there\s+is\s+(?:any|a|an)\s+character\s+with\s+inspiration\s+(\d+)\s+or\s+more\s+in\s+rival'?s\s+adventure\s+area/i
  );
  if (rivalHighPower) {
    const minPwr = parseInt(rivalHighPower[1], 10) || 1;
    return allLanes.some(
      (l) =>
        rival.adventureArea[l].character !== null &&
        calculateLanePowerBreakdown(state, oppId, l).totalPower >= minPwr
    );
  }

  if (
    /number\s+of\s+characters\s+in\s+your\s+adventure\s+area\s+is\s+less\s+than\s+the\s+number\s+of\s+characters\s+in\s+rival'?s\s+adventure\s+area/i.test(
      cond
    )
  ) {
    const mine = allLanes.filter((l) => player.adventureArea[l].character !== null).length;
    const theirs = allLanes.filter((l) => rival.adventureArea[l].character !== null).length;
    return mine < theirs;
  }

  if (/cards\s+in\s+your\s+hand\s+are\s+less\s+than\s+the\s+cards\s+in\s+rival'?s\s+hand/i.test(cond)) {
    return player.hand.length < rival.hand.length;
  }

  const handMinMatch = cond.match(/there\s+are\s+(\d+)\s+or\s+more\s+cards\s+in\s+your\s+hand/i);
  if (handMinMatch) return player.hand.length >= (parseInt(handMinMatch[1], 10) || 1);

  if (
    /there\s+is\s+(?:any|a|an)\s+character\s+that\s+has\s+had\s+a\s+treat\s+in\s+your\s+adventure\s+area/i.test(
      cond
    )
  ) {
    return allLanes.some((l) => player.adventureArea[l].character !== null && player.adventureArea[l].hadTreat);
  }

  if (
    /there\s+are\s+[｢\[「]unicorn[｣\]」]\s*,\s*[｢\[「]pegasus[｣\]」]\s*(?:and|,)\s*[｢\[「]earth\s+pony[｣\]」]\s+in\s+your\s+adventure\s+area/i.test(
      cond
    )
  ) {
    const deployedChars = allLanes
      .map((l) => player.adventureArea[l].character)
      .filter(Boolean) as CardDefinition[];
    return (
      deployedChars.some((c) => matchesCardKeywordExact(c, 'Unicorn', true)) &&
      deployedChars.some((c) => matchesCardKeywordExact(c, 'Pegasus', true)) &&
      deployedChars.some((c) => matchesCardKeywordExact(c, 'Earth Pony', true))
    );
  }

  const bracketCostInAdv = cond.match(
    /there\s+is\s+(?:any|a|an)\s+[｢\[「]([^｣\]」]+)[｣\]」]\s+with\s+cost(?:\s+of\s+force\s+of\s+harmony)?\s+(\d+)\s+or\s+less\s+in\s+your\s+adventure\s+area/i
  );
  if (bracketCostInAdv) {
    const reqName = bracketCostInAdv[1].trim();
    const maxCost = parseInt(bracketCostInAdv[2], 10) || 0;
    return allLanes.some((l) => {
      const c = player.adventureArea[l].character;
      return c !== null && matchesCardKeywordExact(c, reqName, true) && (Number(c.cost) || 0) <= maxCost;
    });
  }

  const bracketInAdv = cond.match(
    /there\s+is\s+(?:any|a|an)\s+([｢\[「][^｣\]」]+[｣\]」](?:\s+or\s+[｢\[「][^｣\]」]+[｣\]」])*)\s+in\s+your\s+adventure\s+area/i
  );
  if (bracketInAdv) {
    return allLanes.some((l) => {
      const char = player.adventureArea[l].character;
      return char !== null && matchesCardKeywordExact(char, bracketInAdv[1].trim(), true);
    });
  }

  const retMinEvents = cond.match(
    /there\s+are\s+(\d+)\s+or\s+more\s+events?\s+in\s+your\s+retirement\s+area/i
  );
  if (retMinEvents) {
    return (
      player.retirement.filter((c) => String(c.type || '').toLowerCase() === 'event').length >=
      (parseInt(retMinEvents[1], 10) || 1)
    );
  }

  const retMinItems = cond.match(
    /there\s+are\s+(\d+)\s+or\s+more\s+items?\s+in\s+your\s+retirement\s+area/i
  );
  if (retMinItems) {
    return (
      player.retirement.filter((c) => String(c.type || '').toLowerCase() === 'item').length >=
      (parseInt(retMinItems[1], 10) || 1)
    );
  }

  if (/there\s+is\s+(?:any|a|an)\s+event\s+in\s+your\s+retirement\s+area/i.test(cond)) {
    return player.retirement.some((c) => String(c.type || '').toLowerCase() === 'event');
  }
  if (/there\s+is\s+(?:any|an)\s+item\s+in\s+your\s+retirement/i.test(cond)) {
    return player.retirement.some((c) => String(c.type || '').toLowerCase() === 'item');
  }

  const minCharsMatch = cond.match(
    /there\s+are\s+(\d+)\s+or\s+more\s+characters?\s+in\s+your\s+adventure\s+area/i
  );
  if (minCharsMatch) {
    return (
      allLanes.filter((l) => player.adventureArea[l].character !== null).length >=
      (parseInt(minCharsMatch[1], 10) || 1)
    );
  }

  const countCharsMatch = cond.match(/you\s+have\s+(\d+)\s+or\s+more\s+characters?/i);
  if (countCharsMatch) {
    return (
      allLanes.filter((l) => player.adventureArea[l].character !== null).length >=
      (parseInt(countCharsMatch[1], 10) || 1)
    );
  }

  return true;
}

export interface ParsedActivatedEffect {
  kind:
    | 'NONE_PASSIVE'
    | 'DRAW'
    | 'DRAW_UNTIL_MATCH_RIVAL'
    | 'DRAW_THEN_DISCARD'
    | 'DISCARD_HAND'
    | 'DISCARD_THEN_DRAW'
    | 'RECOVER_RETIREMENT'
    | 'REVIVE_RETIREMENT'
    | 'MOVE_HAND_TO_PLAN'
    | 'UNTAP_SCENES'
    | 'FLIP_SCENES_UP'
    | 'FLIP_SCENES_DOWN'
    | 'FLIP_RIVAL_SCENES_DOWN'
    | 'ADD_FACEDOWN_SCENE'
    | 'COST_DISCOUNT_NEXT'
    | 'SCRY_TOP_BOTTOM'
    | 'REVEAL_TOP_PICK_HAND'
    | 'TARGET_BUFF_POWER'
    | 'BUFF_TWO_TARGETS'
    | 'TARGET_DEBUFF_OPPONENT'
    | 'GLOBAL_DEBUFF_OPPONENT'
    | 'TARGET_RETIRE_OPPONENT'
    | 'PREVENT_RETIRE_IN_CONTACT'
    | 'TARGET_MOVE_FRIENDLY'
    | 'SWITCH_POSITIONS'
    | 'TARGET_READY_FRIENDLY'
    | 'GLOBAL_BUFF_FRIENDLY'
    | 'TREAT_FOR_YOU'
    | 'REMOVE_TREAT'
    | 'DELIVER_PRESENT'
    | 'UNWRAP_PRESENT';
  amount: number;
  secondaryAmount?: number;
  maxLimit?: number;
  isSelfOnly?: boolean;
  isGlobal?: boolean;
  requiresChoice?: boolean;
  targetSide?: 'SELF' | 'OPPONENT' | 'ANY';
  requiredTypeFilter?: string;
  requiredNameFilter?: string;
  secondaryNameFilter?: string;
}

export function extractTriggerClause(
  effectText: string | undefined,
  triggerType:
    | 'Appear'
    | 'Farewell'
    | 'Adventure'
    | 'Pre-Plan'
    | 'Treat for you!'
    | 'Deliver Present'
    | 'Unwrap Present'
): string | null {
  const text = sanitizeCardText(effectText);
  if (!text) return null;

  const escaped = triggerType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `${escaped}\\s*(?:(?<!un)\\btap\\s*:|:)\\s*([\\s\\S]*?)(?=(?:\\n|\\r|(?:Appear|Farewell|Adventure|Inspo Boost|Inspiration Boost|Pre-Plan|Mane Ability|Activate|Treat for you!|Deliver Present|Unwrap Present)\\s*(?:(?<!un)\\btap\\s*:|:)|$))`,
    'i'
  );
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

export function splitCompoundClauses(rawText?: string): string[] {
  let text = sanitizeCardText(rawText);
  if (!text) return [];
  text = text.replace(/^only\s+(?:use|play|activate)\s+when\s+[^.]+\.\s*/i, '').trim();
  if (!text) return [];

  if (/reveal\s+the\s+top\s+\d+|draw\s+\d+.*discard\s+\d+|discard\s+.*draw\s+\d+/i.test(text)) {
    return [text];
  }

  return text
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^only\s+(?:use|play|activate|adorn)\b/i.test(s));
}

export function parseEffectClause(clauseText?: string): ParsedActivatedEffect | null {
  let text = sanitizeCardText(clauseText);
  if (!text) return null;

  text = text.replace(/^(?<!un)\btap\s*:\s*/i, '').trim();

  if (/^while\b/i.test(text)) {
    return { kind: 'NONE_PASSIVE', amount: 0 };
  }

  text = text.replace(/^only\s+(?:use|play|activate)\s+when\s+[^.]+\.\s*/i, '').trim();
  const leadingIf = text.match(/^if\s+[^,]+,\s*([\s\S]+)$/i);
  if (leadingIf) {
    text = leadingIf[1].trim();
  }

  const allBrackets = extractBracketKeywords(text);
  const nameFilter = allBrackets[0];

  const limitMatch = text.match(
    /(?:cost(?:\s+of\s+Force\s+of\s+Harmony)?|power|inspiration|harmony(?:\s+level)?)\s*(\d+)\s*or\s*less/i
  );
  const parsedMaxLimit = limitMatch ? parseInt(limitMatch[1], 10) : undefined;

  const nextDiscountMatch = text.match(
    /the\s+next\s+(Item|Event|Character|[｢\[「][^｣\]」]+[｣\]」])\s+gets\s*-(\d+)\s*cost/i
  );
  if (nextDiscountMatch) {
    const rawTarget = nextDiscountMatch[1].trim();
    const isType = ['item', 'event', 'character'].includes(rawTarget.toLowerCase());
    return {
      kind: 'COST_DISCOUNT_NEXT',
      amount: parseInt(nextDiscountMatch[2], 10) || 1,
      requiredTypeFilter: isType ? rawTarget : undefined,
      requiredNameFilter: !isType ? rawTarget : undefined,
    };
  }

  if (/draw\s+cards?\s+until\s+you\s+have\s+as\s+many\s+cards\s+in\s+hand\s+as\s+rival/i.test(text)) {
    return { kind: 'DRAW_UNTIL_MATCH_RIVAL', amount: 1 };
  }

  if (/add\s+1\s+face-down\s+scene/i.test(text)) {
    return { kind: 'ADD_FACEDOWN_SCENE', amount: 1 };
  }

  if (/move\s+1\s+hand\s+to\s+story\s+area.*plan/i.test(text)) {
    return { kind: 'MOVE_HAND_TO_PLAN', amount: 1, requiresChoice: true };
  }

  if (/retirement\s+area,\s*move\s+it\s+to\s+adventure\s+area/i.test(text)) {
    return {
      kind: 'REVIVE_RETIREMENT',
      amount: 1,
      maxLimit: parsedMaxLimit,
      requiredNameFilter: nameFilter,
      requiresChoice: true,
    };
  }

  const flipRivalDown = text.match(
    /choose\s+(\d+)\s+face-up\s+scenes?\s+in\s+rival'?s\s+scene\s+area,\s*turn\s+(?:it|them)\s+down/i
  );
  if (flipRivalDown) {
    return {
      kind: 'FLIP_RIVAL_SCENES_DOWN',
      amount: parseInt(flipRivalDown[1], 10) || 1,
      requiresChoice: true,
    };
  }
  const flipSelfDown = text.match(
    /choose\s+(\d+)\s+face-up\s+scenes?(?:\s+in\s+your\s+scene\s+area)?,\s*turn\s+(?:it|them)\s+down/i
  );
  if (flipSelfDown) {
    return {
      kind: 'FLIP_SCENES_DOWN',
      amount: parseInt(flipSelfDown[1], 10) || 1,
      requiresChoice: true,
    };
  }
  const flipSelfUp = text.match(
    /choose\s+(\d+)\s+face-down\s+(?:tapped\s+)?scenes?(?:\s+without\s+"everyday"\s+mark)?\s+in\s+your\s+scene\s+area,\s*turn\s+(?:it|them)\s+up/i
  );
  if (flipSelfUp) {
    return {
      kind: 'FLIP_SCENES_UP',
      amount: parseInt(flipSelfUp[1], 10) || 1,
      requiresChoice: true,
    };
  }

  if (
    /(?:look\s+at|reveal)\s+the\s+top\s+card\s+of\s+(?:your|the)\s+deck.*?(?:top\s+or\s+(?:the )?bottom)/i.test(
      text
    )
  ) {
    return { kind: 'SCRY_TOP_BOTTOM', amount: 1, requiresChoice: true };
  }

  if (/(?:won'?t|cannot|can'?t)\s+(?:be\s+)?retired?\s+in\s+contact/i.test(text)) {
    return {
      kind: 'PREVENT_RETIRE_IN_CONTACT',
      amount: 1,
      maxLimit: parsedMaxLimit,
      requiredNameFilter: nameFilter,
      requiresChoice: true,
    };
  }

  const drawDiscardMatch = text.match(
    /draw\s+(\d+|a|an)\s+cards?[,.]?\s*(?:then\s+)?discard\s+(\d+|a|an)\s+cards?/i
  );
  if (drawDiscardMatch) {
    const dRaw = drawDiscardMatch[1].toLowerCase();
    const discRaw = drawDiscardMatch[2].toLowerCase();
    return {
      kind: 'DRAW_THEN_DISCARD',
      amount: dRaw === 'a' || dRaw === 'an' ? 1 : parseInt(dRaw, 10) || 1,
      secondaryAmount: discRaw === 'a' || discRaw === 'an' ? 1 : parseInt(discRaw, 10) || 1,
      requiresChoice: true,
    };
  }

  const discardDrawMatch = text.match(
    /discard\s+(?:up\s+to\s+)?(\d+|a|an)\s+cards?[,.]?\s*(?:then\s+)?draw\s+(\d+|a|an)\s+cards?/i
  );
  if (discardDrawMatch) {
    const discRaw = discardDrawMatch[1].toLowerCase();
    const dRaw = discardDrawMatch[2].toLowerCase();
    return {
      kind: 'DISCARD_THEN_DRAW',
      amount: discRaw === 'a' || discRaw === 'an' ? 1 : parseInt(discRaw, 10) || 1,
      secondaryAmount: dRaw === 'a' || dRaw === 'an' ? 1 : parseInt(dRaw, 10) || 1,
      requiredNameFilter: nameFilter,
      requiresChoice: true,
    };
  }

  const soloDiscardMatch = text.match(/discard\s+(\d+|a|an)\s+cards?\s+from\s+(?:your\s+)?hand/i);
  if (soloDiscardMatch) {
    const discRaw = soloDiscardMatch[1].toLowerCase();
    return {
      kind: 'DISCARD_HAND',
      amount: discRaw === 'a' || discRaw === 'an' ? 1 : parseInt(discRaw, 10) || 1,
      requiresChoice: true,
    };
  }

  const untapSceneMatch = text.match(
    /(?:choose|select|ready|untap)\s+(\d+|a|an)\s+(?:face-down\s+|exhausted\s+|tapped\s+)?scenes?\s+in\s+your\s+scene\s+area/i
  );
  if (untapSceneMatch) {
    const raw = untapSceneMatch[1].toLowerCase();
    return {
      kind: 'UNTAP_SCENES',
      amount: raw === 'a' || raw === 'an' ? 1 : parseInt(raw, 10) || 1,
      requiresChoice: /choose|select/i.test(text),
    };
  }

  const revealPickMatch = text.match(
    /reveal\s+the\s+top\s+(\d+)\s+cards?\s+of\s+(?:your|the)\s+deck.*?choose\s+1\s+(Item|Event|Character|Scene|card|[｢\[「][^｣\]」]+[｣\]」](?:\s+or\s+[｢\[「][^｣\]」]+[｣\]」])*)/i
  );
  if (revealPickMatch) {
    const count = parseInt(revealPickMatch[1], 10) || 3;
    const rawTarget = revealPickMatch[2].trim();
    const isAnyCard = rawTarget.toLowerCase() === 'card';
    const isCardType = ['item', 'event', 'character', 'scene'].includes(rawTarget.toLowerCase());
    return {
      kind: 'REVEAL_TOP_PICK_HAND',
      amount: count,
      requiredTypeFilter: isCardType ? rawTarget : undefined,
      requiredNameFilter: !isCardType && !isAnyCard ? rawTarget : nameFilter,
      requiresChoice: true,
    };
  }

  if (/remove\s+the\s+treat/i.test(text)) {
    return { kind: 'REMOVE_TREAT', amount: 1, requiresChoice: true };
  }

  if (/treat for you!|put\s+\d+\s+treat/i.test(text)) {
    const countMatch = text.match(/put\s+(\d+)\s+treat/i);
    const isGlobal = /each\s+/i.test(text);
    const targetSide: 'SELF' | 'OPPONENT' | 'ANY' = /rival'?s\s+adventure/i.test(text)
      ? 'OPPONENT'
      : /your\s+adventure/i.test(text)
      ? 'SELF'
      : 'ANY';
    return {
      kind: 'TREAT_FOR_YOU',
      amount: countMatch ? parseInt(countMatch[1], 10) : 1,
      isGlobal,
      targetSide,
      requiredNameFilter: nameFilter,
      requiresChoice: !isGlobal,
    };
  }

  if (/unwrap\s+(?:1\s+)?present/i.test(text)) {
    const targetSide: 'SELF' | 'OPPONENT' | 'ANY' = /rival'?s\s+adventure/i.test(text)
      ? 'OPPONENT'
      : /your\s+adventure/i.test(text)
      ? 'SELF'
      : 'ANY';
    return {
      kind: 'UNWRAP_PRESENT',
      amount: 1,
      targetSide,
      requiredNameFilter: nameFilter,
      requiresChoice: true,
    };
  }

  if (/deliver\s+present|put\s+(?:\d+|[｢\[「][^｣\]」]+[｣\]」])\s*present/i.test(text)) {
    const countMatch = text.match(/put\s+(\d+)\s+present/i);
    const isGlobal = /each\s+/i.test(text);
    const targetSide: 'SELF' | 'OPPONENT' | 'ANY' = /rival'?s\s+adventure/i.test(text)
      ? 'OPPONENT'
      : /your\s+adventure/i.test(text)
      ? 'SELF'
      : 'ANY';
    return {
      kind: 'DELIVER_PRESENT',
      amount: countMatch ? parseInt(countMatch[1], 10) : 1,
      isGlobal,
      targetSide,
      requiredNameFilter: nameFilter,
      requiresChoice: !isGlobal,
    };
  }

  if (/switch(?:es)?\s+positions/i.test(text)) {
    const targetSide: 'SELF' | 'OPPONENT' = /rival'?s\s+adventure/i.test(text) ? 'OPPONENT' : 'SELF';
    return {
      kind: 'SWITCH_POSITIONS',
      amount: 1,
      targetSide,
      requiredNameFilter: nameFilter,
      requiresChoice: true,
    };
  }

  const globalDebuffMatch = text.match(
    /each\s+character\s+in\s+rival'?s\s+adventure\s+area\s+gets\s*(?:–|-)\s*(\d+)\s*(?:Inspiration|Power)/i
  );
  if (globalDebuffMatch) {
    return {
      kind: 'GLOBAL_DEBUFF_OPPONENT',
      amount: parseInt(globalDebuffMatch[1], 10) || 1,
    };
  }

  const debuffMatch = text.match(/(?:–|-)\s*(\d+)\s*(?:Inspiration|Power)/i);
  if (debuffMatch && /rival|opponent/i.test(text)) {
    return {
      kind: 'TARGET_DEBUFF_OPPONENT',
      amount: parseInt(debuffMatch[1], 10) || 1,
      requiresChoice: true,
    };
  }

  if (/move\s+(?:1\s+of\s+your\s+|a\s+|an?\s+|it\s+to\s+1\s+empty)/i.test(text)) {
    return { kind: 'TARGET_MOVE_FRIENDLY', amount: 1, requiresChoice: true };
  }

  if (
    /retire\s+(?:1\s+of\s+your\s+opponent|an?\s+opponent)|(?:choose|select)\s+1\s+character.*?(?:rival|opponent).*?to\s+retire/i.test(
      text
    )
  ) {
    return {
      kind: 'TARGET_RETIRE_OPPONENT',
      amount: 1,
      maxLimit: parsedMaxLimit,
      requiresChoice: true,
    };
  }

  if (/ready|untap/i.test(text) && /character/i.test(text)) {
    return { kind: 'TARGET_READY_FRIENDLY', amount: 1, requiresChoice: true };
  }

  // Ticket #14 Fix: Require Character type when bracketed name filter is used without explicit Item/Event/Scene type
  if (/retirement\s+(?:area|pile)/i.test(text) && /add\s+(?:it|them)\s+to\s+(?:your\s+)?hand/i.test(text)) {
    const typeMatch = text.match(/(?:choose|select)\s+(?:1|any)\s+(Item|Event|Character|Scene)/i);
    const inferredType = typeMatch ? typeMatch[1] : nameFilter ? 'Character' : undefined;
    return {
      kind: 'RECOVER_RETIREMENT',
      amount: 1,
      maxLimit: parsedMaxLimit,
      requiredTypeFilter: inferredType,
      requiredNameFilter: nameFilter,
      requiresChoice: true,
    };
  }

  const drawMatch = text.match(/draw\s+(\d+|a|an)\s+card/i);
  if (drawMatch) {
    const rawCount = drawMatch[1].toLowerCase();
    const count = rawCount === 'a' || rawCount === 'an' ? 1 : parseInt(rawCount, 10) || 1;
    return { kind: 'DRAW', amount: count };
  }

  const globalMatch = text.match(
    /(?:all|each)\s+(?:of\s+)?(?:your\s+)?(?:characters?(?:\s+that\s+has\s+had\s+a\s+treat)?|[｢\[「][^｣\]」]+[｣\]」])\s+(?:in\s+your\s+adventure\s+area\s+)?get[s]?\s*\+(\d+)/i
  );
  if (globalMatch) {
    return {
      kind: 'GLOBAL_BUFF_FRIENDLY',
      amount: parseInt(globalMatch[1], 10) || 1,
      requiredNameFilter: nameFilter,
    };
  }

  const buffMatch = text.match(/\+(\d+)\s*(?:Inspiration|Power)/i);
  if (buffMatch) {
    const isDualTarget =
      allBrackets.length >= 2 &&
      /choose\s+1\s+[｢\[「][^｣\]」]+[｣\]」]\s+and\s+1\s+[｢\[「][^｣\]」]+[｣\]」]/i.test(text);
    if (isDualTarget) {
      return {
        kind: 'BUFF_TWO_TARGETS',
        amount: parseInt(buffMatch[1], 10) || 1,
        requiredNameFilter: allBrackets[0],
        secondaryNameFilter: allBrackets[1],
        requiresChoice: true,
      };
    }
    const isTargeted =
      /choose|select|target|1\s+of\s+your|another/i.test(text) || allBrackets.length > 0;
    return {
      kind: 'TARGET_BUFF_POWER',
      amount: parseInt(buffMatch[1], 10) || 1,
      isSelfOnly: !isTargeted,
      requiredNameFilter: nameFilter,
      requiresChoice: isTargeted,
    };
  }

  return null;
}

export function parseAppearOrFarewellEffect(effectText?: string): ParsedActivatedEffect | null {
  return parseEffectClause(effectText);
}

export function parseActivatedCardEffect(card: CardDefinition): ParsedActivatedEffect {
  const text = sanitizeCardText(card.effectText);
  const adventureClause = extractTriggerClause(text, 'Adventure');
  const parsed = parseEffectClause(adventureClause || text);
  if (parsed) return parsed;

  return {
    kind: 'NONE_PASSIVE',
    amount: 0,
  };
}