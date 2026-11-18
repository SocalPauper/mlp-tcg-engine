import {
  KayouGameState,
  CardDefinition,
  PlayerState,
  HydratedDeckPayload,
  LaneKey,
  SceneCardInPlay,
  StoryStageSlot,
  PendingTargetSelection,
  AdventureSlot,
  ActionLogEntry,
} from './types.js';
import {
  sanitizeCardText,
  canPayHarmonyCost,
  getEffectiveCardCost,
  exhaustScenesWithElementPriority,
  calculateLanePowerBreakdown,
  parseActivatedCardEffect,
  extractTriggerClause,
  parseEffectClause,
  ParsedActivatedEffect,
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

function appendLog(
  state: KayouGameState,
  actor: string,
  text: string,
  category: ActionLogEntry['category'],
  sourceCard?: string
): KayouGameState {
  const entry: ActionLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: state.turnNumber,
    actor,
    sourceCard,
    text,
    category,
    timestamp: Date.now(),
  };
  return {
    ...state,
    actionLog: [...(state.actionLog || []), entry].slice(-80),
  };
}

function createEmptySlot(): AdventureSlot {
  return {
    character: null,
    items: [],
    inspoBoost: 0,
    isExhausted: false,
    treats: 0,
    hadTreat: false,
    presents: [],
    hadPresent: false,
  };
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
      left: createEmptySlot(),
      center: createEmptySlot(),
      right: createEmptySlot(),
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
    pendingHandChoice: null,
    pendingLaneQueueAfterReveal: null,
    lastClashEvent: null,
    lastPlanRevealEvent: null,
    lastStoryRevealEvent: null,
    announcements: [],
    actionLog: [],
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
        left: createEmptySlot(),
        center: createEmptySlot(),
        right: createEmptySlot(),
      },
      mulliganStatus: 'PENDING',
      turnsTaken: 0,
      actedLanesThisTurn: [],
      isConnected: true,
    };
  };

  const firstName = firstPlayerId === '0' ? p0Name : p1Name;

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
    pendingHandChoice: null,
    pendingLaneQueueAfterReveal: null,
    lastClashEvent: null,
    lastPlanRevealEvent: null,
    lastStoryRevealEvent: null,
    announcements: [
      {
        type: 'SYSTEM',
        message: `${firstName} won the toss and goes first!`,
        timestamp: Date.now(),
      },
    ],
    actionLog: [
      {
        id: `init-${Date.now()}`,
        turn: 1,
        actor: 'System',
        text: `Match initialized. ${firstName} goes first.`,
        category: 'SYSTEM',
        timestamp: Date.now(),
      },
    ],
  };
}

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
      state: appendLog(
        {
          ...state,
          phase: 'GAME_OVER',
          winnerId,
          winReason: `${player.displayName} ran out of cards in their Main Deck (Deck Out)!`,
          contactState: null,
          pendingTarget: null,
          pendingHandChoice: null,
          pendingLaneQueueAfterReveal: null,
        },
        player.displayName,
        'Ran out of Main Deck cards (Deck Out)!',
        'SYSTEM'
      ),
    };
  }

  const drawn = player.mainDeck.slice(0, count);
  const restMain = player.mainDeck.slice(count);

  const next = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        mainDeck: restMain,
        hand: [...player.hand, ...drawn],
      },
    },
  };

  return {
    deckedOut: false,
    state: appendLog(
      next,
      player.displayName,
      `Drew ${count} card${count === 1 ? '' : 's'}.`,
      'EFFECT'
    ),
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

  let nextState: KayouGameState = appendLog(
    {
      ...state,
      players: {
        ...state.players,
        [playerId]: updatedPlayer,
      },
    },
    player.displayName,
    doMulligan ? 'Mulliganed opening hand for 5 new cards.' : 'Kept opening hand.',
    'SYSTEM'
  );

  if (
    nextState.players['0'].mulliganStatus !== 'PENDING' &&
    nextState.players['1'].mulliganStatus !== 'PENDING'
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

    const p0Ready = dealInitialScenes(nextState.players['0']);
    const p1Ready = dealInitialScenes(nextState.players['1']);
    const firstName = state.firstPlayerId === '0' ? p0Ready.displayName : p1Ready.displayName;

    return appendLog(
      {
        ...nextState,
        phase: 'MAIN_PHASE',
        turnPlayerId: state.firstPlayerId,
        turnNumber: 1,
        players: {
          '0': p0Ready,
          '1': p1Ready,
        },
        announcements: [
          ...nextState.announcements,
          {
            type: 'TURN',
            message: `Turn 1 begins! ${firstName} (First Turn: no draw, no attack).`,
            timestamp: Date.now(),
          },
        ],
      },
      'System',
      `Turn 1 begins (${firstName}).`,
      'SYSTEM'
    );
  }

  return nextState;
}

function matchesFilter(card: CardDefinition, filter?: string): boolean {
  if (!filter) return true;
  const f = filter.trim().toLowerCase();
  return (
    String(card.name || '').toLowerCase().includes(f) ||
    String(card.traits || '').toLowerCase().includes(f) ||
    String(card.type || '').toLowerCase().includes(f)
  );
}

function triggerOnPresentUnwrapped(
  state: KayouGameState,
  unwrapperPlayerId: '0' | '1'
): KayouGameState {
  let workingState = { ...state };

  for (const lane of ['left', 'center', 'right'] as const) {
    const slot = workingState.players[unwrapperPlayerId].adventureArea[lane];
    if (!slot.character) continue;
    const text = sanitizeCardText(slot.character.effectText);
    if (/when (?:a|the) present.*is unwrapped/i.test(text)) {
      const boostMatch = text.match(/\+(\d+)\s*Inspiration/i);
      if (boostMatch) {
        const boost = parseInt(boostMatch[1], 10) || 1;
        const p = workingState.players[unwrapperPlayerId];
        const targetSlot = p.adventureArea[lane];
        workingState = appendLog(
          {
            ...workingState,
            players: {
              ...workingState.players,
              [unwrapperPlayerId]: {
                ...p,
                adventureArea: {
                  ...p.adventureArea,
                  [lane]: {
                    ...targetSlot,
                    inspoBoost: targetSlot.inspoBoost + boost,
                  },
                },
              },
            },
          },
          p.displayName,
          `${slot.character.name} gained +${boost} Inspiration from unwrapping a Present!`,
          'EFFECT',
          slot.character.name
        );
      }
    }
  }

  return workingState;
}

function buildPendingTargetFromParsed(
  state: KayouGameState,
  playerId: '0' | '1',
  sourceCard: CardDefinition,
  parsed: ParsedActivatedEffect,
  sourceOrigin: 'HAND_EVENT' | 'ADVENTURE_TAP' | 'MANE_ABILITY' | 'APPEAR_EFFECT' | 'STORY_PROMOTION',
  sourceLane?: LaneKey
): PendingTargetSelection | null {
  const oppId: '0' | '1' = playerId === '0' ? '1' : '0';
  const me = state.players[playerId];
  const opp = state.players[oppId];
  const allLanes: LaneKey[] = ['left', 'center', 'right'];

  if (parsed.kind === 'TARGET_BUFF_POWER' && !parsed.isSelfOnly) {
    const validTargets = allLanes
      .filter(
        (l) =>
          me.adventureArea[l].character !== null &&
          matchesFilter(me.adventureArea[l].character!, parsed.requiredNameFilter)
      )
      .map((l) => ({ owner: 'SELF' as const, lane: l }));
    if (validTargets.length === 0) return null;
    return {
      sourceCard,
      sourceOrigin,
      sourceLane,
      effectAction: 'BUFF_POWER',
      value: parsed.amount,
      promptText: `Select one of your Characters in your Adventure Area to gain +${parsed.amount} Inspiration:`,
      validTargets,
    };
  }

  if (parsed.kind === 'TARGET_DEBUFF_OPPONENT') {
    const validTargets = allLanes
      .filter((l) => opp.adventureArea[l].character !== null)
      .map((l) => ({ owner: 'OPPONENT' as const, lane: l }));
    if (validTargets.length === 0) return null;
    return {
      sourceCard,
      sourceOrigin,
      sourceLane,
      effectAction: 'DEBUFF_OPPONENT',
      value: parsed.amount,
      promptText: `Select a Rival Character to give -${parsed.amount} Inspiration:`,
      validTargets,
    };
  }

  if (parsed.kind === 'TREAT_FOR_YOU' && !parsed.isGlobal) {
    const targets: { owner: 'SELF' | 'OPPONENT'; lane: LaneKey }[] = [];
    if (parsed.targetSide !== 'OPPONENT') {
      for (const l of allLanes) {
        if (
          me.adventureArea[l].character &&
          matchesFilter(me.adventureArea[l].character!, parsed.requiredNameFilter)
        ) {
          targets.push({ owner: 'SELF', lane: l });
        }
      }
    }
    if (parsed.targetSide !== 'SELF') {
      for (const l of allLanes) {
        if (
          opp.adventureArea[l].character &&
          matchesFilter(opp.adventureArea[l].character!, parsed.requiredNameFilter)
        ) {
          targets.push({ owner: 'OPPONENT', lane: l });
        }
      }
    }
    if (targets.length === 0) return null;
    return {
      sourceCard,
      sourceOrigin,
      sourceLane,
      effectAction: 'TREAT_CHARACTER',
      value: parsed.amount,
      promptText: `Treat for you! Select a Character to receive ${parsed.amount} Treat:`,
      validTargets: targets,
    };
  }

  if (parsed.kind === 'DELIVER_PRESENT' && !parsed.isGlobal) {
    const targets: { owner: 'SELF' | 'OPPONENT'; lane: LaneKey }[] = [];
    if (parsed.targetSide !== 'OPPONENT') {
      for (const l of allLanes) {
        if (
          me.adventureArea[l].character &&
          matchesFilter(me.adventureArea[l].character!, parsed.requiredNameFilter)
        ) {
          targets.push({ owner: 'SELF', lane: l });
        }
      }
    }
    if (parsed.targetSide !== 'SELF') {
      for (const l of allLanes) {
        if (
          opp.adventureArea[l].character &&
          matchesFilter(opp.adventureArea[l].character!, parsed.requiredNameFilter)
        ) {
          targets.push({ owner: 'OPPONENT', lane: l });
        }
      }
    }
    if (targets.length === 0) return null;
    return {
      sourceCard,
      sourceOrigin,
      sourceLane,
      effectAction: 'DELIVER_PRESENT',
      value: parsed.amount,
      promptText: `Deliver Present: Select a Character to receive a Present:`,
      validTargets: targets,
    };
  }

  if (parsed.kind === 'UNWRAP_PRESENT') {
    const targets: { owner: 'SELF' | 'OPPONENT'; lane: LaneKey }[] = [];
    if (parsed.targetSide !== 'OPPONENT') {
      for (const l of allLanes) {
        if (me.adventureArea[l].character && me.adventureArea[l].presents.length > 0) {
          targets.push({ owner: 'SELF', lane: l });
        }
      }
    }
    if (parsed.targetSide !== 'SELF') {
      for (const l of allLanes) {
        if (opp.adventureArea[l].character && opp.adventureArea[l].presents.length > 0) {
          targets.push({ owner: 'OPPONENT', lane: l });
        }
      }
    }
    if (targets.length === 0) return null;
    return {
      sourceCard,
      sourceOrigin,
      sourceLane,
      effectAction: 'UNWRAP_PRESENT',
      value: 1,
      promptText: `Unwrap Present: Select a Character with a Present to unwrap:`,
      validTargets: targets,
    };
  }

  if (parsed.kind === 'SWITCH_POSITIONS') {
    const targetOwner = parsed.targetSide === 'OPPONENT' ? 'OPPONENT' : 'SELF';
    const targetPlayer = targetOwner === 'OPPONENT' ? opp : me;
    const occupiedLanes = allLanes
      .filter((l) => targetPlayer.adventureArea[l].character !== null)
      .map((l) => ({ owner: targetOwner as 'SELF' | 'OPPONENT', lane: l }));
    if (occupiedLanes.length < 2) return null;
    return {
      sourceCard,
      sourceOrigin,
      sourceLane,
      effectAction: 'SWITCH_POSITIONS',
      value: 1,
      promptText: `Switch Positions: Select the first Character to swap:`,
      validTargets: occupiedLanes,
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
      promptText: `Select a Rival Character in their Adventure Area to Retire:`,
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
      promptText: `Select a tapped Character in your Adventure Area to Untap:`,
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
      promptText: `Select one of your Characters to move to an empty slot:`,
      validTargets,
    };
  }

  return null;
}

function executeParsedImmediateEffect(
  state: KayouGameState,
  playerId: '0' | '1',
  parsed: ParsedActivatedEffect,
  sourceCard: CardDefinition,
  sourceLane?: LaneKey
): KayouGameState {
  const player = state.players[playerId];

  if (parsed.kind === 'DRAW') {
    return drawCardsWithDeckOutCheck(state, playerId, parsed.amount).state;
  }

  // Draw X, then prompt user to select Y cards in Hand to discard
  if (parsed.kind === 'DRAW_THEN_DISCARD') {
    const drawRes = drawCardsWithDeckOutCheck(state, playerId, parsed.amount);
    if (drawRes.deckedOut) return drawRes.state;
    const updatedPlayer = drawRes.state.players[playerId];
    const discardCount = Math.min(parsed.secondaryAmount || 1, updatedPlayer.hand.length);
    if (discardCount <= 0) return drawRes.state;

    return {
      ...drawRes.state,
      phase: 'PENDING_HAND_CHOICE',
      pendingHandChoice: {
        sourceCard,
        playerId,
        action: 'DISCARD_FROM_HAND',
        count: discardCount,
        promptText: `${sourceCard.name}: Select ${discardCount} card${discardCount > 1 ? 's' : ''} from your Hand to discard to your Retirement Area:`,
        sourceLane,
      },
    };
  }

  // Discard X (optional/required), then draw Y
  if (parsed.kind === 'DISCARD_THEN_DRAW') {
    if (player.hand.length === 0) return state;
    const discardCount = Math.min(parsed.amount, player.hand.length);
    return {
      ...state,
      phase: 'PENDING_HAND_CHOICE',
      pendingHandChoice: {
        sourceCard,
        playerId,
        action: 'DISCARD_FROM_HAND',
        count: discardCount,
        promptText: `${sourceCard.name}: Select ${discardCount} card${discardCount > 1 ? 's' : ''} to discard:`,
        filterName: parsed.requiredNameFilter,
        sourceLane,
      },
    };
  }

  // Untap up to X Scenes in Scene Area
  if (parsed.kind === 'UNTAP_SCENES') {
    let untapped = 0;
    const updatedScenes = player.sceneArea.map((s) => {
      if (s.isExhausted && untapped < parsed.amount) {
        untapped += 1;
        return { ...s, isExhausted: false };
      }
      return s;
    });

    if (untapped === 0) return state;
    return appendLog(
      {
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...player,
            sceneArea: updatedScenes,
          },
        },
      },
      player.displayName,
      `${sourceCard.name} untapped ${untapped} Scene${untapped > 1 ? 's' : ''} in Scene Area!`,
      'EFFECT',
      sourceCard.name
    );
  }

  // Reveal top X cards of Main Deck, add matching card to Hand, move rest to Retirement Area
  if (parsed.kind === 'REVEAL_TOP_PICK_HAND') {
    const lookCount = Math.min(parsed.amount, player.mainDeck.length);
    if (lookCount === 0) return state;

    const revealed = player.mainDeck.slice(0, lookCount);
    const remainingDeck = player.mainDeck.slice(lookCount);

    const matchIdx = revealed.findIndex((c) => {
      if (parsed.requiredTypeFilter) {
        return String(c.type || '').toLowerCase().includes(parsed.requiredTypeFilter.toLowerCase());
      }
      if (parsed.requiredNameFilter) {
        return matchesFilter(c, parsed.requiredNameFilter);
      }
      return true;
    });

    if (matchIdx !== -1) {
      const picked = revealed[matchIdx];
      const discardedRest = revealed.filter((_, idx) => idx !== matchIdx);
      return appendLog(
        {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              mainDeck: remainingDeck,
              hand: [...player.hand, picked],
              retirement: [...player.retirement, ...discardedRest],
            },
          },
        },
        player.displayName,
        `${sourceCard.name} revealed top ${lookCount} cards and added ${picked.name} to Hand!`,
        'EFFECT',
        sourceCard.name
      );
    }

    return appendLog(
      {
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...player,
            mainDeck: remainingDeck,
            retirement: [...player.retirement, ...revealed],
          },
        },
      },
      player.displayName,
      `${sourceCard.name} revealed top ${lookCount} cards (no matching card found; moved to Retirement Area).`,
      'EFFECT',
      sourceCard.name
    );
  }

  // Recover matching card from Retirement Area to Hand
  if (parsed.kind === 'RECOVER_RETIREMENT' && player.retirement.length > 0) {
    let matchIdx = -1;
    for (let i = player.retirement.length - 1; i >= 0; i--) {
      const candidate = player.retirement[i];
      const typeOk =
        !parsed.requiredTypeFilter ||
        String(candidate.type || '').toLowerCase().includes(parsed.requiredTypeFilter.toLowerCase());
      const nameOk =
        !parsed.requiredNameFilter || matchesFilter(candidate, parsed.requiredNameFilter);
      if (typeOk && nameOk) {
        matchIdx = i;
        break;
      }
    }

    if (matchIdx !== -1) {
      const recovered = player.retirement[matchIdx];
      const nextRetirement = player.retirement.filter((_, idx) => idx !== matchIdx);
      return appendLog(
        {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              retirement: nextRetirement,
              hand: [...player.hand, recovered],
            },
          },
        },
        player.displayName,
        `${sourceCard.name} returned ${recovered.name} from Retirement Area to Hand!`,
        'EFFECT',
        sourceCard.name
      );
    }
  }

  if (parsed.kind === 'TREAT_FOR_YOU' && parsed.isGlobal) {
    const adv = player.adventureArea;
    const applyTreat = (slot: AdventureSlot): AdventureSlot =>
      slot.character && matchesFilter(slot.character, parsed.requiredNameFilter)
        ? { ...slot, treats: slot.treats + parsed.amount, hadTreat: true }
        : slot;

    return appendLog(
      {
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...player,
            adventureArea: {
              left: applyTreat(adv.left),
              center: applyTreat(adv.center),
              right: applyTreat(adv.right),
            },
          },
        },
      },
      player.displayName,
      `${sourceCard.name} placed ${parsed.amount} Treat on matching Characters!`,
      'EFFECT',
      sourceCard.name
    );
  }

  if (parsed.kind === 'DELIVER_PRESENT' && parsed.isGlobal) {
    let deck = [...player.mainDeck];
    const adv = { ...player.adventureArea };

    for (const lane of ['left', 'center', 'right'] as const) {
      const slot = adv[lane];
      if (slot.character && matchesFilter(slot.character, parsed.requiredNameFilter) && deck.length > 0) {
        const presentCard = deck.shift()!;
        adv[lane] = {
          ...slot,
          presents: [...slot.presents, presentCard],
          hadPresent: true,
        };
      }
    }

    return appendLog(
      {
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...player,
            mainDeck: deck,
            adventureArea: adv,
          },
        },
      },
      player.displayName,
      `${sourceCard.name} delivered Presents to matching Characters!`,
      'EFFECT',
      sourceCard.name
    );
  }

  if (parsed.kind === 'GLOBAL_BUFF_FRIENDLY') {
    const boost = parsed.amount;
    const adv = player.adventureArea;
    const applyBuff = (slot: AdventureSlot): AdventureSlot =>
      slot.character && matchesFilter(slot.character, parsed.requiredNameFilter)
        ? { ...slot, inspoBoost: slot.inspoBoost + boost }
        : slot;

    return appendLog(
      {
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...player,
            adventureArea: {
              left: applyBuff(adv.left),
              center: applyBuff(adv.center),
              right: applyBuff(adv.right),
            },
          },
        },
      },
      player.displayName,
      `${sourceCard.name} granted +${boost} Inspiration to matching Characters!`,
      'EFFECT',
      sourceCard.name
    );
  }

  if (parsed.kind === 'TARGET_BUFF_POWER' && parsed.isSelfOnly && sourceLane) {
    const slot = player.adventureArea[sourceLane];
    if (!slot.character) return state;
    return appendLog(
      {
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...player,
            adventureArea: {
              ...player.adventureArea,
              [sourceLane]: {
                ...slot,
                inspoBoost: slot.inspoBoost + parsed.amount,
              },
            },
          },
        },
      },
      player.displayName,
      `${sourceCard.name} gained +${parsed.amount} Inspiration!`,
      'EFFECT',
      sourceCard.name
    );
  }

  return state;
}

function executeAppearOrFarewellEffect(
  state: KayouGameState,
  playerId: '0' | '1',
  card: CardDefinition,
  lane: LaneKey,
  type: 'Appear' | 'Farewell'
): KayouGameState {
  const subText = extractTriggerClause(card.effectText, type);
  if (!subText) return state;

  const parsed = parseEffectClause(subText);
  if (!parsed) return state;

  let workingState = appendLog(
    state,
    state.players[playerId].displayName,
    `${card.name} triggered ${type}: ${subText}`,
    'EFFECT',
    card.name
  );

  workingState = executeParsedImmediateEffect(workingState, playerId, parsed, card, lane);
  if (workingState.phase === 'PENDING_HAND_CHOICE' || workingState.phase === 'GAME_OVER') {
    return workingState;
  }

  if (workingState.turnPlayerId === playerId && workingState.phase === 'MAIN_PHASE') {
    const pending = buildPendingTargetFromParsed(
      workingState,
      playerId,
      card,
      parsed,
      'APPEAR_EFFECT',
      lane
    );
    if (pending) {
      return {
        ...workingState,
        phase: 'PENDING_TARGET',
        pendingTarget: pending,
      };
    }
  } else if (parsed.kind === 'TARGET_RETIRE_OPPONENT') {
    const oppId: '0' | '1' = playerId === '0' ? '1' : '0';
    const opp = workingState.players[oppId];
    const validLane = (['left', 'center', 'right'] as LaneKey[]).find((l) => {
      const c = opp.adventureArea[l].character;
      if (!c) return false;
      if (parsed.maxLimit !== undefined) {
        const totalPwr = calculateLanePowerBreakdown(workingState, oppId, l).totalPower;
        return (Number(c.cost) || 0) <= parsed.maxLimit || totalPwr <= parsed.maxLimit;
      }
      return true;
    });
    if (validLane) {
      return retireCharacterWithFarewell(workingState, oppId, validLane);
    }
  } else if (parsed.kind === 'TARGET_BUFF_POWER' && !parsed.isSelfOnly) {
    const me = workingState.players[playerId];
    const validLane = (['left', 'center', 'right'] as LaneKey[]).find(
      (l) =>
        me.adventureArea[l].character !== null &&
        matchesFilter(me.adventureArea[l].character!, parsed.requiredNameFilter)
    );
    if (validLane) {
      const slot = me.adventureArea[validLane];
      return {
        ...workingState,
        players: {
          ...workingState.players,
          [playerId]: {
            ...me,
            adventureArea: {
              ...me.adventureArea,
              [validLane]: {
                ...slot,
                inspoBoost: slot.inspoBoost + parsed.amount,
              },
            },
          },
        },
      };
    }
  }

  return workingState;
}

function retireCharacterWithFarewell(
  state: KayouGameState,
  playerId: '0' | '1',
  lane: LaneKey
): KayouGameState {
  const player = state.players[playerId];
  const slot = player.adventureArea[lane];
  if (!slot.character) return state;

  const retiringChar = slot.character;
  const retiringItems = [...slot.items];
  const retiringPresents = [...slot.presents];

  let workingState: KayouGameState = appendLog(
    {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          retirement: [...player.retirement, retiringChar, ...retiringItems, ...retiringPresents],
          adventureArea: {
            ...player.adventureArea,
            [lane]: createEmptySlot(),
          },
        },
      },
    },
    player.displayName,
    `${retiringChar.name} retired from ${lane.toUpperCase()} lane to Retirement Area.`,
    'PLAY',
    retiringChar.name
  );

  workingState = executeAppearOrFarewellEffect(workingState, playerId, retiringChar, lane, 'Farewell');
  return workingState;
}

function buildPendingTargetFromEffect(
  state: KayouGameState,
  playerId: '0' | '1',
  sourceCard: CardDefinition,
  sourceOrigin: 'HAND_EVENT' | 'ADVENTURE_TAP' | 'MANE_ABILITY' | 'APPEAR_EFFECT' | 'STORY_PROMOTION',
  sourceLane?: LaneKey
): PendingTargetSelection | null {
  const parsed = parseActivatedCardEffect(sourceCard);
  return buildPendingTargetFromParsed(state, playerId, sourceCard, parsed, sourceOrigin, sourceLane);
}

function executeImmediateActivatedEffect(
  state: KayouGameState,
  playerId: '0' | '1',
  sourceCard: CardDefinition
): KayouGameState {
  const parsed = parseActivatedCardEffect(sourceCard);
  return executeParsedImmediateEffect(state, playerId, parsed, sourceCard);
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

  if (normalizedType.includes('character')) {
    const lane: LaneKey = targetLane || 'left';

    let workingState: KayouGameState = appendLog(
      {
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...player,
            hand: newHand,
            sceneArea: updatedSceneArea,
          },
        },
      },
      player.displayName,
      `Played ${card.name} to ${lane.toUpperCase()} lane (Cost: ${effectiveCost} Force of Harmony).`,
      'PLAY',
      card.name
    );

    if (workingState.players[playerId].adventureArea[lane].character) {
      workingState = retireCharacterWithFarewell(workingState, playerId, lane);
    }

    const updatedAdv = {
      ...workingState.players[playerId].adventureArea,
      [lane]: {
        ...createEmptySlot(),
        character: card,
      },
    };

    workingState = {
      ...workingState,
      players: {
        ...workingState.players,
        [playerId]: {
          ...workingState.players[playerId],
          adventureArea: updatedAdv,
        },
      },
    };

    workingState = executeAppearOrFarewellEffect(workingState, playerId, card, lane, 'Appear');
    return workingState;
  }

  if (normalizedType === 'item') {
    const lane: LaneKey = targetLane || 'left';
    const currentSlot = player.adventureArea[lane];
    if (!currentSlot.character) return state;

    const replacedItems = currentSlot.items.length > 0 ? [...currentSlot.items] : [];

    return appendLog(
      {
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
                items: [card],
              },
            },
          },
        },
      },
      player.displayName,
      `Adorned ${currentSlot.character.name} with Item: ${card.name}.`,
      'PLAY',
      card.name
    );
  }

  let nextState: KayouGameState = appendLog(
    {
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
    },
    player.displayName,
    `Played Event: ${card.name}.`,
    'PLAY',
    card.name
  );

  const pending = buildPendingTargetFromEffect(nextState, playerId, card, 'HAND_EVENT');
  if (pending) {
    if (
      targetLane &&
      pending.effectAction !== 'MOVE_FRIENDLY' &&
      pending.effectAction !== 'SWITCH_POSITIONS' &&
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

export function resolveHandCardChoice(
  state: KayouGameState,
  playerId: '0' | '1',
  selectedIndices: number[]
): KayouGameState {
  if (state.phase !== 'PENDING_HAND_CHOICE' || !state.pendingHandChoice) return state;
  const choice = state.pendingHandChoice;
  if (choice.playerId !== playerId) return state;

  const player = state.players[playerId];
  const uniqueValidIndices = Array.from(new Set(selectedIndices))
    .filter((i) => i >= 0 && i < player.hand.length)
    .slice(0, choice.count);

  if (uniqueValidIndices.length < Math.min(choice.count, player.hand.length)) {
    return state;
  }

  const discardedCards = uniqueValidIndices.map((i) => player.hand[i]);
  const remainingHand = player.hand.filter((_, i) => !uniqueValidIndices.includes(i));
  const discardedNames = discardedCards.map((c) => c.name).join(', ');

  let nextState: KayouGameState = appendLog(
    {
      ...state,
      phase: 'MAIN_PHASE',
      pendingHandChoice: null,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          hand: remainingHand,
          retirement: [...player.retirement, ...discardedCards],
        },
      },
    },
    player.displayName,
    `Discarded ${discardedNames} to Retirement Area (${choice.sourceCard.name}).`,
    'EFFECT',
    choice.sourceCard.name
  );

  // If this was a "Discard X, draw Y" card, draw the cards now
  const parsed = parseEffectClause(choice.sourceCard.effectText);
  if (parsed?.kind === 'DISCARD_THEN_DRAW' && parsed.secondaryAmount) {
    nextState = drawCardsWithDeckOutCheck(nextState, playerId, parsed.secondaryAmount).state;
  }

  return nextState;
}

export function resolveTargetSelection(
  state: KayouGameState,
  playerId: '0' | '1',
  targetOwner: 'SELF' | 'OPPONENT',
  targetLane: LaneKey
): KayouGameState {
  if (state.turnPlayerId !== playerId || !state.pendingTarget) return state;
  const pending = state.pendingTarget;
  const oppId: '0' | '1' = playerId === '0' ? '1' : '0';
  const targetPlayerId: '0' | '1' = targetOwner === 'SELF' ? playerId : oppId;

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
        promptText: `Select destination slot to move ${
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

    return appendLog(
      {
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
      },
      me.displayName,
      `Moved ${fromSlot.character?.name || 'Character'} from ${fromLane.toUpperCase()} to ${toLane.toUpperCase()} lane.`,
      'EFFECT',
      pending.sourceCard.name
    );
  }

  if (pending.effectAction === 'SWITCH_POSITIONS' && !pending.selectedFromLane) {
    const targetPlayer = state.players[targetPlayerId];
    if (!targetPlayer.adventureArea[targetLane].character) return state;

    const secondTargets = (['left', 'center', 'right'] as LaneKey[])
      .filter((l) => l !== targetLane && targetPlayer.adventureArea[l].character !== null)
      .map((l) => ({ owner: targetOwner, lane: l }));

    return {
      ...state,
      pendingTarget: {
        ...pending,
        selectedFromLane: targetLane,
        promptText: `Select the second Character to switch positions with ${
          targetPlayer.adventureArea[targetLane].character!.name
        }:`,
        validTargets: secondTargets,
      },
    };
  }

  if (pending.effectAction === 'SWITCH_POSITIONS' && pending.selectedFromLane) {
    const laneA = pending.selectedFromLane;
    const laneB = targetLane;
    if (laneA === laneB) return state;

    const targetPlayer = state.players[targetPlayerId];
    const slotA = targetPlayer.adventureArea[laneA];
    const slotB = targetPlayer.adventureArea[laneB];

    return appendLog(
      {
        ...state,
        phase: 'MAIN_PHASE',
        pendingTarget: null,
        players: {
          ...state.players,
          [targetPlayerId]: {
            ...targetPlayer,
            adventureArea: {
              ...targetPlayer.adventureArea,
              [laneA]: slotB,
              [laneB]: slotA,
            },
          },
        },
      },
      state.players[playerId].displayName,
      `Switched positions between ${slotA.character?.name} and ${slotB.character?.name}.`,
      'EFFECT',
      pending.sourceCard.name
    );
  }

  if (pending.effectAction === 'BUFF_POWER' && targetOwner === 'SELF') {
    const me = state.players[playerId];
    const slot = me.adventureArea[targetLane];
    if (!slot.character) return state;

    return appendLog(
      {
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
      },
      me.displayName,
      `Granted +${pending.value} Inspiration to ${slot.character.name} (${pending.sourceCard.name}).`,
      'EFFECT',
      pending.sourceCard.name
    );
  }

  if (pending.effectAction === 'DEBUFF_OPPONENT' && targetOwner === 'OPPONENT') {
    const opp = state.players[oppId];
    const slot = opp.adventureArea[targetLane];
    if (!slot.character) return state;

    return appendLog(
      {
        ...state,
        phase: 'MAIN_PHASE',
        pendingTarget: null,
        players: {
          ...state.players,
          [oppId]: {
            ...opp,
            adventureArea: {
              ...opp.adventureArea,
              [targetLane]: {
                ...slot,
                inspoBoost: slot.inspoBoost - pending.value,
              },
            },
          },
        },
      },
      state.players[playerId].displayName,
      `Applied -${pending.value} Inspiration to Rival's ${slot.character.name}.`,
      'EFFECT',
      pending.sourceCard.name
    );
  }

  if (pending.effectAction === 'TREAT_CHARACTER') {
    const targetPlayer = state.players[targetPlayerId];
    const slot = targetPlayer.adventureArea[targetLane];
    if (!slot.character) return state;

    return appendLog(
      {
        ...state,
        phase: 'MAIN_PHASE',
        pendingTarget: null,
        players: {
          ...state.players,
          [targetPlayerId]: {
            ...targetPlayer,
            adventureArea: {
              ...targetPlayer.adventureArea,
              [targetLane]: {
                ...slot,
                treats: slot.treats + pending.value,
                hadTreat: true,
              },
            },
          },
        },
      },
      state.players[playerId].displayName,
      `Placed ${pending.value} Treat on ${slot.character.name}.`,
      'EFFECT',
      pending.sourceCard.name
    );
  }

  if (pending.effectAction === 'DELIVER_PRESENT') {
    const me = state.players[playerId];
    if (me.mainDeck.length === 0) {
      return { ...state, phase: 'MAIN_PHASE', pendingTarget: null };
    }
    const presentCard = me.mainDeck[0];
    const restDeck = me.mainDeck.slice(1);

    const stateAfterDeck: KayouGameState = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...me,
          mainDeck: restDeck,
        },
      },
    };

    const recipient = stateAfterDeck.players[targetPlayerId];
    const slot = recipient.adventureArea[targetLane];
    if (!slot.character) {
      return { ...stateAfterDeck, phase: 'MAIN_PHASE', pendingTarget: null };
    }

    return appendLog(
      {
        ...stateAfterDeck,
        phase: 'MAIN_PHASE',
        pendingTarget: null,
        players: {
          ...stateAfterDeck.players,
          [targetPlayerId]: {
            ...recipient,
            adventureArea: {
              ...recipient.adventureArea,
              [targetLane]: {
                ...slot,
                presents: [...slot.presents, presentCard],
                hadPresent: true,
              },
            },
          },
        },
      },
      me.displayName,
      `Delivered a Present to ${slot.character.name}.`,
      'EFFECT',
      pending.sourceCard.name
    );
  }

  if (pending.effectAction === 'UNWRAP_PRESENT') {
    const targetPlayer = state.players[targetPlayerId];
    const slot = targetPlayer.adventureArea[targetLane];
    if (!slot.character || slot.presents.length === 0) {
      return { ...state, phase: 'MAIN_PHASE', pendingTarget: null };
    }

    const unwrappedCard = slot.presents[0];
    const remainingPresents = slot.presents.slice(1);

    let updatedState: KayouGameState = appendLog(
      {
        ...state,
        phase: 'MAIN_PHASE',
        pendingTarget: null,
        players: {
          ...state.players,
          [targetPlayerId]: {
            ...targetPlayer,
            retirement: [...targetPlayer.retirement, unwrappedCard],
            adventureArea: {
              ...targetPlayer.adventureArea,
              [targetLane]: {
                ...slot,
                presents: remainingPresents,
              },
            },
          },
        },
      },
      state.players[playerId].displayName,
      `Unwrapped Present on ${slot.character.name}!`,
      'EFFECT',
      pending.sourceCard.name
    );

    updatedState = triggerOnPresentUnwrapped(updatedState, targetPlayerId);
    return updatedState;
  }

  if (pending.effectAction === 'READY_FRIENDLY' && targetOwner === 'SELF') {
    const me = state.players[playerId];
    const slot = me.adventureArea[targetLane];
    if (!slot.character) return state;

    return appendLog(
      {
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
      },
      me.displayName,
      `Untapped ${slot.character.name} (${pending.sourceCard.name}).`,
      'EFFECT',
      pending.sourceCard.name
    );
  }

  if (pending.effectAction === 'RETIRE_OPPONENT' && targetOwner === 'OPPONENT') {
    const workingState = retireCharacterWithFarewell(state, oppId, targetLane);
    return {
      ...workingState,
      phase: 'MAIN_PHASE',
      pendingTarget: null,
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

  const exhaustedState: KayouGameState = appendLog(
    {
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
    },
    player.displayName,
    `Tapped ${slot.character.name} for Adventure ability.`,
    'EFFECT',
    slot.character.name
  );

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

  const markedState: KayouGameState = appendLog(
    {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          leaderAbilityUsedThisTurn: true,
        },
      },
    },
    player.displayName,
    `Activated Main Character ability: ${player.leader.name}.`,
    'EFFECT',
    player.leader.name
  );

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
      reason: 'This Scene does not have an Inspiration Boost ability.',
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

  const logged = appendLog(
    state,
    attacker.displayName,
    `Entered Contact Phase (${activeAttackLanes.map((l) => l.toUpperCase()).join(' → ')}).`,
    'CLASH'
  );

  return advanceToNextAttackLane(logged, playerId, activeAttackLanes);
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

  const updatedState: KayouGameState = appendLog(
    {
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
    },
    player.displayName,
    `Triggered Inspiration Boost (${sceneItem.card.name}): +${check.boostAmount} Inspiration to ${currentSlot.character?.name}!`,
    'CLASH',
    sceneItem.card.name
  );

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

  let workingState = appendLog(
    { ...state },
    'Clash',
    `${lane.toUpperCase()} Lane Contact: ${atkSlot.character.name} (${atkPower} Insp) vs ${defSlot.character.name} (${defPower} Insp) → ${outcome.replace('_', ' ')}!`,
    'CLASH'
  );

  if (outcome === 'ATTACKER_WINS') {
    workingState = retireCharacterWithFarewell(workingState, defenderId, lane);
    const atk = workingState.players[attackerId];
    workingState = {
      ...workingState,
      players: {
        ...workingState.players,
        [attackerId]: {
          ...atk,
          actedLanesThisTurn: [...atk.actedLanesThisTurn, lane],
        },
      },
    };
  } else if (outcome === 'DEFENDER_WINS') {
    workingState = retireCharacterWithFarewell(workingState, attackerId, lane);
    const atk = workingState.players[attackerId];
    workingState = {
      ...workingState,
      players: {
        ...workingState.players,
        [attackerId]: {
          ...atk,
          actedLanesThisTurn: [...atk.actedLanesThisTurn, lane],
        },
      },
    };
  } else {
    workingState = retireCharacterWithFarewell(workingState, attackerId, lane);
    workingState = retireCharacterWithFarewell(workingState, defenderId, lane);
    const atk = workingState.players[attackerId];
    workingState = {
      ...workingState,
      players: {
        ...workingState.players,
        [attackerId]: {
          ...atk,
          actedLanesThisTurn: [...atk.actedLanesThisTurn, lane],
        },
      },
    };
  }

  const remainingQueue = state.contactState.laneQueue.slice(1);
  return {
    ...workingState,
    phase: 'CLASH_HOLD',
    contactState: null,
    pendingLaneQueueAfterReveal: remainingQueue,
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
    const parsed = parseEffectClause(text);
    if (parsed) {
      workingState = executeParsedImmediateEffect(workingState, defenderId, parsed, revealedCard);
      effectSummary = `Pre-Plan Triggered (${revealedCard.name}): ${text}`;
    } else if (
      /retire|remove/i.test(text) &&
      workingState.players[attackerId].adventureArea[activeLane].character
    ) {
      workingState = retireCharacterWithFarewell(workingState, attackerId, activeLane);
      effectSummary = `Pre-Plan Triggered: Attacking Character in ${activeLane.toUpperCase()} lane was retired!`;
    } else {
      effectSummary = `Pre-Plan Triggered: ${text}`;
    }
  }

  workingState = appendLog(
    workingState,
    workingState.players[defenderId].displayName,
    `Plan revealed: ${revealedCard.name}${effectSummary ? ` (${effectSummary})` : ' (added to Hand)'}.`,
    'STORY',
    revealedCard.name
  );

  return { nextState: workingState, hasPrePlanTrigger, effectSummary };
}

/**
 * Full Story Stage 2 & Stage 3 Promotion Pipeline:
 * Routes the Story card's promotion clause through the complete effectParser + target/immediate execution.
 */
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
  const rawText = sanitizeCardText(storyCard.effectText);
  let workingState = { ...state };
  let effectSummary: string | null = null;

  if (!rawText) return { nextState: workingState, effectSummary };

  // Strip "When promoted to this stage," prefix so the action clause parses cleanly
  const actionClause = rawText
    .replace(/^.*?(?:When\s+promoted\s+to\s+this\s+stage|When\s+promoted)[,:\s]*/i, '')
    .trim();

  const parsed = parseEffectClause(actionClause) || parseEffectClause(rawText);

  if (parsed) {
    workingState = executeParsedImmediateEffect(
      workingState,
      attackerId,
      parsed,
      storyCard,
      activeLane
    );

    if (parsed.kind === 'RECOVER_RETIREMENT') {
      effectSummary = `Story Promotion Effect: Recovered ${parsed.requiredTypeFilter || 'card'} from Retirement Area to Hand!`;
    } else if (parsed.kind === 'DRAW') {
      effectSummary = `Story Promotion Effect: Drew ${parsed.amount} card${parsed.amount > 1 ? 's' : ''}!`;
    } else if (parsed.kind === 'TREAT_FOR_YOU') {
      effectSummary = `Story Promotion Effect: Placed ${parsed.amount} Treat on matching Character(s)!`;
    } else if (parsed.kind === 'DELIVER_PRESENT') {
      effectSummary = `Story Promotion Effect: Delivered Present(s)!`;
    } else if (parsed.kind === 'GLOBAL_BUFF_FRIENDLY' || parsed.kind === 'TARGET_BUFF_POWER') {
      effectSummary = `Story Promotion Effect: Granted +${parsed.amount} Inspiration!`;
    } else {
      effectSummary = `Story Promotion Effect: ${actionClause || rawText}`;
    }
  } else if (/opponent.*discard/i.test(rawText) && workingState.players[defenderId].hand.length > 0) {
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
    effectSummary = `Story Promotion Effect: ${def.displayName} discarded ${discarded.name}!`;
  } else {
    effectSummary = `Story Promotion Effect: ${actionClause || rawText}`;
  }

  workingState = appendLog(
    workingState,
    workingState.players[attackerId].displayName,
    `Promoted to Story Stage: ${storyCard.name} — ${effectSummary}`,
    'STORY',
    storyCard.name
  );

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

    if (nextProgress >= 4) {
      return appendLog(
        {
          ...baseStateWithStory,
          phase: 'GAME_OVER',
          winnerId: playerId,
          winReason: `${attacker.displayName} progressed to Story Stage 4 and won the game!`,
          contactState: null,
          pendingLaneQueueAfterReveal: null,
          lastStoryRevealEvent: null,
          announcements: [
            ...state.announcements,
            {
              type: 'VICTORY',
              message: `${attacker.displayName} completed Story Stage 4 and won the match!`,
              timestamp: Date.now(),
            },
          ],
        },
        attacker.displayName,
        'Completed Story Stage 4 and won the match!',
        'STORY'
      );
    }

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
          isGameWinningStage: false,
        },
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
  return appendLog(
    {
      ...state,
      phase: 'GAME_OVER',
      winnerId,
      winReason: reason,
      contactState: null,
      pendingTarget: null,
      pendingHandChoice: null,
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
    },
    'System',
    reason,
    'SYSTEM'
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

  if (startingPlayer.mainDeck.length === 0) {
    return appendLog(
      {
        ...state,
        phase: 'GAME_OVER',
        winnerId: playerId,
        winReason: `${startingPlayer.displayName} attempted to draw from an empty Main Deck (Deck Out)!`,
        contactState: null,
        pendingTarget: null,
        pendingHandChoice: null,
        pendingLaneQueueAfterReveal: null,
      },
      startingPlayer.displayName,
      'Decked out at start of turn!',
      'SYSTEM'
    );
  }

  const drawnMain = startingPlayer.mainDeck.slice(0, 1);
  const restMain = startingPlayer.mainDeck.slice(1);

  const readiedExistingScenes: SceneCardInPlay[] = startingPlayer.sceneArea.map((s) => ({
    ...s,
    isExhausted: false,
  }));

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

  return appendLog(
    {
      ...state,
      phase: 'MAIN_PHASE',
      turnPlayerId: nextPlayerId,
      turnNumber: nextTurnNumber,
      contactState: null,
      pendingTarget: null,
      pendingHandChoice: null,
      pendingLaneQueueAfterReveal: null,
      players: {
        [playerId]: cleanedEndingPlayer,
        [nextPlayerId]: updatedStartingPlayer,
      } as Record<'0' | '1', PlayerState>,
    },
    updatedStartingPlayer.displayName,
    `Turn ${nextTurnNumber} started (Drew 1 card${addedScenes.length > 0 ? ', placed 1 Scene' : ''}).`,
    'SYSTEM'
  );
}