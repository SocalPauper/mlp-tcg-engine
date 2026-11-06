import { KayouGameState, CardDefinition, PlayerState, GamePhase } from './types.ts';

export function createWaitingMatch(p0DeckId: string, p1DeckId: string): KayouGameState {
  return {
    roomId: 'waiting-room',
    phase: 'WAITING_FOR_PLAYERS',
    turnPlayerId: null,
    players: {
      '0': createEmptyPlayer('0', 'Player 1'),
      '1': createEmptyPlayer('1', 'Player 2'),
    },
    announcements: [],
    lastClashResult: null,
  };
}

function createEmptyPlayer(id: string, name: string): PlayerState {
  return {
    id,
    displayName: name,
    leader: null,
    deck: [],
    hand: [],
    discard: [],
    points: 0,
    lanes: { left: null, center: null, right: null },
  };
}

export function startSeatedMatch(deck0Def: { leader: CardDefinition, cards: CardDefinition[] }, deck1Def: { leader: CardDefinition, cards: CardDefinition[] }): KayouGameState {
  return {
    roomId: 'active-match',
    phase: 'MAIN_PHASE',
    turnPlayerId: '0',
    players: {
      '0': {
        id: '0',
        displayName: 'Player 1',
        leader: deck0Def.leader,
        deck: [...deck0Def.cards],
        hand: deck0Def.cards.slice(0, 5),
        discard: [],
        points: 0,
        lanes: { left: null, center: null, right: null },
      },
      '1': {
        id: '1',
        displayName: 'Player 2',
        leader: deck1Def.leader,
        deck: [...deck1Def.cards],
        hand: deck1Def.cards.slice(0, 5),
        discard: [],
        points: 0,
        lanes: { left: null, center: null, right: null },
      },
    },
    announcements: [{ type: 'SYSTEM', message: 'Match started! May the best pony win.', timestamp: Date.now() }],
    lastClashResult: null,
  };
}

export function acknowledgeAnnouncement(state: KayouGameState, playerId: '0' | '1'): KayouGameState {
  return state;
}

export function resolveMulligan(state: KayouGameState, playerId: '0' | '1', decision: boolean): KayouGameState {
  return state;
}

export function playCharacter(state: KayouGameState, playerId: '0' | '1', cardId: string, laneIndex: 'left' | 'center' | 'right'): KayouGameState {
  const player = state.players[playerId];
  const cardIndex = player.hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return state;

  const card = player.hand[cardIndex];
  const newHand = [...player.hand];
  newHand.splice(cardIndex, 1);

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        hand: newHand,
        lanes: {
          ...player.lanes,
          [laneIndex]: card,
        }
      }
    }
  };
}

export function attachItem(state: KayouGameState, playerId: '0' | '1', cardId: string, laneIndex: 'left' | 'center' | 'right'): KayouGameState {
  return state;
}

export function playEvent(state: KayouGameState, playerId: '0' | '1', cardId: string, targetLane: 'left' | 'center' | 'right'): KayouGameState {
  return state;
}

export function boostClashWithScene(state: KayouGameState, playerId: '0' | '1', sceneIndex: number): KayouGameState {
  return state;
}

export function passClashPriority(state: KayouGameState, playerId: '0' | '1'): KayouGameState {
  return state;
}

export function executeLaneAction(state: KayouGameState, playerId: '0' | '1', laneAction: any): KayouGameState {
  return state;
}

export function discardCardFromHand(state: KayouGameState, playerId: '0' | '1', cardId: string): KayouGameState {
  return state;
}

export function advancePhase(state: KayouGameState): KayouGameState {
  const phases: GamePhase[] = ['WAITING_FOR_PLAYERS', 'MULLIGAN', 'MAIN_PHASE', 'CLASH_RESOLUTION', 'GAME_OVER'];
  const currentIndex = phases.indexOf(state.phase);
  const nextPhase = phases[(currentIndex + 1) % phases.length];
  return { ...state, phase: nextPhase };
}