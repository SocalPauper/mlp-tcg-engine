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
  if (/at the end of/i.test(text)) tags.push('Delayed: End of Turn');
  if (/until the end of/i.test(text)) tags.push('Duration: Until End of Turn');
  if (/top or (?:the )?bottom/i.test(text)) tags.push('Top/Bottom Deck Choice');
  const bracket = text.match(/[｢\[「]([^｣\]」]+)[｣\]」]/);
  if (bracket) tags.push(`Keyword: 「${bracket[1]}」`);
  return tags;
}

export function matchesCardKeywordExact(card: CardDefinition, filterText: string): boolean {
  const target = filterText.trim().toLowerCase();
  if (!target) return true;

  const cardName = String(card.name || '').trim().toLowerCase();
  if (cardName === target) return true;

  // Check traits AND card.type (e.g. "Pet", "Earth Pony", "Unicorn", "Pegasus", "Dragon")
  const combinedKeywords = `${card.traits || ''} ${card.type || ''}`.toLowerCase();
  const traitTokens = combinedKeywords
    .split(/[,/|•·\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (!target.includes(' ') && traitTokens.includes(target)) {
    return true;
  }

  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordBoundaryRegex = new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'i');
  if (wordBoundaryRegex.test(combinedKeywords)) return true;

  return false;
}

export function canPlayCardRestrictions(
  state: KayouGameState,
  playerId: '0' | '1',
  card: CardDefinition
): { allowed: boolean; reason?: string } {
  const text = sanitizeCardText(card.effectText);
  if (!text) return { allowed: true };

  // Check "Only use when <condition>." (e.g., Dress for Competition: "Only use when there is any 「Rarity」 in your Adventure Area.")
  const onlyMatch = text.match(/^only\s+(?:use|play|activate)\s+when\s+([^.]+)\./i);
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
    /Inspo Boost|Inspiration Boost|Pre-Plan|Appear\s*:|Farewell\s*:|When promoted|until the end of|at the end of/i.test(
      text
    )
  ) {
    return 0;
  }
  if (/Adventure\s*:\s*Tap/i.test(text)) {
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

  if (
    /while\s+there\s+(?:is|are)\s+(?:any\s+)?untapped\s+scenes?\s+in\s+your\s+scene\s+area/i.test(
      text
    ) &&
    ownerPlayer
  ) {
    const hasUntappedScene = ownerPlayer.sceneArea.some((sc) => !sc.isExhausted);
    if (!hasUntappedScene) return 0;
  }

  if (
    /while\s+there\s+(?:is|are)\s+(?:any\s+)?tapped\s+scenes?\s+in\s+your\s+scene\s+area/i.test(
      text
    ) &&
    ownerPlayer
  ) {
    const hasTappedScene = ownerPlayer.sceneArea.some((sc) => sc.isExhausted);
    if (!hasTappedScene) return 0;
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
    if (!matchesCardKeywordExact(character, charBracketMatch[1])) {
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
  const cond = sanitizeCardText(conditionText);
  const player = state.players[ownerId];
  const allLanes: LaneKey[] = ['left', 'center', 'right'];

  const bracketInAdv = cond.match(
    /there\s+is\s+(?:any|a|an)\s+[｢\[「]([^｣\]」]+)[｣\]」]\s+in\s+your\s+adventure\s+area/i
  );
  if (bracketInAdv) {
    const required = bracketInAdv[1].trim();
    return allLanes.some((l) => {
      const char = player.adventureArea[l].character;
      return char !== null && matchesCardKeywordExact(char, required);
    });
  }

  if (/there\s+is\s+(?:any|an)\s+item\s+in\s+your\s+retirement/i.test(cond)) {
    return player.retirement.some((c) => String(c.type || '').toLowerCase() === 'item');
  }

  const countCharsMatch = cond.match(/you\s+have\s+(\d+)\s+or\s+more\s+characters?/i);
  if (countCharsMatch) {
    const minCount = parseInt(countCharsMatch[1], 10) || 1;
    const currentCount = allLanes.filter((l) => player.adventureArea[l].character !== null).length;
    return currentCount >= minCount;
  }

  return true;
}

export interface ParsedActivatedEffect {
  kind:
    | 'NONE_PASSIVE'
    | 'DRAW'
    | 'DRAW_THEN_DISCARD'
    | 'DISCARD_HAND'
    | 'DISCARD_THEN_DRAW'
    | 'RECOVER_RETIREMENT'
    | 'UNTAP_SCENES'
    | 'SCRY_TOP_BOTTOM'
    | 'REVEAL_TOP_PICK_HAND'
    | 'TARGET_BUFF_POWER'
    | 'TARGET_DEBUFF_OPPONENT'
    | 'TARGET_RETIRE_OPPONENT'
    | 'PREVENT_RETIRE_IN_CONTACT'
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
  requiresChoice?: boolean;
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
    `${escaped}\\s*(?:Tap\\s*:|:)\\s*([\\s\\S]*?)(?=(?:\\n|\\r|(?:Appear|Farewell|Adventure|Inspo Boost|Inspiration Boost|Pre-Plan|Mane Ability|Activate|Treat for you!|Deliver Present|Unwrap Present)\\s*(?:Tap\\s*:|:)|$))`,
    'i'
  );
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

export function parseEffectClause(clauseText?: string): ParsedActivatedEffect | null {
  let text = sanitizeCardText(clauseText);
  if (!text) return null;

  text = text.replace(/^Tap\s*:\s*/i, '').trim();

  if (/^while\b/i.test(text)) {
    return { kind: 'NONE_PASSIVE', amount: 0 };
  }

  // Strip leading "Only use when <condition>." or "If <condition>, " before parsing the action
  text = text.replace(/^only\s+(?:use|play|activate)\s+when\s+[^.]+\.\s*/i, '').trim();
  const leadingIf = text.match(/^if\s+[^,]+,\s*([\s\S]+)$/i);
  if (leadingIf) {
    text = leadingIf[1].trim();
  }

  const nameBracket = text.match(/[｢\[「]([^｣\]」]+)[｣\]」]/);
  const nameFilter = nameBracket ? nameBracket[1].trim() : undefined;

  const limitMatch = text.match(
    /(?:cost(?:\s+of\s+Force\s+of\s+Harmony)?|power|inspiration|harmony(?:\s+level)?)\s*(\d+)\s*or\s*less/i
  );
  const parsedMaxLimit = limitMatch ? parseInt(limitMatch[1], 10) : undefined;

  // Owlowiscious (SD01A-C05): "Look/Reveal the top card of the Deck, put it at the top or the bottom of the Deck."
  if (
    /(?:look\s+at|reveal)\s+the\s+top\s+card\s+of\s+(?:your|the)\s+deck.*?(?:top\s+or\s+(?:the )?bottom)/i.test(
      text
    )
  ) {
    return {
      kind: 'SCRY_TOP_BOTTOM',
      amount: 1,
      requiresChoice: true,
    };
  }

  // Prevent Retire in Contact (e.g., Tailor-made SD01F-SPR01: "Choose 1 「Rarity」 with Inspiration 3 or less in your Adventure Area, it won't retire in Contact until the end of turn.")
  if (/(?:won'?t|cannot|can'?t)\s+(?:be\s+)?retired?\s+in\s+contact/i.test(text)) {
    return {
      kind: 'PREVENT_RETIRE_IN_CONTACT',
      amount: 1,
      maxLimit: parsedMaxLimit,
      requiredNameFilter: nameFilter,
      requiresChoice: true,
    };
  }

  // Draw X, then discard Y
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

  // Discard X, then draw Y
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

  // Standalone Discard from Hand
  const soloDiscardMatch = text.match(/discard\s+(\d+|a|an)\s+cards?\s+from\s+(?:your\s+)?hand/i);
  if (soloDiscardMatch) {
    const discRaw = soloDiscardMatch[1].toLowerCase();
    return {
      kind: 'DISCARD_HAND',
      amount: discRaw === 'a' || discRaw === 'an' ? 1 : parseInt(discRaw, 10) || 1,
      requiresChoice: true,
    };
  }

  // Untap / Ready Scenes in Scene Area
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

  // Reveal top X cards of Deck, choose 1 matching card to add to Hand
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
      requiresChoice: true,
    };
  }

  // Treat for you!
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

  // Unwrap Present
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

  // Deliver Present
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
      requiresChoice: !isGlobal,
    };
  }

  // Switch Positions
  if (/switch(?:es)?\s+positions/i.test(text)) {
    const targetSide: 'SELF' | 'OPPONENT' = /rival'?s\s+adventure/i.test(text)
      ? 'OPPONENT'
      : 'SELF';
    return {
      kind: 'SWITCH_POSITIONS',
      amount: 1,
      targetSide,
      requiredNameFilter: nameFilter,
      requiresChoice: true,
    };
  }

  // Negative Inspiration debuff on Rival character
  const debuffMatch = text.match(/(?:–|-)\s*(\d+)\s*(?:Inspiration|Power)/i);
  if (debuffMatch && /rival|opponent/i.test(text)) {
    return {
      kind: 'TARGET_DEBUFF_OPPONENT',
      amount: parseInt(debuffMatch[1], 10) || 1,
      requiresChoice: true,
    };
  }

  // Move friendly Character to empty slot
  if (/move\s+(?:1\s+of\s+your\s+|a\s+|an?\s+|it\s+to\s+1\s+empty)/i.test(text)) {
    return { kind: 'TARGET_MOVE_FRIENDLY', amount: 1, requiresChoice: true };
  }

  // Retire opponent Character
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

  // Ready / Untap Character
  if (/ready|untap/i.test(text) && /character/i.test(text)) {
    return { kind: 'TARGET_READY_FRIENDLY', amount: 1, requiresChoice: true };
  }

  // Recover from Retirement Area
  if (
    /retirement\s+(?:area|pile)/i.test(text) &&
    /add\s+(?:it|them)\s+to\s+(?:your\s+)?hand/i.test(text)
  ) {
    const typeMatch = text.match(/(?:choose|select)\s+(?:1|any)\s+(Item|Event|Character|Scene)/i);
    return {
      kind: 'RECOVER_RETIREMENT',
      amount: 1,
      maxLimit: parsedMaxLimit,
      requiredTypeFilter: typeMatch ? typeMatch[1] : undefined,
      requiredNameFilter: nameFilter,
      requiresChoice: true,
    };
  }

  // Draw cards
  const drawMatch = text.match(/draw\s+(\d+|a|an)\s+card/i);
  if (drawMatch) {
    const rawCount = drawMatch[1].toLowerCase();
    const count = rawCount === 'a' || rawCount === 'an' ? 1 : parseInt(rawCount, 10) || 1;
    return { kind: 'DRAW', amount: count };
  }

  // Global / trait buff to friendly Characters
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

  // Single-target or self +Inspiration buff
  const buffMatch = text.match(/\+(\d+)\s*(?:Inspiration|Power)/i);
  if (buffMatch) {
    const isTargeted =
      /choose|select|target|1\s+of\s+your|another/i.test(text) || Boolean(nameBracket);
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