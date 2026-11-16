import { WebSocket, WebSocketServer } from 'ws';
import { KayouGameState, DeckId, CardDefinition } from '../../3_engine/types.js';
import { createWaitingMatch, startSeatedMatch, drawCard, playCharacter, advancePhase } from '../../3_engine/gameRules.js';
import { pool } from '../../4_data/db.js';

interface RoomClient {
  ws: WebSocket;
  seat: '0' | '1' | 'spectator';
  roomCode: string;
  selectedDeck: DeckId;
  username: string;
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
}

export class GameManager {
  private rooms = new Map<string, Room>();
  private quickPlayQueue: QueuedPlayer[] = [];
  private wss: WebSocketServer;

  constructor(server: any) {
    this.wss = new WebSocketServer({ server });
    this.initListeners();
  }

  private initListeners() {
    this.wss.on('connection', (ws: WebSocket) => {
      let userSession: RoomClient | null = null;

      const removeFromQueue = () => {
        this.quickPlayQueue = this.quickPlayQueue.filter(q => q.ws !== ws && q.ws.readyState === WebSocket.OPEN);
      };

      const handleClientLeave = () => {
        removeFromQueue();
        if (!userSession) return;
        const room = this.rooms.get(userSession.roomCode);
        if (room) {
          room.clients = room.clients.filter(c => c.ws !== ws);
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
          const message = JSON.parse(rawMessage.toString());

          if (message.type === 'GET_ROOMS') {
            this.sendLobbyRoomsToClient(ws);
            return;
          }

          if (message.type === 'CANCEL_QUICK_PLAY') {
            removeFromQueue();
            ws.send(JSON.stringify({ type: 'QUICK_PLAY_CANCELLED' }));
            return;
          }

          if (message.type === 'QUICK_PLAY') {
            if (userSession) handleClientLeave();
            removeFromQueue();

            const deckId: DeckId = message.deckId || 'SD01_TWILIGHT';
            const username = message.username || `Guest_${Math.floor(100 + Math.random() * 900)}`;

            // Clean disconnected sockets in queue
            this.quickPlayQueue = this.quickPlayQueue.filter(q => q.ws.readyState === WebSocket.OPEN);

            if (this.quickPlayQueue.length > 0) {
              const opponent = this.quickPlayQueue.shift()!;
              const roomCode = `qp-${Math.floor(10000 + Math.random() * 90000)}`;

              const room: Room = {
                code: roomCode,
                name: `Quick Play: ${opponent.username} vs ${username}`,
                mode: 'Casual',
                allowSpectators: true,
                state: createWaitingMatch(opponent.deckId, deckId),
                clients: [],
                decks: { '0': opponent.deckId, '1': deckId },
              };

              const p0Session: RoomClient = {
                ws: opponent.ws,
                seat: '0',
                roomCode,
                selectedDeck: opponent.deckId,
                username: opponent.username,
              };
              const p1Session: RoomClient = {
                ws,
                seat: '1',
                roomCode,
                selectedDeck: deckId,
                username,
              };

              room.clients.push(p0Session, p1Session);
              this.rooms.set(roomCode, room);

              // Notify both sockets to bind their session
              (opponent.ws as any).__setSession?.(p0Session);
              userSession = p1Session;

              await this.startMatchWithDecks(room);
              this.broadcastRoomState(room);
              this.broadcastLobbyRooms();
            } else {
              this.quickPlayQueue.push({ ws, deckId, username });
              ws.send(JSON.stringify({ type: 'QUEUED', message: 'Waiting for an opponent in Quick Play...' }));
            }
            return;
          }

          if (message.type === 'CREATE_ROOM') {
            if (userSession) handleClientLeave();
            const roomCode = (message.roomCode || `pony-${Math.floor(1000 + Math.random() * 9000)}`).trim().toLowerCase();
            const roomName = message.roomName || 'Custom Mane Showdown';
            const mode = message.mode || 'Casual';
            const allowSpectators = message.allowSpectators ?? true;
            const deckId: DeckId = message.deckId || 'SD01_TWILIGHT';
            const username = message.username || 'Host';

            const room: Room = {
              code: roomCode,
              name: roomName,
              mode,
              allowSpectators,
              state: createWaitingMatch(deckId, 'SD02_RAINBOW'),
              clients: [],
              decks: { '0': deckId },
            };

            this.rooms.set(roomCode, room);

            userSession = { ws, seat: '0', roomCode, selectedDeck: deckId, username };
            room.clients.push(userSession);

            this.broadcastRoomState(room);
            this.broadcastLobbyRooms();
            return;
          }

          if (message.type === 'JOIN_ROOM') {
            if (userSession && userSession.roomCode !== message.roomCode) handleClientLeave();
            const roomCode = (message.roomCode || '').trim().toLowerCase();
            const chosenDeckId: DeckId = message.deckId || 'SD02_RAINBOW';
            const username = message.username || 'GuestPlayer';

            const room = this.rooms.get(roomCode);
            if (!room) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found.' }));

            room.clients = room.clients.filter(c => c.ws.readyState === WebSocket.OPEN && c.ws !== ws);
            const assignedSeat = room.clients.some(c => c.seat === '0') ? '1' : '0';

            userSession = { ws, seat: assignedSeat, roomCode, selectedDeck: chosenDeckId, username };
            room.clients.push(userSession);
            room.decks[assignedSeat] = chosenDeckId;

            if (room.clients.some(c => c.seat === '0') && room.clients.some(c => c.seat === '1') && room.state.phase === 'WAITING_FOR_PLAYERS') {
              await this.startMatchWithDecks(room);
            }

            this.broadcastRoomState(room);
            this.broadcastLobbyRooms();
            return;
          }

          if (message.type === 'SPECTATE_ROOM') {
            const roomCode = (message.roomCode || '').trim().toLowerCase();
            const room = this.rooms.get(roomCode);
            if (!room || !room.allowSpectators) {
              return ws.send(JSON.stringify({ type: 'ERROR', message: 'Spectating not allowed or room not found.' }));
            }

            userSession = { ws, seat: 'spectator', roomCode, selectedDeck: 'SD01_TWILIGHT', username: 'Spectator' };
            room.clients.push(userSession);

            ws.send(JSON.stringify({
              type: 'STATE_UPDATE',
              state: this.getPublicStateForSpectator(room.state),
              seat: 'spectator',
              clientCount: room.clients.length,
            }));
            return;
          }

          if (message.type === 'GAME_ACTION' && userSession) {
            const room = this.rooms.get(userSession.roomCode);
            if (!room) return;

            const { action, payload } = message;
            if (userSession.seat === '0' || userSession.seat === '1') {
              room.state = this.processGameAction(room.state, userSession.seat, action, payload);
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

      // Allow Quick Play pairing to attach session to waiting socket
      (ws as any).__setSession = (session: RoomClient) => {
        userSession = session;
      };

      ws.on('close', () => {
        handleClientLeave();
      });
    });
  }

  private getRoomListPayload() {
    const roomList = Array.from(this.rooms.values()).map(r => {
      const hostClient = r.clients.find(c => c.seat === '0');
      const playerCount = r.clients.filter(c => c.seat === '0' || c.seat === '1').length;
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
        const stateToSend = client.seat === 'spectator'
          ? this.getPublicStateForSpectator(room.state)
          : room.state;

        client.ws.send(JSON.stringify({
          type: 'STATE_UPDATE',
          state: stateToSend,
          seat: client.seat,
          clientCount: room.clients.length,
        }));
      }
    }
  }

  private getPublicStateForSpectator(state: KayouGameState): KayouGameState {
    return {
      ...state,
      players: {
        '0': { ...state.players['0'], hand: [], deck: [] },
        '1': { ...state.players['1'], hand: [], deck: [] },
      }
    };
  }

  private buildStarterDeck(deckId: DeckId): { leader: CardDefinition; cards: CardDefinition[] } {
    const isRainbow = deckId.includes('RAINBOW');
    const leader: CardDefinition = isRainbow
      ? { id: 'SD02-001', cardNumber: 'SD02-001', name: 'Rainbow Dash - Element of Loyalty', type: 'MainCharacter', element: 'Loyalty', power: 4 }
      : { id: 'SD01-001', cardNumber: 'SD01-001', name: 'Twilight Sparkle - Element of Magic', type: 'MainCharacter', element: 'Magic', power: 4 };

    const element = isRainbow ? 'Loyalty' : 'Magic';
    const cards: CardDefinition[] = Array.from({ length: 30 }, (_, i) => ({
      id: `${deckId}-C${i + 1}`,
      cardNumber: `${deckId}-${String(i + 1).padStart(3, '0')}`,
      name: isRainbow ? `Wonderbolt Trainee #${i + 1}` : `Canterlot Scholar #${i + 1}`,
      type: i % 5 === 0 ? 'Story' : 'Character',
      element,
      power: (i % 4) + 1,
      defense: (i % 3) + 1,
      effectText: 'Harmony boost +1 when paired in matching lane.',
    }));

    return { leader, cards };
  }

  private async startMatchWithDecks(room: Room) {
    const deck0 = this.buildStarterDeck(room.decks['0'] || 'SD01_TWILIGHT');
    const deck1 = this.buildStarterDeck(room.decks['1'] || 'SD02_RAINBOW');

    room.state = startSeatedMatch(deck0, deck1);
    room.state.roomId = room.code;

    const p0Client = room.clients.find(c => c.seat === '0');
    const p1Client = room.clients.find(c => c.seat === '1');
    if (p0Client) room.state.players['0'].displayName = p0Client.username;
    if (p1Client) room.state.players['1'].displayName = p1Client.username;
  }

  private processGameAction(state: KayouGameState, playerId: '0' | '1', action: string, payload: any): KayouGameState {
    switch (action) {
      case 'PLAY_CHARACTER': return playCharacter(state, playerId, payload.cardId, payload.laneIndex);
      case 'DRAW_CARD': return drawCard(state, playerId);
      case 'ADVANCE_PHASE': return advancePhase(state);
      default: return state;
    }
  }
}