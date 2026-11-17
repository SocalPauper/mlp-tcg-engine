import {
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
    /cost\s+1\s+less/i.test(leaderText) &&
    ((cardType.includes('friend') && /friend/i.test(leaderText)) ||
      (cardType === 'item' && /item/i.test(leaderText)) ||
      (cardType === 'event' && /event/i.test(leaderText)))
  ) {
    baseCost = Math.max(0, baseCost - 1);
  }

  for (const sc of player.sceneArea) {
    if (!sc.isFaceUp) continue;
    const scText = sanitizeCardText(sc.card.effectText);
    if (
      /cost\s+1\s+less/i.test(scText) &&
      ((cardType.includes('friend') && /friend/i.test(scText)) ||
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
  isSelfCard = false
): number {
  const text = sanitizeCardText(rawText);
  if (!text) return 0;

  if (
    /Inspo Boost|Inspiration Boost|Pre-Plan|Appear\s*:|Farewell\s*:|When promoted/i.test(text)
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

  if (/during your turn|in your turn/i.test(text) && !isOwnersTurn) {
    return 0;
  }

  // Conditional Retirement check (e.g., "While there is any Item in your Retirement Area")
  if (/while there is any item in your retirement/i.test(text) && ownerPlayer) {
    const hasItemInRetirement = ownerPlayer.retirement.some(
      (c) => String(c.type || '').toLowerCase() === 'item'
    );
    if (!hasItemInRetirement) return 0;
  }

  // Self-only continuous passive ("this Character gets +X")
  if (/this\s+character\s+gets/i.test(text) && !isSelfCard) {
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
  if (charBracketMatch) {
    const req = charBracketMatch[1].trim().toLowerCase();
    if (!String(character.name || '').toLowerCase().includes(req)) {
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

  // Check continuous self-passive printed on the character itself
  const selfBonus = doesPassiveTextApplyToCharacter(
    character.effectText || '',
    character,
    lane,
    isOwnersTurn,
    player,
    true
  );
  if (selfBonus > 0) {
    modifiers.push({
      sourceName: `Passive: ${character.name}`,
      sourceType: 'MANE_PASSIVE',
      amount: selfBonus,
    });
  }

  for (const item of slot.items) {
    let itemBonus = Number(item.power) || 1;
    const itemText = sanitizeCardText(item.effectText);
    const condMatch = itemText.match(/if attached to .*? get[s]?\s*\+(\d+)/i);
    if (condMatch) {
      const charBracket = itemText.match(/[｢\[「]([^｣\]」]+)[｣\]」]/);
      if (
        !charBracket ||
        String(character.name || '').toLowerCase().includes(charBracket[1].trim().toLowerCase())
      ) {
        itemBonus += parseInt(condMatch[1], 10) || 0;
      }
    }
    modifiers.push({
      sourceName: `Item: ${item.name}`,
      sourceType: 'ITEM',
      amount: itemBonus,
    });
  }

  if (player.leader) {
    const leaderBonus = doesPassiveTextApplyToCharacter(
      player.leader.effectText || '',
      character,
      lane,
      isOwnersTurn,
      player,
      false
    );
    if (leaderBonus > 0) {
      modifiers.push({
        sourceName: `Mane Passive: ${player.leader.name}`,
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
      false
    );
    if (stBonus > 0) {
      modifiers.push({
        sourceName: `Story ${st.stage}: ${st.storyCard.name}`,
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
    | 'RECOVER_RETIREMENT'
    | 'TARGET_BUFF_POWER'
    | 'TARGET_DEBUFF_OPPONENT'
    | 'TARGET_RETIRE_OPPONENT'
    | 'TARGET_MOVE_FRIENDLY'
    | 'TARGET_READY_FRIENDLY'
    | 'GLOBAL_BUFF_FRIENDLY';
  amount: number;
  maxLimit?: number;
  isSelfOnly?: boolean;
  requiredNameFilter?: string;
}

/**
 * Extracts the clause belonging specifically to Appear or Farewell
 * without bleeding into other triggered abilities on the same card.
 */
export function extractTriggerClause(
  effectText: string | undefined,
  triggerType: 'Appear' | 'Farewell'
): string | null {
  const text = sanitizeCardText(effectText);
  if (!text) return null;

  const regex = new RegExp(
    `${triggerType}\\s*:\\s*([\\s\\S]*?)(?=(?:\\n|\\r|(?:Appear|Farewell|Adventure|Inspo Boost|Inspiration Boost|Pre-Plan|Mane Ability|Activate)\\s*:|$))`,
    'i'
  );
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

export function parseEffectClause(clauseText?: string): ParsedActivatedEffect | null {
  const text = sanitizeCardText(clauseText);
  if (!text) return null;

  // Negative Inspiration debuff on Rival character (e.g., "Choose 1 Character in Rival's Adventure Area, it gets -2 Inspiration")
  const debuffMatch = text.match(/[–-]\s*(\d+)\s*(?:Inspiration|Power)/i);
  if (debuffMatch && /rival|opponent/i.test(text)) {
    return {
      kind: 'TARGET_DEBUFF_OPPONENT',
      amount: parseInt(debuffMatch[1], 10) || 1,
    };
  }

  if (/move\s+(?:1\s+of\s+your\s+|a\s+|an?\s+)?(?:friendly\s+)?character/i.test(text)) {
    return { kind: 'TARGET_MOVE_FRIENDLY', amount: 1 };
  }

  if (
    /retire\s+(?:1\s+of\s+your\s+opponent|an?\s+opponent)|choose\s+1\s+character.*?(?:rival|opponent).*?to\s+retire/i.test(
      text
    )
  ) {
    const limitMatch = text.match(/(?:cost|power|inspiration)\s*(\d+)\s*or\s*less/i);
    return {
      kind: 'TARGET_RETIRE_OPPONENT',
      amount: 1,
      maxLimit: limitMatch ? parseInt(limitMatch[1], 10) : undefined,
    };
  }

  if (/ready|untap/i.test(text) && /character/i.test(text)) {
    return { kind: 'TARGET_READY_FRIENDLY', amount: 1 };
  }

  if (
    /from\s+your\s+retirement\s+(?:area\s+|pile\s+)?to\s+(?:your\s+)?hand|in\s+your\s+retirement\s+area,\s*add\s+(?:it|them)\s+to\s+(?:your\s+)?hand/i.test(
      text
    )
  ) {
    return { kind: 'RECOVER_RETIREMENT', amount: 1 };
  }

  const drawMatch = text.match(/draw\s+(\d+|a|an)\s+card/i);
  if (drawMatch) {
    const rawCount = drawMatch[1].toLowerCase();
    const count = rawCount === 'a' || rawCount === 'an' ? 1 : parseInt(rawCount, 10) || 1;
    return { kind: 'DRAW', amount: count };
  }

  const globalMatch = text.match(
    /all\s+(?:of\s+)?(?:your\s+)?characters?\s+(?:in\s+your\s+adventure\s+area\s+)?get[s]?\s*\+(\d+)/i
  );
  if (globalMatch) {
    return { kind: 'GLOBAL_BUFF_FRIENDLY', amount: parseInt(globalMatch[1], 10) || 1 };
  }

  const buffMatch = text.match(/\+(\d+)\s*(?:Inspiration|Power)/i);
  if (buffMatch) {
    const nameBracket = text.match(/[｢\[「]([^｣\]」]+)[｣\]」]/);
    const isTargeted = /choose|target|1\s+of\s+your|another/i.test(text) || Boolean(nameBracket);
    return {
      kind: 'TARGET_BUFF_POWER',
      amount: parseInt(buffMatch[1], 10) || 1,
      isSelfOnly: !isTargeted,
      requiredNameFilter: nameBracket ? nameBracket[1].trim() : undefined,
    };
  }

  return null;
}

export function parseAppearOrFarewellEffect(effectText?: string): ParsedActivatedEffect | null {
  return parseEffectClause(effectText);
}

export function parseActivatedCardEffect(card: CardDefinition): ParsedActivatedEffect {
  const text = sanitizeCardText(card.effectText);
  const parsed = parseEffectClause(text);
  if (parsed) return parsed;

  const buffMatch = text.match(/\+(\d+)\s*(?:Inspiration|Power)/i);
  return {
    kind: 'TARGET_BUFF_POWER',
    amount: buffMatch ? parseInt(buffMatch[1], 10) : 2,
  };
}