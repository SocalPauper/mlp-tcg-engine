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

export function sanitizeCardText(raw?: string): string {
  if (!raw) return '';
  return raw.replace(/\{\{[^}]*$/g, '').replace(/\{\{|\}\}/g, '').trim();
}

export function getEffectiveCardCost(player: PlayerState, card: CardDefinition): number {
  let baseCost = Math.max(0, Number(card.cost) || 0);
  if (baseCost === 0) return 0;

  const cardType = String(card.type || '').toLowerCase();
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

export function canPayHarmonyCost(player: PlayerState, card: CardDefinition): boolean {
  const requiredCost = getEffectiveCardCost(player, card);
  if (requiredCost === 0) return true;

  const readyScenes = player.sceneArea.filter((s) => !s.isExhausted);
  if (readyScenes.length < requiredCost) return false;

  const cardEl = String(card.element || 'Everyday').toLowerCase();
  if (!cardEl || cardEl === 'everyday' || cardEl === 'none') {
    return true;
  }

  return readyScenes.some((s) => {
    const sEl = String(s.card.element || 'Everyday').toLowerCase();
    return sEl === cardEl || sEl === 'everyday' || sEl === 'none';
  });
}

export function exhaustScenesWithElementPriority(
  sceneArea: SceneCardInPlay[],
  card: CardDefinition,
  effectiveCost: number
): SceneCardInPlay[] {
  if (effectiveCost <= 0) return sceneArea;

  const cardEl = String(card.element || 'Everyday').toLowerCase();
  const indicesToExhaust = new Set<number>();

  if (cardEl && cardEl !== 'everyday' && cardEl !== 'none') {
    const exactIdx = sceneArea.findIndex(
      (s) => !s.isExhausted && String(s.card.element || '').toLowerCase() === cardEl
    );
    if (exactIdx !== -1) {
      indicesToExhaust.add(exactIdx);
    } else {
      const wildIdx = sceneArea.findIndex((s) => {
        const sEl = String(s.card.element || 'Everyday').toLowerCase();
        return !s.isExhausted && (sEl === 'everyday' || sEl === 'none');
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

function matchesCharacterFilter(character: CardDefinition, filterText: string): boolean {
  const cleanFilter = filterText.trim().toLowerCase();
  const charName = String(character.name || '').toLowerCase();
  const charTraits = String(character.traits || '').toLowerCase();
  const charType = String(character.type || '').toLowerCase();
  return (
    charName.includes(cleanFilter) ||
    charTraits.includes(cleanFilter) ||
    charType.includes(cleanFilter)
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
  isAttachedItem = false
): number {
  const text = sanitizeCardText(rawText);
  if (!text) return 0;

  if (
    /Inspo Boost|Inspiration Boost|Pre-Plan|Appear\s*:|Farewell\s*:|When promoted|until the end of/i.test(
      text
    )
  ) {
    return 0;
  }
  if (/Adventure\s*:/i.test(text) && !/Adventure\s*:\s*While\b/i.test(text)) {
    return 0;
  }

  const powerMatch = text.match(/get[s]?\s*\+(\d+)\s*(?:Inspiration|Power)/i);
  if (!powerMatch) return 0;

  const bonus = parseInt(powerMatch[1], 10) || 0;
  if (bonus <= 0) return 0;

  if (/(?:during|in)\s+your\s+turn/i.test(text) && !isOwnersTurn) {
    return 0;
  }
  if (/(?:during|in)\s+rival'?s\s+turn/i.test(text) && isOwnersTurn) {
    return 0;
  }

  if (/while there is any item in your retirement/i.test(text) && ownerPlayer) {
    const hasItemInRetirement = ownerPlayer.retirement.some(
      (c) => String(c.type || '').toLowerCase() === 'item'
    );
    if (!hasItemInRetirement) return 0;
  }

  if (/while adorned with an item/i.test(text) && slot && slot.items.length === 0) {
    return 0;
  }

  if (/while (?:it has|adorned with) (?:a )?treat/i.test(text) && slot && slot.treats <= 0) {
    return 0;
  }

  if (/while (?:it has|adorned with) (?:a )?present/i.test(text) && slot && slot.presents.length === 0) {
    return 0;
  }

  if (/this\s+character\s+gets/i.test(text) && !isSelfCard && !isAttachedItem) {
    return 0;
  }
  if (/adorned\s+character\s+gets/i.test(text) && !isAttachedItem) {
    return 0;
  }

  if (/left\s+lane/i.test(text) && lane !== 'left') return 0;
  if (/center\s+lane/i.test(text) && lane !== 'center') return 0;
  if (/right\s+lane/i.test(text) && lane !== 'right') return 0;

  const charType = String(character.type || '').toLowerCase();
  if (/your\s+friend/i.test(text) && !charType.includes('friend')) {
    return 0;
  }

  const elements = ['magic', 'loyalty', 'honesty', 'generosity', 'kindness', 'laughter'];
  for (const el of elements) {
    const elRegex = new RegExp(`your\\s+${el}\\s+character`, 'i');
    if (elRegex.test(text) && String(character.element || '').toLowerCase() !== el) {
      return 0;
    }
  }

  const charBracketMatch = text.match(/[｢\[「]([^｣\]」]+)[｣\]」]/);
  if (charBracketMatch && !isAttachedItem) {
    if (!matchesCharacterFilter(character, charBracketMatch[1])) {
      return 0;
    }
  }

  return bonus;
}

export function calculateLanePowerBreakdown(
  state: KayouGameState,
  playerId: '0' | '1',
  lane: LaneKey
): LanePowerBreakdown {
  const player = state.players[playerId];
  const slot = player.adventureArea[lane];

  if (!slot.character) {
    return { basePower: 0, modifiers: [], totalPower: 0 };
  }

  const character = slot.character;
  const basePower = Number(character.power) || 0;
  const modifiers: PowerModifierLine[] = [];
  const isOwnersTurn = state.turnPlayerId === playerId;

  const selfBonus = doesPassiveTextApplyToCharacter(
    character.effectText || '',
    character,
    lane,
    isOwnersTurn,
    player,
    slot,
    true,
    false
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
      true
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

  if (player.leader) {
    const leaderBonus = doesPassiveTextApplyToCharacter(
      player.leader.effectText || '',
      character,
      lane,
      isOwnersTurn,
      player,
      slot,
      false,
      false
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
      false
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
      false
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

export interface ParsedActivatedEffect {
  kind:
    | 'DRAW'
    | 'DRAW_THEN_DISCARD'
    | 'DISCARD_HAND'
    | 'DISCARD_THEN_DRAW'
    | 'RECOVER_RETIREMENT'
    | 'UNTAP_SCENES'
    | 'REVEAL_TOP_PICK_HAND'
    | 'TARGET_BUFF_POWER'
    | 'TARGET_DEBUFF_OPPONENT'
    | 'TARGET_RETIRE_OPPONENT'
    | 'TARGET_MOVE_FRIENDLY'
    | 'SWITCH_POSITIONS'
    | 'TARGET_READY_FRIENDLY'
    | 'GLOBAL_BUFF_FRIENDLY'
    | 'TREAT_FOR_YOU'
    | 'DELIVER_PRESENT'
    | 'UNWRAP_PRESENT';
  amount: number;
  secondaryAmount?: number;
  maxLimit?: number;
  isSelfOnly?: boolean;
  isGlobal?: boolean;
  targetSide?: 'SELF' | 'OPPONENT' | 'ANY';
  requiredTypeFilter?: string;
  requiredNameFilter?: string;
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
    `${escaped}\\s*:?\\s*([\\s\\S]*?)(?=(?:\\n|\\r|(?:Appear|Farewell|Adventure|Inspo Boost|Inspiration Boost|Pre-Plan|Mane Ability|Activate|Treat for you!|Deliver Present|Unwrap Present)\\s*:?|$))`,
    'i'
  );
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

export function parseEffectClause(clauseText?: string): ParsedActivatedEffect | null {
  const text = sanitizeCardText(clauseText);
  if (!text) return null;

  const nameBracket = text.match(/[｢\[「]([^｣\]」]+)[｣\]」]/);
  const nameFilter = nameBracket ? nameBracket[1].trim() : undefined;

  // 0A. Draw X, then discard Y
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
    };
  }

  // 0B. Discard X, then draw Y
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
    };
  }

  // 0C. Standalone Discard from Hand
  const soloDiscardMatch = text.match(/discard\s+(\d+|a|an)\s+cards?\s+from\s+(?:your\s+)?hand/i);
  if (soloDiscardMatch) {
    const discRaw = soloDiscardMatch[1].toLowerCase();
    return {
      kind: 'DISCARD_HAND',
      amount: discRaw === 'a' || discRaw === 'an' ? 1 : parseInt(discRaw, 10) || 1,
    };
  }

  // 0D. Untap / Ready Scenes in Scene Area
  const untapSceneMatch = text.match(
    /(?:choose|ready|untap)\s+(\d+|a|an)\s+(?:face-down\s+|exhausted\s+|tapped\s+)?scenes?\s+in\s+your\s+scene\s+area/i
  );
  if (untapSceneMatch) {
    const raw = untapSceneMatch[1].toLowerCase();
    return {
      kind: 'UNTAP_SCENES',
      amount: raw === 'a' || raw === 'an' ? 1 : parseInt(raw, 10) || 1,
    };
  }

  // 0E. Reveal top X cards of Deck, choose 1 matching card to add to Hand
  const revealPickMatch = text.match(
    /reveal\s+the\s+top\s+(\d+)\s+cards?\s+of\s+(?:your|the)\s+deck.*?choose\s+1\s+(Item|Event|Character|Scene|card|[｢\[「][^｣\]」]+[｣\]」])/i
  );
  if (revealPickMatch) {
    const count = parseInt(revealPickMatch[1], 10) || 3;
    const rawTarget = revealPickMatch[2].replace(/[｢\[「｣\]」]/g, '').trim();
    const isAnyCard = rawTarget.toLowerCase() === 'card';
    const isCardType = ['item', 'event', 'character', 'scene'].includes(rawTarget.toLowerCase());
    return {
      kind: 'REVEAL_TOP_PICK_HAND',
      amount: count,
      requiredTypeFilter: isCardType ? rawTarget : undefined,
      requiredNameFilter: !isCardType && !isAnyCard ? rawTarget : nameFilter,
    };
  }

  // 1. Treat for you!
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
    };
  }

  // 2. Unwrap Present
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
    };
  }

  // 3. Deliver Present
  if (/deliver\s+present|put\s+\d+\s+present/i.test(text)) {
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
    };
  }

  // 4. Switch Positions
  if (/switch(?:es)?\s+positions/i.test(text)) {
    const targetSide: 'SELF' | 'OPPONENT' = /rival'?s\s+adventure/i.test(text)
      ? 'OPPONENT'
      : 'SELF';
    return {
      kind: 'SWITCH_POSITIONS',
      amount: 1,
      targetSide,
      requiredNameFilter: nameFilter,
    };
  }

  // 5. Negative Inspiration debuff on Rival character
  const debuffMatch = text.match(/[–-]\s*(\d+)\s*(?:Inspiration|Power)/i);
  if (debuffMatch && /rival|opponent/i.test(text)) {
    return {
      kind: 'TARGET_DEBUFF_OPPONENT',
      amount: parseInt(debuffMatch[1], 10) || 1,
    };
  }

  // 6. Move friendly Character to empty slot
  if (/move\s+(?:1\s+of\s+your\s+|a\s+|an?\s+|it\s+to\s+1\s+empty)/i.test(text)) {
    return { kind: 'TARGET_MOVE_FRIENDLY', amount: 1 };
  }

  // 7. Retire opponent Character
  if (
    /retire\s+(?:1\s+of\s+your\s+opponent|an?\s+opponent)|choose\s+1\s+character.*?(?:rival|opponent).*?to\s+retire/i.test(
      text
    )
  ) {
    const limitMatch = text.match(
      /(?:cost(?:\s+of\s+Force\s+of\s+Harmony)?|power|inspiration)\s*(\d+)\s*or\s*less/i
    );
    return {
      kind: 'TARGET_RETIRE_OPPONENT',
      amount: 1,
      maxLimit: limitMatch ? parseInt(limitMatch[1], 10) : undefined,
    };
  }

  // 8. Ready / Untap Character
  if (/ready|untap/i.test(text) && /character/i.test(text)) {
    return { kind: 'TARGET_READY_FRIENDLY', amount: 1 };
  }

  // 9. Recover from Retirement Area
  if (
    /in\s+your\s+retirement\s+(?:area\s+|pile\s+)?(?:,|\s)*add\s+(?:it|them)\s+to\s+(?:your\s+)?hand|from\s+your\s+retirement\s+(?:area\s+|pile\s+)?to\s+(?:your\s+)?hand/i.test(
      text
    )
  ) {
    const typeMatch = text.match(/choose\s+1\s+(Item|Event|Character|Scene)/i);
    return {
      kind: 'RECOVER_RETIREMENT',
      amount: 1,
      requiredTypeFilter: typeMatch ? typeMatch[1] : undefined,
      requiredNameFilter: nameFilter,
    };
  }

  // 10. Draw cards
  const drawMatch = text.match(/draw\s+(\d+|a|an)\s+card/i);
  if (drawMatch) {
    const rawCount = drawMatch[1].toLowerCase();
    const count = rawCount === 'a' || rawCount === 'an' ? 1 : parseInt(rawCount, 10) || 1;
    return { kind: 'DRAW', amount: count };
  }

  // 11. Global / trait buff to friendly Characters
  const globalMatch = text.match(
    /(?:all|each)\s+(?:of\s+)?(?:your\s+)?(?:characters?|[｢\[「][^｣\]」]+[｣\]」])\s+(?:in\s+your\s+adventure\s+area\s+)?get[s]?\s*\+(\d+)/i
  );
  if (globalMatch) {
    return {
      kind: 'GLOBAL_BUFF_FRIENDLY',
      amount: parseInt(globalMatch[1], 10) || 1,
      requiredNameFilter: nameFilter,
    };
  }

  // 12. Single-target or self +Inspiration buff
  const buffMatch = text.match(/\+(\d+)\s*(?:Inspiration|Power)/i);
  if (buffMatch) {
    const isTargeted =
      /choose|target|1\s+of\s+your|another/i.test(text) || Boolean(nameBracket);
    return {
      kind: 'TARGET_BUFF_POWER',
      amount: parseInt(buffMatch[1], 10) || 1,
      isSelfOnly: !isTargeted,
      requiredNameFilter: nameFilter,
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

  const buffMatch = text.match(/\+(\d+)\s*(?:Inspiration|Power)/i);
  return {
    kind: 'TARGET_BUFF_POWER',
    amount: buffMatch ? parseInt(buffMatch[1], 10) : 2,
  };
}