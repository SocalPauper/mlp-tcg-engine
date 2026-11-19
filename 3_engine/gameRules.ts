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
  ActionLogEntry,
  ActionSpotlightEvent,
  AdventureSlot,
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
    actionLog: [...(state.actionLog || []), entry].slice(-80),
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
    lastActionBanner: null,
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

  const firstPlayerName = firstPlayerId === '0' ? p0Name : p1Name;

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
    lastActionBanner: null,
    announcements: [
      {
        type: 'SYSTEM',
        message: `${firstPlayerName} won the toss and goes first!`,
        timestamp: Date.now(),
      },
    ],
    actionLog: [
      {
        id: `${Date.now()}-init`,
        turn: 1,
        actor: 'System',
        text: `Match started! ${firstPlayerName} goes first.`,
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

    return {
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
  sourceOrigin: PendingTargetSelection['sourceOrigin'],
  sourceLane?: LaneKey,
  resumeAttackQueue?: LaneKey[] | null
): PendingTargetSelection | null {
  const oppId: '0' | '1' = playerId === '0' ? '1' : '0';
  const me = state.players[playerId];
  const opp = state.players[oppId];
  const allLanes: LaneKey[] = ['left', 'center', 'right'];

  if (parsed.kind === 'PREVENT_RETIRE_IN_CONTACT') {
    const validTargets = allLanes
      .filter((l) => {
        const c = me.adventureArea[l].character;
        if (!c) return false;
        if (!matchesFilter(c, parsed.requiredNameFilter)) return false;
        if (parsed.maxLimit !== undefined) {
          const totalPwr = calculateLanePowerBreakdown(state, playerId, l).totalPower;
          return totalPwr <= parsed.maxLimit;
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
      promptText: `${sourceCard.name}: Select one of your Characters to grant +${parsed.amount} Inspiration:`,
      validTargets,
      resumeAttackQueue,
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
      promptText: `${sourceCard.name}: Select an opponent's Character to move to their Retirement Area:`,
      validTargets,
      resumeAttackQueue,
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
    };
  }

  return null;
}

function buildPendingHandChoiceFromParsed(
  state: KayouGameState,
  playerId: '0' | '1',
  sourceCard: CardDefinition,
  parsed: ParsedActivatedEffect,
  resumeAttackQueue?: LaneKey[] | null
): PendingHandChoice | null {
  const player = state.players[playerId];

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
    };
  }

  if (parsed.kind === 'RECOVER_RETIREMENT') {
    const matching = player.retirement.filter((c) =>
      matchesFilter(c, parsed.requiredNameFilter, parsed.requiredTypeFilter, parsed.maxLimit)
    );
    if (matching.length === 0) return null;
    return {
      sourceCard,
      playerId,
      choiceType: 'RECOVER_FROM_RETIREMENT',
      count: 1,
      promptText: `${sourceCard.name}: Choose 1 ${
        parsed.requiredNameFilter || parsed.requiredTypeFilter || 'card'
      } from your Retirement Area to add to your Hand:`,
      candidateCards: matching,
      validIndices: matching.map((_, idx) => idx),
      filterLabel: parsed.requiredNameFilter || parsed.requiredTypeFilter,
      resumeAttackQueue,
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
  const player = state.players[playerId];

  if (parsed.kind === 'DRAW' || parsed.kind === 'DRAW_THEN_DISCARD') {
    const res = drawCardsWithDeckOutCheck(state, playerId, parsed.amount);
    if (res.deckedOut) return res.state;
    return appendActionLog(
      res.state,
      player.displayName,
      `drew ${parsed.amount} card${parsed.amount === 1 ? '' : 's'} via ${sourceCard.name}.`,
      'EFFECT',
      sourceCard.name
    );
  }

  if (parsed.kind === 'UNTAP_SCENES') {
    let remainingToUntap = parsed.amount;
    const updatedScenes = player.sceneArea.map((sc) => {
      if (remainingToUntap > 0 && (sc.isExhausted || !sc.isFaceUp)) {
        remainingToUntap -= 1;
        return { ...sc, isExhausted: false, isFaceUp: true };
      }
      return sc;
    });
    const next = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          sceneArea: updatedScenes,
        },
      },
    };
    return appendActionLog(
      next,
      player.displayName,
      `readied ${parsed.amount} Scene card(s) via ${sourceCard.name}.`,
      'EFFECT',
      sourceCard.name
    );
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
      `placed ${parsed.amount} Treat on matching Characters via ${sourceCard.name}.`,
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
      `delivered Presents to matching Characters via ${sourceCard.name}.`,
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

    const next = {
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
    return appendActionLog(
      next,
      player.displayName,
      `granted +${boost} Inspiration to matching Characters via ${sourceCard.name}.`,
      'EFFECT',
      sourceCard.name
    );
  }

  if (parsed.kind === 'TARGET_BUFF_POWER' && parsed.isSelfOnly && sourceLane) {
    const slot = player.adventureArea[sourceLane];
    if (!slot.character) return state;
    const next = {
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
    };
    return appendActionLog(
      next,
      player.displayName,
      `${slot.character.name} gained +${parsed.amount} Inspiration.`,
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

  let workingState = appendActionLog(
    state,
    state.players[playerId].displayName,
    `${type} ability triggered on ${card.name}: ${subText}`,
    'EFFECT',
    card.name
  );

  workingState = setActionSpotlight(
    workingState,
    playerId,
    'TRIGGER_KEYWORD',
    `${card.name} — ${type.toUpperCase()}!`,
    subText,
    card,
    lane,
    `${type.toUpperCase()}!`
  );

  workingState = executeParsedImmediateEffect(workingState, playerId, card, parsed, lane);
  if (workingState.phase === 'GAME_OVER') return workingState;

  const handChoice = buildPendingHandChoiceFromParsed(workingState, playerId, card, parsed);
  if (handChoice) {
    return {
      ...workingState,
      phase: 'PENDING_HAND_CHOICE',
      pendingHandChoice: handChoice,
    };
  }

  const origin = type === 'Appear' ? 'APPEAR_EFFECT' : 'FAREWELL_EFFECT';
  const pending = buildPendingTargetFromParsed(
    workingState,
    playerId,
    card,
    parsed,
    origin,
    lane
  );
  if (pending && workingState.turnPlayerId === playerId && workingState.phase === 'MAIN_PHASE') {
    return {
      ...workingState,
      phase: 'PENDING_TARGET',
      pendingTarget: pending,
    };
  }

  if (parsed.kind === 'TARGET_RETIRE_OPPONENT') {
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

  workingState = appendActionLog(
    workingState,
    player.displayName,
    `${retiringChar.name} (${lane.toUpperCase()} lane) moved to Retirement Area.`,
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
  sourceOrigin: PendingTargetSelection['sourceOrigin'],
  sourceLane?: LaneKey
): PendingTargetSelection | null {
  const parsed = parseActivatedCardEffect(sourceCard);
  return buildPendingTargetFromParsed(state, playerId, sourceCard, parsed, sourceOrigin, sourceLane);
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

    let workingState: KayouGameState = {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          hand: newHand,
          sceneArea: updatedSceneArea,
        },
      },
    };

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

    workingState = appendActionLog(
      workingState,
      player.displayName,
      `played ${card.name} to the ${lane.toUpperCase()} lane (Cost: ${effectiveCost} Force of Harmony).`,
      'PLAY',
      card.name
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

    workingState = executeAppearOrFarewellEffect(workingState, playerId, card, lane, 'Appear');
    return workingState;
  }

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
      `adorned ${currentSlot.character.name} with Item ${card.name} (Cost: ${effectiveCost}).`,
      'PLAY',
      card.name
    );

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

  nextState = appendActionLog(
    nextState,
    player.displayName,
    `played Event ${card.name} (Cost: ${effectiveCost} Force of Harmony).`,
    'PLAY',
    card.name
  );

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

  const parsed = parseActivatedCardEffect(card);
  const immediateState = executeParsedImmediateEffect(nextState, playerId, card, parsed);
  if (immediateState.phase === 'GAME_OVER') return immediateState;

  const handChoice = buildPendingHandChoiceFromParsed(immediateState, playerId, card, parsed);
  if (handChoice) {
    return {
      ...immediateState,
      phase: 'PENDING_HAND_CHOICE',
      pendingHandChoice: handChoice,
    };
  }

  const pending = buildPendingTargetFromEffect(immediateState, playerId, card, 'HAND_EVENT');
  if (pending) {
    if (
      targetLane &&
      pending.effectAction !== 'MOVE_FRIENDLY' &&
      pending.effectAction !== 'SWITCH_POSITIONS' &&
      pending.validTargets.some((t) => t.lane === targetLane)
    ) {
      return resolveTargetSelection(immediateState, playerId, pending.validTargets[0].owner, targetLane);
    }
    return {
      ...immediateState,
      phase: 'PENDING_TARGET',
      pendingTarget: pending,
    };
  }

  return immediateState;
}

export function resolveHandChoice(
  state: KayouGameState,
  playerId: '0' | '1',
  selectedIndices: number[]
): KayouGameState {
  if (state.phase !== 'PENDING_HAND_CHOICE' || !state.pendingHandChoice) return state;
  if (state.turnPlayerId !== playerId) return state;

  const choice = state.pendingHandChoice;
  const player = state.players[playerId];
  const uniqueIndices = Array.from(new Set(selectedIndices)).filter(
    (idx) => idx >= 0 && idx < choice.candidateCards.length
  );

  if (uniqueIndices.length === 0) return state;

  let workingState = { ...state };
  const resumeQueue = choice.resumeAttackQueue;

  if (choice.choiceType === 'DISCARD_FROM_HAND' || choice.choiceType === 'DISCARD_THEN_DRAW') {
    const selectedSet = new Set(uniqueIndices);
    const discardedCards = player.hand.filter((_, idx) => selectedSet.has(idx));
    const remainingHand = player.hand.filter((_, idx) => !selectedSet.has(idx));

    workingState = {
      ...workingState,
      phase: 'MAIN_PHASE',
      pendingHandChoice: null,
      players: {
        ...workingState.players,
        [playerId]: {
          ...player,
          hand: remainingHand,
          retirement: [...player.retirement, ...discardedCards],
        },
      },
    };

    workingState = appendActionLog(
      workingState,
      player.displayName,
      `discarded ${discardedCards.map((c) => c.name).join(', ')} to Retirement Area.`,
      'EFFECT',
      choice.sourceCard.name
    );

    if (choice.choiceType === 'DISCARD_THEN_DRAW' && choice.secondaryDrawCount) {
      const drawRes = drawCardsWithDeckOutCheck(workingState, playerId, choice.secondaryDrawCount);
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
    const chosenCard = choice.candidateCards[uniqueIndices[0]];
    const retIdx = player.retirement.findIndex((c) => c.id === chosenCard.id);
    if (retIdx === -1) {
      return { ...state, phase: 'MAIN_PHASE', pendingHandChoice: null };
    }
    const nextRetirement = [...player.retirement];
    nextRetirement.splice(retIdx, 1);

    workingState = {
      ...workingState,
      phase: 'MAIN_PHASE',
      pendingHandChoice: null,
      players: {
        ...workingState.players,
        [playerId]: {
          ...player,
          retirement: nextRetirement,
          hand: [...player.hand, chosenCard],
        },
      },
    };

    workingState = appendActionLog(
      workingState,
      player.displayName,
      `recovered ${chosenCard.name} from Retirement Area to Hand.`,
      'EFFECT',
      choice.sourceCard.name
    );
  } else if (choice.choiceType === 'PICK_REVEALED_TO_HAND') {
    const chosenCard = choice.candidateCards[uniqueIndices[0]];
    const revealedCount = choice.candidateCards.length;
    const remainingDeck = player.mainDeck.slice(revealedCount);
    const unpicked = choice.candidateCards.filter((_, idx) => idx !== uniqueIndices[0]);

    workingState = {
      ...workingState,
      phase: 'MAIN_PHASE',
      pendingHandChoice: null,
      players: {
        ...workingState.players,
        [playerId]: {
          ...player,
          mainDeck: [...remainingDeck, ...unpicked],
          hand: [...player.hand, chosenCard],
        },
      },
    };

    workingState = appendActionLog(
      workingState,
      player.displayName,
      `revealed top ${revealedCount} cards and added ${chosenCard.name} to Hand.`,
      'EFFECT',
      choice.sourceCard.name
    );
  }

  if (resumeQueue && resumeQueue.length > 0) {
    return advanceToNextAttackLane(workingState, playerId, resumeQueue);
  }
  if (resumeQueue && resumeQueue.length === 0) {
    return endTurn(workingState, playerId);
  }

  return workingState;
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

  const finishAndResume = (nextState: KayouGameState): KayouGameState => {
    if (resumeQueue && resumeQueue.length > 0) {
      return advanceToNextAttackLane(nextState, playerId, resumeQueue);
    }
    if (resumeQueue && resumeQueue.length === 0) {
      return endTurn(nextState, playerId);
    }
    return nextState;
  };

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
      `protected ${slot.character.name} (${targetLane.toUpperCase()} lane) from retiring in Contact this turn!`,
      'EFFECT',
      pending.sourceCard.name
    );
    return finishAndResume(next);
  }

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
                inspoBoost: slot.inspoBoost + pending.value,
              },
            },
          },
        },
      },
      me.displayName,
      `granted +${pending.value} Inspiration to ${slot.character.name} (${targetLane.toUpperCase()} lane).`,
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
      `applied -${pending.value} Inspiration to rival's ${slot.character.name}.`,
      'EFFECT',
      pending.sourceCard.name
    );
    return finishAndResume(next);
  }

  if (pending.effectAction === 'TREAT_CHARACTER') {
    const targetPlayer = state.players[targetPlayerId];
    const slot = targetPlayer.adventureArea[targetLane];
    if (!slot.character) return state;

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
      `placed ${pending.value} Treat on ${slot.character.name}.`,
      'EFFECT',
      pending.sourceCard.name
    );
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
      `delivered a Present to ${slot.character.name}.`,
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
      `unwrapped a Present on ${slot.character.name}!`,
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
      `readied (untapped) ${slot.character.name}.`,
      'EFFECT',
      pending.sourceCard.name
    );
    return finishAndResume(next);
  }

  if (pending.effectAction === 'RETIRE_OPPONENT' && targetOwner === 'OPPONENT') {
    const workingState = retireCharacterWithFarewell(state, oppId, targetLane);
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
  const cleared: KayouGameState = {
    ...state,
    phase: 'MAIN_PHASE',
    pendingTarget: null,
  };
  if (resumeQueue && resumeQueue.length > 0) {
    return advanceToNextAttackLane(cleared, playerId, resumeQueue);
  }
  if (resumeQueue && resumeQueue.length === 0) {
    return endTurn(cleared, playerId);
  }
  return cleared;
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
    `activated Adventure ability of ${slot.character.name} (${lane.toUpperCase()} lane).`,
    'EFFECT',
    slot.character.name
  );

  workingState = setActionSpotlight(
    workingState,
    playerId,
    'ACTIVATE_ABILITY',
    `${player.displayName} activated Adventure!`,
    `${slot.character.name} (${lane.toUpperCase()} Lane)`,
    slot.character,
    lane,
    'ADVENTURE!'
  );

  const parsed = parseActivatedCardEffect(slot.character);
  workingState = executeParsedImmediateEffect(workingState, playerId, slot.character, parsed, lane);
  if (workingState.phase === 'GAME_OVER') return workingState;

  const handChoice = buildPendingHandChoiceFromParsed(workingState, playerId, slot.character, parsed);
  if (handChoice) {
    return {
      ...workingState,
      phase: 'PENDING_HAND_CHOICE',
      pendingHandChoice: handChoice,
    };
  }

  const pending = buildPendingTargetFromEffect(
    workingState,
    playerId,
    slot.character,
    'ADVENTURE_TAP',
    lane
  );
  if (pending) {
    return {
      ...workingState,
      phase: 'PENDING_TARGET',
      pendingTarget: pending,
    };
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
    `activated Main Character ability of ${player.leader.name}.`,
    'EFFECT',
    player.leader.name
  );

  workingState = setActionSpotlight(
    workingState,
    playerId,
    'ACTIVATE_ABILITY',
    `${player.displayName} activated Mane Ability!`,
    player.leader.name,
    player.leader,
    undefined,
    'HARMONY!'
  );

  const parsed = parseActivatedCardEffect(player.leader);
  workingState = executeParsedImmediateEffect(workingState, playerId, player.leader, parsed);
  if (workingState.phase === 'GAME_OVER') return workingState;

  const handChoice = buildPendingHandChoiceFromParsed(workingState, playerId, player.leader, parsed);
  if (handChoice) {
    return {
      ...workingState,
      phase: 'PENDING_HAND_CHOICE',
      pendingHandChoice: handChoice,
    };
  }

  const pending = buildPendingTargetFromEffect(
    workingState,
    playerId,
    player.leader,
    'MANE_ABILITY'
  );
  if (pending) {
    return {
      ...workingState,
      phase: 'PENDING_TARGET',
      pendingTarget: pending,
    };
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

  // Rules v1.3.0: Encounters always proceed strictly from Left -> Center -> Right
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

  loggedState = setActionSpotlight(
    loggedState,
    playerId,
    'ENTER_CONTACT',
    `${attacker.displayName} entered Encounter Phase!`,
    `Resolving Left → Right: ${activeAttackLanes.map((l) => l.toUpperCase()).join(' → ')}`,
    undefined,
    undefined,
    'CONTACT!'
  );

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
    `used Inspiration Boost (${sceneItem.card.name}) for +${check.boostAmount} Inspiration in ${lane.toUpperCase()} lane.`,
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

  let workingState = appendActionLog(
    state,
    atkPlayer.displayName,
    `${lane.toUpperCase()} Lane Contact: ${atkSlot.character.name} (${atkPower}) vs ${defSlot.character.name} (${defPower}) → ${outcome.replace('_', ' ')}!`,
    'CLASH'
  );

  if (outcome === 'ATTACKER_WINS') {
    if (!defSlot.preventRetireInContact) {
      workingState = retireCharacterWithFarewell(workingState, defenderId, lane);
    } else {
      workingState = appendActionLog(
        workingState,
        defPlayer.displayName,
        `${defSlot.character.name} was protected from retiring in Contact!`,
        'EFFECT',
        defSlot.character.name
      );
    }
  } else if (outcome === 'DEFENDER_WINS') {
    if (!atkSlot.preventRetireInContact) {
      workingState = retireCharacterWithFarewell(workingState, attackerId, lane);
    } else {
      workingState = appendActionLog(
        workingState,
        atkPlayer.displayName,
        `${atkSlot.character.name} was protected from retiring in Contact!`,
        'EFFECT',
        atkSlot.character.name
      );
    }
  } else {
    if (!atkSlot.preventRetireInContact) {
      workingState = retireCharacterWithFarewell(workingState, attackerId, lane);
    }
    if (!defSlot.preventRetireInContact) {
      workingState = retireCharacterWithFarewell(workingState, defenderId, lane);
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
  const fullText = sanitizeCardText(revealedCard.effectText);
  const prePlanClause = extractTriggerClause(fullText, 'Pre-Plan');
  const hasPrePlanTrigger = Boolean(
    prePlanClause || /Pre-Plan|Scheme|When revealed as a Plan|Plan:/i.test(fullText)
  );

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
    const clauseToParse = prePlanClause || fullText;
    const parsed = parseEffectClause(clauseToParse);

    if (parsed) {
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
        workingState = retireCharacterWithFarewell(workingState, attackerId, activeLane);
      }
      effectSummary = `Pre-Plan Triggered (${revealedCard.name}): ${clauseToParse}`;
    } else if (
      /retire|remove/i.test(clauseToParse) &&
      workingState.players[attackerId].adventureArea[activeLane].character
    ) {
      workingState = retireCharacterWithFarewell(workingState, attackerId, activeLane);
      effectSummary = `Pre-Plan Triggered: Attacking character in ${activeLane.toUpperCase()} lane retired!`;
    } else {
      effectSummary = `Pre-Plan Triggered: ${clauseToParse}`;
    }

    workingState = appendActionLog(
      workingState,
      workingState.players[defenderId].displayName,
      effectSummary,
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

  if (parsedPromotion) {
    workingState = executeParsedImmediateEffect(
      workingState,
      attackerId,
      storyCard,
      parsedPromotion,
      activeLane
    );

    if (parsedPromotion.kind === 'DRAW') {
      effectSummary = `Story Promotion Effect: ${workingState.players[attackerId].displayName} drew ${parsedPromotion.amount} card${
        parsedPromotion.amount === 1 ? '' : 's'
      }!`;
    } else if (parsedPromotion.kind === 'DRAW_THEN_DISCARD') {
      effectSummary = `Story Promotion Effect: Drew ${parsedPromotion.amount} card(s) — select ${parsedPromotion.secondaryAmount} card to discard after acknowledging!`;
    } else if (parsedPromotion.kind === 'RECOVER_RETIREMENT') {
      effectSummary = `Story Promotion Effect: Select a ${
        parsedPromotion.requiredNameFilter || parsedPromotion.requiredTypeFilter || 'card'
      } from your Retirement Area after acknowledging!`;
    } else if (parsedPromotion.kind === 'TARGET_RETIRE_OPPONENT') {
      effectSummary = `Story Promotion Effect: Choose an opponent's Character to move to Retirement Area!`;
    } else if (parsedPromotion.kind === 'TARGET_BUFF_POWER') {
      effectSummary = `Story Promotion Effect: Grant +${parsedPromotion.amount} Inspiration!`;
    } else {
      effectSummary = `Story Promotion Effect: ${promotionClause}`;
    }
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

    baseStateWithStory = setActionSpotlight(
      baseStateWithStory,
      playerId,
      'PROGRESS_STORY',
      `${attacker.displayName} Progressed Story!`,
      `Reached Story Stage ${nextProgress} / 4 (${activeLane.toUpperCase()} Lane)`,
      attacker.storyStages[nextProgress - 1]?.storyCard,
      activeLane,
      'STORY UP!'
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

    defender = {
      ...defender,
      storyStages: updatedDefStages,
    };

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
      `intervened on ${defender.displayName}'s Story Stage ${targetStage.stage} Plan (${revealedCard.name})!`,
      'STORY',
      revealedCard.name
    );

    baseStateWithPlan = setActionSpotlight(
      baseStateWithPlan,
      playerId,
      'INTERVENE_PLAN',
      `${attacker.displayName} Intervened!`,
      `Revealed ${defender.displayName}'s Stage ${targetStage.stage} Plan: ${revealedCard.name}`,
      revealedCard,
      activeLane,
      'INTERVENE!'
    );

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

  if (parsedPromotion) {
    const handChoice = buildPendingHandChoiceFromParsed(
      clearedState,
      revealEvent.attackerId,
      revealEvent.storyCard,
      parsedPromotion,
      queueToResume
    );
    if (handChoice) {
      return {
        ...clearedState,
        phase: 'PENDING_HAND_CHOICE',
        pendingHandChoice: handChoice,
      };
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
      return {
        ...clearedState,
        phase: 'PENDING_TARGET',
        pendingTarget,
      };
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

  const nextPlayerId: '0' | '1' = playerId === '0' ? '1' : '0';
  const nextTurnNumber = state.turnNumber + 1;

  const endingPlayer = state.players[playerId];
  const cleanedEndingPlayer: PlayerState = {
    ...endingPlayer,
    actedLanesThisTurn: [],
    adventureArea: {
      left: { ...endingPlayer.adventureArea.left, inspoBoost: 0, preventRetireInContact: false },
      center: { ...endingPlayer.adventureArea.center, inspoBoost: 0, preventRetireInContact: false },
      right: { ...endingPlayer.adventureArea.right, inspoBoost: 0, preventRetireInContact: false },
    },
  };

  const startingPlayer = state.players[nextPlayerId];
  const newTurnsTaken = startingPlayer.turnsTaken + 1;

  if (startingPlayer.mainDeck.length === 0) {
    return {
      ...state,
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
    mainDeck: restMain,
    hand: [...startingPlayer.hand, ...drawnMain],
    sceneDeck: restScene,
    sceneArea: [...readiedExistingScenes, ...addedScenes],
    adventureArea: {
      left: { ...startingPlayer.adventureArea.left, isExhausted: false, preventRetireInContact: false },
      center: { ...startingPlayer.adventureArea.center, isExhausted: false, preventRetireInContact: false },
      right: { ...startingPlayer.adventureArea.right, isExhausted: false, preventRetireInContact: false },
    },
  };

  return appendActionLog(
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
    startingPlayer.displayName,
    `started Turn ${nextTurnNumber} (drew 1 card${
      addedScenes.length > 0 ? ' and flipped 1 Force of Harmony Scene' : ''
    }).`,
    'SYSTEM'
  );
}