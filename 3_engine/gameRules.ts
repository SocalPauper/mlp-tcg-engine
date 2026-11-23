import crypto from 'crypto';
import {
  KayouGameState,
  CardDefinition,
  PlayerState,
  HydratedDeckPayload,
  LaneKey,
  SceneCardInPlay,
  StoryStageSlot,
  PendingTargetSelection,
  PendingHandChoice,
  QueuedEffectItem,
  DelayedTriggerEntry,
  ManeSpeechBubble,
  DebugTraceEntry,
  ActionLogEntry,
  ActionSpotlightEvent,
  AdventureSlot,
} from './types.js';
import {
  sanitizeCardText,
  detectEffectKeywords,
  matchesCardKeywordExact,
  isReactiveAdventureClause,
  extractItemGrantedAdventureClause,
  canPlayCardRestrictions,
  canPayHarmonyCost,
  getEffectiveCardCost,
  calculateLanePowerBreakdown,
  evaluateScalingMultiplier,
  parseActivatedCardEffect,
  extractTriggerClause,
  extractDelayedTiming,
  evaluateBoardCondition,
  splitCompoundClauses,
  parseEffectClause,
  ParsedActivatedEffect,
} from './effectParser.js';

export { calculateLanePowerBreakdown, canPayHarmonyCost, getEffectiveCardCost };

export function secureShuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function appendActionLog(
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
    actionLog: [...(state.actionLog || []), entry].slice(-100),
  };
}

function setManeSpeechBubble(
  state: KayouGameState,
  playerId: '0' | '1',
  text: string,
  tone: ManeSpeechBubble['tone'] = 'INFO'
): KayouGameState {
  const player = state.players[playerId];
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        speechBubble: {
          id: `sp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text,
          tone,
          timestamp: Date.now(),
        },
      },
    },
  };
}

function triggerCardFlight(
  state: KayouGameState,
  playerId: '0' | '1',
  kind: 'DRAW' | 'DISCARD' | 'RETIRE',
  count: number,
  cardName?: string
): KayouGameState {
  return {
    ...state,
    lastCardFlight: {
      id: `flt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      playerId,
      kind,
      count,
      cardName,
      timestamp: Date.now(),
    },
  };
}

function appendDebugTrace(
  state: KayouGameState,
  params: {
    actor: string;
    card: CardDefinition;
    triggerType: string;
    parsedKind: string;
    targetsOrChoice: string;
    status: DebugTraceEntry['status'];
    notes: string;
  }
): KayouGameState {
  const entry: DebugTraceEntry = {
    id: `dbg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    turn: state.turnNumber,
    phase: state.phase,
    turnPlayer: state.players[state.turnPlayerId]?.displayName || state.turnPlayerId,
    actor: params.actor,
    cardId: params.card.id,
    cardName: params.card.name,
    cardText: sanitizeCardText(params.card.effectText) || '(No text)',
    triggerType: params.triggerType,
    detectedKeywords: detectEffectKeywords(params.card.effectText),
    parsedKind: params.parsedKind,
    targetsOrChoice: params.targetsOrChoice,
    status: params.status,
    notes: params.notes,
    timestamp: Date.now(),
  };
  return {
    ...state,
    debugTrace: [...(state.debugTrace || []), entry].slice(-120),
  };
}

function setActionSpotlight(
  state: KayouGameState,
  actorId: '0' | '1',
  actionType: ActionSpotlightEvent['actionType'],
  title: string,
  subtitle: string,
  card?: CardDefinition | null,
  lane?: LaneKey,
  comicWord?: string
): KayouGameState {
  return {
    ...state,
    lastActionBanner: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      actorId,
      actorName: state.players[actorId].displayName,
      actionType,
      comicWord,
      title,
      subtitle,
      card: card || null,
      lane,
      timestamp: Date.now(),
    },
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
    preventRetireInContact: false,
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
    nextCardCostDiscount: null,
    isConnected: true,
    speechBubble: null,
  };
}

export function createWaitingMatch(): KayouGameState {
  return {
    roomId: 'waiting-room',
    phase: 'WAITING_FOR_PLAYERS',
    firstPlayerId: '0',
    wheelSpinDegrees: 2070,
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
    effectResolutionQueue: [],
    delayedTriggers: [],
    lastClashEvent: null,
    lastPlanRevealEvent: null,
    lastStoryRevealEvent: null,
    lastActionBanner: null,
    lastCardFlight: null,
    announcements: [],
    actionLog: [],
    debugTrace: [],
  };
}

export function startSeatedMatch(
  deck0: HydratedDeckPayload,
  deck1: HydratedDeckPayload,
  p0Name = 'Player 1',
  p1Name = 'Player 2'
): KayouGameState {
  const coinFlip = crypto.randomInt(0, 2);
  const firstPlayerId: '0' | '1' = coinFlip === 0 ? '0' : '1';
  const sliceJitter = crypto.randomInt(30, 150);
  const wheelSpinDegrees = 1800 + (firstPlayerId === '0' ? 180 + sliceJitter : sliceJitter);

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
      nextCardCostDiscount: null,
      isConnected: true,
      speechBubble: null,
    };
  };

  const firstPlayerName = firstPlayerId === '0' ? p0Name : p1Name;

  return {
    roomId: 'active-match',
    phase: 'VS_INTRO',
    firstPlayerId,
    wheelSpinDegrees,
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
    effectResolutionQueue: [],
    delayedTriggers: [],
    lastClashEvent: null,
    lastPlanRevealEvent: null,
    lastStoryRevealEvent: null,
    lastActionBanner: null,
    lastCardFlight: null,
    announcements: [
      {
        type: 'SYSTEM',
        message: `${firstPlayerName} won the spin and goes first!`,
        timestamp: Date.now(),
      },
    ],
    actionLog: [
      {
        id: `${Date.now()}-init`,
        turn: 1,
        actor: 'System',
        text: `Match started! Wheel selected ${firstPlayerName} to go first.`,
        category: 'SYSTEM',
        timestamp: Date.now(),
      },
    ],
    debugTrace: [],
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
      state: {
        ...state,
        phase: 'GAME_OVER',
        winnerId,
        winReason: `${player.displayName} ran out of cards in their Main Deck (Deck Out)!`,
        contactState: null,
        pendingTarget: null,
        pendingHandChoice: null,
        pendingLaneQueueAfterReveal: null,
      },
    };
  }

  const drawn = player.mainDeck.slice(0, count);
  const restMain = player.mainDeck.slice(count);

  let nextState: KayouGameState = {
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

  nextState = triggerCardFlight(nextState, playerId, 'DRAW', count);
  return {
    deckedOut: false,
    state: nextState,
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

  let workingState: KayouGameState = {
    ...state,
    players: {
      ...state.players,
      [playerId]: updatedPlayer,
    },
  };

  workingState = appendActionLog(
    workingState,
    player.displayName,
    doMulligan ? 'performed a full opening hand Mulligan.' : 'kept their opening hand.',
    'SYSTEM'
  );

  const nextPlayers = workingState.players;

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

    let readyState: KayouGameState = {
      ...workingState,
      phase: 'MAIN_PHASE',
      turnPlayerId: state.firstPlayerId,
      turnNumber: 1,
      players: {
        '0': p0Ready,
        '1': p1Ready,
      },
      announcements: [
        ...workingState.announcements,
        {
          type: 'TURN',
          message: `Turn 1 begins! ${
            state.firstPlayerId === '0' ? p0Ready.displayName : p1Ready.displayName
          } (First Turn: no draw, no attack).`,
          timestamp: Date.now(),
        },
      ],
    };

    readyState = setManeSpeechBubble(
      readyState,
      state.firstPlayerId,
      "My turn! Let's start the adventure!",
      'INFO'
    );
    return readyState;
  }

  return workingState;
}

function matchesFilter(
  card: CardDefinition,
  filter?: string,
  typeFilter?: string,
  maxCost?: number
): boolean {
  if (maxCost !== undefined && (Number(card.cost) || 0) > maxCost) {
    return false;
  }
  if (typeFilter) {
    const t = String(card.type || '').toLowerCase();
    const ft = typeFilter.trim().toLowerCase();
    if (!t.includes(ft)) return false;
  }
  if (!filter) return true;
  return matchesCardKeywordExact(card, filter);
}

function triggerOnTreatChanged(
  state: KayouGameState,
  targetPlayerId: '0' | '1',
  lane: LaneKey,
  kind: 'PLACED' | 'REMOVED'
): KayouGameState {
  const player = state.players[targetPlayerId];
  const slot = player.adventureArea[lane];
  if (!slot.character) return state;

  const text = sanitizeCardText(slot.character.effectText);
  const pattern =
    kind === 'PLACED'
      ? /when\s+a\s+treat\s+is\s+put\s+on\s+this\s+character,\s*(?:this\s+character|it)\s+gets\s*\+(\d+)\s*Inspiration/i
      : /when\s+a\s+treat\s+on\s+this\s+character\s+is\s+removed,\s*(?:this\s+character|it)\s+gets\s*\+(\d+)\s*Inspiration/i;

  const match = text.match(pattern);
  if (!match) return state;

  const boost = parseInt(match[1], 10) || 1;
  let next: KayouGameState = {
    ...state,
    players: {
      ...state.players,
      [targetPlayerId]: {
        ...player,
        adventureArea: {
          ...player.adventureArea,
          [lane]: {
            ...slot,
            inspoBoost: slot.inspoBoost + boost,
          },
        },
      },
    },
  };
  return appendActionLog(
    next,
    player.displayName,
    `${slot.character.name} (${slot.character.id}) gained +${boost} Inspiration when a Treat was ${kind.toLowerCase()}!`,
    'EFFECT',
    slot.character.name
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
    if (/when (?:a|the) present.*is unwrapped|each time.*present.*is unwrapped/i.test(text)) {
      const boostMatch = text.match(/\+(\d+)\s*Inspiration/i);
      if (boostMatch) {
        const boost = parseInt(boostMatch[1], 10) || 1;
        const p = workingState.players[unwrapperPlayerId];
        const targetSlot = p.adventureArea[lane];
        workingState = {
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
        };
        workingState = appendActionLog(
          workingState,
          p.displayName,
          `${slot.character.name} (${slot.character.id}) gained +${boost} Inspiration from unwrapping a Present!`,
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
  sourceOrigin: PendingTargetSelection['sourceOrigin'],
  sourceLane?: LaneKey,
  resumeAttackQueue?: LaneKey[] | null,
  resumeEndTurnForPlayer?: '0' | '1' | null
): PendingTargetSelection | null {
  if (parsed.kind === 'NONE_PASSIVE') return null;

  const oppId: '0' | '1' = playerId === '0' ? '1' : '0';
  const me = state.players[playerId];
  const opp = state.players[oppId];
  const allLanes: LaneKey[] = ['left', 'center', 'right'];

  if (parsed.kind === 'BUFF_TWO_TARGETS') {
    const firstTargets = allLanes
      .filter(
        (l) =>
          me.adventureArea[l].character !== null &&
          matchesFilter(me.adventureArea[l].character!, parsed.requiredNameFilter)
      )
      .map((l) => ({ owner: 'SELF' as const, lane: l }));
    const secondTargets = allLanes
      .filter(
        (l) =>
          me.adventureArea[l].character !== null &&
          matchesFilter(me.adventureArea[l].character!, parsed.secondaryNameFilter)
      )
      .map((l) => ({ owner: 'SELF' as const, lane: l }));
    if (firstTargets.length === 0 || secondTargets.length === 0) return null;
    return {
      sourceCard,
      sourceOrigin,
      sourceLane,
      effectAction: 'BUFF_TWO_TARGETS',
      value: parsed.amount,
      secondaryNameFilter: parsed.secondaryNameFilter,
      promptText: `${sourceCard.name}: Select 「${parsed.requiredNameFilter}」 to grant +${parsed.amount} Inspiration (1 of 2):`,
      validTargets: firstTargets,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  if (parsed.kind === 'PREVENT_RETIRE_IN_CONTACT') {
    const validTargets = allLanes
      .filter((l) => {
        const c = me.adventureArea[l].character;
        if (!c) return false;
        if (!matchesFilter(c, parsed.requiredNameFilter)) return false;
        if (parsed.maxLimit !== undefined) {
          return calculateLanePowerBreakdown(state, playerId, l).totalPower <= parsed.maxLimit;
        }
        return true;
      })
      .map((l) => ({ owner: 'SELF' as const, lane: l }));
    if (validTargets.length === 0) return null;
    return {
      sourceCard,
      sourceOrigin,
      sourceLane,
      effectAction: 'PREVENT_RETIRE_IN_CONTACT',
      value: 1,
      maxTargetCostOrPower: parsed.maxLimit,
      promptText: `${sourceCard.name}: Select a matching Character to protect from retiring in Contact:`,
      validTargets,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

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
      promptText: `${sourceCard.name}: Select ${
        parsed.requiredNameFilter ? `「${parsed.requiredNameFilter}」` : 'one of your Characters'
      } to grant +${parsed.amount} Inspiration:`,
      validTargets,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
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
      promptText: `${sourceCard.name}: Select an opponent's Character to give -${parsed.amount} Inspiration:`,
      validTargets,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  if (parsed.kind === 'REMOVE_TREAT') {
    const validTargets = allLanes
      .filter((l) => me.adventureArea[l].character !== null && me.adventureArea[l].treats > 0)
      .map((l) => ({ owner: 'SELF' as const, lane: l }));
    if (validTargets.length === 0) return null;
    return {
      sourceCard,
      sourceOrigin,
      sourceLane,
      effectAction: 'REMOVE_TREAT',
      value: 1,
      promptText: `${sourceCard.name}: Select a Character with a Treat to remove its Treat:`,
      validTargets,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
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
      promptText: `Treat for you! (${sourceCard.name}) Select a Character to receive ${parsed.amount} Treat:`,
      validTargets: targets,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
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
      promptText: `Deliver Present (${sourceCard.name}): Select a Character to receive a Present:`,
      validTargets: targets,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
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
      promptText: `Unwrap Present (${sourceCard.name}): Select a Character with a Present to unwrap:`,
      validTargets: targets,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
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
      promptText: `Switch Positions (${sourceCard.name}): Select the first Character to swap:`,
      validTargets: occupiedLanes,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  if (parsed.kind === 'TARGET_RETIRE_OPPONENT') {
    const validTargets = allLanes
      .filter((l) => {
        const c = opp.adventureArea[l].character;
        if (!c) return false;
        if (parsed.maxLimit !== undefined) {
          const totalPwr = calculateLanePowerBreakdown(state, oppId, l).totalPower;
          return totalPwr <= parsed.maxLimit || (Number(c.cost) || 0) <= parsed.maxLimit;
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
      promptText: `${sourceCard.name}: Select an opponent's Character to move to their Retirement Area:`,
      validTargets,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
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
      promptText: `${sourceCard.name}: Select an exhausted Character to Ready (untap):`,
      validTargets,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
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
      promptText: `${sourceCard.name}: Select one of your Characters to move to another lane:`,
      validTargets,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  return null;
}

function buildPendingHandChoiceFromParsed(
  state: KayouGameState,
  playerId: '0' | '1',
  sourceCard: CardDefinition,
  parsed: ParsedActivatedEffect,
  resumeAttackQueue?: LaneKey[] | null,
  resumeEndTurnForPlayer?: '0' | '1' | null
): PendingHandChoice | null {
  if (parsed.kind === 'NONE_PASSIVE') return null;
  const oppId: '0' | '1' = playerId === '0' ? '1' : '0';
  const player = state.players[playerId];
  const rival = state.players[oppId];

  if (parsed.kind === 'SCRY_TOP_BOTTOM') {
    if (player.mainDeck.length === 0) return null;
    const topCard = player.mainDeck[0];
    return {
      sourceCard,
      playerId,
      choiceType: 'TOP_OR_BOTTOM_DECK',
      count: 1,
      promptText: `${sourceCard.name}: Revealed top card (${topCard.name} • ${topCard.id}). Put it at the Top or Bottom of your Main Deck?`,
      candidateCards: [topCard],
      validIndices: [0],
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  if (parsed.kind === 'MOVE_HAND_TO_PLAN') {
    if (player.hand.length === 0) return null;
    const emptyPlanExists = player.storyStages.some((s) => s.planCard === null && !s.isStoryCompleted);
    if (!emptyPlanExists) return null;
    return {
      sourceCard,
      playerId,
      choiceType: 'MOVE_HAND_TO_PLAN',
      count: 1,
      promptText: `${sourceCard.name}: Choose 1 card from your Hand to place face-down as a Plan in your Story Area:`,
      candidateCards: player.hand,
      validIndices: player.hand.map((_, idx) => idx),
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  if (parsed.kind === 'REVIVE_RETIREMENT') {
    const hasEmptyLane = (['left', 'center', 'right'] as LaneKey[]).some(
      (l) => player.adventureArea[l].character === null
    );
    if (!hasEmptyLane || player.retirement.length === 0) return null;
    const validIndices = player.retirement
      .map((c, idx) =>
        String(c.type || '').toLowerCase().includes('character') &&
        matchesFilter(c, parsed.requiredNameFilter, undefined, parsed.maxLimit)
          ? idx
          : -1
      )
      .filter((idx) => idx !== -1);
    if (validIndices.length === 0) return null;
    return {
      sourceCard,
      playerId,
      choiceType: 'REVIVE_FROM_RETIREMENT',
      count: 1,
      promptText: `${sourceCard.name}: Choose 1 Character from your Retirement Area to deploy to your Adventure Area:`,
      candidateCards: player.retirement,
      validIndices,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  if (parsed.kind === 'FLIP_SCENES_UP') {
    const validIndices = player.sceneArea
      .map((sc, idx) => (!sc.isFaceUp && !sc.isLockedFaceDown ? idx : -1))
      .filter((idx) => idx !== -1);
    if (validIndices.length === 0) return null;
    const count = Math.min(parsed.amount, validIndices.length);
    return {
      sourceCard,
      playerId,
      choiceType: 'CHOOSE_SCENE_TO_FLIP_UP',
      count,
      promptText: `${sourceCard.name}: Choose ${count} face-down Scene(s) in your Scene Area to turn face-up:`,
      candidateCards: player.sceneArea.map((s) => s.card),
      validIndices,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  if (parsed.kind === 'FLIP_SCENES_DOWN') {
    const validIndices = player.sceneArea
      .map((sc, idx) => (sc.isFaceUp ? idx : -1))
      .filter((idx) => idx !== -1);
    if (validIndices.length === 0) return null;
    const count = Math.min(parsed.amount, validIndices.length);
    return {
      sourceCard,
      playerId,
      choiceType: 'CHOOSE_SCENE_TO_FLIP_DOWN',
      count,
      promptText: `${sourceCard.name}: Choose ${count} face-up Scene(s) in your Scene Area to turn face-down:`,
      candidateCards: player.sceneArea.map((s) => s.card),
      validIndices,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  if (parsed.kind === 'FLIP_RIVAL_SCENES_DOWN') {
    const validIndices = rival.sceneArea
      .map((sc, idx) => (sc.isFaceUp ? idx : -1))
      .filter((idx) => idx !== -1);
    if (validIndices.length === 0) return null;
    const count = Math.min(parsed.amount, validIndices.length);
    return {
      sourceCard,
      playerId,
      choiceType: 'CHOOSE_RIVAL_SCENE_TO_FLIP_DOWN',
      count,
      promptText: `${sourceCard.name}: Choose ${count} face-up Scene(s) in Rival's Scene Area to turn face-down:`,
      candidateCards: rival.sceneArea.map((s) => s.card),
      validIndices,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  if (parsed.kind === 'UNTAP_SCENES' && parsed.requiresChoice) {
    const tappedIndices = player.sceneArea
      .map((sc, idx) => (sc.isExhausted ? idx : -1))
      .filter((idx) => idx !== -1);
    if (tappedIndices.length === 0) return null;
    return {
      sourceCard,
      playerId,
      choiceType: 'CHOOSE_SCENE_TO_UNTAP',
      count: Math.min(parsed.amount, tappedIndices.length),
      promptText: `${sourceCard.name}: Choose ${Math.min(
        parsed.amount,
        tappedIndices.length
      )} tapped Scene card(s) in your Scene Area to untap:`,
      candidateCards: player.sceneArea.map((s) => s.card),
      validIndices: tappedIndices,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  if (parsed.kind === 'DRAW_THEN_DISCARD' || parsed.kind === 'DISCARD_HAND') {
    const discardCount =
      parsed.kind === 'DRAW_THEN_DISCARD' ? parsed.secondaryAmount || 1 : parsed.amount;
    if (player.hand.length === 0) return null;
    const count = Math.min(discardCount, player.hand.length);
    return {
      sourceCard,
      playerId,
      choiceType: 'DISCARD_FROM_HAND',
      count,
      promptText: `${sourceCard.name}: Choose ${count} card${
        count === 1 ? '' : 's'
      } from your Hand to discard to your Retirement Area:`,
      candidateCards: player.hand,
      validIndices: player.hand.map((_, idx) => idx),
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  if (parsed.kind === 'DISCARD_THEN_DRAW') {
    if (player.hand.length === 0) return null;
    const validIndices = player.hand
      .map((c, idx) => (matchesFilter(c, parsed.requiredNameFilter) ? idx : -1))
      .filter((idx) => idx !== -1);
    if (validIndices.length === 0) return null;
    const count = Math.min(parsed.amount, validIndices.length);
    return {
      sourceCard,
      playerId,
      choiceType: 'DISCARD_THEN_DRAW',
      count,
      secondaryDrawCount: parsed.secondaryAmount || 1,
      promptText: `${sourceCard.name}: Choose ${count} card${
        count === 1 ? '' : 's'
      } from your Hand to discard, then draw ${parsed.secondaryAmount || 1}:`,
      candidateCards: player.hand,
      validIndices,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  if (parsed.kind === 'RECOVER_RETIREMENT') {
    if (player.retirement.length === 0) return null;
    const validIndices = player.retirement
      .map((c, idx) =>
        matchesFilter(c, parsed.requiredNameFilter, parsed.requiredTypeFilter, parsed.maxLimit)
          ? idx
          : -1
      )
      .filter((idx) => idx !== -1);
    if (validIndices.length === 0) return null;
    return {
      sourceCard,
      playerId,
      choiceType: 'RECOVER_FROM_RETIREMENT',
      count: 1,
      promptText: `${sourceCard.name}: Choose 1 ${
        parsed.requiredNameFilter
          ? `「${parsed.requiredNameFilter}」`
          : parsed.requiredTypeFilter || 'card'
      } from your Retirement Area to add to your Hand:`,
      candidateCards: player.retirement,
      validIndices,
      filterLabel: parsed.requiredNameFilter || parsed.requiredTypeFilter,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  if (parsed.kind === 'REVEAL_TOP_PICK_HAND') {
    const revealed = player.mainDeck.slice(0, parsed.amount);
    if (revealed.length === 0) return null;
    const validIndices = revealed
      .map((c, idx) =>
        matchesFilter(c, parsed.requiredNameFilter, parsed.requiredTypeFilter, parsed.maxLimit)
          ? idx
          : -1
      )
      .filter((idx) => idx !== -1);

    if (validIndices.length === 0) return null;
    return {
      sourceCard,
      playerId,
      choiceType: 'PICK_REVEALED_TO_HAND',
      count: 1,
      promptText: `${sourceCard.name}: Revealed top ${revealed.length} cards — choose 1 matching ${
        parsed.requiredNameFilter || parsed.requiredTypeFilter || 'card'
      } to add to your Hand:`,
      candidateCards: revealed,
      validIndices,
      filterLabel: parsed.requiredNameFilter || parsed.requiredTypeFilter,
      resumeAttackQueue,
      resumeEndTurnForPlayer,
    };
  }

  return null;
}

function executeParsedImmediateEffect(
  state: KayouGameState,
  playerId: '0' | '1',
  sourceCard: CardDefinition,
  parsed: ParsedActivatedEffect,
  sourceLane?: LaneKey
): KayouGameState {
  if (parsed.kind === 'NONE_PASSIVE') return state;
  const oppId: '0' | '1' = playerId === '0' ? '1' : '0';
  const player = state.players[playerId];
  const rival = state.players[oppId];

  if (parsed.kind === 'COST_DISCOUNT_NEXT') {
    const next: KayouGameState = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          nextCardCostDiscount: {
            filter: parsed.requiredNameFilter,
            cardType: parsed.requiredTypeFilter,
            amount: parsed.amount,
          },
        },
      },
    };
    return appendActionLog(
      next,
      player.displayName,
      `activated -${parsed.amount} Cost discount for the next matching card via ${sourceCard.name}.`,
      'EFFECT',
      sourceCard.name
    );
  }

  if (parsed.kind === 'DRAW_UNTIL_MATCH_RIVAL') {
    const diff = Math.max(0, rival.hand.length - player.hand.length);
    if (diff === 0) return state;
    const res = drawCardsWithDeckOutCheck(state, playerId, diff);
    if (res.deckedOut) return res.state;
    return appendActionLog(
      res.state,
      player.displayName,
      `drew ${diff} card(s) to match Rival's hand size via ${sourceCard.name}.`,
      'EFFECT',
      sourceCard.name
    );
  }

  if (parsed.kind === 'ADD_FACEDOWN_SCENE') {
    if (player.sceneDeck.length === 0) return state;
    const added = player.sceneDeck[0];
    const next: KayouGameState = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          sceneDeck: player.sceneDeck.slice(1),
          sceneArea: [
            ...player.sceneArea,
            { card: added, isFaceUp: false, isExhausted: true, isLockedFaceDown: false },
          ],
        },
      },
    };
    return appendActionLog(
      next,
      player.displayName,
      `added 1 tapped face-down Scene to Scene Area via ${sourceCard.name}.`,
      'EFFECT',
      sourceCard.name
    );
  }

  if (parsed.kind === 'GLOBAL_DEBUFF_OPPONENT') {
    const adv = rival.adventureArea;
    const applyDebuff = (slot: AdventureSlot): AdventureSlot =>
      slot.character ? { ...slot, inspoBoost: slot.inspoBoost - parsed.amount } : slot;

    const next: KayouGameState = {
      ...state,
      players: {
        ...state.players,
        [oppId]: {
          ...rival,
          adventureArea: {
            left: applyDebuff(adv.left),
            center: applyDebuff(adv.center),
            right: applyDebuff(adv.right),
          },
        },
      },
    };
    return appendActionLog(
      next,
      player.displayName,
      `applied -${parsed.amount} Inspiration to each Character in Rival's Adventure Area via ${sourceCard.name}.`,
      'EFFECT',
      sourceCard.name
    );
  }

  if (parsed.kind === 'DRAW' || parsed.kind === 'DRAW_THEN_DISCARD') {
    const scale = /for\s+each/i.test(sourceCard.effectText || '')
      ? evaluateScalingMultiplier(sourceCard.effectText || '', player, rival)
      : 1;
    const totalDraw = Math.max(0, parsed.amount * scale);
    const res = drawCardsWithDeckOutCheck(state, playerId, totalDraw);
    if (res.deckedOut) return res.state;
    let next = appendActionLog(
      res.state,
      player.displayName,
      `drew ${totalDraw} card${totalDraw === 1 ? '' : 's'} via ${sourceCard.name} (${sourceCard.id}).`,
      'EFFECT',
      sourceCard.name
    );
    next = setManeSpeechBubble(
      next,
      playerId,
      `${sourceCard.name}: I draw ${totalDraw} card${totalDraw === 1 ? '' : 's'}!`,
      'EFFECT'
    );
    return next;
  }

  if (parsed.kind === 'UNTAP_SCENES' && !parsed.requiresChoice) {
    let remainingToUntap = parsed.amount;
    const updatedScenes = player.sceneArea.map((sc) => {
      if (remainingToUntap > 0 && sc.isExhausted) {
        remainingToUntap -= 1;
        return { ...sc, isExhausted: false };
      }
      return sc;
    });
    let next = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          sceneArea: updatedScenes,
        },
      },
    };
    next = appendActionLog(
      next,
      player.displayName,
      `untapped ${parsed.amount} Scene card(s) via ${sourceCard.name} (${sourceCard.id}).`,
      'EFFECT',
      sourceCard.name
    );
    return setManeSpeechBubble(next, playerId, `I untap ${parsed.amount} Scene card!`, 'EFFECT');
  }

  if (parsed.kind === 'TREAT_FOR_YOU' && parsed.isGlobal) {
    const adv = player.adventureArea;
    const applyTreat = (slot: AdventureSlot): AdventureSlot =>
      slot.character && matchesFilter(slot.character, parsed.requiredNameFilter)
        ? { ...slot, treats: slot.treats + parsed.amount, hadTreat: true }
        : slot;

    const next = {
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
    };
    return appendActionLog(
      next,
      player.displayName,
      `placed ${parsed.amount} Treat on matching Characters via ${sourceCard.name} (${sourceCard.id}).`,
      'EFFECT',
      sourceCard.name
    );
  }

  if (parsed.kind === 'DELIVER_PRESENT' && parsed.isGlobal) {
    let deck = [...player.mainDeck];
    const adv = { ...player.adventureArea };

    for (const lane of ['left', 'center', 'right'] as const) {
      const slot = adv[lane];
      if (
        slot.character &&
        matchesFilter(slot.character, parsed.requiredNameFilter) &&
        deck.length > 0
      ) {
        const presentCard = deck.shift()!;
        adv[lane] = {
          ...slot,
          presents: [...slot.presents, presentCard],
          hadPresent: true,
        };
      }
    }

    const next = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          mainDeck: deck,
          adventureArea: adv,
        },
      },
    };
    return appendActionLog(
      next,
      player.displayName,
      `delivered Presents to matching Characters via ${sourceCard.name} (${sourceCard.id}).`,
      'EFFECT',
      sourceCard.name
    );
  }

  if (parsed.kind === 'GLOBAL_BUFF_FRIENDLY') {
    const scale = /for\s+each/i.test(sourceCard.effectText || '')
      ? evaluateScalingMultiplier(sourceCard.effectText || '', player, rival)
      : 1;
    const boost = Math.max(0, parsed.amount * scale);
    const adv = player.adventureArea;
    const applyBuff = (slot: AdventureSlot): AdventureSlot =>
      slot.character && matchesFilter(slot.character, parsed.requiredNameFilter)
        ? { ...slot, inspoBoost: slot.inspoBoost + boost }
        : slot;

    let next = {
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
    };
    next = appendActionLog(
      next,
      player.displayName,
      `granted +${boost} Inspiration to matching Characters via ${sourceCard.name} (${sourceCard.id}).`,
      'EFFECT',
      sourceCard.name
    );
    return setManeSpeechBubble(next, playerId, `Everyone gets +${boost} Inspiration!`, 'EFFECT');
  }

  if (parsed.kind === 'TARGET_BUFF_POWER' && parsed.isSelfOnly && sourceLane) {
    const slot = player.adventureArea[sourceLane];
    if (!slot.character) return state;
    const scale = /for\s+each/i.test(sourceCard.effectText || '')
      ? evaluateScalingMultiplier(sourceCard.effectText || '', player, rival)
      : 1;
    const boost = Math.max(0, parsed.amount * scale);
    let next = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          adventureArea: {
            ...player.adventureArea,
            [sourceLane]: {
              ...slot,
              inspoBoost: slot.inspoBoost + boost,
            },
          },
        },
      },
    };
    next = appendActionLog(
      next,
      player.displayName,
      `${slot.character.name} (${slot.character.id}) gained +${boost} Inspiration.`,
      'EFFECT',
      sourceCard.name
    );
    return setManeSpeechBubble(
      next,
      playerId,
      `${slot.character.name} gains +${boost} Inspiration!`,
      'EFFECT'
    );
  }

  return state;
}

function scheduleDelayedTrigger(
  state: KayouGameState,
  ownerId: '0' | '1',
  sourceCard: CardDefinition,
  sourceLane: LaneKey | undefined,
  timing: 'END_OF_YOUR_TURN' | 'END_OF_ANY_TURN',
  conditionText: string | undefined,
  innerEffectClause: string
): KayouGameState {
  const entry: DelayedTriggerEntry = {
    id: `trig-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ownerId,
    ownerName: state.players[ownerId].displayName,
    sourceCard,
    sourceLane,
    timing,
    conditionText,
    effectClause: innerEffectClause,
    createdTurn: state.turnNumber,
  };

  let workingState: KayouGameState = {
    ...state,
    delayedTriggers: [...(state.delayedTriggers || []), entry],
  };

  const fullDesc = `${timing === 'END_OF_YOUR_TURN' ? 'At the end of your turn' : 'At the end of turn'}: ${
    conditionText ? `If ${conditionText}, ` : ''
  }${innerEffectClause}`;

  workingState = appendActionLog(
    workingState,
    state.players[ownerId].displayName,
    `scheduled delayed trigger on ${sourceCard.name} (${sourceCard.id}): ${fullDesc}`,
    'EFFECT',
    sourceCard.name
  );

  workingState = setManeSpeechBubble(
    workingState,
    ownerId,
    `Queued "${sourceCard.name}" for End of Turn!`,
    'EFFECT'
  );

  workingState = appendDebugTrace(workingState, {
    actor: state.players[ownerId].displayName,
    card: sourceCard,
    triggerType: 'DELAYED_SCHEDULE',
    parsedKind: timing,
    targetsOrChoice: conditionText ? `Condition: ${conditionText}` : 'Unconditional',
    status: 'QUEUED_DELAYED',
    notes: fullDesc,
  });

  return setActionSpotlight(
    workingState,
    ownerId,
    'DELAYED_TRIGGER',
    `${sourceCard.name} — Trigger Queued!`,
    fullDesc,
    sourceCard,
    sourceLane,
    'QUEUED!'
  );
}

function enqueueEffectItem(
  state: KayouGameState,
  item: Omit<QueuedEffectItem, 'id'>
): KayouGameState {
  const entry: QueuedEffectItem = {
    ...item,
    id: `qef-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
  let next: KayouGameState = {
    ...state,
    effectResolutionQueue: [...(state.effectResolutionQueue || []), entry],
  };
  next = appendActionLog(
    next,
    state.players[item.ownerId].displayName,
    `*EFFECT* ${item.triggerType} queued on ${item.sourceCard.name} (${item.sourceCard.id}): ${item.effectClause}`,
    'EFFECT',
    item.sourceCard.name
  );
  return appendDebugTrace(next, {
    actor: state.players[item.ownerId].displayName,
    card: item.sourceCard,
    triggerType: item.triggerType,
    parsedKind: 'QUEUED_STACK',
    targetsOrChoice: 'Waiting for current animation/step',
    status: 'QUEUED_STACK',
    notes: item.effectClause,
  });
}

function drainEffectQueue(
  state: KayouGameState,
  fallbackResumeQueue?: LaneKey[] | null,
  fallbackEndTurnPlayer?: '0' | '1' | null
): KayouGameState {
  const queue = state.effectResolutionQueue || [];
  if (queue.length === 0) {
    if (fallbackEndTurnPlayer) {
      return endTurn(state, fallbackEndTurnPlayer);
    }
    if (fallbackResumeQueue && fallbackResumeQueue.length > 0) {
      return advanceToNextAttackLane(state, state.turnPlayerId, fallbackResumeQueue);
    }
    if (fallbackResumeQueue && fallbackResumeQueue.length === 0) {
      return endTurn(state, state.turnPlayerId);
    }
    return state;
  }

  const [head, ...rest] = queue;
  let workingState: KayouGameState = {
    ...state,
    effectResolutionQueue: rest,
  };

  const resumeQueue = head.resumeAttackQueue ?? fallbackResumeQueue ?? null;
  const resumeEndTurn = head.resumeEndTurnForPlayer ?? fallbackEndTurnPlayer ?? null;

  workingState = resolveSingleTriggeredClause(
    workingState,
    head.ownerId,
    head.sourceCard,
    head.sourceLane,
    head.triggerType,
    head.effectClause,
    resumeQueue,
    resumeEndTurn
  );

  if (
    workingState.phase === 'PENDING_HAND_CHOICE' ||
    workingState.phase === 'PENDING_TARGET' ||
    workingState.phase === 'GAME_OVER'
  ) {
    return workingState;
  }

  return drainEffectQueue(workingState, resumeQueue, resumeEndTurn);
}

function resolveSingleTriggeredClause(
  state: KayouGameState,
  playerId: '0' | '1',
  card: CardDefinition,
  lane: LaneKey | undefined,
  triggerType: QueuedEffectItem['triggerType'],
  subText: string,
  resumeQueue?: LaneKey[] | null,
  resumeEndTurn?: '0' | '1' | null
): KayouGameState {
  const actorName = state.players[playerId].displayName;

  const delayed = extractDelayedTiming(subText);
  if (delayed) {
    return scheduleDelayedTrigger(
      state,
      playerId,
      card,
      lane,
      delayed.timing,
      delayed.conditionText,
      delayed.innerEffectClause
    );
  }

  const condMatch = subText.match(/^if\s+([^,]+),/i);
  if (condMatch && !evaluateBoardCondition(state, playerId, condMatch[1])) {
    const skipped = appendActionLog(
      state,
      actorName,
      `*EFFECT* ${triggerType} (${card.name} • ${card.id}): condition not met (${condMatch[1]}).`,
      'EFFECT',
      card.name
    );
    return appendDebugTrace(skipped, {
      actor: actorName,
      card,
      triggerType,
      parsedKind: 'CONDITIONAL_GUARD',
      targetsOrChoice: condMatch[1],
      status: 'SKIPPED',
      notes: `Condition "${condMatch[1]}" evaluated false.`,
    });
  }

  const parsed = parseEffectClause(subText);
  if (!parsed || parsed.kind === 'NONE_PASSIVE') {
    return appendDebugTrace(state, {
      actor: actorName,
      card,
      triggerType,
      parsedKind: parsed?.kind || 'UNRECOGNIZED',
      targetsOrChoice: 'None',
      status: 'SKIPPED',
      notes: `Clause "${subText}" did not map to an executable action.`,
    });
  }

  let workingState = appendActionLog(
    state,
    actorName,
    `*EFFECT* ${triggerType} resolving on ${card.name} (${card.id}): ${subText}`,
    'EFFECT',
    card.name
  );

  workingState = setActionSpotlight(
    workingState,
    playerId,
    'TRIGGER_KEYWORD',
    `${card.name} — ${triggerType.toUpperCase()}!`,
    subText,
    card,
    lane,
    `${triggerType.toUpperCase()}!`
  );

  workingState = executeParsedImmediateEffect(workingState, playerId, card, parsed, lane);
  if (workingState.phase === 'GAME_OVER') return workingState;

  const handChoice = buildPendingHandChoiceFromParsed(
    workingState,
    playerId,
    card,
    parsed,
    resumeQueue,
    resumeEndTurn
  );
  if (handChoice) {
    const bubbleText =
      handChoice.choiceType === 'TOP_OR_BOTTOM_DECK'
        ? `${card.name}: Looking at top card of my Deck...`
        : handChoice.choiceType === 'CHOOSE_SCENE_TO_UNTAP'
        ? `${card.name}: Picking a Scene to untap...`
        : handChoice.choiceType === 'RECOVER_FROM_RETIREMENT'
        ? `${card.name}: Selecting a card from Retirement...`
        : `${card.name}: Making a selection...`;

    workingState = setManeSpeechBubble(workingState, playerId, bubbleText, 'CHOICE');
    workingState = appendDebugTrace(workingState, {
      actor: actorName,
      card,
      triggerType,
      parsedKind: parsed.kind,
      targetsOrChoice: `ChoiceType: ${handChoice.choiceType} (${handChoice.validIndices?.length || 0} valid options)`,
      status: 'AWAITING_INPUT',
      notes: handChoice.promptText,
    });

    return {
      ...workingState,
      phase: 'PENDING_HAND_CHOICE',
      pendingHandChoice: handChoice,
    };
  }

  const originMap: Record<QueuedEffectItem['triggerType'], PendingTargetSelection['sourceOrigin']> = {
    Appear: 'APPEAR_EFFECT',
    Farewell: 'FAREWELL_EFFECT',
    Adventure: 'ADVENTURE_TAP',
    'Pre-Plan': 'PRE_PLAN_EFFECT',
    StoryPromotion: 'STORY_PROMOTION',
    DelayedTrigger: 'DELAYED_TRIGGER',
  };

  const pending = buildPendingTargetFromParsed(
    workingState,
    playerId,
    card,
    parsed,
    originMap[triggerType],
    lane,
    resumeQueue,
    resumeEndTurn
  );
  if (pending) {
    workingState = setManeSpeechBubble(
      workingState,
      playerId,
      `${card.name}: Choosing a target...`,
      'CHOICE'
    );
    workingState = appendDebugTrace(workingState, {
      actor: actorName,
      card,
      triggerType,
      parsedKind: parsed.kind,
      targetsOrChoice: `Valid Targets: ${pending.validTargets.map((t) => `${t.owner}:${t.lane}`).join(', ')}`,
      status: 'AWAITING_INPUT',
      notes: pending.promptText,
    });

    return {
      ...workingState,
      phase: 'PENDING_TARGET',
      pendingTarget: pending,
    };
  } else if (parsed.requiresChoice) {
    workingState = appendActionLog(
      workingState,
      actorName,
      `*EFFECT* ${triggerType} (${card.name} • ${card.id}): no valid target available (${subText}).`,
      'EFFECT',
      card.name
    );
    workingState = setManeSpeechBubble(
      workingState,
      playerId,
      `${card.name}: No valid target available.`,
      'WARNING'
    );
    workingState = appendDebugTrace(workingState, {
      actor: actorName,
      card,
      triggerType,
      parsedKind: parsed.kind,
      targetsOrChoice: '0 valid targets found',
      status: 'SKIPPED',
      notes: `No eligible target in play/retirement for "${subText}".`,
    });
    return workingState;
  }

  return appendDebugTrace(workingState, {
    actor: actorName,
    card,
    triggerType,
    parsedKind: parsed.kind,
    targetsOrChoice: 'Automatic / No Target Needed',
    status: 'RESOLVED',
    notes: subText,
  });
}

function executeAppearOrFarewellEffect(
  state: KayouGameState,
  playerId: '0' | '1',
  card: CardDefinition,
  lane: LaneKey,
  type: 'Appear' | 'Farewell',
  deferToQueue = false
): KayouGameState {
  const subText = extractTriggerClause(card.effectText, type);
  if (!subText) return state;

  const clauses = splitCompoundClauses(subText);
  if (clauses.length === 0) return state;

  if (deferToQueue) {
    let working = state;
    for (const cl of clauses) {
      working = enqueueEffectItem(working, {
        ownerId: playerId,
        sourceCard: card,
        sourceLane: lane,
        triggerType: type,
        effectClause: cl,
      });
    }
    return working;
  }

  let working = state;
  for (let i = 1; i < clauses.length; i++) {
    working = enqueueEffectItem(working, {
      ownerId: playerId,
      sourceCard: card,
      sourceLane: lane,
      triggerType: type,
      effectClause: clauses[i],
    });
  }
  working = resolveSingleTriggeredClause(working, playerId, card, lane, type, clauses[0]);
  if (working.phase === 'MAIN_PHASE') {
    return drainEffectQueue(working);
  }
  return working;
}

function retireCharacterWithFarewell(
  state: KayouGameState,
  playerId: '0' | '1',
  lane: LaneKey,
  deferToQueue = false,
  inContact = false
): KayouGameState {
  const player = state.players[playerId];
  const slot = player.adventureArea[lane];
  if (!slot.character) return state;

  // Replacement Shield check (e.g., Soda / Funny Glasses / Pinkie's Tent / Rarity's Tent)
  const shieldItemIdx = slot.items.findIndex((it) => {
    const t = sanitizeCardText(it.effectText);
    if (
      inContact &&
      /when\s+adorned\s+character\s+retires\s+in\s+contact,\s*move\s+this\s+item\s+to\s+retirement\s+area\s+instead/i.test(
        t
      )
    ) {
      return true;
    }
    return /(?:when|if)\s+adorned\s+character\s+(?:would\s+)?retires?,\s*move\s+this\s+item\s+to\s+(?:your\s+)?retirement\s+area.*instead/i.test(
      t
    );
  });

  if (shieldItemIdx !== -1) {
    const sacrificedItem = slot.items[shieldItemIdx];
    const remainingItems = slot.items.filter((_, idx) => idx !== shieldItemIdx);
    const savedState: KayouGameState = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          retirement: [...player.retirement, sacrificedItem],
          adventureArea: {
            ...player.adventureArea,
            [lane]: {
              ...slot,
              items: remainingItems,
            },
          },
        },
      },
    };
    return appendActionLog(
      savedState,
      player.displayName,
      `${sacrificedItem.name} (${sacrificedItem.id}) moved to Retirement Area instead of retiring ${slot.character.name}!`,
      'EFFECT',
      sacrificedItem.name
    );
  }

  const retiringChar = slot.character;
  const retiringItems = [...slot.items];
  const retiringPresents = [...slot.presents];

  let workingState: KayouGameState = {
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
  };

  workingState = triggerCardFlight(workingState, playerId, 'RETIRE', 1, retiringChar.name);
  workingState = appendActionLog(
    workingState,
    player.displayName,
    `${retiringChar.name} (${retiringChar.id}) in ${lane.toUpperCase()} lane was defeated/retired to Retirement Area.`,
    'PLAY',
    retiringChar.name
  );

  workingState = executeAppearOrFarewellEffect(
    workingState,
    playerId,
    retiringChar,
    lane,
    'Farewell',
    deferToQueue
  );
  return workingState;
}

export function playCardFromHand(
  state: KayouGameState,
  playerId: '0' | '1',
  cardId: string,
  targetLane?: LaneKey
): KayouGameState {
  if (state.phase !== 'MAIN_PHASE' || state.turnPlayerId !== playerId) return state;

  const oppId: '0' | '1' = playerId === '0' ? '1' : '0';
  const player = state.players[playerId];
  const rival = state.players[oppId];
  const cardIdx = player.hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) return state;

  const card = player.hand[cardIdx];

  if (!canPayHarmonyCost(player, card, rival)) return state;
  const restriction = canPlayCardRestrictions(state, playerId, card, targetLane);
  if (!restriction.allowed) {
    const blocked = appendActionLog(
      state,
      player.displayName,
      `cannot play ${card.name} (${card.id}): ${restriction.reason}.`,
      'SYSTEM',
      card.name
    );
    return setManeSpeechBubble(
      blocked,
      playerId,
      `Can't play ${card.name}: ${restriction.reason}`,
      'WARNING'
    );
  }

  const effectiveCost = getEffectiveCardCost(player, card, rival);
  const normalizedType = String(card.type || '').toLowerCase();

  // Consume nextCardCostDiscount if it applied to this card
  let nextDiscount = player.nextCardCostDiscount || null;
  if (nextDiscount) {
    const typeMatches =
      !nextDiscount.cardType || normalizedType.includes(nextDiscount.cardType.toLowerCase());
    const nameMatches = !nextDiscount.filter || matchesCardKeywordExact(card, nextDiscount.filter);
    if (typeMatches && nameMatches) nextDiscount = null;
  }

  if (normalizedType.includes('character')) {
    const lane: LaneKey = targetLane || 'left';
    if (player.adventureArea[lane].character !== null) return state;

    const newHand = [...player.hand];
    newHand.splice(cardIdx, 1);

    const updatedSceneArea = exhaustScenesWithElementPriority(
      player.sceneArea,
      card,
      effectiveCost
    );

    const updatedAdv = {
      ...player.adventureArea,
      [lane]: {
        ...createEmptySlot(),
        character: card,
      },
    };

    let workingState: KayouGameState = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          hand: newHand,
          sceneArea: updatedSceneArea,
          adventureArea: updatedAdv,
          nextCardCostDiscount: nextDiscount,
        },
      },
    };

    workingState = appendActionLog(
      workingState,
      player.displayName,
      `played ${card.name} (${card.id}) to ${lane.toUpperCase()} lane (Cost: ${effectiveCost} Force of Harmony).`,
      'PLAY',
      card.name
    );

    workingState = setManeSpeechBubble(
      workingState,
      playerId,
      `I summon ${card.name} to the ${lane.toUpperCase()} lane!`,
      'INFO'
    );

    workingState = setActionSpotlight(
      workingState,
      playerId,
      'PLAY_CHARACTER',
      `${player.displayName} played ${card.name}`,
      `Placed in ${lane.toUpperCase()} Adventure Lane`,
      card,
      lane,
      'SUMMON!'
    );

    if (!/Appear\s*:/i.test(sanitizeCardText(card.effectText))) {
      workingState = appendDebugTrace(workingState, {
        actor: player.displayName,
        card,
        triggerType: 'PLAY_CHARACTER',
        parsedKind: 'NONE_PASSIVE',
        targetsOrChoice: `Lane: ${lane.toUpperCase()}`,
        status: 'RESOLVED',
        notes: 'Character deployed; no Appear trigger.',
      });
    }

    workingState = executeAppearOrFarewellEffect(workingState, playerId, card, lane, 'Appear', false);
    return workingState;
  }

  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  const updatedSceneArea = exhaustScenesWithElementPriority(
    player.sceneArea,
    card,
    effectiveCost
  );

  if (normalizedType === 'item') {
    const lane: LaneKey = targetLane || 'left';
    const currentSlot = player.adventureArea[lane];
    if (!currentSlot.character) return state;

    const replacedItems = currentSlot.items.length > 0 ? [...currentSlot.items] : [];

    let nextState: KayouGameState = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          hand: newHand,
          sceneArea: updatedSceneArea,
          nextCardCostDiscount: nextDiscount,
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
    };

    nextState = appendActionLog(
      nextState,
      player.displayName,
      `adorned ${currentSlot.character.name} (${currentSlot.character.id}) with Item ${card.name} (${card.id}) (Cost: ${effectiveCost}).`,
      'PLAY',
      card.name
    );

    nextState = setManeSpeechBubble(
      nextState,
      playerId,
      `I adorn ${currentSlot.character.name} with ${card.name}!`,
      'INFO'
    );

    nextState = appendDebugTrace(nextState, {
      actor: player.displayName,
      card,
      triggerType: 'ADORN_ITEM',
      parsedKind: 'EQUIP_ITEM',
      targetsOrChoice: `${currentSlot.character.name} (${lane.toUpperCase()} lane)`,
      status: 'RESOLVED',
      notes: `Adorned Item onto ${currentSlot.character.name}.`,
    });

    return setActionSpotlight(
      nextState,
      playerId,
      'ADORN_ITEM',
      `${player.displayName} adorned ${card.name}`,
      `Equipped onto ${currentSlot.character.name} (${lane.toUpperCase()} Lane)`,
      card,
      lane,
      'ADORN!'
    );
  }

  // Event card — supports compound multi-sentence clauses
  let nextState: KayouGameState = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        hand: newHand,
        sceneArea: updatedSceneArea,
        nextCardCostDiscount: nextDiscount,
        retirement: [...player.retirement, card],
      },
    },
  };

  nextState = appendActionLog(
    nextState,
    player.displayName,
    `played Event ${card.name} (${card.id}) (Cost: ${effectiveCost} Force of Harmony).`,
    'PLAY',
    card.name
  );

  nextState = setManeSpeechBubble(nextState, playerId, `I cast Event: ${card.name}!`, 'EFFECT');

  nextState = setActionSpotlight(
    nextState,
    playerId,
    'PLAY_EVENT',
    `${player.displayName} played Event: ${card.name}`,
    sanitizeCardText(card.effectText) || 'Event activated',
    card,
    undefined,
    'EVENT!'
  );

  const clauses = splitCompoundClauses(card.effectText);
  if (clauses.length === 0) return nextState;

  for (let i = 1; i < clauses.length; i++) {
    nextState = enqueueEffectItem(nextState, {
      ownerId: playerId,
      sourceCard: card,
      triggerType: 'Adventure',
      effectClause: clauses[i],
    });
  }

  nextState = resolveSingleTriggeredClause(nextState, playerId, card, targetLane, 'Adventure', clauses[0]);
  if (nextState.phase === 'MAIN_PHASE') {
    return drainEffectQueue(nextState);
  }
  return nextState;
}

export function resolveHandChoice(
  state: KayouGameState,
  playerId: '0' | '1',
  selectedIndices: number[]
): KayouGameState {
  if (state.phase !== 'PENDING_HAND_CHOICE' || !state.pendingHandChoice) return state;
  if (state.pendingHandChoice.playerId !== playerId && state.turnPlayerId !== playerId) return state;

  const choice = state.pendingHandChoice;
  const actingPlayerId = choice.playerId || playerId;
  const oppId: '0' | '1' = actingPlayerId === '0' ? '1' : '0';
  const player = state.players[actingPlayerId];
  const rival = state.players[oppId];
  const uniqueIndices = Array.from(new Set(selectedIndices)).filter(
    (idx) => idx >= 0 && idx < choice.candidateCards.length
  );

  if (uniqueIndices.length === 0) return state;

  let workingState = { ...state };
  const resumeQueue = choice.resumeAttackQueue;
  const resumeEndTurn = choice.resumeEndTurnForPlayer;

  if (choice.choiceType === 'MOVE_HAND_TO_PLAN') {
    const chosenIdx = uniqueIndices[0];
    const chosenCard = player.hand[chosenIdx];
    const nextHand = player.hand.filter((_, i) => i !== chosenIdx);
    const emptyPlanIdx = player.storyStages.findIndex((s) => s.planCard === null && !s.isStoryCompleted);
    if (!chosenCard || emptyPlanIdx === -1) {
      return { ...state, phase: 'MAIN_PHASE', pendingHandChoice: null };
    }
    const updatedStages = player.storyStages.map((s, idx) =>
      idx === emptyPlanIdx ? { ...s, planCard: chosenCard, isPlanRevealed: false } : s
    );
    workingState = appendActionLog(
      {
        ...workingState,
        phase: 'MAIN_PHASE',
        pendingHandChoice: null,
        players: {
          ...workingState.players,
          [actingPlayerId]: { ...player, hand: nextHand, storyStages: updatedStages },
        },
      },
      player.displayName,
      `placed a card from Hand face-down as a Plan in Story Area via ${choice.sourceCard.name}.`,
      'EFFECT',
      choice.sourceCard.name
    );
  } else if (choice.choiceType === 'REVIVE_FROM_RETIREMENT') {
    const chosenIdx = uniqueIndices[0];
    const chosenCard = player.retirement[chosenIdx];
    const emptyLane = (['left', 'center', 'right'] as LaneKey[]).find(
      (l) => player.adventureArea[l].character === null
    );
    if (!chosenCard || !emptyLane) {
      return { ...state, phase: 'MAIN_PHASE', pendingHandChoice: null };
    }
    const nextRetirement = player.retirement.filter((_, i) => i !== chosenIdx);
    workingState = appendActionLog(
      {
        ...workingState,
        phase: 'MAIN_PHASE',
        pendingHandChoice: null,
        players: {
          ...workingState.players,
          [actingPlayerId]: {
            ...player,
            retirement: nextRetirement,
            adventureArea: {
              ...player.adventureArea,
              [emptyLane]: { ...createEmptySlot(), character: chosenCard },
            },
          },
        },
      },
      player.displayName,
      `deployed ${chosenCard.name} (${chosenCard.id}) from Retirement Area to ${emptyLane.toUpperCase()} lane!`,
      'EFFECT',
      choice.sourceCard.name
    );
    workingState = executeAppearOrFarewellEffect(workingState, actingPlayerId, chosenCard, emptyLane, 'Appear', true);
  } else if (choice.choiceType === 'CHOOSE_SCENE_TO_FLIP_UP') {
    const selectedSet = new Set(uniqueIndices);
    const updatedScenes = player.sceneArea.map((sc, idx) =>
      selectedSet.has(idx) ? { ...sc, isFaceUp: true, isExhausted: false } : sc
    );
    workingState = appendActionLog(
      {
        ...workingState,
        phase: 'MAIN_PHASE',
        pendingHandChoice: null,
        players: {
          ...workingState.players,
          [actingPlayerId]: { ...player, sceneArea: updatedScenes },
        },
      },
      player.displayName,
      `turned ${uniqueIndices.length} face-down Scene(s) face-up via ${choice.sourceCard.name}.`,
      'EFFECT',
      choice.sourceCard.name
    );
  } else if (choice.choiceType === 'CHOOSE_SCENE_TO_FLIP_DOWN') {
    const selectedSet = new Set(uniqueIndices);
    const updatedScenes = player.sceneArea.map((sc, idx) =>
      selectedSet.has(idx) ? { ...sc, isFaceUp: false } : sc
    );
    workingState = appendActionLog(
      {
        ...workingState,
        phase: 'MAIN_PHASE',
        pendingHandChoice: null,
        players: {
          ...workingState.players,
          [actingPlayerId]: { ...player, sceneArea: updatedScenes },
        },
      },
      player.displayName,
      `turned ${uniqueIndices.length} face-up Scene(s) face-down via ${choice.sourceCard.name}.`,
      'EFFECT',
      choice.sourceCard.name
    );
  } else if (choice.choiceType === 'CHOOSE_RIVAL_SCENE_TO_FLIP_DOWN') {
    const selectedSet = new Set(uniqueIndices);
    const updatedRivalScenes = rival.sceneArea.map((sc, idx) =>
      selectedSet.has(idx) ? { ...sc, isFaceUp: false } : sc
    );
    workingState = appendActionLog(
      {
        ...workingState,
        phase: 'MAIN_PHASE',
        pendingHandChoice: null,
        players: {
          ...workingState.players,
          [oppId]: { ...rival, sceneArea: updatedRivalScenes },
        },
      },
      player.displayName,
      `turned ${uniqueIndices.length} of Rival's face-up Scene(s) face-down via ${choice.sourceCard.name}.`,
      'EFFECT',
      choice.sourceCard.name
    );
  } else if (choice.choiceType === 'TOP_OR_BOTTOM_DECK') {
    const putOnBottom = selectedIndices[0] === 1;
    const topCard = player.mainDeck[0];
    const restDeck = player.mainDeck.slice(1);
    const nextDeck = topCard
      ? putOnBottom
        ? [...restDeck, topCard]
        : [topCard, ...restDeck]
      : player.mainDeck;

    workingState = {
      ...workingState,
      phase: 'MAIN_PHASE',
      pendingHandChoice: null,
      players: {
        ...workingState.players,
        [actingPlayerId]: {
          ...player,
          mainDeck: nextDeck,
        },
      },
    };

    const destLabel = putOnBottom ? 'BOTTOM' : 'TOP';
    workingState = appendActionLog(
      workingState,
      player.displayName,
      `looked at top card (${topCard?.name} • ${topCard?.id}) via ${choice.sourceCard.name} and placed it on the ${destLabel} of Main Deck.`,
      'EFFECT',
      choice.sourceCard.name
    );
  } else if (choice.choiceType === 'CHOOSE_SCENE_TO_UNTAP') {
    const selectedSet = new Set(uniqueIndices);
    const untappedNames: string[] = [];
    const updatedScenes = player.sceneArea.map((sc, idx) => {
      if (selectedSet.has(idx) && sc.isExhausted) {
        untappedNames.push(`${sc.card.name} (${sc.card.id})`);
        return { ...sc, isExhausted: false };
      }
      return sc;
    });

    workingState = appendActionLog(
      {
        ...workingState,
        phase: 'MAIN_PHASE',
        pendingHandChoice: null,
        players: {
          ...workingState.players,
          [actingPlayerId]: {
            ...player,
            sceneArea: updatedScenes,
          },
        },
      },
      player.displayName,
      `selected and untapped ${untappedNames.join(', ')} via ${choice.sourceCard.name}.`,
      'EFFECT',
      choice.sourceCard.name
    );
  } else if (
    choice.choiceType === 'DISCARD_FROM_HAND' ||
    choice.choiceType === 'DISCARD_THEN_DRAW' ||
    choice.choiceType === 'END_PHASE_HAND_LIMIT'
  ) {
    const selectedSet = new Set(uniqueIndices);
    const discardedCards = player.hand.filter((_, idx) => selectedSet.has(idx));
    const remainingHand = player.hand.filter((_, idx) => !selectedSet.has(idx));

    workingState = {
      ...workingState,
      phase: 'MAIN_PHASE',
      pendingHandChoice: null,
      players: {
        ...workingState.players,
        [actingPlayerId]: {
          ...player,
          hand: remainingHand,
          retirement: [...player.retirement, ...discardedCards],
        },
      },
    };

    const cardDesc = discardedCards.map((c) => `${c.name} (${c.id})`).join(', ');
    workingState = triggerCardFlight(
      workingState,
      actingPlayerId,
      'DISCARD',
      discardedCards.length,
      discardedCards[0]?.name
    );
    workingState = appendActionLog(
      workingState,
      player.displayName,
      choice.choiceType === 'END_PHASE_HAND_LIMIT'
        ? `discarded ${cardDesc} to meet the 10-card End Phase hand limit.`
        : `selected and discarded ${cardDesc} to Retirement Area.`,
      'EFFECT',
      choice.sourceCard.name
    );

    if (choice.choiceType === 'DISCARD_THEN_DRAW' && choice.secondaryDrawCount) {
      const drawRes = drawCardsWithDeckOutCheck(
        workingState,
        actingPlayerId,
        choice.secondaryDrawCount
      );
      workingState = drawRes.state;
      if (workingState.phase === 'GAME_OVER') return workingState;
      workingState = appendActionLog(
        workingState,
        player.displayName,
        `drew ${choice.secondaryDrawCount} card(s) after discarding.`,
        'EFFECT',
        choice.sourceCard.name
      );
    }
  } else if (choice.choiceType === 'RECOVER_FROM_RETIREMENT') {
    const chosenIdx = uniqueIndices[0];
    const chosenCard = player.retirement[chosenIdx];
    if (!chosenCard) {
      return { ...state, phase: 'MAIN_PHASE', pendingHandChoice: null };
    }
    const nextRetirement = [...player.retirement];
    nextRetirement.splice(chosenIdx, 1);

    workingState = appendActionLog(
      {
        ...workingState,
        phase: 'MAIN_PHASE',
        pendingHandChoice: null,
        players: {
          ...workingState.players,
          [actingPlayerId]: {
            ...player,
            retirement: nextRetirement,
            hand: [...player.hand, chosenCard],
          },
        },
      },
      player.displayName,
      `recovered ${chosenCard.name} (${chosenCard.id}) from Retirement Area to Hand.`,
      'EFFECT',
      choice.sourceCard.name
    );
  } else if (choice.choiceType === 'PICK_REVEALED_TO_HAND') {
    const chosenCard = choice.candidateCards[uniqueIndices[0]];
    const revealedCount = choice.candidateCards.length;
    const remainingDeck = player.mainDeck.slice(revealedCount);
    const unpicked = choice.candidateCards.filter((_, idx) => idx !== uniqueIndices[0]);

    workingState = appendActionLog(
      {
        ...workingState,
        phase: 'MAIN_PHASE',
        pendingHandChoice: null,
        players: {
          ...workingState.players,
          [actingPlayerId]: {
            ...player,
            mainDeck: [...remainingDeck, ...unpicked],
            hand: [...player.hand, chosenCard],
          },
        },
      },
      player.displayName,
      `revealed top ${revealedCount} cards and added ${chosenCard.name} (${chosenCard.id}) to Hand.`,
      'EFFECT',
      choice.sourceCard.name
    );
  }

  return drainEffectQueue(workingState, resumeQueue, resumeEndTurn);
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
  const resumeQueue = pending.resumeAttackQueue;
  const resumeEndTurn = pending.resumeEndTurnForPlayer;

  const finishAndResume = (nextState: KayouGameState): KayouGameState => {
    return drainEffectQueue(nextState, resumeQueue, resumeEndTurn);
  };

  if (pending.effectAction === 'BUFF_TWO_TARGETS' && targetOwner === 'SELF') {
    const me = state.players[playerId];
    const slot = me.adventureArea[targetLane];
    if (!slot.character) return state;

    const buffedState: KayouGameState = {
      ...state,
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

    let logged = appendActionLog(
      buffedState,
      me.displayName,
      `granted +${pending.value} Inspiration to ${slot.character.name} (${slot.character.id}) in ${targetLane.toUpperCase()} lane.`,
      'EFFECT',
      pending.sourceCard.name
    );

    if (!pending.selectedFromLane && pending.secondaryNameFilter) {
      const secondTargets = (['left', 'center', 'right'] as LaneKey[])
        .filter((l) => {
          const c = logged.players[playerId].adventureArea[l].character;
          return c !== null && matchesFilter(c, pending.secondaryNameFilter);
        })
        .map((l) => ({ owner: 'SELF' as const, lane: l }));

      if (secondTargets.length > 0) {
        return {
          ...logged,
          phase: 'PENDING_TARGET',
          pendingTarget: {
            ...pending,
            selectedFromLane: targetLane,
            promptText: `${pending.sourceCard.name}: Select 「${pending.secondaryNameFilter}」 to grant +${pending.value} Inspiration (2 of 2):`,
            validTargets: secondTargets,
          },
        };
      }
    }

    return finishAndResume({
      ...logged,
      phase: 'MAIN_PHASE',
      pendingTarget: null,
    });
  }

  if (pending.effectAction === 'REMOVE_TREAT' && targetOwner === 'SELF') {
    const me = state.players[playerId];
    const slot = me.adventureArea[targetLane];
    if (!slot.character || slot.treats <= 0) return state;

    let next: KayouGameState = {
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
              treats: Math.max(0, slot.treats - 1),
            },
          },
        },
      },
    };
    next = appendActionLog(
      next,
      me.displayName,
      `removed 1 Treat from ${slot.character.name} (${slot.character.id}).`,
      'EFFECT',
      pending.sourceCard.name
    );
    next = triggerOnTreatChanged(next, playerId, targetLane, 'REMOVED');
    return finishAndResume(next);
  }

  if (pending.effectAction === 'PREVENT_RETIRE_IN_CONTACT' && targetOwner === 'SELF') {
    const me = state.players[playerId];
    const slot = me.adventureArea[targetLane];
    if (!slot.character) return state;

    const next = appendActionLog(
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
                preventRetireInContact: true,
              },
            },
          },
        },
      },
      me.displayName,
      `protected ${slot.character.name} (${slot.character.id}) in ${targetLane.toUpperCase()} lane from retiring in Contact!`,
      'EFFECT',
      pending.sourceCard.name
    );
    return finishAndResume(next);
  }

  if (pending.effectAction === 'MOVE_FRIENDLY' && !pending.selectedFromLane) {
    if (targetOwner !== 'SELF' || !state.players[playerId].adventureArea[targetLane].character)
      return state;
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

    const next = appendActionLog(
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
      `moved ${fromSlot.character?.name || 'Character'} from ${fromLane.toUpperCase()} to ${toLane.toUpperCase()} lane.`,
      'EFFECT',
      pending.sourceCard.name
    );
    return finishAndResume(next);
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

    const next = appendActionLog(
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
      `switched positions of Characters in ${laneA.toUpperCase()} and ${laneB.toUpperCase()} lanes.`,
      'EFFECT',
      pending.sourceCard.name
    );
    return finishAndResume(next);
  }

  if (pending.effectAction === 'BUFF_POWER' && targetOwner === 'SELF') {
    const me = state.players[playerId];
    const slot = me.adventureArea[targetLane];
    if (!slot.character) return state;

    const scale = /for\s+each/i.test(pending.sourceCard.effectText || '')
      ? evaluateScalingMultiplier(pending.sourceCard.effectText || '', me, state.players[oppId])
      : 1;
    const boost = Math.max(0, pending.value * scale);

    const next = appendActionLog(
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
                inspoBoost: slot.inspoBoost + boost,
              },
            },
          },
        },
      },
      me.displayName,
      `granted +${boost} Inspiration to ${slot.character.name} (${slot.character.id}) in ${targetLane.toUpperCase()} lane.`,
      'EFFECT',
      pending.sourceCard.name
    );
    return finishAndResume(next);
  }

  if (pending.effectAction === 'DEBUFF_OPPONENT' && targetOwner === 'OPPONENT') {
    const opp = state.players[oppId];
    const slot = opp.adventureArea[targetLane];
    if (!slot.character) return state;

    const next = appendActionLog(
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
      `applied -${pending.value} Inspiration to rival's ${slot.character.name} (${slot.character.id}).`,
      'EFFECT',
      pending.sourceCard.name
    );
    return finishAndResume(next);
  }

  if (pending.effectAction === 'TREAT_CHARACTER') {
    const targetPlayer = state.players[targetPlayerId];
    const slot = targetPlayer.adventureArea[targetLane];
    if (!slot.character) return state;

    let next = appendActionLog(
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
      `placed ${pending.value} Treat on ${slot.character.name} (${slot.character.id}).`,
      'EFFECT',
      pending.sourceCard.name
    );
    next = triggerOnTreatChanged(next, targetPlayerId, targetLane, 'PLACED');
    return finishAndResume(next);
  }

  if (pending.effectAction === 'DELIVER_PRESENT') {
    const me = state.players[playerId];
    if (me.mainDeck.length === 0) {
      return finishAndResume({ ...state, phase: 'MAIN_PHASE', pendingTarget: null });
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
      return finishAndResume({ ...stateAfterDeck, phase: 'MAIN_PHASE', pendingTarget: null });
    }

    const next = appendActionLog(
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
      `delivered a Present to ${slot.character.name} (${slot.character.id}).`,
      'EFFECT',
      pending.sourceCard.name
    );
    return finishAndResume(next);
  }

  if (pending.effectAction === 'UNWRAP_PRESENT') {
    const targetPlayer = state.players[targetPlayerId];
    const slot = targetPlayer.adventureArea[targetLane];
    if (!slot.character || slot.presents.length === 0) {
      return finishAndResume({ ...state, phase: 'MAIN_PHASE', pendingTarget: null });
    }

    const unwrappedCard = slot.presents[0];
    const remainingPresents = slot.presents.slice(1);

    let updatedState: KayouGameState = {
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
    };

    updatedState = appendActionLog(
      updatedState,
      state.players[playerId].displayName,
      `unwrapped a Present on ${slot.character.name} (${slot.character.id})!`,
      'EFFECT',
      pending.sourceCard.name
    );

    updatedState = triggerOnPresentUnwrapped(updatedState, targetPlayerId);
    return finishAndResume(updatedState);
  }

  if (pending.effectAction === 'READY_FRIENDLY' && targetOwner === 'SELF') {
    const me = state.players[playerId];
    const slot = me.adventureArea[targetLane];
    if (!slot.character) return state;

    const next = appendActionLog(
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
      `readied (untapped) ${slot.character.name} (${slot.character.id}).`,
      'EFFECT',
      pending.sourceCard.name
    );
    return finishAndResume(next);
  }

  if (pending.effectAction === 'RETIRE_OPPONENT' && targetOwner === 'OPPONENT') {
    const workingState = retireCharacterWithFarewell(state, oppId, targetLane, false, false);
    return finishAndResume({
      ...workingState,
      phase: 'MAIN_PHASE',
      pendingTarget: null,
    });
  }

  return finishAndResume({
    ...state,
    phase: 'MAIN_PHASE',
    pendingTarget: null,
  });
}

export function cancelTargetSelection(state: KayouGameState, playerId: '0' | '1'): KayouGameState {
  if (state.phase !== 'PENDING_TARGET' || state.turnPlayerId !== playerId) return state;
  const resumeQueue = state.pendingTarget?.resumeAttackQueue;
  const resumeEndTurn = state.pendingTarget?.resumeEndTurnForPlayer;
  const cleared: KayouGameState = {
    ...state,
    phase: 'MAIN_PHASE',
    pendingTarget: null,
  };
  return drainEffectQueue(cleared, resumeQueue, resumeEndTurn);
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

  const charText = sanitizeCardText(slot.character.effectText);
  let sourceCard = slot.character;
  let advClause = /Adventure\s*:/i.test(charText)
    ? extractTriggerClause(charText, 'Adventure') || charText
    : null;

  // Support Item-granted Adventure abilities (e.g., Today's Homework, Recorder, Candy Bag)
  if (!advClause || parseEffectClause(advClause)?.kind === 'NONE_PASSIVE') {
    const itemGranted = extractItemGrantedAdventureClause(slot);
    if (itemGranted) {
      sourceCard = itemGranted.sourceCard;
      advClause = itemGranted.clause;
    }
  }

  if (!advClause || isReactiveAdventureClause(advClause)) return state;
  const parsed = parseEffectClause(advClause);
  if (!parsed || parsed.kind === 'NONE_PASSIVE') return state;

  let workingState: KayouGameState = {
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

  workingState = appendActionLog(
    workingState,
    player.displayName,
    `activated Adventure ability of ${sourceCard.name} (${sourceCard.id}) in ${lane.toUpperCase()} lane.`,
    'EFFECT',
    sourceCard.name
  );

  const clauses = splitCompoundClauses(advClause);
  for (let i = 1; i < clauses.length; i++) {
    workingState = enqueueEffectItem(workingState, {
      ownerId: playerId,
      sourceCard,
      sourceLane: lane,
      triggerType: 'Adventure',
      effectClause: clauses[i],
    });
  }

  workingState = resolveSingleTriggeredClause(
    workingState,
    playerId,
    sourceCard,
    lane,
    'Adventure',
    clauses[0] || advClause
  );
  if (workingState.phase === 'MAIN_PHASE') {
    return drainEffectQueue(workingState);
  }
  return workingState;
}

export function activateManeLeaderAbility(
  state: KayouGameState,
  playerId: '0' | '1'
): KayouGameState {
  if (state.phase !== 'MAIN_PHASE' || state.turnPlayerId !== playerId) return state;
  const player = state.players[playerId];
  if (!player.leader || player.leaderAbilityUsedThisTurn) return state;

  const text = sanitizeCardText(player.leader.effectText);
  if (!/Main Character Ability|Mane Ability|Once per turn|Activate\s*:/i.test(text)) return state;

  let workingState: KayouGameState = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        leaderAbilityUsedThisTurn: true,
      },
    },
  };

  workingState = appendActionLog(
    workingState,
    player.displayName,
    `activated Main Character ability of ${player.leader.name} (${player.leader.id}).`,
    'EFFECT',
    player.leader.name
  );

  const parsed = parseActivatedCardEffect(player.leader);
  workingState = executeParsedImmediateEffect(workingState, playerId, player.leader, parsed);
  if (workingState.phase === 'GAME_OVER') return workingState;

  const handChoice = buildPendingHandChoiceFromParsed(workingState, playerId, player.leader, parsed);
  if (handChoice) {
    return { ...workingState, phase: 'PENDING_HAND_CHOICE', pendingHandChoice: handChoice };
  }

  const pending = buildPendingTargetFromParsed(
    workingState,
    playerId,
    player.leader,
    parsed,
    'MANE_ABILITY'
  );
  if (pending) {
    return { ...workingState, phase: 'PENDING_TARGET', pendingTarget: pending };
  }

  return workingState;
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
    if (!matchesCardKeywordExact(targetCharacter, charBracketMatch[1])) {
      return {
        eligible: false,
        boostAmount: 0,
        reason: `Only boosts 「${charBracketMatch[1].trim()}」`,
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
        return { eligible: false, boostAmount: 0, reason: `Only boosts ${pony}` };
      }
    }
  }

  const elements = ['magic', 'loyalty', 'honesty', 'generosity', 'kindness', 'laughter'];
  for (const el of elements) {
    const elRegex = new RegExp(`your\\s+${el}\\s+character`, 'i');
    if (elRegex.test(text) && String(targetCharacter.element || '').toLowerCase() !== el) {
      return { eligible: false, boostAmount: 0, reason: `Only boosts ${el.toUpperCase()} characters` };
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

  const orderedLanes: LaneKey[] = ['left', 'center', 'right'];
  const activeAttackLanes = orderedLanes.filter(
    (l) =>
      attacker.adventureArea[l].character !== null &&
      !attacker.actedLanesThisTurn.includes(l)
  );

  if (activeAttackLanes.length === 0) {
    return endTurn(state, playerId);
  }

  let loggedState = appendActionLog(
    state,
    attacker.displayName,
    `entered Contact Phase (Left → Right): ${activeAttackLanes.map((l) => l.toUpperCase()).join(' → ')}.`,
    'CLASH'
  );

  loggedState = setManeSpeechBubble(loggedState, playerId, 'Entering Contact Phase!', 'INFO');

  return advanceToNextAttackLane(loggedState, playerId, activeAttackLanes);
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

  let updatedState: KayouGameState = {
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

  updatedState = appendActionLog(
    updatedState,
    player.displayName,
    `used Inspiration Boost (${sceneItem.card.name} • ${sceneItem.card.id}) for +${check.boostAmount} Inspiration in ${lane.toUpperCase()} lane.`,
    'CLASH',
    sceneItem.card.name
  );

  const attackerId = state.turnPlayerId;
  const defenderId: '0' | '1' = attackerId === '0' ? '1' : '0';

  return {
    ...updatedState,
    contactState: {
      ...state.contactState,
      promptPlayerId: playerId,
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

  let workingState = appendActionLog(
    state,
    atkPlayer.displayName,
    `${lane.toUpperCase()} Lane Contact: ${atkSlot.character.name} (${atkPower}) vs ${defSlot.character.name} (${defPower}) → ${outcome.replace('_', ' ')}!`,
    'CLASH'
  );

  if (outcome === 'ATTACKER_WINS') {
    if (!defSlot.preventRetireInContact) {
      workingState = retireCharacterWithFarewell(workingState, defenderId, lane, true, true);
    }
  } else if (outcome === 'DEFENDER_WINS') {
    if (!atkSlot.preventRetireInContact) {
      workingState = retireCharacterWithFarewell(workingState, attackerId, lane, true, true);
    }
  } else {
    if (!atkSlot.preventRetireInContact) {
      workingState = retireCharacterWithFarewell(workingState, attackerId, lane, true, true);
    }
    if (!defSlot.preventRetireInContact) {
      workingState = retireCharacterWithFarewell(workingState, defenderId, lane, true, true);
    }
  }

  const atkAfter = workingState.players[attackerId];
  workingState = {
    ...workingState,
    players: {
      ...workingState.players,
      [attackerId]: {
        ...atkAfter,
        actedLanesThisTurn: [...atkAfter.actedLanesThisTurn, lane],
      },
    },
  };

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
  const clearedState: KayouGameState = {
    ...state,
    phase: 'MAIN_PHASE',
    lastClashEvent: null,
    pendingLaneQueueAfterReveal: null,
  };

  return drainEffectQueue(clearedState, queueToResume, null);
}

export function canProgressNextStoryStage(attacker: PlayerState, defender: PlayerState): boolean {
  const nextStageIdx = attacker.storyProgress;
  if (nextStageIdx >= 4) return false;
  const opponentPairedStage = defender.storyStages[nextStageIdx];
  if (!opponentPairedStage) return true;
  return Boolean(opponentPairedStage.isPlanRevealed || !opponentPairedStage.planCard);
}

function executePrePlanEffect(
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
  const fullText = sanitizeCardText(revealedCard.effectText);
  const prePlanClause = extractTriggerClause(fullText, 'Pre-Plan');
  const hasPrePlanTrigger = Boolean(
    prePlanClause || /Pre-Plan|Scheme|When revealed as a Plan|Plan:/i.test(fullText)
  );

  let workingState: KayouGameState = {
    ...state,
    players: {
      ...state.players,
      [defenderId]: hasPrePlanTrigger
        ? {
            ...state.players[defenderId],
            retirement: [...state.players[defenderId].retirement, revealedCard],
          }
        : {
            ...state.players[defenderId],
            hand: [...state.players[defenderId].hand, revealedCard],
          },
    },
  };

  let effectSummary: string | null = null;

  if (hasPrePlanTrigger) {
    const clauseToParse = prePlanClause || fullText;
    const parsed = parseEffectClause(clauseToParse);

    if (parsed && parsed.kind !== 'NONE_PASSIVE') {
      workingState = executeParsedImmediateEffect(
        workingState,
        defenderId,
        revealedCard,
        parsed,
        activeLane
      );
      if (
        parsed.kind === 'TARGET_RETIRE_OPPONENT' &&
        workingState.players[attackerId].adventureArea[activeLane].character
      ) {
        workingState = retireCharacterWithFarewell(workingState, attackerId, activeLane, true, false);
      }
      effectSummary = `Pre-Plan Triggered (${revealedCard.name}): ${clauseToParse}`;
    } else if (
      /retire|remove/i.test(clauseToParse) &&
      workingState.players[attackerId].adventureArea[activeLane].character
    ) {
      workingState = retireCharacterWithFarewell(workingState, attackerId, activeLane, true, false);
      effectSummary = `Pre-Plan Triggered: Attacking character in ${activeLane.toUpperCase()} lane retired!`;
    } else {
      effectSummary = `Pre-Plan Triggered: ${clauseToParse}`;
    }

    workingState = appendActionLog(
      workingState,
      workingState.players[defenderId].displayName,
      `${effectSummary} (${revealedCard.name} • ${revealedCard.id} moved to Retirement Area)`,
      'EFFECT',
      revealedCard.name
    );
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
  parsedPromotion: ParsedActivatedEffect | null;
} {
  const rawText = sanitizeCardText(storyCard.effectText);
  let workingState = { ...state };
  let effectSummary: string | null = null;

  if (!rawText) return { nextState: workingState, effectSummary, parsedPromotion: null };

  const promotionClause = rawText
    .replace(/^when\s+promoted\s+to\s+this\s+stage[,:\s]*/i, '')
    .trim();

  const parsedPromotion = parseEffectClause(promotionClause);

  if (parsedPromotion && parsedPromotion.kind !== 'NONE_PASSIVE') {
    workingState = executeParsedImmediateEffect(
      workingState,
      attackerId,
      storyCard,
      parsedPromotion,
      activeLane
    );
    effectSummary = `Story Promotion Effect: ${promotionClause}`;
  } else if (/opponent.*discard/i.test(promotionClause) && workingState.players[defenderId].hand.length > 0) {
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
    effectSummary = `Story Promotion Effect: ${def.displayName} discarded 1 card!`;
  } else {
    effectSummary = `Story Promotion Effect: ${promotionClause}`;
  }

  workingState = appendActionLog(
    workingState,
    workingState.players[attackerId].displayName,
    effectSummary,
    'STORY',
    storyCard.name
  );

  return { nextState: workingState, effectSummary, parsedPromotion };
}

export function resolveBreakthroughChoice(
  state: KayouGameState,
  playerId: '0' | '1',
  choice: 'PROGRESS_STORY' | 'INTERVENE_PLAN'
): KayouGameState {
  if (state.phase !== 'BREAKTHROUGH_CHOICE' || !state.contactState) return state;
  if (state.turnPlayerId !== playerId) return state;

  const activeLane = state.contactState.activeLane;
  if (state.players[playerId].actedLanesThisTurn.includes(activeLane)) return state;

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

    let baseStateWithStory: KayouGameState = {
      ...state,
      players: {
        ...state.players,
        [playerId]: attacker,
        [defenderId]: defender,
      },
    };

    baseStateWithStory = appendActionLog(
      baseStateWithStory,
      attacker.displayName,
      `progressed to Story Stage ${nextProgress}/4 via ${activeLane.toUpperCase()} lane breakthrough!`,
      'STORY'
    );

    if (nextProgress >= 4) {
      return {
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
      };
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

    defender = { ...defender, storyStages: updatedDefStages };

    let baseStateWithPlan: KayouGameState = {
      ...state,
      players: {
        ...state.players,
        [playerId]: attacker,
        [defenderId]: defender,
      },
    };

    baseStateWithPlan = appendActionLog(
      baseStateWithPlan,
      attacker.displayName,
      `intervened on ${defender.displayName}'s Story Stage ${targetStage.stage} Plan (${revealedCard.name} • ${revealedCard.id})!`,
      'STORY',
      revealedCard.name
    );

    // Trigger reactive "Adventure: When this Character intervenes the Plan, ..." effects (e.g. SD01E-U01)
    const interveningChar = attacker.adventureArea[activeLane]?.character;
    if (interveningChar) {
      const interveneAdvClause = extractTriggerClause(interveningChar.effectText, 'Adventure');
      const interveneMatch = interveneAdvClause?.match(
        /^when\s+(?:this\s+character|it)\s+intervenes\s+(?:the\s+)?plan[,:\s]+([\s\S]+)$/i
      );
      if (interveneMatch) {
        const innerClauses = splitCompoundClauses(interveneMatch[1].trim());
        for (const cl of innerClauses) {
          baseStateWithPlan = enqueueEffectItem(baseStateWithPlan, {
            ownerId: playerId,
            sourceCard: interveningChar,
            sourceLane: activeLane,
            triggerType: 'Adventure',
            effectClause: cl,
          });
        }
      }
    }

    const { nextState, hasPrePlanTrigger, effectSummary } = executePrePlanEffect(
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
  const clearedState: KayouGameState = {
    ...state,
    phase: 'MAIN_PHASE',
    lastPlanRevealEvent: null,
    pendingLaneQueueAfterReveal: null,
  };

  return drainEffectQueue(clearedState, queueToResume, null);
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
  const clearedState: KayouGameState = {
    ...state,
    lastStoryRevealEvent: null,
    pendingLaneQueueAfterReveal: null,
  };

  const rawText = sanitizeCardText(revealEvent.storyCard.effectText);
  const promotionClause = rawText
    .replace(/^when\s+promoted\s+to\s+this\s+stage[,:\s]*/i, '')
    .trim();
  const parsedPromotion = parseEffectClause(promotionClause);

  if (parsedPromotion && parsedPromotion.kind !== 'NONE_PASSIVE') {
    const handChoice = buildPendingHandChoiceFromParsed(
      clearedState,
      revealEvent.attackerId,
      revealEvent.storyCard,
      parsedPromotion,
      queueToResume
    );
    if (handChoice) {
      return { ...clearedState, phase: 'PENDING_HAND_CHOICE', pendingHandChoice: handChoice };
    }

    const pendingTarget = buildPendingTargetFromParsed(
      clearedState,
      revealEvent.attackerId,
      revealEvent.storyCard,
      parsedPromotion,
      'STORY_PROMOTION',
      undefined,
      queueToResume
    );
    if (pendingTarget) {
      return { ...clearedState, phase: 'PENDING_TARGET', pendingTarget };
    }
  }

  return advanceToNextAttackLane(clearedState, state.turnPlayerId, queueToResume);
}

export function forfeitMatch(
  state: KayouGameState,
  forfeitingPlayerId: '0' | '1',
  reason: string
): KayouGameState {
  if (state.phase === 'GAME_OVER' || state.phase === 'WAITING_FOR_PLAYERS') return state;
  const winnerId: '0' | '1' = forfeitingPlayerId === '0' ? '1' : '0';
  return appendActionLog(
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

  let workingState: KayouGameState = {
    ...state,
    phase: 'END_PHASE',
  };

  // Auto-enqueue any continuous/board-state End-of-Turn Adventure triggers from Characters currently in play
  for (const checkPid of ['0', '1'] as const) {
    const checkPlayer = workingState.players[checkPid];
    for (const laneKey of ['left', 'center', 'right'] as const) {
      const char = checkPlayer.adventureArea[laneKey]?.character;
      if (!char) continue;
      const advClause = extractTriggerClause(char.effectText, 'Adventure');
      if (!advClause) continue;
      const delayedSpec = extractDelayedTiming(advClause);
      if (!delayedSpec) continue;
      const appliesNow =
        (delayedSpec.timing === 'END_OF_YOUR_TURN' && checkPid === playerId) ||
        delayedSpec.timing === 'END_OF_ANY_TURN';
      if (!appliesNow) continue;

      const alreadyScheduled = (workingState.delayedTriggers || []).some(
        (t) =>
          t.ownerId === checkPid &&
          t.sourceCard.id === char.id &&
          t.sourceLane === laneKey &&
          t.createdTurn === workingState.turnNumber
      );
      if (!alreadyScheduled) {
        workingState = scheduleDelayedTrigger(
          workingState,
          checkPid,
          char,
          laneKey,
          delayedSpec.timing,
          delayedSpec.conditionText,
          delayedSpec.innerEffectClause
        );
      }
    }
  }

  const allDelayed = workingState.delayedTriggers || [];
  const activeMatchingIdx = allDelayed.findIndex(
    (t) =>
      t.ownerId === playerId &&
      (t.timing === 'END_OF_YOUR_TURN' || t.timing === 'END_OF_ANY_TURN')
  );
  const rivalMatchingIdx =
    activeMatchingIdx === -1
      ? allDelayed.findIndex(
          (t) => t.ownerId !== playerId && t.timing === 'END_OF_ANY_TURN'
        )
      : -1;

  const nextTriggerIdx = activeMatchingIdx !== -1 ? activeMatchingIdx : rivalMatchingIdx;

  if (nextTriggerIdx !== -1) {
    const trig = allDelayed[nextTriggerIdx];
    const remainingTriggers = allDelayed.filter((_, idx) => idx !== nextTriggerIdx);
    workingState = {
      ...workingState,
      delayedTriggers: remainingTriggers,
    };

    const conditionMet = evaluateBoardCondition(workingState, trig.ownerId, trig.conditionText);
    if (!conditionMet) {
      workingState = appendActionLog(
        workingState,
        trig.ownerName,
        `End Phase trigger on ${trig.sourceCard.name} (${trig.sourceCard.id}) skipped (condition not met: ${trig.conditionText}).`,
        'EFFECT',
        trig.sourceCard.name
      );
      return endTurn(workingState, playerId);
    }

    return resolveSingleTriggeredClause(
      workingState,
      trig.ownerId,
      trig.sourceCard,
      trig.sourceLane,
      'DelayedTrigger',
      trig.effectClause,
      null,
      playerId
    );
  }

  const endingPlayerCheck = workingState.players[playerId];
  if (endingPlayerCheck.hand.length > 10) {
    const excess = endingPlayerCheck.hand.length - 10;
    return {
      ...workingState,
      phase: 'PENDING_HAND_CHOICE',
      pendingHandChoice: {
        sourceCard: endingPlayerCheck.leader || endingPlayerCheck.hand[0],
        playerId,
        choiceType: 'END_PHASE_HAND_LIMIT',
        count: excess,
        promptText: `End Phase Hand Limit (10 max): Choose ${excess} card${
          excess === 1 ? '' : 's'
        } to discard to your Retirement Area:`,
        candidateCards: endingPlayerCheck.hand,
        validIndices: endingPlayerCheck.hand.map((_, idx) => idx),
        resumeEndTurnForPlayer: playerId,
      },
    };
  }

  const nextPlayerId: '0' | '1' = playerId === '0' ? '1' : '0';
  const nextTurnNumber = workingState.turnNumber + 1;

  const endingPlayer = workingState.players[playerId];
  const cleanedEndingPlayer: PlayerState = {
    ...endingPlayer,
    actedLanesThisTurn: [],
    nextCardCostDiscount: null,
    adventureArea: {
      left: { ...endingPlayer.adventureArea.left, inspoBoost: 0, preventRetireInContact: false },
      center: { ...endingPlayer.adventureArea.center, inspoBoost: 0, preventRetireInContact: false },
      right: { ...endingPlayer.adventureArea.right, inspoBoost: 0, preventRetireInContact: false },
    },
  };

  const startingPlayer = workingState.players[nextPlayerId];
  const newTurnsTaken = startingPlayer.turnsTaken + 1;

  if (startingPlayer.mainDeck.length === 0) {
    return {
      ...workingState,
      phase: 'GAME_OVER',
      winnerId: playerId,
      winReason: `${startingPlayer.displayName} attempted to draw from an empty Main Deck (Deck Out)!`,
      contactState: null,
      pendingTarget: null,
      pendingHandChoice: null,
      pendingLaneQueueAfterReveal: null,
    };
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
    nextCardCostDiscount: null,
    mainDeck: restMain,
    hand: [...startingPlayer.hand, ...drawnMain],
    sceneDeck: restScene,
    sceneArea: [...readiedExistingScenes, ...addedScenes],
    adventureArea: {
      left: {
        ...startingPlayer.adventureArea.left,
        inspoBoost: 0,
        isExhausted: false,
        preventRetireInContact: false,
      },
      center: {
        ...startingPlayer.adventureArea.center,
        inspoBoost: 0,
        isExhausted: false,
        preventRetireInContact: false,
      },
      right: {
        ...startingPlayer.adventureArea.right,
        inspoBoost: 0,
        isExhausted: false,
        preventRetireInContact: false,
      },
    },
  };

  let nextTurnState: KayouGameState = {
    ...workingState,
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
  };

  nextTurnState = triggerCardFlight(nextTurnState, nextPlayerId, 'DRAW', 1);
  nextTurnState = setManeSpeechBubble(
    nextTurnState,
    nextPlayerId,
    `Turn ${nextTurnNumber}! I draw 1 card${addedScenes.length > 0 ? ' & flip a Scene' : ''}!`,
    'INFO'
  );

  return appendActionLog(
    nextTurnState,
    startingPlayer.displayName,
    `started Turn ${nextTurnNumber} (drew 1 card${
      addedScenes.length > 0 ? ' and flipped 1 Force of Harmony Scene' : ''
    }).`,
    'SYSTEM'
  );
}