import {
  KayouGameState,
  CardDefinition,
  PlayerState,
  HydratedDeckPayload,
  LaneKey,
  SceneCardInPlay,
  StoryStageSlot,
  PendingTargetSelection,
} from './types.js';
import {
  sanitizeCardText,
  canPayHarmonyCost,
  getEffectiveCardCost,
  exhaustScenesWithElementPriority,
  calculateLanePowerBreakdown,
  parseActivatedCardEffect,
} from './effectParser.js';

export { calculateLanePowerBreakdown, canPayHarmonyCost, getEffectiveCardCost };

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
    leaderAbilityUsedThisTurn: false,
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
      left: { character: null, items: [], inspoBoost: 0, isExhausted: false },
      center: { character: null, items: [], inspoBoost: 0, isExhausted: false },
      right: { character: null, items: [], inspoBoost: 0, isExhausted: false },
    },
    mulliganStatus: 'PENDING',
    turnsTaken: 0,
    actedLanesThisTurn: [],
    isConnected: true,
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
    winReason: null,
    players: {
      '0': createEmptyPlayer('0', 'Player 1'),
      '1': createEmptyPlayer('1', 'Player 2'),
    },
    contactState: null,
    pendingTarget: null,
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
      leaderAbilityUsedThisTurn: false,
      mainDeck: remainingMain,
      sceneDeck: shuffledScenes,
      hand: openingHand,
      retirement: [],
      sceneArea: [],
      storyStages,
      storyProgress: 0,
      adventureArea: {
        left: { character: null, items: [], inspoBoost: 0, isExhausted: false },
        center: { character: null, items: [], inspoBoost: 0, isExhausted: false },
        right: { character: null, items: [], inspoBoost: 0, isExhausted: false },
      },
      mulliganStatus: 'PENDING',
      turnsTaken: 0,
      actedLanesThisTurn: [],
      isConnected: true,
    };
  };

  return {
    roomId: 'active-match',
    phase: 'VS_INTRO',
    firstPlayerId,
    turnPlayerId: firstPlayerId,
    turnNumber: 1,
    winnerId: null,
    winReason: null,
    players: {
      '0': setupPlayer('0', p0Name, deck0),
      '1': setupPlayer('1', p1Name, deck1),
    },
    contactState: null,
    pendingTarget: null,
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

/**
 * Official Kayou Rule: Drawing from an empty Main Deck causes that player to lose immediately.
 */
function drawCardsWithDeckOutCheck(
  state: KayouGameState,
  playerId: '0' | '1',
  count: number
): { state: KayouGameState; deckedOut: boolean } {
  if (count <= 0) return { state, deckedOut: false };
  const player = state.players[playerId];

  if (player.mainDeck.length < count) {
    const winnerId: '0' | '1' = playerId === '0' ? '1' : '0';
    return {
      deckedOut: true,
      state: {
        ...state,
        phase: 'GAME_OVER',
        winnerId,
        winReason: `${player.displayName} ran out of cards in their Main Deck (Deck Out)!`,
        contactState: null,
        pendingTarget: null,
        pendingLaneQueueAfterReveal: null,
      },
    };
  }

  const drawn = player.mainDeck.slice(0, count);
  const restMain = player.mainDeck.slice(count);

  return {
    deckedOut: false,
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          mainDeck: restMain,
          hand: [...player.hand, ...drawn],
        },
      },
    },
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

function buildPendingTargetFromEffect(
  state: KayouGameState,
  playerId: '0' | '1',
  sourceCard: CardDefinition,
  sourceOrigin: 'HAND_EVENT' | 'ADVENTURE_TAP' | 'MANE_ABILITY',
  sourceLane?: LaneKey
): PendingTargetSelection | null {
  const oppId: '0' | '1' = playerId === '0' ? '1' : '0';
  const me = state.players[playerId];
  const opp = state.players[oppId];
  const parsed = parseActivatedCardEffect(sourceCard);
  const allLanes: LaneKey[] = ['left', 'center', 'right'];

  if (parsed.kind === 'TARGET_BUFF_POWER') {
    const validTargets = allLanes
      .filter((l) => me.adventureArea[l].character !== null)
      .map((l) => ({ owner: 'SELF' as const, lane: l }));
    if (validTargets.length === 0) return null;
    return {
      sourceCard,
      sourceOrigin,
      sourceLane,
      effectAction: 'BUFF_POWER',
      value: parsed.amount,
      promptText: `Select one of your Characters to grant +${parsed.amount} Inspiration:`,
      validTargets,
    };
  }

  if (parsed.kind === 'TARGET_RETIRE_OPPONENT') {
    const validTargets = allLanes
      .filter((l) => {
        const c = opp.adventureArea[l].character;
        if (!c) return false;
        if (parsed.maxLimit !== undefined) {
          const totalPwr = calculateLanePowerBreakdown(state, oppId, l).totalPower;
          return (Number(c.cost) || 0) <= parsed.maxLimit || totalPwr <= parsed.maxLimit;
        }
        return true;
      })
      .map((l) => ({ owner: 'OPPONENT' as const, lane: l }));
    if (validTargets.length === 0) return null;
    return {
      sourceCard,
      sourceOrigin,
      sourceLane,
      effectAction: 'RETIRE_OPPONENT',
      value: 1,
      maxTargetCostOrPower: parsed.maxLimit,
      promptText: `Select an opponent's Character to Retire:`,
      validTargets,
    };
  }

  if (parsed.kind === 'TARGET_READY_FRIENDLY') {
    const validTargets = allLanes
      .filter((l) => me.adventureArea[l].character !== null && me.adventureArea[l].isExhausted)
      .map((l) => ({ owner: 'SELF' as const, lane: l }));
    if (validTargets.length === 0) return null;
    return {
      sourceCard,
      sourceOrigin,
      sourceLane,
      effectAction: 'READY_FRIENDLY',
      value: 1,
      promptText: `Select an exhausted Character to Ready (untap):`,
      validTargets,
    };
  }

  if (parsed.kind === 'TARGET_MOVE_FRIENDLY') {
    const validTargets = allLanes
      .filter((l) => me.adventureArea[l].character !== null)
      .map((l) => ({ owner: 'SELF' as const, lane: l }));
    if (validTargets.length === 0) return null;
    return {
      sourceCard,
      sourceOrigin,
      sourceLane,
      effectAction: 'MOVE_FRIENDLY',
      value: 1,
      promptText: `Select one of your Characters to move to another lane:`,
      validTargets,
    };
  }

  return null;
}

function executeImmediateActivatedEffect(
  state: KayouGameState,
  playerId: '0' | '1',
  sourceCard: CardDefinition
): KayouGameState {
  const parsed = parseActivatedCardEffect(sourceCard);
  const player = state.players[playerId];

  if (parsed.kind === 'DRAW') {
    return drawCardsWithDeckOutCheck(state, playerId, parsed.amount).state;
  }

  if (parsed.kind === 'RECOVER_RETIREMENT' && player.retirement.length > 0) {
    const recovered = player.retirement[player.retirement.length - 1];
    return {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          retirement: player.retirement.slice(0, -1),
          hand: [...player.hand, recovered],
        },
      },
    };
  }

  if (parsed.kind === 'GLOBAL_BUFF_FRIENDLY') {
    const boost = parsed.amount;
    const adv = player.adventureArea;
    return {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          adventureArea: {
            left: adv.left.character ? { ...adv.left, inspoBoost: adv.left.inspoBoost + boost } : adv.left,
            center: adv.center.character ? { ...adv.center, inspoBoost: adv.center.inspoBoost + boost } : adv.center,
            right: adv.right.character ? { ...adv.right, inspoBoost: adv.right.inspoBoost + boost } : adv.right,
          },
        },
      },
    };
  }

  return state;
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

  // Official Element Harmony Cost Validation
  if (!canPayHarmonyCost(player, card)) return state;
  const effectiveCost = getEffectiveCardCost(player, card);

  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const updatedSceneArea = exhaustScenesWithElementPriority(
    player.sceneArea,
    card,
    effectiveCost
  );
  const normalizedType = String(card.type || '').toLowerCase();

  // 1. Deploy Character / Friend Character (Enforces Unique Character Name rule across lanes)
  if (normalizedType.includes('character')) {
    const lane: LaneKey = targetLane || 'left';
    const baseCharName = String(card.name || '').split(/[-–]/)[0].trim().toLowerCase();

    const updatedAdv = { ...player.adventureArea };
    const newlyRetired: CardDefinition[] = [];

    // Check uniqueness: if another lane already has the same named Character, retire it
    for (const l of ['left', 'center', 'right'] as const) {
      const existing = updatedAdv[l];
      if (existing.character) {
        const existingBaseName = String(existing.character.name || '')
          .split(/[-–]/)[0]
          .trim()
          .toLowerCase();
        if (l === lane || existingBaseName === baseCharName) {
          newlyRetired.push(existing.character, ...existing.items);
          updatedAdv[l] = { character: null, items: [], inspoBoost: 0, isExhausted: false };
        }
      }
    }

    updatedAdv[lane] = {
      character: card,
      items: [],
      inspoBoost: 0,
      isExhausted: false,
    };

    return {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          hand: newHand,
          sceneArea: updatedSceneArea,
          retirement: [...player.retirement, ...newlyRetired],
          adventureArea: updatedAdv,
        },
      },
    };
  }

  // 2. Equip Item (Official Rule: Max 1 Item per Character; replaces previous Item if already equipped)
  if (normalizedType === 'item') {
    const lane: LaneKey = targetLane || 'left';
    const currentSlot = player.adventureArea[lane];
    if (!currentSlot.character) return state;

    const replacedItems = currentSlot.items.length > 0 ? [...currentSlot.items] : [];

    return {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          hand: newHand,
          sceneArea: updatedSceneArea,
          retirement: [...player.retirement, ...replacedItems],
          adventureArea: {
            ...player.adventureArea,
            [lane]: {
              ...currentSlot,
              items: [card], // Enforces 1 attached Item limit
            },
          },
        },
      },
    };
  }

  // 3. Cast Event Card
  let nextState: KayouGameState = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        hand: newHand,
        sceneArea: updatedSceneArea,
        retirement: [...player.retirement, card],
      },
    },
  };

  // If a target lane was directly clicked on the board, apply immediately; otherwise check if target selection is needed
  const pending = buildPendingTargetFromEffect(nextState, playerId, card, 'HAND_EVENT');
  if (pending) {
    if (
      targetLane &&
      pending.effectAction !== 'MOVE_FRIENDLY' &&
      pending.validTargets.some((t) => t.lane === targetLane)
    ) {
      return resolveTargetSelection(nextState, playerId, pending.validTargets[0].owner, targetLane);
    }
    return {
      ...nextState,
      phase: 'PENDING_TARGET',
      pendingTarget: pending,
    };
  }

  return executeImmediateActivatedEffect(nextState, playerId, card);
}

/**
 * Resolves interactive target selection for Events, Adventure tap abilities, and Mane Leader abilities.
 */
export function resolveTargetSelection(
  state: KayouGameState,
  playerId: '0' | '1',
  targetOwner: 'SELF' | 'OPPONENT',
  targetLane: LaneKey
): KayouGameState {
  if (state.turnPlayerId !== playerId || !state.pendingTarget) return state;
  const pending = state.pendingTarget;
  const oppId: '0' | '1' = playerId === '0' ? '1' : '0';

  // Step 1 of MOVE_FRIENDLY: select source lane first, then pick destination lane
  if (pending.effectAction === 'MOVE_FRIENDLY' && !pending.selectedFromLane) {
    if (targetOwner !== 'SELF' || !state.players[playerId].adventureArea[targetLane].character) {
      return state;
    }
    const destinations = (['left', 'center', 'right'] as LaneKey[])
      .filter((l) => l !== targetLane)
      .map((l) => ({ owner: 'SELF' as const, lane: l }));

    return {
      ...state,
      pendingTarget: {
        ...pending,
        selectedFromLane: targetLane,
        promptText: `Select destination lane to move ${
          state.players[playerId].adventureArea[targetLane].character!.name
        } to:`,
        validTargets: destinations,
      },
    };
  }

  if (pending.effectAction === 'MOVE_FRIENDLY' && pending.selectedFromLane) {
    const fromLane = pending.selectedFromLane;
    const toLane = targetLane;
    if (fromLane === toLane) return state;

    const me = state.players[playerId];
    const fromSlot = me.adventureArea[fromLane];
    const toSlot = me.adventureArea[toLane];

    return {
      ...state,
      phase: 'MAIN_PHASE',
      pendingTarget: null,
      players: {
        ...state.players,
        [playerId]: {
          ...me,
          adventureArea: {
            ...me.adventureArea,
            [fromLane]: toSlot,
            [toLane]: fromSlot,
          },
        },
      },
    };
  }

  if (pending.effectAction === 'BUFF_POWER' && targetOwner === 'SELF') {
    const me = state.players[playerId];
    const slot = me.adventureArea[targetLane];
    if (!slot.character) return state;

    return {
      ...state,
      phase: 'MAIN_PHASE',
      pendingTarget: null,
      players: {
        ...state.players,
        [playerId]: {
          ...me,
          adventureArea: {
            ...me.adventureArea,
            [targetLane]: {
              ...slot,
              inspoBoost: slot.inspoBoost + pending.value,
            },
          },
        },
      },
    };
  }

  if (pending.effectAction === 'READY_FRIENDLY' && targetOwner === 'SELF') {
    const me = state.players[playerId];
    const slot = me.adventureArea[targetLane];
    if (!slot.character) return state;

    return {
      ...state,
      phase: 'MAIN_PHASE',
      pendingTarget: null,
      players: {
        ...state.players,
        [playerId]: {
          ...me,
          adventureArea: {
            ...me.adventureArea,
            [targetLane]: {
              ...slot,
              isExhausted: false,
            },
          },
        },
      },
    };
  }

  if (pending.effectAction === 'RETIRE_OPPONENT' && targetOwner === 'OPPONENT') {
    const opp = state.players[oppId];
    const slot = opp.adventureArea[targetLane];
    if (!slot.character) return state;

    return {
      ...state,
      phase: 'MAIN_PHASE',
      pendingTarget: null,
      players: {
        ...state.players,
        [oppId]: {
          ...opp,
          retirement: [...opp.retirement, slot.character, ...slot.items],
          adventureArea: {
            ...opp.adventureArea,
            [targetLane]: { character: null, items: [], inspoBoost: 0, isExhausted: false },
          },
        },
      },
    };
  }

  return {
    ...state,
    phase: 'MAIN_PHASE',
    pendingTarget: null,
  };
}

export function cancelTargetSelection(state: KayouGameState, playerId: '0' | '1'): KayouGameState {
  if (state.phase !== 'PENDING_TARGET' || state.turnPlayerId !== playerId) return state;
  return {
    ...state,
    phase: 'MAIN_PHASE',
    pendingTarget: null,
  };
}

export function activateCharacterAdventureAbility(
  state: KayouGameState,
  playerId: '0' | '1',
  lane: LaneKey
): KayouGameState {
  if (state.phase !== 'MAIN_PHASE' || state.turnPlayerId !== playerId) return state;

  const player = state.players[playerId];
  const slot = player.adventureArea[lane];
  if (!slot.character || slot.isExhausted) return state;

  const text = sanitizeCardText(slot.character.effectText);
  if (!/Adventure\s*:/i.test(text)) return state;

  const exhaustedState: KayouGameState = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        adventureArea: {
          ...player.adventureArea,
          [lane]: {
            ...slot,
            isExhausted: true,
          },
        },
      },
    },
  };

  const pending = buildPendingTargetFromEffect(
    exhaustedState,
    playerId,
    slot.character,
    'ADVENTURE_TAP',
    lane
  );
  if (pending) {
    return {
      ...exhaustedState,
      phase: 'PENDING_TARGET',
      pendingTarget: pending,
    };
  }

  return executeImmediateActivatedEffect(exhaustedState, playerId, slot.character);
}

export function activateManeLeaderAbility(
  state: KayouGameState,
  playerId: '0' | '1'
): KayouGameState {
  if (state.phase !== 'MAIN_PHASE' || state.turnPlayerId !== playerId) return state;
  const player = state.players[playerId];
  if (!player.leader || player.leaderAbilityUsedThisTurn) return state;

  const text = sanitizeCardText(player.leader.effectText);
  if (!/Mane Ability|Once per turn|Activate\s*:/i.test(text)) return state;

  const markedState: KayouGameState = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        leaderAbilityUsedThisTurn: true,
      },
    },
  };

  const pending = buildPendingTargetFromEffect(
    markedState,
    playerId,
    player.leader,
    'MANE_ABILITY'
  );
  if (pending) {
    return {
      ...markedState,
      phase: 'PENDING_TARGET',
      pendingTarget: pending,
    };
  }

  return executeImmediateActivatedEffect(markedState, playerId, player.leader);
}

export function canSceneInspireCharacter(
  scene: SceneCardInPlay,
  targetCharacter: CardDefinition | null
): { eligible: boolean; boostAmount: number; reason?: string } {
  if (scene.isLockedFaceDown) {
    return { eligible: false, boostAmount: 0, reason: 'First-Turn Locked Scene' };
  }
  if (!scene.isFaceUp) {
    return { eligible: false, boostAmount: 0, reason: 'Already flipped face-down' };
  }
  if (!targetCharacter) {
    return { eligible: false, boostAmount: 0, reason: 'No character in active lane' };
  }

  const text = sanitizeCardText(scene.card.effectText);
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

  const actualCharName = String(targetCharacter.name || '').toLowerCase();

  const charBracketMatch = text.match(/[｢\[「]([^｣\]」]+)[｣\]」]/);
  if (charBracketMatch) {
    const requiredName = charBracketMatch[1].trim().toLowerCase();
    if (!actualCharName.includes(requiredName)) {
      return {
        eligible: false,
        boostAmount: 0,
        reason: `Only boosts ${charBracketMatch[1].trim()}`,
      };
    }
  } else {
    const namedPonies = [
      'Twilight Sparkle',
      'Rainbow Dash',
      'Applejack',
      'Rarity',
      'Fluttershy',
      'Pinkie Pie',
      'Spike',
      'Princess Celestia',
      'Princess Luna',
      'Princess Cadance',
      'Starlight Glimmer',
      'Trixie',
    ];
    for (const pony of namedPonies) {
      const ponyRegex = new RegExp(`\\b${pony}\\b`, 'i');
      if (ponyRegex.test(text) && !actualCharName.includes(pony.toLowerCase())) {
        return {
          eligible: false,
          boostAmount: 0,
          reason: `Only boosts ${pony}`,
        };
      }
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

export function startContactPhase(state: KayouGameState, playerId: '0' | '1'): KayouGameState {
  if (state.phase !== 'MAIN_PHASE' || state.turnPlayerId !== playerId) return state;
  const attacker = state.players[playerId];

  if (attacker.turnsTaken <= 1) {
    return endTurn(state, playerId);
  }

  const orderedLanes: LaneKey[] =
    playerId === state.firstPlayerId
      ? ['left', 'center', 'right']
      : ['right', 'center', 'left'];

  const activeAttackLanes = orderedLanes.filter(
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
    const atkTotal = calculateLanePowerBreakdown(state, attackerId, lane).totalPower;

    if (defSlot.character) {
      const defTotal = calculateLanePowerBreakdown(state, defenderId, lane).totalPower;
      return {
        ...state,
        phase: 'CONTACT_INSPIRE',
        contactState: {
          activeLane: lane,
          laneQueue: remaining,
          promptPlayerId: attackerId,
          consecutivePasses: 0,
          attackerPower: atkTotal,
          defenderPower: defTotal,
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
        attackerPower: atkTotal,
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

  const updatedState: KayouGameState = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        sceneArea: updatedSceneArea,
        adventureArea: {
          ...player.adventureArea,
          [lane]: updatedSlot,
        },
      },
    },
  };

  const attackerId = state.turnPlayerId;
  const defenderId: '0' | '1' = attackerId === '0' ? '1' : '0';
  const nextPrompt: '0' | '1' = playerId === '0' ? '1' : '0';

  return {
    ...updatedState,
    contactState: {
      ...state.contactState,
      promptPlayerId: nextPrompt,
      consecutivePasses: 0,
      attackerPower: calculateLanePowerBreakdown(updatedState, attackerId, lane).totalPower,
      defenderPower: calculateLanePowerBreakdown(updatedState, defenderId, lane).totalPower,
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

  const atkPower = calculateLanePowerBreakdown(state, attackerId, lane).totalPower;
  const defPower = calculateLanePowerBreakdown(state, defenderId, lane).totalPower;

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
    acknowledgedBy: [] as ('0' | '1')[],
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
        [lane]: { character: null, items: [], inspoBoost: 0, isExhausted: false },
      },
    };
  } else if (outcome === 'DEFENDER_WINS') {
    nextAtkPlayer = {
      ...nextAtkPlayer,
      retirement: [...nextAtkPlayer.retirement, atkSlot.character, ...atkSlot.items],
      adventureArea: {
        ...nextAtkPlayer.adventureArea,
        [lane]: { character: null, items: [], inspoBoost: 0, isExhausted: false },
      },
    };
  } else {
    nextAtkPlayer = {
      ...nextAtkPlayer,
      retirement: [...nextAtkPlayer.retirement, atkSlot.character, ...atkSlot.items],
      adventureArea: {
        ...nextAtkPlayer.adventureArea,
        [lane]: { character: null, items: [], inspoBoost: 0, isExhausted: false },
      },
    };
    nextDefPlayer = {
      ...nextDefPlayer,
      retirement: [...nextDefPlayer.retirement, defSlot.character, ...defSlot.items],
      adventureArea: {
        ...nextDefPlayer.adventureArea,
        [lane]: { character: null, items: [], inspoBoost: 0, isExhausted: false },
      },
    };
  }

  const remainingQueue = state.contactState.laneQueue.slice(1);
  return {
    ...state,
    phase: 'CLASH_HOLD',
    contactState: null,
    pendingLaneQueueAfterReveal: remainingQueue,
    players: {
      ...state.players,
      [attackerId]: nextAtkPlayer,
      [defenderId]: nextDefPlayer,
    },
    lastClashEvent: clashEvent,
  };
}

export function acknowledgeClashAnimation(
  state: KayouGameState,
  playerId: '0' | '1'
): KayouGameState {
  if (state.phase !== 'CLASH_HOLD' || !state.lastClashEvent) return state;
  if (state.lastClashEvent.acknowledgedBy.includes(playerId)) return state;

  const updatedAck = [...state.lastClashEvent.acknowledgedBy, playerId];

  if (updatedAck.length < 2) {
    return {
      ...state,
      lastClashEvent: {
        ...state.lastClashEvent,
        acknowledgedBy: updatedAck,
      },
    };
  }

  const queueToResume = state.pendingLaneQueueAfterReveal || [];
  return advanceToNextAttackLane(
    {
      ...state,
      lastClashEvent: null,
      pendingLaneQueueAfterReveal: null,
    },
    state.turnPlayerId,
    queueToResume
  );
}

export function canProgressNextStoryStage(attacker: PlayerState, defender: PlayerState): boolean {
  const nextStageIdx = attacker.storyProgress;
  if (nextStageIdx >= 4) return false;
  const opponentPairedStage = defender.storyStages[nextStageIdx];
  if (!opponentPairedStage) return true;
  return Boolean(opponentPairedStage.isPlanRevealed || !opponentPairedStage.planCard);
}

function executePrePlanEffectAndReturnToHand(
  state: KayouGameState,
  attackerId: '0' | '1',
  defenderId: '0' | '1',
  revealedCard: CardDefinition,
  activeLane: LaneKey
): {
  nextState: KayouGameState;
  hasPrePlanTrigger: boolean;
  effectSummary: string | null;
} {
  const text = sanitizeCardText(revealedCard.effectText);
  const hasPrePlanTrigger = /Pre-Plan|Scheme|When revealed as a Plan|Plan:/i.test(text);

  let workingState: KayouGameState = {
    ...state,
    players: {
      ...state.players,
      [defenderId]: {
        ...state.players[defenderId],
        hand: [...state.players[defenderId].hand, revealedCard],
      },
    },
  };

  let effectSummary: string | null = null;

  if (hasPrePlanTrigger) {
    if (/draw\s+1|draw\s+a\s+card/i.test(text)) {
      const drawRes = drawCardsWithDeckOutCheck(workingState, defenderId, 1);
      workingState = drawRes.state;
      effectSummary = `Pre-Plan Triggered: ${workingState.players[defenderId].displayName} drew 1 card!`;
    } else if (/retire|remove/i.test(text) && workingState.players[attackerId].adventureArea[activeLane].character) {
      const atkSlot = workingState.players[attackerId].adventureArea[activeLane];
      workingState = {
        ...workingState,
        players: {
          ...workingState.players,
          [attackerId]: {
            ...workingState.players[attackerId],
            retirement: [
              ...workingState.players[attackerId].retirement,
              atkSlot.character!,
              ...atkSlot.items,
            ],
            adventureArea: {
              ...workingState.players[attackerId].adventureArea,
              [activeLane]: { character: null, items: [], inspoBoost: 0, isExhausted: false },
            },
          },
        },
      };
      effectSummary = `Pre-Plan Triggered: Attacking character in ${activeLane.toUpperCase()} lane was retired!`;
    } else {
      effectSummary = `Pre-Plan Triggered: ${text}`;
    }
  }

  return { nextState: workingState, hasPrePlanTrigger, effectSummary };
}

function executeStoryPromotionEffect(
  state: KayouGameState,
  attackerId: '0' | '1',
  defenderId: '0' | '1',
  storyCard: CardDefinition,
  activeLane: LaneKey
): {
  nextState: KayouGameState;
  effectSummary: string | null;
} {
  const text = sanitizeCardText(storyCard.effectText);
  let workingState = { ...state };
  let effectSummary: string | null = null;

  if (!text) return { nextState: workingState, effectSummary };

  const drawMatch = text.match(/draw\s+(\d+|a)\s+card/i);
  if (drawMatch) {
    const drawCount = drawMatch[1].toLowerCase() === 'a' ? 1 : parseInt(drawMatch[1], 10) || 1;
    const drawRes = drawCardsWithDeckOutCheck(workingState, attackerId, drawCount);
    workingState = drawRes.state;
    effectSummary = `Story Effect: ${workingState.players[attackerId].displayName} drew ${drawCount} card${
      drawCount === 1 ? '' : 's'
    }!`;
  } else if (/opponent.*discard/i.test(text) && workingState.players[defenderId].hand.length > 0) {
    const def = workingState.players[defenderId];
    const discarded = def.hand[def.hand.length - 1];
    workingState = {
      ...workingState,
      players: {
        ...workingState.players,
        [defenderId]: {
          ...def,
          hand: def.hand.slice(0, -1),
          retirement: [...def.retirement, discarded],
        },
      },
    };
    effectSummary = `Story Effect: ${def.displayName} discarded 1 card!`;
  } else if (
    /\+(\d+)\s*Inspiration/i.test(text) &&
    workingState.players[attackerId].adventureArea[activeLane].character
  ) {
    const boost = parseInt(text.match(/\+(\d+)\s*Inspiration/i)![1], 10) || 1;
    const atk = workingState.players[attackerId];
    const slot = atk.adventureArea[activeLane];
    workingState = {
      ...workingState,
      players: {
        ...workingState.players,
        [attackerId]: {
          ...atk,
          adventureArea: {
            ...atk.adventureArea,
            [activeLane]: { ...slot, inspoBoost: slot.inspoBoost + boost },
          },
        },
      },
    };
    effectSummary = `Story Effect: +${boost} Inspiration granted!`;
  } else {
    effectSummary = `Story Effect: ${text}`;
  }

  return { nextState: workingState, effectSummary };
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

    const baseStateWithStory: KayouGameState = {
      ...state,
      players: {
        ...state.players,
        [playerId]: attacker,
        [defenderId]: defender,
      },
    };

    const revealedStoryStage = attacker.storyStages[nextProgress - 1];
    const storyCard = revealedStoryStage?.storyCard;

    if (storyCard) {
      const { nextState, effectSummary } = executeStoryPromotionEffect(
        baseStateWithStory,
        playerId,
        defenderId,
        storyCard,
        activeLane
      );
      if (nextState.phase === 'GAME_OVER') return nextState;

      return {
        ...nextState,
        phase: 'REVEAL_HOLD',
        contactState: null,
        pendingLaneQueueAfterReveal: remainingQueue,
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
        ...baseStateWithStory,
        phase: 'GAME_OVER',
        winnerId: playerId,
        winReason: `${attacker.displayName} progressed to Story Stage 4!`,
        contactState: null,
        pendingLaneQueueAfterReveal: null,
      };
    }

    return advanceToNextAttackLane(baseStateWithStory, playerId, remainingQueue);
  }

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

    const baseStateWithPlan: KayouGameState = {
      ...state,
      players: {
        ...state.players,
        [playerId]: attacker,
        [defenderId]: defender,
      },
    };

    const { nextState, hasPrePlanTrigger, effectSummary } = executePrePlanEffectAndReturnToHand(
      baseStateWithPlan,
      playerId,
      defenderId,
      revealedCard,
      activeLane
    );
    if (nextState.phase === 'GAME_OVER') return nextState;

    return {
      ...nextState,
      phase: 'REVEAL_HOLD',
      contactState: null,
      pendingLaneQueueAfterReveal: remainingQueue,
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

  if (revealEvent.isGameWinningStage) {
    return {
      ...state,
      phase: 'GAME_OVER',
      winnerId: revealEvent.attackerId,
      winReason: `${revealEvent.attackerName} completed Story Stage 4!`,
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

export function forfeitMatch(
  state: KayouGameState,
  forfeitingPlayerId: '0' | '1',
  reason: string
): KayouGameState {
  if (state.phase === 'GAME_OVER' || state.phase === 'WAITING_FOR_PLAYERS') return state;
  const winnerId: '0' | '1' = forfeitingPlayerId === '0' ? '1' : '0';
  return {
    ...state,
    phase: 'GAME_OVER',
    winnerId,
    winReason: reason,
    contactState: null,
    pendingTarget: null,
    pendingLaneQueueAfterReveal: null,
    lastClashEvent: null,
    lastPlanRevealEvent: null,
    lastStoryRevealEvent: null,
    announcements: [
      ...state.announcements,
      {
        type: 'FORFEIT',
        message: reason,
        timestamp: Date.now(),
      },
    ],
  };
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

  // Official Deck-Out Loss Check when starting player draws for turn
  if (startingPlayer.mainDeck.length === 0) {
    return {
      ...state,
      phase: 'GAME_OVER',
      winnerId: playerId,
      winReason: `${startingPlayer.displayName} attempted to draw from an empty Main Deck (Deck Out)!`,
      contactState: null,
      pendingTarget: null,
      pendingLaneQueueAfterReveal: null,
    };
  }

  const drawnMain = startingPlayer.mainDeck.slice(0, 1);
  const restMain = startingPlayer.mainDeck.slice(1);

  const readiedExistingScenes: SceneCardInPlay[] = startingPlayer.sceneArea.map((s) => ({
    ...s,
    isExhausted: false,
  }));

  // Player 2 does not draw a Scene on their first turn; if Scene Deck is empty later, skip safely without decking out
  const shouldFlipNewScene = newTurnsTaken > 1 && startingPlayer.sceneDeck.length > 0;
  const drawnScene = shouldFlipNewScene ? startingPlayer.sceneDeck.slice(0, 1) : [];
  const restScene = shouldFlipNewScene
    ? startingPlayer.sceneDeck.slice(1)
    : startingPlayer.sceneDeck;

  const addedScenes: SceneCardInPlay[] = drawnScene.map((c) => ({
    card: c,
    isFaceUp: true,
    isExhausted: false,
    isLockedFaceDown: false,
  }));

  const updatedStartingPlayer: PlayerState = {
    ...startingPlayer,
    leaderAbilityUsedThisTurn: false,
    turnsTaken: newTurnsTaken,
    actedLanesThisTurn: [],
    mainDeck: restMain,
    hand: [...startingPlayer.hand, ...drawnMain],
    sceneDeck: restScene,
    sceneArea: [...readiedExistingScenes, ...addedScenes],
    adventureArea: {
      left: { ...startingPlayer.adventureArea.left, isExhausted: false },
      center: { ...startingPlayer.adventureArea.center, isExhausted: false },
      right: { ...startingPlayer.adventureArea.right, isExhausted: false },
    },
  };

  return {
    ...state,
    phase: 'MAIN_PHASE',
    turnPlayerId: nextPlayerId,
    turnNumber: nextTurnNumber,
    contactState: null,
    pendingTarget: null,
    pendingLaneQueueAfterReveal: null,
    players: {
      [playerId]: cleanedEndingPlayer,
      [nextPlayerId]: updatedStartingPlayer,
    } as Record<'0' | '1', PlayerState>,
  };
}