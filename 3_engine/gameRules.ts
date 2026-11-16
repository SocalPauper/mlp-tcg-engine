import {
  KayouGameState,
  CardDefinition,
  PlayerState,
  HydratedDeckPayload,
  LaneKey,
  SceneCardInPlay,
  StoryStageSlot,
} from './types.js';

export function secureShuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const randomBuffer = new Uint32Array(1);
    crypto.getRandomValues(randomBuffer);
    const j = Math.floor((randomBuffer[0] / (0xffffffff + 1)) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function createEmptyPlayer(id: '0' | '1', name: string): PlayerState {
  return {
    id,
    displayName: name,
    leader: null,
    mainDeck: [],
    sceneDeck: [],
    hand: [],
    retirement: [],
    sceneArea: [],
    storyStages: [1, 2, 3, 4].map((s) => ({
      stage: s as 1 | 2 | 3 | 4,
      storyCard: null,
      isStoryCompleted: false,
      planCard: null,
      isPlanRevealed: false,
    })),
    storyProgress: 0,
    adventureArea: {
      left: { character: null, items: [], inspoBoost: 0 },
      center: { character: null, items: [], inspoBoost: 0 },
      right: { character: null, items: [], inspoBoost: 0 },
    },
    mulliganStatus: 'PENDING',
    turnsTaken: 0,
    actedLanesThisTurn: [],
  };
}

export function createWaitingMatch(): KayouGameState {
  return {
    roomId: 'waiting-room',
    phase: 'WAITING_FOR_PLAYERS',
    firstPlayerId: '0',
    turnPlayerId: '0',
    turnNumber: 1,
    winnerId: null,
    players: {
      '0': createEmptyPlayer('0', 'Player 1'),
      '1': createEmptyPlayer('1', 'Player 2'),
    },
    contactState: null,
    pendingLaneQueueAfterReveal: null,
    lastClashEvent: null,
    lastPlanRevealEvent: null,
    lastStoryRevealEvent: null,
    announcements: [],
  };
}

export function startSeatedMatch(
  deck0: HydratedDeckPayload,
  deck1: HydratedDeckPayload,
  p0Name = 'Player 1',
  p1Name = 'Player 2'
): KayouGameState {
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  const firstPlayerId: '0' | '1' = rand[0] % 2 === 0 ? '0' : '1';

  const setupPlayer = (id: '0' | '1', name: string, deck: HydratedDeckPayload): PlayerState => {
    const shuffledMain = secureShuffle(deck.mainDeck);
    const shuffledScenes = secureShuffle(deck.sceneDeck);

    const planCards = shuffledMain.slice(0, 4);
    const openingHand = shuffledMain.slice(4, 9);
    const remainingMain = shuffledMain.slice(9);

    const storyStages: StoryStageSlot[] = [1, 2, 3, 4].map((stageNum, idx) => ({
      stage: stageNum as 1 | 2 | 3 | 4,
      storyCard: deck.storyDeck[idx] || null,
      isStoryCompleted: false,
      planCard: planCards[idx] || null,
      isPlanRevealed: false,
    }));

    return {
      id,
      displayName: name,
      leader: deck.leader,
      mainDeck: remainingMain,
      sceneDeck: shuffledScenes,
      hand: openingHand,
      retirement: [],
      sceneArea: [],
      storyStages,
      storyProgress: 0,
      adventureArea: {
        left: { character: null, items: [], inspoBoost: 0 },
        center: { character: null, items: [], inspoBoost: 0 },
        right: { character: null, items: [], inspoBoost: 0 },
      },
      mulliganStatus: 'PENDING',
      turnsTaken: 0,
      actedLanesThisTurn: [],
    };
  };

  return {
    roomId: 'active-match',
    phase: 'VS_INTRO',
    firstPlayerId,
    turnPlayerId: firstPlayerId,
    turnNumber: 1,
    winnerId: null,
    players: {
      '0': setupPlayer('0', p0Name, deck0),
      '1': setupPlayer('1', p1Name, deck1),
    },
    contactState: null,
    pendingLaneQueueAfterReveal: null,
    lastClashEvent: null,
    lastPlanRevealEvent: null,
    lastStoryRevealEvent: null,
    announcements: [
      {
        type: 'SYSTEM',
        message: `${firstPlayerId === '0' ? p0Name : p1Name} won the toss and goes first!`,
        timestamp: Date.now(),
      },
    ],
  };
}

export function acknowledgeVsIntro(state: KayouGameState): KayouGameState {
  if (state.phase !== 'VS_INTRO') return state;
  return {
    ...state,
    phase: 'MULLIGAN',
  };
}

export function resolveMulligan(
  state: KayouGameState,
  playerId: '0' | '1',
  doMulligan: boolean
): KayouGameState {
  if (state.phase !== 'MULLIGAN') return state;
  const player = state.players[playerId];
  if (player.mulliganStatus !== 'PENDING') return state;

  let updatedPlayer: PlayerState;

  if (doMulligan) {
    const combinedBottom = [...player.mainDeck, ...player.hand];
    const newHand = combinedBottom.slice(0, 5);
    const remainingMain = combinedBottom.slice(5);

    updatedPlayer = {
      ...player,
      mainDeck: remainingMain,
      hand: newHand,
      mulliganStatus: 'MULLIGANED',
    };
  } else {
    updatedPlayer = {
      ...player,
      mulliganStatus: 'KEPT',
    };
  }

  const nextPlayers = {
    ...state.players,
    [playerId]: updatedPlayer,
  };

  if (
    nextPlayers['0'].mulliganStatus !== 'PENDING' &&
    nextPlayers['1'].mulliganStatus !== 'PENDING'
  ) {
    const dealInitialScenes = (p: PlayerState): PlayerState => {
      const topTwo = p.sceneDeck.slice(0, 2);
      const restSceneDeck = p.sceneDeck.slice(2);
      const isFirst = p.id === state.firstPlayerId;

      const sceneArea: SceneCardInPlay[] = topTwo.map((card, idx) => ({
        card,
        isFaceUp: isFirst && idx === 0 ? false : true,
        isExhausted: false,
        isLockedFaceDown: isFirst && idx === 0 ? true : false,
      }));

      return {
        ...p,
        sceneDeck: restSceneDeck,
        sceneArea,
        turnsTaken: p.id === state.firstPlayerId ? 1 : 0,
      };
    };

    const p0Ready = dealInitialScenes(nextPlayers['0']);
    const p1Ready = dealInitialScenes(nextPlayers['1']);

    return {
      ...state,
      phase: 'MAIN_PHASE',
      turnPlayerId: state.firstPlayerId,
      turnNumber: 1,
      players: {
        '0': p0Ready,
        '1': p1Ready,
      },
      announcements: [
        ...state.announcements,
        {
          type: 'TURN',
          message: `Turn 1 begins! ${
            state.firstPlayerId === '0' ? p0Ready.displayName : p1Ready.displayName
          } (First Turn: no draw, no attack).`,
          timestamp: Date.now(),
        },
      ],
    };
  }

  return {
    ...state,
    players: nextPlayers,
  };
}

export function getAvailableHarmonyCost(player: PlayerState): number {
  return player.sceneArea.filter((s) => !s.isExhausted).length;
}

function exhaustScenesForCost(sceneArea: SceneCardInPlay[], cost: number): SceneCardInPlay[] {
  let remainingToExhaust = cost;
  return sceneArea.map((scene) => {
    if (remainingToExhaust > 0 && !scene.isExhausted) {
      remainingToExhaust--;
      return { ...scene, isExhausted: true };
    }
    return scene;
  });
}

export function playCardFromHand(
  state: KayouGameState,
  playerId: '0' | '1',
  cardId: string,
  targetLane?: LaneKey
): KayouGameState {
  if (state.phase !== 'MAIN_PHASE' || state.turnPlayerId !== playerId) return state;

  const player = state.players[playerId];
  const cardIdx = player.hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) return state;

  const card = player.hand[cardIdx];
  const cardCost = Math.max(0, Number(card.cost) || 0);
  const availableHarmony = getAvailableHarmonyCost(player);
  if (cardCost > availableHarmony) return state;

  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const updatedSceneArea = exhaustScenesForCost(player.sceneArea, cardCost);
  const normalizedType = String(card.type || '').toLowerCase();

  if (normalizedType.includes('character')) {
    const lane: LaneKey = targetLane || 'left';
    const currentSlot = player.adventureArea[lane];

    const retiredFromSlot = currentSlot.character
      ? [currentSlot.character, ...currentSlot.items]
      : [];

    return {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          hand: newHand,
          sceneArea: updatedSceneArea,
          retirement: [...player.retirement, ...retiredFromSlot],
          adventureArea: {
            ...player.adventureArea,
            [lane]: {
              character: card,
              items: [],
              inspoBoost: 0,
            },
          },
        },
      },
    };
  }

  if (normalizedType === 'item') {
    const lane: LaneKey = targetLane || 'left';
    const currentSlot = player.adventureArea[lane];
    if (!currentSlot.character) return state;

    return {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          hand: newHand,
          sceneArea: updatedSceneArea,
          adventureArea: {
            ...player.adventureArea,
            [lane]: {
              ...currentSlot,
              items: [...currentSlot.items, card],
            },
          },
        },
      },
    };
  }

  const lane: LaneKey = targetLane || 'left';
  const currentSlot = player.adventureArea[lane];
  const boostedSlot = currentSlot.character
    ? { ...currentSlot, inspoBoost: currentSlot.inspoBoost + 1 }
    : currentSlot;

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        hand: newHand,
        sceneArea: updatedSceneArea,
        retirement: [...player.retirement, card],
        adventureArea: {
          ...player.adventureArea,
          [lane]: boostedSlot,
        },
      },
    },
  };
}

export function canSceneInspireCharacter(
  scene: SceneCardInPlay,
  targetCharacter: CardDefinition | null
): { eligible: boolean; boostAmount: number; reason?: string } {
  if (!scene.isFaceUp || scene.isLockedFaceDown || !targetCharacter) {
    return { eligible: false, boostAmount: 0 };
  }

  const text = String(scene.card.effectText || '');
  const id = String(scene.card.id || '').toUpperCase();

  const hasInspoKeyword =
    /Inspo Boost|Inspiration Boost|\+\d+\s*Inspiration/i.test(text) || id.includes('-ER');
  if (!hasInspoKeyword) {
    return {
      eligible: false,
      boostAmount: 0,
      reason: 'This Scene does not have an Inspo Boost ability.',
    };
  }

  const boostMatch = text.match(/\+(\d+)\s*Inspiration/i);
  const boostAmount = boostMatch ? parseInt(boostMatch[1], 10) : 1;

  const charBracketMatch = text.match(/[｢\[]([^｣\]]+)[｣\]]/);
  if (charBracketMatch) {
    const requiredName = charBracketMatch[1].trim().toLowerCase();
    const actualName = String(targetCharacter.name || '').toLowerCase();
    if (!actualName.includes(requiredName)) {
      return {
        eligible: false,
        boostAmount: 0,
        reason: `Only boosts ${charBracketMatch[1]}`,
      };
    }
  }

  const elements = ['magic', 'loyalty', 'honesty', 'generosity', 'kindness', 'laughter'];
  for (const el of elements) {
    const elRegex = new RegExp(`your\\s+${el}\\s+character`, 'i');
    if (elRegex.test(text) && String(targetCharacter.element || '').toLowerCase() !== el) {
      return {
        eligible: false,
        boostAmount: 0,
        reason: `Only boosts ${el.toUpperCase()} characters`,
      };
    }
  }

  return { eligible: true, boostAmount };
}

function getSlotTotalPower(slot: {
  character: CardDefinition | null;
  items: CardDefinition[];
  inspoBoost: number;
}): number {
  if (!slot.character) return 0;
  const base = Number(slot.character.power) || 0;
  const itemBonus = slot.items.reduce((sum, it) => sum + (Number(it.power) || 1), 0);
  return base + itemBonus + slot.inspoBoost;
}

export function startContactPhase(state: KayouGameState, playerId: '0' | '1'): KayouGameState {
  if (state.phase !== 'MAIN_PHASE' || state.turnPlayerId !== playerId) return state;
  const attacker = state.players[playerId];

  if (attacker.turnsTaken <= 1) {
    return endTurn(state, playerId);
  }

  const allLanes: LaneKey[] = ['left', 'center', 'right'];
  const activeAttackLanes = allLanes.filter(
    (l) =>
      attacker.adventureArea[l].character !== null &&
      !attacker.actedLanesThisTurn.includes(l)
  );

  if (activeAttackLanes.length === 0) {
    return endTurn(state, playerId);
  }

  return advanceToNextAttackLane(state, playerId, activeAttackLanes);
}

function advanceToNextAttackLane(
  state: KayouGameState,
  attackerId: '0' | '1',
  laneQueue: LaneKey[]
): KayouGameState {
  const defenderId: '0' | '1' = attackerId === '0' ? '1' : '0';
  const attacker = state.players[attackerId];
  const defender = state.players[defenderId];

  const remaining = [...laneQueue];
  while (remaining.length > 0) {
    const lane = remaining[0];
    const atkSlot = attacker.adventureArea[lane];

    if (!atkSlot.character || attacker.actedLanesThisTurn.includes(lane)) {
      remaining.shift();
      continue;
    }

    const defSlot = defender.adventureArea[lane];

    if (defSlot.character) {
      return {
        ...state,
        phase: 'CONTACT_INSPIRE',
        contactState: {
          activeLane: lane,
          laneQueue: remaining,
          promptPlayerId: attackerId,
          consecutivePasses: 0,
          attackerPower: getSlotTotalPower(atkSlot),
          defenderPower: getSlotTotalPower(defSlot),
        },
      };
    }

    return {
      ...state,
      phase: 'BREAKTHROUGH_CHOICE',
      contactState: {
        activeLane: lane,
        laneQueue: remaining,
        promptPlayerId: attackerId,
        consecutivePasses: 0,
        attackerPower: getSlotTotalPower(atkSlot),
        defenderPower: 0,
      },
    };
  }

  return endTurn(
    {
      ...state,
      contactState: null,
      pendingLaneQueueAfterReveal: null,
    },
    attackerId
  );
}

export function inspireInContact(
  state: KayouGameState,
  playerId: '0' | '1',
  sceneIndex: number
): KayouGameState {
  if (state.phase !== 'CONTACT_INSPIRE' || !state.contactState) return state;
  if (state.contactState.promptPlayerId !== playerId) return state;

  const player = state.players[playerId];
  const sceneItem = player.sceneArea[sceneIndex];
  const lane = state.contactState.activeLane;
  const currentSlot = player.adventureArea[lane];

  if (!sceneItem) return state;
  const check = canSceneInspireCharacter(sceneItem, currentSlot.character);
  if (!check.eligible) return state;

  const updatedSceneArea = player.sceneArea.map((s, idx) =>
    idx === sceneIndex ? { ...s, isFaceUp: false } : s
  );

  const updatedSlot = {
    ...currentSlot,
    inspoBoost: currentSlot.inspoBoost + check.boostAmount,
  };

  const updatedPlayer: PlayerState = {
    ...player,
    sceneArea: updatedSceneArea,
    adventureArea: {
      ...player.adventureArea,
      [lane]: updatedSlot,
    },
  };

  const nextPlayers = {
    ...state.players,
    [playerId]: updatedPlayer,
  };

  const attackerId = state.turnPlayerId;
  const defenderId: '0' | '1' = attackerId === '0' ? '1' : '0';
  const nextPrompt: '0' | '1' = playerId === '0' ? '1' : '0';

  return {
    ...state,
    players: nextPlayers,
    contactState: {
      ...state.contactState,
      promptPlayerId: nextPrompt,
      consecutivePasses: 0,
      attackerPower: getSlotTotalPower(nextPlayers[attackerId].adventureArea[lane]),
      defenderPower: getSlotTotalPower(nextPlayers[defenderId].adventureArea[lane]),
    },
  };
}

export function passInspireInContact(
  state: KayouGameState,
  playerId: '0' | '1'
): KayouGameState {
  if (state.phase !== 'CONTACT_INSPIRE' || !state.contactState) return state;
  if (state.contactState.promptPlayerId !== playerId) return state;

  const newPasses = state.contactState.consecutivePasses + 1;
  const nextPrompt: '0' | '1' = playerId === '0' ? '1' : '0';

  if (newPasses < 2) {
    return {
      ...state,
      contactState: {
        ...state.contactState,
        promptPlayerId: nextPrompt,
        consecutivePasses: newPasses,
      },
    };
  }

  const attackerId = state.turnPlayerId;
  const defenderId: '0' | '1' = attackerId === '0' ? '1' : '0';
  const lane = state.contactState.activeLane;

  const atkPlayer = state.players[attackerId];
  const defPlayer = state.players[defenderId];
  const atkSlot = atkPlayer.adventureArea[lane];
  const defSlot = defPlayer.adventureArea[lane];

  if (!atkSlot.character || !defSlot.character) {
    const nextQueue = state.contactState.laneQueue.slice(1);
    return advanceToNextAttackLane(state, attackerId, nextQueue);
  }

  const atkPower = getSlotTotalPower(atkSlot);
  const defPower = getSlotTotalPower(defSlot);

  let outcome: 'ATTACKER_WINS' | 'DEFENDER_WINS' | 'TIE' = 'TIE';
  if (atkPower > defPower) outcome = 'ATTACKER_WINS';
  else if (defPower > atkPower) outcome = 'DEFENDER_WINS';

  const clashEvent = {
    id: Date.now(),
    lane,
    attackerCard: atkSlot.character,
    defenderCard: defSlot.character,
    attackerTotalPower: atkPower,
    defenderTotalPower: defPower,
    outcome,
  };

  let nextAtkPlayer: PlayerState = {
    ...atkPlayer,
    actedLanesThisTurn: [...atkPlayer.actedLanesThisTurn, lane],
  };
  let nextDefPlayer: PlayerState = { ...defPlayer };

  if (outcome === 'ATTACKER_WINS') {
    nextDefPlayer = {
      ...nextDefPlayer,
      retirement: [...nextDefPlayer.retirement, defSlot.character, ...defSlot.items],
      adventureArea: {
        ...nextDefPlayer.adventureArea,
        [lane]: { character: null, items: [], inspoBoost: 0 },
      },
    };
  } else if (outcome === 'DEFENDER_WINS') {
    nextAtkPlayer = {
      ...nextAtkPlayer,
      retirement: [...nextAtkPlayer.retirement, atkSlot.character, ...atkSlot.items],
      adventureArea: {
        ...nextAtkPlayer.adventureArea,
        [lane]: { character: null, items: [], inspoBoost: 0 },
      },
    };
  } else {
    nextAtkPlayer = {
      ...nextAtkPlayer,
      retirement: [...nextAtkPlayer.retirement, atkSlot.character, ...atkSlot.items],
      adventureArea: {
        ...nextAtkPlayer.adventureArea,
        [lane]: { character: null, items: [], inspoBoost: 0 },
      },
    };
    nextDefPlayer = {
      ...nextDefPlayer,
      retirement: [...nextDefPlayer.retirement, defSlot.character, ...defSlot.items],
      adventureArea: {
        ...nextDefPlayer.adventureArea,
        [lane]: { character: null, items: [], inspoBoost: 0 },
      },
    };
  }

  const nextQueue = state.contactState.laneQueue.slice(1);
  return advanceToNextAttackLane(
    {
      ...state,
      players: {
        ...state.players,
        [attackerId]: nextAtkPlayer,
        [defenderId]: nextDefPlayer,
      },
      lastClashEvent: clashEvent,
    },
    attackerId,
    nextQueue
  );
}

export function canProgressNextStoryStage(attacker: PlayerState, defender: PlayerState): boolean {
  const nextStageIdx = attacker.storyProgress;
  if (nextStageIdx >= 4) return false;
  const opponentPairedStage = defender.storyStages[nextStageIdx];
  if (!opponentPairedStage) return true;
  return Boolean(opponentPairedStage.isPlanRevealed || !opponentPairedStage.planCard);
}

function sanitizeCardText(raw: string): string {
  return raw.replace(/\{\{[^}]*$/g, '').replace(/\{\{|\}\}/g, '').trim();
}

function executePrePlanEffectAndReturnToHand(
  attacker: PlayerState,
  defender: PlayerState,
  revealedCard: CardDefinition,
  activeLane: LaneKey
): {
  updatedAttacker: PlayerState;
  updatedDefender: PlayerState;
  hasPrePlanTrigger: boolean;
  effectSummary: string | null;
} {
  const text = sanitizeCardText(String(revealedCard.effectText || ''));
  const hasPrePlanTrigger = /Pre-Plan|Scheme|When revealed as a Plan|Plan:/i.test(text);

  let updatedAttacker = { ...attacker };
  let updatedDefender = {
    ...defender,
    hand: [...defender.hand, revealedCard],
  };
  let effectSummary: string | null = null;

  if (hasPrePlanTrigger) {
    if (/draw\s+1|draw\s+a\s+card/i.test(text) && updatedDefender.mainDeck.length > 0) {
      const drawn = updatedDefender.mainDeck[0];
      updatedDefender = {
        ...updatedDefender,
        mainDeck: updatedDefender.mainDeck.slice(1),
        hand: [...updatedDefender.hand, drawn],
      };
      effectSummary = `Pre-Plan Triggered: ${defender.displayName} drew 1 card!`;
    } else if (/retire|remove/i.test(text) && updatedAttacker.adventureArea[activeLane].character) {
      const atkSlot = updatedAttacker.adventureArea[activeLane];
      updatedAttacker = {
        ...updatedAttacker,
        retirement: [...updatedAttacker.retirement, atkSlot.character!, ...atkSlot.items],
        adventureArea: {
          ...updatedAttacker.adventureArea,
          [activeLane]: { character: null, items: [], inspoBoost: 0 },
        },
      };
      effectSummary = `Pre-Plan Triggered: Attacking character in ${activeLane.toUpperCase()} lane was retired!`;
    } else {
      effectSummary = `Pre-Plan Triggered: ${text}`;
    }
  }

  return { updatedAttacker, updatedDefender, hasPrePlanTrigger, effectSummary };
}

/**
 * Executes any printed promotion effect when a Story stage is revealed/progressed
 * (e.g., "When promoted to this stage, draw 1 card" or "+1 Inspiration").
 */
function executeStoryPromotionEffect(
  attacker: PlayerState,
  defender: PlayerState,
  storyCard: CardDefinition,
  activeLane: LaneKey
): {
  updatedAttacker: PlayerState;
  updatedDefender: PlayerState;
  effectSummary: string | null;
} {
  const text = sanitizeCardText(String(storyCard.effectText || ''));
  let updatedAttacker = { ...attacker };
  let updatedDefender = { ...defender };
  let effectSummary: string | null = null;

  if (!text) return { updatedAttacker, updatedDefender, effectSummary };

  const drawMatch = text.match(/draw\s+(\d+|a)\s+card/i);
  if (drawMatch) {
    const drawCount = drawMatch[1].toLowerCase() === 'a' ? 1 : parseInt(drawMatch[1], 10) || 1;
    const drawnCards = updatedAttacker.mainDeck.slice(0, drawCount);
    updatedAttacker = {
      ...updatedAttacker,
      mainDeck: updatedAttacker.mainDeck.slice(drawCount),
      hand: [...updatedAttacker.hand, ...drawnCards],
    };
    effectSummary = `Story Effect: ${attacker.displayName} drew ${drawnCards.length} card${
      drawnCards.length === 1 ? '' : 's'
    }!`;
  } else if (/opponent.*discard/i.test(text) && updatedDefender.hand.length > 0) {
    const discarded = updatedDefender.hand[updatedDefender.hand.length - 1];
    updatedDefender = {
      ...updatedDefender,
      hand: updatedDefender.hand.slice(0, -1),
      retirement: [...updatedDefender.retirement, discarded],
    };
    effectSummary = `Story Effect: ${defender.displayName} discarded 1 card!`;
  } else if (/\+(\d+)\s*Inspiration/i.test(text) && updatedAttacker.adventureArea[activeLane].character) {
    const boost = parseInt(text.match(/\+(\d+)\s*Inspiration/i)![1], 10) || 1;
    const slot = updatedAttacker.adventureArea[activeLane];
    updatedAttacker = {
      ...updatedAttacker,
      adventureArea: {
        ...updatedAttacker.adventureArea,
        [activeLane]: { ...slot, inspoBoost: slot.inspoBoost + boost },
      },
    };
    effectSummary = `Story Effect: +${boost} Inspiration granted!`;
  } else {
    effectSummary = `Story Effect: ${text}`;
  }

  return { updatedAttacker, updatedDefender, effectSummary };
}

export function resolveBreakthroughChoice(
  state: KayouGameState,
  playerId: '0' | '1',
  choice: 'PROGRESS_STORY' | 'INTERVENE_PLAN'
): KayouGameState {
  if (state.phase !== 'BREAKTHROUGH_CHOICE' || !state.contactState) return state;
  if (state.turnPlayerId !== playerId) return state;

  const activeLane = state.contactState.activeLane;
  if (state.players[playerId].actedLanesThisTurn.includes(activeLane)) {
    return state;
  }

  const defenderId: '0' | '1' = playerId === '0' ? '1' : '0';
  let attacker: PlayerState = {
    ...state.players[playerId],
    actedLanesThisTurn: [...state.players[playerId].actedLanesThisTurn, activeLane],
  };
  let defender: PlayerState = { ...state.players[defenderId] };

  const allowedToProgress = canProgressNextStoryStage(attacker, defender);
  const effectiveChoice =
    choice === 'PROGRESS_STORY' && !allowedToProgress ? 'INTERVENE_PLAN' : choice;

  const remainingQueue = state.contactState.laneQueue.slice(1);

  if (effectiveChoice === 'PROGRESS_STORY') {
    const nextProgress = Math.min(4, attacker.storyProgress + 1) as 1 | 2 | 3 | 4;
    const updatedStages = attacker.storyStages.map((st, idx) =>
      idx < nextProgress ? { ...st, isStoryCompleted: true } : st
    );

    attacker = {
      ...attacker,
      storyProgress: nextProgress,
      storyStages: updatedStages,
    };

    const revealedStoryStage = attacker.storyStages[nextProgress - 1];
    const storyCard = revealedStoryStage?.storyCard;

    if (storyCard) {
      const { updatedAttacker, updatedDefender, effectSummary } = executeStoryPromotionEffect(
        attacker,
        defender,
        storyCard,
        activeLane
      );
      attacker = updatedAttacker;
      defender = updatedDefender;

      // Hold turn/lane progression in REVEAL_HOLD until BOTH players acknowledge the Story card!
      return {
        ...state,
        phase: 'REVEAL_HOLD',
        contactState: null,
        pendingLaneQueueAfterReveal: remainingQueue,
        players: {
          ...state.players,
          [playerId]: attacker,
          [defenderId]: defender,
        },
        lastStoryRevealEvent: {
          id: Date.now(),
          stage: nextProgress,
          attackerId: playerId,
          attackerName: attacker.displayName,
          storyCard,
          triggeredEffectSummary: effectSummary,
          acknowledgedBy: [],
          isGameWinningStage: nextProgress >= 4,
        },
      };
    }

    if (nextProgress >= 4) {
      return {
        ...state,
        phase: 'GAME_OVER',
        winnerId: playerId,
        contactState: null,
        pendingLaneQueueAfterReveal: null,
        players: {
          ...state.players,
          [playerId]: attacker,
        },
      };
    }

    return advanceToNextAttackLane(
      {
        ...state,
        players: {
          ...state.players,
          [playerId]: attacker,
          [defenderId]: defender,
        },
      },
      playerId,
      remainingQueue
    );
  }

  // INTERVENE_PLAN: Flip opponent's lowest sequential Plan card, reveal to both players,
  // place into defender's hand, and HOLD turn transition until BOTH players acknowledge!
  const sequentialStageIdx = defender.storyStages.findIndex(
    (s) => s.planCard !== null && !s.isPlanRevealed
  );

  if (sequentialStageIdx !== -1) {
    const targetStage = defender.storyStages[sequentialStageIdx];
    const revealedCard = targetStage.planCard!;

    const updatedDefStages = defender.storyStages.map((s, idx) =>
      idx === sequentialStageIdx ? { ...s, planCard: null, isPlanRevealed: true } : s
    );

    defender = {
      ...defender,
      storyStages: updatedDefStages,
    };

    const { updatedAttacker, updatedDefender, hasPrePlanTrigger, effectSummary } =
      executePrePlanEffectAndReturnToHand(attacker, defender, revealedCard, activeLane);

    attacker = updatedAttacker;
    defender = updatedDefender;

    return {
      ...state,
      phase: 'REVEAL_HOLD',
      contactState: null,
      pendingLaneQueueAfterReveal: remainingQueue,
      players: {
        ...state.players,
        [playerId]: attacker,
        [defenderId]: defender,
      },
      lastPlanRevealEvent: {
        id: Date.now(),
        stage: targetStage.stage,
        defenderId,
        defenderName: defender.displayName,
        revealedCard,
        hasPrePlanTrigger,
        triggeredEffectSummary: effectSummary,
        acknowledgedBy: [],
      },
    };
  }

  return advanceToNextAttackLane(
    {
      ...state,
      players: {
        ...state.players,
        [playerId]: attacker,
        [defenderId]: defender,
      },
    },
    playerId,
    remainingQueue
  );
}

export function acknowledgePlanReveal(
  state: KayouGameState,
  playerId: '0' | '1'
): KayouGameState {
  if (!state.lastPlanRevealEvent) return state;
  if (state.lastPlanRevealEvent.acknowledgedBy.includes(playerId)) return state;

  const updatedAck = [...state.lastPlanRevealEvent.acknowledgedBy, playerId];

  // Wait until BOTH players acknowledge before continuing lanes or switching turns
  if (updatedAck.length < 2) {
    return {
      ...state,
      lastPlanRevealEvent: {
        ...state.lastPlanRevealEvent,
        acknowledgedBy: updatedAck,
      },
    };
  }

  const queueToResume = state.pendingLaneQueueAfterReveal || [];
  return advanceToNextAttackLane(
    {
      ...state,
      lastPlanRevealEvent: null,
      pendingLaneQueueAfterReveal: null,
    },
    state.turnPlayerId,
    queueToResume
  );
}

export function acknowledgeStoryReveal(
  state: KayouGameState,
  playerId: '0' | '1'
): KayouGameState {
  if (!state.lastStoryRevealEvent) return state;
  if (state.lastStoryRevealEvent.acknowledgedBy.includes(playerId)) return state;

  const updatedAck = [...state.lastStoryRevealEvent.acknowledgedBy, playerId];

  // Wait until BOTH players acknowledge the revealed Story card before advancing
  if (updatedAck.length < 2) {
    return {
      ...state,
      lastStoryRevealEvent: {
        ...state.lastStoryRevealEvent,
        acknowledgedBy: updatedAck,
      },
    };
  }

  const revealEvent = state.lastStoryRevealEvent;

  // If this was Story Stage 4, trigger the Victory Screen now that both players saw it!
  if (revealEvent.isGameWinningStage) {
    return {
      ...state,
      phase: 'GAME_OVER',
      winnerId: revealEvent.attackerId,
      lastStoryRevealEvent: null,
      pendingLaneQueueAfterReveal: null,
      announcements: [
        ...state.announcements,
        {
          type: 'VICTORY',
          message: `${revealEvent.attackerName} completed Story Stage 4 and won the match!`,
          timestamp: Date.now(),
        },
      ],
    };
  }

  const queueToResume = state.pendingLaneQueueAfterReveal || [];
  return advanceToNextAttackLane(
    {
      ...state,
      lastStoryRevealEvent: null,
      pendingLaneQueueAfterReveal: null,
    },
    state.turnPlayerId,
    queueToResume
  );
}

export function endTurn(state: KayouGameState, playerId: '0' | '1'): KayouGameState {
  if (state.turnPlayerId !== playerId) return state;

  const nextPlayerId: '0' | '1' = playerId === '0' ? '1' : '0';
  const nextTurnNumber = state.turnNumber + 1;

  const endingPlayer = state.players[playerId];
  const cleanedEndingPlayer: PlayerState = {
    ...endingPlayer,
    actedLanesThisTurn: [],
    adventureArea: {
      left: { ...endingPlayer.adventureArea.left, inspoBoost: 0 },
      center: { ...endingPlayer.adventureArea.center, inspoBoost: 0 },
      right: { ...endingPlayer.adventureArea.right, inspoBoost: 0 },
    },
  };

  const startingPlayer = state.players[nextPlayerId];
  const newTurnsTaken = startingPlayer.turnsTaken + 1;

  const drawnMain = startingPlayer.mainDeck.slice(0, 1);
  const restMain = startingPlayer.mainDeck.slice(1);

  const drawnScene = startingPlayer.sceneDeck.slice(0, 1);
  const restScene = startingPlayer.sceneDeck.slice(1);

  const readiedExistingScenes: SceneCardInPlay[] = startingPlayer.sceneArea.map((s) => ({
    ...s,
    isExhausted: false,
  }));

  const addedScenes: SceneCardInPlay[] = drawnScene.map((c) => ({
    card: c,
    isFaceUp: true,
    isExhausted: false,
    isLockedFaceDown: false,
  }));

  const updatedStartingPlayer: PlayerState = {
    ...startingPlayer,
    turnsTaken: newTurnsTaken,
    actedLanesThisTurn: [],
    mainDeck: restMain,
    hand: [...startingPlayer.hand, ...drawnMain],
    sceneDeck: restScene,
    sceneArea: [...readiedExistingScenes, ...addedScenes],
  };

  return {
    ...state,
    phase: 'MAIN_PHASE',
    turnPlayerId: nextPlayerId,
    turnNumber: nextTurnNumber,
    contactState: null,
    pendingLaneQueueAfterReveal: null,
    players: {
      [playerId]: cleanedEndingPlayer,
      [nextPlayerId]: updatedStartingPlayer,
    } as Record<'0' | '1', PlayerState>,
  };
}