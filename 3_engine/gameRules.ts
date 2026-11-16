import { KayouGameState, CardDefinition, PlayerState, GamePhase } from './types.ts';

/**
 * Secure Fisher-Yates shuffle utilizing crypto.getRandomValues for true randomness.
 */
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
    lanes: {
      left: { character: null, item: null, story: null, plan: null },
      center: { character: null, item: null, story: null, plan: null },
      right: { character: null, item: null, story: null, plan: null },
    },
  };
}

export function startSeatedMatch(
  deck0Def: { leader: CardDefinition, cards: CardDefinition[] }, 
  deck1Def: { leader: CardDefinition, cards: CardDefinition[] }
): KayouGameState {
  const shuffledDeck0 = secureShuffle(deck0Def.cards);
  const shuffledDeck1 = secureShuffle(deck1Def.cards);

  return {
    roomId: 'active-match',
    phase: 'MAIN_PHASE',
    turnPlayerId: '0',
    players: {
      '0': {
        id: '0',
        displayName: 'Player 1',
        leader: deck0Def.leader,
        deck: shuffledDeck0.slice(5),
        hand: shuffledDeck0.slice(0, 5),
        discard: [],
        points: 0,
        lanes: {
          left: { character: null, item: null, story: null, plan: null },
          center: { character: null, item: null, story: null, plan: null },
          right: { character: null, item: null, story: null, plan: null },
        },
      },
      '1': {
        id: '1',
        displayName: 'Player 2',
        leader: deck1Def.leader,
        deck: shuffledDeck1.slice(5),
        hand: shuffledDeck1.slice(0, 5),
        discard: [],
        points: 0,
        lanes: {
          left: { character: null, item: null, story: null, plan: null },
          center: { character: null, item: null, story: null, plan: null },
          right: { character: null, item: null, story: null, plan: null },
        },
      },
    },
    announcements: [{ type: 'SYSTEM', message: 'Match started with secure cryptographic shuffle!', timestamp: Date.now() }],
    lastClashResult: null,
  };
}

export function drawCard(state: KayouGameState, playerId: '0' | '1'): KayouGameState {
  const player = state.players[playerId];
  if (player.deck.length === 0) return state;

  const newDeck = [...player.deck];
  const drawnCard = newDeck.shift()!;
  const newHand = [...player.hand, drawnCard];

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        deck: newDeck,
        hand: newHand,
      }
    }
  };
}

export function playCharacter(
  state: KayouGameState, 
  playerId: '0' | '1', 
  cardId: string, 
  laneIndex: 'left' | 'center' | 'right'
): KayouGameState {
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
          [laneIndex]: {
            ...player.lanes[laneIndex],
            character: card,
          }
        }
      }
    }
  };
}

export function advancePhase(state: KayouGameState): KayouGameState {
  const phases: GamePhase[] = ['WAITING_FOR_PLAYERS', 'MULLIGAN', 'MAIN_PHASE', 'CLASH_RESOLUTION', 'GAME_OVER'];
  const currentIndex = phases.indexOf(state.phase);
  const nextPhase = phases[(currentIndex + 1) % phases.length];
  return { ...state, phase: nextPhase };
}