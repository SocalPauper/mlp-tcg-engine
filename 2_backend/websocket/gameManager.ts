import { WebSocket, WebSocketServer } from 'ws';
import crypto from 'crypto';
import {
  KayouGameState,
  DeckId,
  CardDefinition,
  HydratedDeckPayload,
} from '../../3_engine/types.js';
import {
  createWaitingMatch,
  startSeatedMatch,
  acknowledgeVsIntro,
  resolveMulligan,
  playCardFromHand,
  activateCharacterAdventureAbility,
  startContactPhase,
  inspireInContact,
  passInspireInContact,
  acknowledgeClashAnimation,
  resolveBreakthroughChoice,
  acknowledgePlanReveal,
  acknowledgeStoryReveal,
  forfeitMatch,
  endTurn,
} from '../../3_engine/gameRules.js';
import { pool } from '../../4_data/db.js';

const INACTIVITY_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

interface RoomClient {
  ws: WebSocket;
  seat: '0' | '1' | 'spectator';
  roomCode: string;
  selectedDeck: DeckId;
  username: string;
  sessionToken: string;
}

interface QueuedPlayer {
  ws: WebSocket;
  deckId: DeckId;
  username: string;
}

interface Room {
  code: string;
  name: string;
  mode: 'Casual' | 'Ranked';
  allowSpectators: boolean;
  state: KayouGameState;
  clients: RoomClient[];
  decks: Partial<Record<'0' | '1', DeckId>>;
  seatTokens: Partial<Record<'0' | '1', string>>;
  disconnectedAt: Partial<Record<'0' | '1', number>>;
  lastActivityAt: number;
}

const STARTER_META: Record<string, { element: string; pony: string }> = {
  'starter-sd01': { element: 'Magic', pony: 'Twilight Sparkle' },
  'starter-sd02': { element: 'Loyalty', pony: 'Rainbow Dash' },
  'starter-sd03': { element: 'Honesty', pony: 'Applejack' },
  'starter-sd04': { element: 'Generosity', pony: 'Rarity' },
  'starter-sd05': { element: 'Kindness', pony: 'Fluttershy' },
  'starter-sd06': { element: 'Laughter', pony: 'Pinkie Pie' },
};

function mapDbRowToCardDef(row: any): CardDefinition {
  return {
    id: String(row.id),
    cardNumber: String(row.id),
    name: String(row.name || row.id),
    type: String(row.card_type || 'Character'),
    element: String(row.element || 'Everyday'),
    cost: Number(row.cost) || 0,
    power: Number(row.power) || 1,
    defense: Number(row.defense) || 1,
    effectText: row.effect_text || '',
    imageUrl: row.image_url || '',
    rarity: row.rarity || 'C',
    setCode: row.set_code || 'SD01',
  };
}

export class GameManager {
  private rooms = new Map<string, Room>();
  private quickPlayQueue: QueuedPlayer[] = [];
  private wss: WebSocketServer;

  constructor(server: any) {
    this.wss = new WebSocketServer({ server });
    this.initListeners();
    this.startWatchdogTimer();
  }

  private startWatchdogTimer() {
    setInterval(() => {
      const now = Date.now();
      for (const [code, room] of this.rooms.entries()) {
        if (room.state.phase === 'GAME_OVER' || room.state.phase === 'WAITING_FOR_PLAYERS') {
          continue;
        }

        // 1. Check if either seated player has been disconnected for > 3 minutes
        for (const seat of ['0', '1'] as const) {
          const discTime = room.disconnectedAt[seat];
          if (discTime && now - discTime >= INACTIVITY_TIMEOUT_MS) {
            const leaverName = room.state.players[seat].displayName;
            room.state = forfeitMatch(
              room.state,
              seat,
              `${leaverName} disconnected and did not return within 3 minutes.`
            );
            this.broadcastRoomState(room);
            this.broadcastLobbyRooms();
            break;
          }
        }

        if (room.state.phase === 'GAME_OVER') continue;

        // 2. Check if the active/prompted player has made NO move for > 3 minutes
        if (now - room.lastActivityAt >= INACTIVITY_TIMEOUT_MS) {
          const stalledSeat: '0' | '1' =
            room.state.phase === 'CONTACT_INSPIRE' && room.state.contactState
              ? room.state.contactState.promptPlayerId
              : room.state.turnPlayerId;

          const stalledName = room.state.players[stalledSeat].displayName;
          room.state = forfeitMatch(
            room.state,
            stalledSeat,
            `${stalledName} made no move for 3 minutes (Inactivity Forfeit).`
          );
          this.broadcastRoomState(room);
          this.broadcastLobbyRooms();
        }
      }

      // Clean up finished rooms with zero connected clients
      for (const [code, room] of this.rooms.entries()) {
        const activeSockets = room.clients.filter((c) => c.ws.readyState === WebSocket.OPEN);
        if (activeSockets.length === 0 && room.state.phase === 'GAME_OVER') {
          this.rooms.delete(code);
        }
      }
    }, 5000);
  }

  private initListeners() {
    this.wss.on('connection', (ws: WebSocket) => {
      let userSession: RoomClient | null = null;

      const removeFromQueue = () => {
        this.quickPlayQueue = this.quickPlayQueue.filter(
          (q) => q.ws !== ws && q.ws.readyState === WebSocket.OPEN
        );
      };

      // Socket drop (network blip or page refresh) -> mark disconnected & start 3-minute grace window
      const handleSocketDisconnect = () => {
        removeFromQueue();
        if (!userSession) return;
        const room = this.rooms.get(userSession.roomCode);
        if (room) {
          room.clients = room.clients.filter((c) => c.ws !== ws);
          if (userSession.seat === '0' || userSession.seat === '1') {
            room.disconnectedAt[userSession.seat] = Date.now();
            room.state.players[userSession.seat].isConnected = false;
            this.broadcastRoomState(room);
          }
        }
        userSession = null;
        this.broadcastLobbyRooms();
      };

      // Explicit Leave Match button -> immediate forfeit so opponent wins right away
      const handleExplicitLeave = () => {
        removeFromQueue();
        if (!userSession) return;
        const room = this.rooms.get(userSession.roomCode);
        if (room) {
          room.clients = room.clients.filter((c) => c.ws !== ws);
          if (
            (userSession.seat === '0' || userSession.seat === '1') &&
            room.state.phase !== 'WAITING_FOR_PLAYERS' &&
            room.state.phase !== 'GAME_OVER'
          ) {
            const leaverName = room.state.players[userSession.seat].displayName;
            room.state = forfeitMatch(
              room.state,
              userSession.seat,
              `${leaverName} forfeited the match.`
            );
          }
          if (room.clients.length === 0 && room.state.phase === 'WAITING_FOR_PLAYERS') {
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
          const message = JSON.parse(rawMessage.toString());

          if (message.type === 'PING') {
            ws.send(JSON.stringify({ type: 'PONG' }));
            return;
          }

          if (message.type === 'GET_ROOMS') {
            this.sendLobbyRoomsToClient(ws);
            return;
          }

          // Reconnect after browser refresh or transient network interruption
          if (message.type === 'RECONNECT_MATCH') {
            const { roomCode, seat, sessionToken } = message;
            const room = this.rooms.get(String(roomCode || '').trim().toLowerCase());
            if (!room || room.state.phase === 'GAME_OVER') {
              ws.send(JSON.stringify({ type: 'RECONNECT_FAILED' }));
              return;
            }
            if ((seat === '0' || seat === '1') && room.seatTokens[seat] === sessionToken) {
              room.clients = room.clients.filter((c) => c.seat !== seat);
              delete room.disconnectedAt[seat];
              room.state.players[seat].isConnected = true;

              const restoredSession: RoomClient = {
                ws,
                seat,
                roomCode: room.code,
                selectedDeck: room.decks[seat] || 'starter-sd01',
                username: room.state.players[seat].displayName,
                sessionToken,
              };
              userSession = restoredSession;
              room.clients.push(restoredSession);

              this.broadcastRoomState(room);
              return;
            }
            ws.send(JSON.stringify({ type: 'RECONNECT_FAILED' }));
            return;
          }

          if (message.type === 'CANCEL_QUICK_PLAY') {
            removeFromQueue();
            ws.send(JSON.stringify({ type: 'QUICK_PLAY_CANCELLED' }));
            return;
          }

          if (message.type === 'QUICK_PLAY') {
            if (userSession) handleExplicitLeave();
            removeFromQueue();

            const deckId: DeckId = message.deckId || 'starter-sd01';
            const username = message.username || `Guest_${Math.floor(100 + Math.random() * 900)}`;

            this.quickPlayQueue = this.quickPlayQueue.filter((q) => q.ws.readyState === WebSocket.OPEN);

            if (this.quickPlayQueue.length > 0) {
              const opponent = this.quickPlayQueue.shift()!;
              const roomCode = `qp-${Math.floor(10000 + Math.random() * 90000)}`;
              const token0 = crypto.randomUUID();
              const token1 = crypto.randomUUID();

              const room: Room = {
                code: roomCode,
                name: `${opponent.username} vs ${username}`,
                mode: 'Casual',
                allowSpectators: true,
                state: createWaitingMatch(),
                clients: [],
                decks: { '0': opponent.deckId, '1': deckId },
                seatTokens: { '0': token0, '1': token1 },
                disconnectedAt: {},
                lastActivityAt: Date.now(),
              };

              const p0Session: RoomClient = {
                ws: opponent.ws,
                seat: '0',
                roomCode,
                selectedDeck: opponent.deckId,
                username: opponent.username,
                sessionToken: token0,
              };
              const p1Session: RoomClient = {
                ws,
                seat: '1',
                roomCode,
                selectedDeck: deckId,
                username,
                sessionToken: token1,
              };

              room.clients.push(p0Session, p1Session);
              this.rooms.set(roomCode, room);

              (opponent.ws as any).__setSession?.(p0Session);
              userSession = p1Session;

              await this.startMatchWithHydratedDecks(room);
              room.lastActivityAt = Date.now();
              room.state.turnDeadlineMs = room.lastActivityAt + INACTIVITY_TIMEOUT_MS;
              this.broadcastRoomState(room);
              this.broadcastLobbyRooms();
            } else {
              this.quickPlayQueue.push({ ws, deckId, username });
              ws.send(
                JSON.stringify({ type: 'QUEUED', message: 'Waiting for an opponent in Quick Play...' })
              );
            }
            return;
          }

          if (message.type === 'CREATE_ROOM') {
            if (userSession) handleExplicitLeave();
            const roomCode = (message.roomCode || `pony-${Math.floor(1000 + Math.random() * 9000)}`)
              .trim()
              .toLowerCase();
            const roomName = message.roomName || 'Custom Mane Showdown';
            const mode = message.mode || 'Casual';
            const allowSpectators = message.allowSpectators ?? true;
            const deckId: DeckId = message.deckId || 'starter-sd01';
            const username = message.username || 'Host';
            const token0 = crypto.randomUUID();

            const room: Room = {
              code: roomCode,
              name: roomName,
              mode,
              allowSpectators,
              state: createWaitingMatch(),
              clients: [],
              decks: { '0': deckId },
              seatTokens: { '0': token0 },
              disconnectedAt: {},
              lastActivityAt: Date.now(),
            };

            this.rooms.set(roomCode, room);

            userSession = {
              ws,
              seat: '0',
              roomCode,
              selectedDeck: deckId,
              username,
              sessionToken: token0,
            };
            room.clients.push(userSession);

            this.broadcastRoomState(room);
            this.broadcastLobbyRooms();
            return;
          }

          if (message.type === 'JOIN_ROOM') {
            if (userSession && userSession.roomCode !== message.roomCode) handleExplicitLeave();
            const roomCode = (message.roomCode || '').trim().toLowerCase();
            const chosenDeckId: DeckId = message.deckId || 'starter-sd02';
            const username = message.username || 'GuestPlayer';

            const room = this.rooms.get(roomCode);
            if (!room) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found.' }));

            room.clients = room.clients.filter((c) => c.ws.readyState === WebSocket.OPEN && c.ws !== ws);
            const assignedSeat = room.clients.some((c) => c.seat === '0') ? '1' : '0';
            const seatToken = crypto.randomUUID();

            userSession = {
              ws,
              seat: assignedSeat,
              roomCode,
              selectedDeck: chosenDeckId,
              username,
              sessionToken: seatToken,
            };
            room.clients.push(userSession);
            room.decks[assignedSeat] = chosenDeckId;
            room.seatTokens[assignedSeat] = seatToken;

            if (
              room.clients.some((c) => c.seat === '0') &&
              room.clients.some((c) => c.seat === '1') &&
              room.state.phase === 'WAITING_FOR_PLAYERS'
            ) {
              await this.startMatchWithHydratedDecks(room);
              room.lastActivityAt = Date.now();
              room.state.turnDeadlineMs = room.lastActivityAt + INACTIVITY_TIMEOUT_MS;
            }

            this.broadcastRoomState(room);
            this.broadcastLobbyRooms();
            return;
          }

          if (message.type === 'SPECTATE_ROOM') {
            const roomCode = (message.roomCode || '').trim().toLowerCase();
            const room = this.rooms.get(roomCode);
            if (!room || !room.allowSpectators) {
              return ws.send(
                JSON.stringify({ type: 'ERROR', message: 'Spectating not allowed or room not found.' })
              );
            }

            userSession = {
              ws,
              seat: 'spectator',
              roomCode,
              selectedDeck: 'starter-sd01',
              username: 'Spectator',
              sessionToken: '',
            };
            room.clients.push(userSession);

            ws.send(
              JSON.stringify({
                type: 'STATE_UPDATE',
                state: this.getPublicStateForSpectator(room.state),
                seat: 'spectator',
                clientCount: room.clients.length,
              })
            );
            return;
          }

          if (message.type === 'GAME_ACTION' && userSession) {
            const room = this.rooms.get(userSession.roomCode);
            if (!room) return;

            const { action, payload } = message;
            if (userSession.seat === '0' || userSession.seat === '1') {
              room.state = this.processGameAction(room.state, userSession.seat, action, payload);
              room.lastActivityAt = Date.now();
              room.state.turnDeadlineMs = room.lastActivityAt + INACTIVITY_TIMEOUT_MS;
              this.broadcastRoomState(room);
            }
            return;
          }

          if (message.type === 'LEAVE_ROOM') {
            handleExplicitLeave();
            return;
          }
        } catch (err) {
          console.error('[WS ERROR]', err);
        }
      });

      (ws as any).__setSession = (session: RoomClient) => {
        userSession = session;
      };

      ws.on('close', () => {
        handleSocketDisconnect();
      });
    });
  }

  private getRoomListPayload() {
    const roomList = Array.from(this.rooms.values()).map((r) => {
      const hostClient = r.clients.find((c) => c.seat === '0');
      const playerCount = r.clients.filter((c) => c.seat === '0' || c.seat === '1').length;
      return {
        code: r.code,
        name: r.name,
        host: hostClient?.username || 'Player',
        mode: r.mode,
        status: playerCount >= 2 ? 'In-Progress' : 'Waiting',
        allowSpectators: r.allowSpectators,
        playerCount,
      };
    });
    return JSON.stringify({ type: 'ROOMS_LIST', rooms: roomList });
  }

  private sendLobbyRoomsToClient(ws: WebSocket) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(this.getRoomListPayload());
    }
  }

  private broadcastLobbyRooms() {
    const payload = this.getRoomListPayload();
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  private broadcastRoomState(room: Room) {
    for (const client of room.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        const stateToSend =
          client.seat === 'spectator' ? this.getPublicStateForSpectator(room.state) : room.state;

        client.ws.send(
          JSON.stringify({
            type: 'STATE_UPDATE',
            state: stateToSend,
            seat: client.seat,
            roomCode: room.code,
            sessionToken: client.sessionToken,
            clientCount: room.clients.length,
          })
        );
      }
    }
  }

  private getPublicStateForSpectator(state: KayouGameState): KayouGameState {
    return {
      ...state,
      players: {
        '0': { ...state.players['0'], hand: [], mainDeck: [], sceneDeck: [] },
        '1': { ...state.players['1'], hand: [], mainDeck: [], sceneDeck: [] },
      },
    };
  }

  private async hydrateDeckFromDatabase(deckId: DeckId): Promise<HydratedDeckPayload> {
    const cardRes = await pool.query(
      `SELECT id, name, set_code, card_type, element, rarity, cost, power, defense, effect_text, image_url
       FROM game.cards
       ORDER BY
         CASE WHEN set_code ILIKE 'SD%' OR id ~* '^SD' THEN 0 ELSE 1 END,
         id ASC;`
    );
    const allRows = cardRes.rows;
    const cardMap = new Map<string, CardDefinition>(
      allRows.map((r: any) => [String(r.id).toLowerCase(), mapDbRowToCardDef(r)])
    );

    if (!deckId.startsWith('starter-')) {
      const deckRes = await pool.query('SELECT * FROM auth.decks WHERE id = $1;', [deckId]);
      if (deckRes.rows.length > 0) {
        const row = deckRes.rows[0];
        const parsed = typeof row.cards === 'string' ? JSON.parse(row.cards) : row.cards || {};
        const maneId =
          typeof row.mane_character === 'object' && row.mane_character !== null
            ? row.mane_character.id || row.mane_character.card_id
            : row.mane_character;

        const hydrateIds = (ids: string[]): CardDefinition[] =>
          (Array.isArray(ids) ? ids : [])
            .map((id) => cardMap.get(String(id).toLowerCase()))
            .filter(Boolean) as CardDefinition[];

        const leader =
          (maneId && cardMap.get(String(maneId).toLowerCase())) ||
          Array.from(cardMap.values()).find((c) => c.type === 'Mane Character')!;

        return {
          leader,
          storyDeck: hydrateIds(parsed.story_deck || parsed.stories || []),
          sceneDeck: hydrateIds(parsed.scene_deck || parsed.scenes || []),
          mainDeck: hydrateIds(parsed.main_deck || parsed.main || []),
        };
      }
    }

    const normalizedStarter = deckId.toLowerCase();
    const meta = STARTER_META[normalizedStarter] || STARTER_META['starter-sd01'];

    const isTrueMane = (r: any) =>
      r.card_type === 'Mane Character' &&
      !String(r.name || '').includes(' - ') &&
      !String(r.name || '').includes(' – ') &&
      !String(r.id || '').includes('SPR') &&
      Number(r.cost || 0) === 0;

    const maneRow =
      allRows.find(
        (r: any) =>
          isTrueMane(r) &&
          String(r.name || '').toLowerCase().includes(meta.pony.toLowerCase()) &&
          /^SD/i.test(r.id)
      ) ||
      allRows.find(
        (r: any) =>
          isTrueMane(r) && String(r.name || '').toLowerCase().includes(meta.pony.toLowerCase())
      ) ||
      allRows.find((r: any) => isTrueMane(r)) ||
      allRows[0];

    const legalPool = allRows.filter(
      (r: any) =>
        !String(r.id).includes('-S') &&
        !String(r.id).includes('SPR') &&
        (String(r.element || '').toLowerCase() === meta.element.toLowerCase() ||
          String(r.element || '').toLowerCase() === 'everyday' ||
          !r.element)
    );

    const storyRows = legalPool.filter(
      (r: any) =>
        r.card_type === 'Story' ||
        String(r.name || '').includes(' - ') ||
        String(r.name || '').includes(' – ')
    );
    const storyDeck: CardDefinition[] = [];
    let arcPrefix = '';
    for (const sr of storyRows) {
      const prefix = String(sr.name || '').split(/[-–]/)[0].trim().toLowerCase();
      if (!arcPrefix) arcPrefix = prefix;
      if (prefix === arcPrefix && storyDeck.length < 4) {
        storyDeck.push(mapDbRowToCardDef(sr));
      }
      if (storyDeck.length === 4) break;
    }

    const sceneRows = legalPool.filter((r: any) => r.card_type === 'Scene');
    const sceneDeck: CardDefinition[] = [];
    for (const scr of sceneRows) {
      for (let i = 0; i < 3 && sceneDeck.length < 15; i++) {
        sceneDeck.push(mapDbRowToCardDef(scr));
      }
      if (sceneDeck.length >= 15) break;
    }

    const mainRows = legalPool.filter(
      (r: any) =>
        ['Character', 'Friend Character', 'Event', 'Item'].includes(r.card_type) &&
        !String(r.name || '').includes(' - ') &&
        !String(r.name || '').includes(' – ') &&
        !isTrueMane(r)
    );
    const mainDeck: CardDefinition[] = [];
    for (const mr of mainRows) {
      for (let i = 0; i < 3 && mainDeck.length < 50; i++) {
        mainDeck.push(mapDbRowToCardDef(mr));
      }
      if (mainDeck.length >= 50) break;
    }

    return {
      leader: mapDbRowToCardDef(maneRow),
      storyDeck,
      sceneDeck,
      mainDeck,
    };
  }

  private async startMatchWithHydratedDecks(room: Room) {
    const [deck0, deck1] = await Promise.all([
      this.hydrateDeckFromDatabase(room.decks['0'] || 'starter-sd01'),
      this.hydrateDeckFromDatabase(room.decks['1'] || 'starter-sd02'),
    ]);

    const p0Client = room.clients.find((c) => c.seat === '0');
    const p1Client = room.clients.find((c) => c.seat === '1');

    room.state = startSeatedMatch(
      deck0,
      deck1,
      p0Client?.username || 'Player 1',
      p1Client?.username || 'Player 2'
    );
    room.state.roomId = room.code;
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
      case 'MULLIGAN_DECISION':
        return resolveMulligan(state, playerId, Boolean(payload?.doMulligan));
      case 'PLAY_CARD':
        return playCardFromHand(state, playerId, payload.cardId, payload.laneIndex);
      case 'ACTIVATE_ADVENTURE':
        return activateCharacterAdventureAbility(state, playerId, payload.laneIndex);
      case 'START_CONTACT':
        return startContactPhase(state, playerId);
      case 'INSPIRE_SCENE':
        return inspireInContact(state, playerId, payload.sceneIndex);
      case 'PASS_INSPIRE':
        return passInspireInContact(state, playerId);
      case 'ACK_CLASH_ANIMATION':
        return acknowledgeClashAnimation(state, playerId);
      case 'BREAKTHROUGH_CHOICE':
        return resolveBreakthroughChoice(state, playerId, payload.choice);
      case 'ACK_PLAN_REVEAL':
        return acknowledgePlanReveal(state, playerId);
      case 'ACK_STORY_REVEAL':
        return acknowledgeStoryReveal(state, playerId);
      case 'END_TURN':
        return endTurn(state, playerId);
	  case 'ACTIVATE_MANE_ABILITY':
        return activateManeLeaderAbility(state, playerId);
      case 'SELECT_TARGET':
        return resolveTargetSelection(state, playerId, payload.targetOwner, payload.laneIndex);
      case 'CANCEL_TARGET':
        return cancelTargetSelection(state, playerId);
      default:
        return state;
    }
  }
}