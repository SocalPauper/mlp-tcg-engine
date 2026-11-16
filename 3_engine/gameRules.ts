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
    lastClashEvent: null,
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
    lastClashEvent: null,
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
  const activeAttackLanes = allLanes.filter((l) => attacker.adventureArea[l].character !== null);

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
    if (!atkSlot.character) {
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
  if (!sceneItem || !sceneItem.isFaceUp || sceneItem.isLockedFaceDown) return state;

  const updatedSceneArea = player.sceneArea.map((s, idx) =>
    idx === sceneIndex ? { ...s, isFaceUp: false } : s
  );

  const lane = state.contactState.activeLane;
  const currentSlot = player.adventureArea[lane];
  const updatedSlot = {
    ...currentSlot,
    inspoBoost: currentSlot.inspoBoost + 1,
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

  let nextAtkPlayer = { ...atkPlayer };
  let nextDefPlayer = { ...defPlayer };

  if (outcome === 'ATTACKER_WINS') {
    nextDefPlayer = {
      ...nextDefPlayer,
      retirement: [...nextDefPlayer.retirement, defSlot.character, ...defSlot.items],
      adventureArea: {
        ...nextDefPlayer.adventureArea,
        [lane]: { character: null, items: [], inspoBoost: 0 },
      },
    };

    return {
      ...state,
      phase: 'BREAKTHROUGH_CHOICE',
      players: {
        ...state.players,
        [attackerId]: nextAtkPlayer,
        [defenderId]: nextDefPlayer,
      },
      lastClashEvent: clashEvent,
    };
  }

  if (outcome === 'DEFENDER_WINS') {
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

/**
 * Helper: Checks whether `attacker` is allowed to progress to their next Story stage.
 * Rule: To progress Story Stage N (index = attacker.storyProgress), the opponent's paired
 * Plan card under their Story Stage N must ALREADY be cleared (isPlanRevealed === true or planCard === null).
 */
export function canProgressNextStoryStage(attacker: PlayerState, defender: PlayerState): boolean {
  const nextStageIdx = attacker.storyProgress; // 0 for Story I, 1 for Story II, etc.
  if (nextStageIdx >= 4) return false;
  const opponentPairedStage = defender.storyStages[nextStageIdx];
  if (!opponentPairedStage) return true;
  return Boolean(opponentPairedStage.isPlanRevealed || !opponentPairedStage.planCard);
}

export function resolveBreakthroughChoice(
  state: KayouGameState,
  playerId: '0' | '1',
  choice: 'PROGRESS_STORY' | 'INTERVENE_PLAN',
  targetPlanStageIndex?: number
): KayouGameState {
  if (state.phase !== 'BREAKTHROUGH_CHOICE' || !state.contactState) return state;
  if (state.turnPlayerId !== playerId) return state;

  const defenderId: '0' | '1' = playerId === '0' ? '1' : '0';
  let attacker = { ...state.players[playerId] };
  let defender = { ...state.players[defenderId] };

  const allowedToProgress = canProgressNextStoryStage(attacker, defender);

  // Enforce rule: if opponent's paired Plan card is NOT cleared yet, force/require Intervene
  const effectiveChoice =
    choice === 'PROGRESS_STORY' && !allowedToProgress ? 'INTERVENE_PLAN' : choice;

  if (effectiveChoice === 'PROGRESS_STORY') {
    const nextProgress = Math.min(4, attacker.storyProgress + 1);
    const updatedStages = attacker.storyStages.map((st, idx) =>
      idx < nextProgress ? { ...st, isStoryCompleted: true } : st
    );

    attacker = {
      ...attacker,
      storyProgress: nextProgress,
      storyStages: updatedStages,
    };

    if (nextProgress >= 4) {
      return {
        ...state,
        phase: 'GAME_OVER',
        winnerId: playerId,
        contactState: null,
        players: {
          ...state.players,
          [playerId]: attacker,
        },
        announcements: [
          ...state.announcements,
          {
            type: 'VICTORY',
            message: `${attacker.displayName} completed Story Stage 4 and won the match!`,
            timestamp: Date.now(),
          },
        ],
      };
    }
  } else if (effectiveChoice === 'INTERVENE_PLAN') {
    const availableIdx =
      targetPlanStageIndex !== undefined &&
      defender.storyStages[targetPlanStageIndex]?.planCard &&
      !defender.storyStages[targetPlanStageIndex]?.isPlanRevealed
        ? targetPlanStageIndex
        : defender.storyStages.findIndex((s) => s.planCard !== null && !s.isPlanRevealed);

    if (availableIdx !== -1) {
      const targetStage = defender.storyStages[availableIdx];
      const retiredPlan = targetStage.planCard!;
      const updatedDefStages = defender.storyStages.map((s, idx) =>
        idx === availableIdx ? { ...s, planCard: null, isPlanRevealed: true } : s
      );

      defender = {
        ...defender,
        storyStages: updatedDefStages,
        retirement: [...defender.retirement, retiredPlan],
      };
    }
  }

  const nextQueue = state.contactState.laneQueue.slice(1);
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
    nextQueue
  );
}

export function endTurn(state: KayouGameState, playerId: '0' | '1'): KayouGameState {
  if (state.turnPlayerId !== playerId) return state;

  const nextPlayerId: '0' | '1' = playerId === '0' ? '1' : '0';
  const nextTurnNumber = state.turnNumber + 1;

  const endingPlayer = state.players[playerId];
  const cleanedEndingPlayer: PlayerState = {
    ...endingPlayer,
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
    players: {
      [playerId]: cleanedEndingPlayer,
      [nextPlayerId]: updatedStartingPlayer,
    } as Record<'0' | '1', PlayerState>,
  };
}