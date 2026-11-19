import { WebSocket, WebSocketServer } from 'ws';
import crypto from 'crypto';
import { KayouGameState, DeckId, HydratedDeckPayload, CardDefinition } from './types.js';
import {
  createWaitingMatch,
  startSeatedMatch,
  acknowledgeVsIntro,
  resolveMulligan,
  playCardFromHand,
  resolveTargetSelection,
  cancelTargetSelection,
  resolveHandChoice,
  activateCharacterAdventureAbility,
  activateManeLeaderAbility,
  startContactPhase,
  inspireInContact,
  passInspireInContact,
  acknowledgeClashAnimation,
  resolveBreakthroughChoice,
  acknowledgePlanReveal,
  acknowledgeStoryReveal,
  forfeitMatch,
  endTurn,
} from './gameRules.js';
import { pool } from '../../4_data/db.js';
import { recordRankedMatchResult } from '../routes/ranked.js';

interface RoomClient {
  ws: WebSocket;
  seat: '0' | '1' | 'spectator';
  roomCode: string;
  selectedDeck: DeckId;
  userId?: string;
  displayName?: string;
  sessionToken: string;
}

interface Room {
  code: string;
  state: KayouGameState;
  clients: RoomClient[];
  deckP0: DeckId;
  deckP1: DeckId;
  userIdP0?: string;
  userIdP1?: string;
  nameP0: string;
  nameP1: string;
  isRanked: boolean;
  rankedRecorded: boolean;
}

async function loadHydratedDeck(deckId: string): Promise<HydratedDeckPayload> {
  const cardsRes = await pool.query(`SELECT * FROM game.cards;`);
  const cardMap = new Map<string, CardDefinition>();
  for (const row of cardsRes.rows) {
    cardMap.set(String(row.id).toLowerCase(), {
      id: row.id,
      cardNumber: row.card_number || row.id,
      name: row.name,
      type: row.card_type,
      element: row.element || 'Everyday',
      cost: Number(row.cost) || 0,
      power: Number(row.power) || 0,
      defense: Number(row.defense) || 0,
      traits: row.traits || '',
      effectText: row.effect_text || '',
      imageUrl: row.image_url || '',
      rarity: row.rarity || 'C',
      setCode: row.set_code || '',
    });
  }

  let rawDeck: any = null;
  if (deckId && !deckId.startsWith('starter-')) {
    const deckRes = await pool.query(`SELECT * FROM auth.decks WHERE id = $1 LIMIT 1;`, [deckId]);
    rawDeck = deckRes.rows[0] || null;
  }

  const parsedCards =
    rawDeck?.cards && typeof rawDeck.cards === 'string'
      ? JSON.parse(rawDeck.cards)
      : rawDeck?.cards || {};

  let maneId = rawDeck?.mane_character;
  if (maneId && typeof maneId === 'object') maneId = maneId.id || maneId.card_id;
  if (typeof maneId === 'string' && maneId.startsWith('{')) {
    try {
      maneId = JSON.parse(maneId).id;
    } catch {
      // keep raw
    }
  }

  const resolveList = (ids: any[]): CardDefinition[] => {
    const out: CardDefinition[] = [];
    for (const entry of Array.isArray(ids) ? ids : []) {
      const id = typeof entry === 'string' ? entry : entry?.id || entry?.card_id;
      const qty = typeof entry === 'object' && entry?.quantity ? Number(entry.quantity) : 1;
      const found = id ? cardMap.get(String(id).toLowerCase()) : undefined;
      if (found) {
        for (let i = 0; i < qty; i++) out.push(found);
      }
    }
    return out;
  };

  const allCards = Array.from(cardMap.values());
  const defaultLeader =
    (maneId && cardMap.get(String(maneId).toLowerCase())) ||
    allCards.find((c) => String(c.type).toLowerCase().includes('mane')) ||
    allCards[0];

  const storyDeck = resolveList(parsedCards.story_deck || parsedCards.stories);
  const sceneDeck = resolveList(parsedCards.scene_deck || parsedCards.scenes);
  const mainDeck = resolveList(parsedCards.main_deck || parsedCards.main);

  return {
    leader: defaultLeader,
    storyDeck:
      storyDeck.length >= 4
        ? storyDeck.slice(0, 4)
        : allCards.filter((c) => String(c.type).toLowerCase() === 'story').slice(0, 4),
    sceneDeck:
      sceneDeck.length >= 10
        ? sceneDeck
        : allCards.filter((c) => String(c.type).toLowerCase() === 'scene').slice(0, 15),
    mainDeck:
      mainDeck.length >= 30
        ? mainDeck
        : allCards.filter((c) => String(c.type).toLowerCase().includes('character')).slice(0, 50),
  };
}

export class GameManager {
  private rooms = new Map<string, Room>();
  private wss: WebSocketServer;

  constructor(server: any) {
    this.wss = new WebSocketServer({ server });
    this.initListeners();
  }

  private initListeners() {
    this.wss.on('connection', (ws: WebSocket) => {
      let userSession: RoomClient | null = null;

      const handleClientLeave = () => {
        if (!userSession) return;
        const room = this.rooms.get(userSession.roomCode);
        if (room) {
          room.clients = room.clients.filter((c) => c.ws !== ws);
          if (userSession.seat === '0' || userSession.seat === '1') {
            room.state = {
              ...room.state,
              players: {
                ...room.state.players,
                [userSession.seat]: {
                  ...room.state.players[userSession.seat],
                  isConnected: false,
                },
              },
            };
          }
          if (room.clients.length === 0) {
            this.rooms.delete(room.code);
          } else {
            this.broadcastRoomState(room);
          }
        }
        userSession = null;
        this.broadcastLobbyRooms();
      };

      ws.on('message', async (rawMessage: string) => {
        try {
          const message = JSON.parse(rawMessage);

          if (message.type === 'PING') {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'PONG' }));
            }
            return;
          }

          if (message.type === 'GET_ROOMS') {
            this.broadcastLobbyRooms();
            return;
          }

          if (message.type === 'CREATE_ROOM') {
            if (userSession) handleClientLeave();
            const roomCode = (
              message.roomCode || `pony-${Math.floor(1000 + Math.random() * 9000)}`
            )
              .trim()
              .toLowerCase();
            const p0DeckId: DeckId = message.deckId || 'starter-twilight';
            const p0Name = message.displayName || 'Player 1';
            const sessionToken = crypto.randomUUID();

            const room: Room = {
              code: roomCode,
              state: createWaitingMatch(),
              clients: [],
              deckP0: p0DeckId,
              deckP1: 'starter-rainbow',
              userIdP0: message.userId ? String(message.userId) : undefined,
              nameP0: p0Name,
              nameP1: 'Player 2',
              isRanked: Boolean(message.isRanked),
              rankedRecorded: false,
            };
            room.state.roomId = roomCode;
            this.rooms.set(roomCode, room);

            userSession = {
              ws,
              seat: '0',
              roomCode,
              selectedDeck: p0DeckId,
              userId: message.userId ? String(message.userId) : undefined,
              displayName: p0Name,
              sessionToken,
            };
            room.clients.push(userSession);
            this.broadcastRoomState(room);
            this.broadcastLobbyRooms();
            return;
          }

          if (message.type === 'JOIN_ROOM') {
            if (userSession && userSession.roomCode !== message.roomCode) handleClientLeave();
            const roomCode = (message.roomCode || '').trim().toLowerCase();
            const chosenDeckId: DeckId = message.deckId || 'starter-rainbow';
            const joinerName = message.displayName || 'Player 2';
            const sessionToken = crypto.randomUUID();
            let room = this.rooms.get(roomCode);

            if (!room) {
              room = {
                code: roomCode,
                state: createWaitingMatch(),
                clients: [],
                deckP0: 'starter-twilight',
                deckP1: chosenDeckId,
                nameP0: 'Player 1',
                nameP1: joinerName,
                isRanked: Boolean(message.isRanked),
                rankedRecorded: false,
              };
              room.state.roomId = roomCode;
              this.rooms.set(roomCode, room);
            }

            room.clients = room.clients.filter(
              (c) => c.ws.readyState === WebSocket.OPEN && c.ws !== ws
            );
            const assignedSeat = room.clients.some((c) => c.seat === '0') ? '1' : '0';

            if (assignedSeat === '0') {
              room.deckP0 = chosenDeckId;
              room.nameP0 = joinerName;
              if (message.userId) room.userIdP0 = String(message.userId);
            } else {
              room.deckP1 = chosenDeckId;
              room.nameP1 = joinerName;
              if (message.userId) room.userIdP1 = String(message.userId);
            }

            userSession = {
              ws,
              seat: assignedSeat,
              roomCode,
              selectedDeck: chosenDeckId,
              userId: message.userId ? String(message.userId) : undefined,
              displayName: joinerName,
              sessionToken,
            };
            room.clients.push(userSession);

            await this.checkAndStartMatch(room);
            this.broadcastRoomState(room);
            this.broadcastLobbyRooms();
            return;
          }

          if (message.type === 'RECONNECT_MATCH') {
            const roomCode = String(message.roomCode || '').trim().toLowerCase();
            const seat = message.seat as '0' | '1';
            const room = this.rooms.get(roomCode);
            if (!room || (seat !== '0' && seat !== '1')) {
              ws.send(JSON.stringify({ type: 'RECONNECT_FAILED' }));
              return;
            }
            userSession = {
              ws,
              seat,
              roomCode,
              selectedDeck: seat === '0' ? room.deckP0 : room.deckP1,
              sessionToken: message.sessionToken || crypto.randomUUID(),
            };
            room.clients = room.clients.filter((c) => c.seat !== seat);
            room.clients.push(userSession);
            room.state = {
              ...room.state,
              players: {
                ...room.state.players,
                [seat]: {
                  ...room.state.players[seat],
                  isConnected: true,
                },
              },
            };
            this.broadcastRoomState(room);
            return;
          }

          if (message.type === 'GAME_ACTION' && userSession) {
            const room = this.rooms.get(userSession.roomCode);
            if (!room) return;

            const { action, payload } = message;
            if (userSession.seat === '0' || userSession.seat === '1') {
              room.state = this.processGameAction(room.state, userSession.seat, action, payload);

              if (
                room.state.phase === 'GAME_OVER' &&
                room.state.winnerId &&
                !room.rankedRecorded &&
                room.userIdP0 &&
                room.userIdP1
              ) {
                room.rankedRecorded = true;
                const winnerId = room.state.winnerId === '0' ? room.userIdP0 : room.userIdP1;
                const loserId = room.state.winnerId === '0' ? room.userIdP1 : room.userIdP0;
                recordRankedMatchResult(winnerId, loserId).catch((err) =>
                  console.error('[RANKED RECORD ERROR]', err)
                );
              }

              this.broadcastRoomState(room);
            }
            return;
          }

          if (message.type === 'LEAVE_ROOM') {
            handleClientLeave();
            return;
          }
        } catch (err) {
          console.error('[WS ERROR]', err);
        }
      });

      ws.on('close', () => {
        handleClientLeave();
      });
    });
  }

  private broadcastLobbyRooms() {
    const roomList = Array.from(this.rooms.values()).map((r) => ({
      code: r.code,
      playerCount: r.clients.filter((c) => c.seat === '0' || c.seat === '1').length,
      isRanked: r.isRanked,
    }));
    const payload = JSON.stringify({ type: 'ROOMS_LIST', rooms: roomList });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  private broadcastRoomState(room: Room) {
    for (const client of room.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(
          JSON.stringify({
            type: 'STATE_UPDATE',
            roomCode: room.code,
            sessionToken: client.sessionToken,
            state: room.state,
            seat: client.seat,
            clientCount: room.clients.length,
          })
        );
      }
    }
  }

  private async checkAndStartMatch(room: Room) {
    const client0 = room.clients.find((c) => c.seat === '0');
    const client1 = room.clients.find((c) => c.seat === '1');

    if (client0 && client1 && room.state.phase === 'WAITING_FOR_PLAYERS') {
      const [deck0, deck1] = await Promise.all([
        loadHydratedDeck(room.deckP0),
        loadHydratedDeck(room.deckP1),
      ]);
      room.state = startSeatedMatch(deck0, deck1, room.nameP0, room.nameP1);
      room.state.roomId = room.code;
    }
  }

  private processGameAction(
    state: KayouGameState,
    playerId: '0' | '1',
    action: string,
    payload: any
  ): KayouGameState {
    switch (action) {
      case 'ACK_VS_INTRO':
        return acknowledgeVsIntro(state);
      case 'RESOLVE_MULLIGAN':
        return resolveMulligan(state, playerId, Boolean(payload?.doMulligan));
      case 'PLAY_CARD':
      case 'PLAY_CHARACTER':
        return playCardFromHand(state, playerId, payload?.cardId, payload?.lane || payload?.laneIndex);
      case 'RESOLVE_TARGET':
        return resolveTargetSelection(state, playerId, payload?.owner, payload?.lane);
      case 'CANCEL_TARGET':
        return cancelTargetSelection(state, playerId);
      case 'RESOLVE_HAND_CHOICE':
        return resolveHandChoice(state, playerId, payload?.selectedIndices || []);
      case 'ACTIVATE_ADVENTURE':
        return activateCharacterAdventureAbility(state, playerId, payload?.lane);
      case 'ACTIVATE_MANE':
        return activateManeLeaderAbility(state, playerId);
      case 'START_CONTACT':
        return startContactPhase(state, playerId);
      case 'INSPIRE_CONTACT':
        return inspireInContact(state, playerId, Number(payload?.sceneIndex));
      case 'PASS_INSPIRE':
        return passInspireInContact(state, playerId);
      case 'ACK_CLASH':
        return acknowledgeClashAnimation(state, playerId);
      case 'BREAKTHROUGH_CHOICE':
        return resolveBreakthroughChoice(state, playerId, payload?.choice);
      case 'ACK_PLAN_REVEAL':
        return acknowledgePlanReveal(state, playerId);
      case 'ACK_STORY_REVEAL':
        return acknowledgeStoryReveal(state, playerId);
      case 'FORFEIT':
        return forfeitMatch(
          state,
          playerId,
          `${state.players[playerId].displayName} forfeited the match.`
        );
      case 'END_TURN':
      case 'ADVANCE_PHASE':
        return endTurn(state, playerId);
      default:
        return state;
    }
  }
}