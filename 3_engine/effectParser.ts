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
  isOwnersTurn: boolean
): number {
  const text = sanitizeCardText(rawText);
  if (!text) return 0;

  if (/Inspo Boost|Inspiration Boost|Adventure\s*:|Pre-Plan|Appear:|Farewell:|When promoted/i.test(text)) {
    return 0;
  }

  const powerMatch = text.match(/get[s]?\s*\+(\d+)\s*(?:Inspiration|Power)/i);
  if (!powerMatch) return 0;

  const bonus = parseInt(powerMatch[1], 10) || 0;
  if (bonus <= 0) return 0;

  if (/during your turn/i.test(text) && !isOwnersTurn) {
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
      isOwnersTurn
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
      isOwnersTurn
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
      isOwnersTurn
    );
    if (stBonus > 0) {
      modifiers.push({
        sourceName: `Story ${st.stage}: ${st.storyCard.name}`,
        sourceType: 'STORY_PASSIVE',
        amount: stBonus,
      });
    }
  }

  if (slot.inspoBoost > 0) {
    modifiers.push({
      sourceName: 'Inspiration / Event Boosts',
      sourceType: 'INSPO_BOOST',
      amount: slot.inspoBoost,
    });
  }

  const totalPower =
    basePower + modifiers.reduce((sum, line) => sum + line.amount, 0);

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
    | 'TARGET_RETIRE_OPPONENT'
    | 'TARGET_MOVE_FRIENDLY'
    | 'TARGET_READY_FRIENDLY'
    | 'GLOBAL_BUFF_FRIENDLY';
  amount: number;
  maxLimit?: number;
}

export function parseAppearOrFarewellEffect(effectText?: string): ParsedActivatedEffect | null {
  const text = sanitizeCardText(effectText);
  if (!text) return null;

  const drawMatch = text.match(/draw\s+(\d+|a)\s+card/i);
  if (drawMatch) {
    const count = drawMatch[1].toLowerCase() === 'a' ? 1 : parseInt(drawMatch[1], 10) || 1;
    return { kind: 'DRAW', amount: count };
  }

  const buffMatch = text.match(/\+(\d+)\s*(?:Inspiration|Power)/i);
  if (buffMatch) {
    return { kind: 'TARGET_BUFF_POWER', amount: parseInt(buffMatch[1], 10) || 1 };
  }

  if (/ready\s+(?:1\s+of\s+your\s+|a\s+)?character/i.test(text)) {
    return { kind: 'TARGET_READY_FRIENDLY', amount: 1 };
  }

  return null;
}

export function parseActivatedCardEffect(card: CardDefinition): ParsedActivatedEffect {
  const text = sanitizeCardText(card.effectText);

  if (/move\s+(?:1\s+of\s+your\s+|a\s+)?character/i.test(text)) {
    return { kind: 'TARGET_MOVE_FRIENDLY', amount: 1 };
  }

  if (/retire\s+(?:1\s+of\s+your\s+opponent|an?\s+opponent)/i.test(text)) {
    const limitMatch = text.match(/(?:cost|power|inspiration)\s*(\d+)\s*or\s*less/i);
    return {
      kind: 'TARGET_RETIRE_OPPONENT',
      amount: 1,
      maxLimit: limitMatch ? parseInt(limitMatch[1], 10) : undefined,
    };
  }

  if (/ready\s+(?:1\s+of\s+your\s+|a\s+)?character/i.test(text)) {
    return { kind: 'TARGET_READY_FRIENDLY', amount: 1 };
  }

  if (/from\s+your\s+retirement\s+area\s+to\s+your\s+hand/i.test(text)) {
    return { kind: 'RECOVER_RETIREMENT', amount: 1 };
  }

  const drawMatch = text.match(/draw\s+(\d+|a)\s+card/i);
  if (drawMatch && !/choose|target/i.test(text)) {
    const count = drawMatch[1].toLowerCase() === 'a' ? 1 : parseInt(drawMatch[1], 10) || 1;
    return { kind: 'DRAW', amount: count };
  }

  const globalMatch = text.match(/all\s+your\s+characters?\s+get[s]?\s*\+(\d+)/i);
  if (globalMatch) {
    return { kind: 'GLOBAL_BUFF_FRIENDLY', amount: parseInt(globalMatch[1], 10) || 1 };
  }

  const buffMatch = text.match(/\+(\d+)\s*(?:Inspiration|Power)/i);
  return {
    kind: 'TARGET_BUFF_POWER',
    amount: buffMatch ? parseInt(buffMatch[1], 10) : 2,
  };
}