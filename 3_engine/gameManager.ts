import { WebSocket, WebSocketServer } from 'ws';
import { KayouGameState, DeckId } from './types.ts';
import { createWaitingMatch, startSeatedMatch, acknowledgeAnnouncement, resolveMulligan, playCharacter, attachItem, playEvent, boostClashWithScene, passClashPriority, executeLaneAction, discardCardFromHand, advancePhase } from './gameRules.ts';

interface RoomClient {
  ws: WebSocket;
  seat: '0' | '1' | 'spectator';
  roomCode: string;
  selectedDeck: DeckId;
}

interface Room {
  code: string;
  state: KayouGameState;
  clients: RoomClient[];
  deckP0: DeckId;
  deckP1: DeckId;
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

      ws.on('message', (rawMessage: string) => {
        try {
          const message = JSON.parse(rawMessage);

          if (message.type === 'GET_ROOMS') {
            this.broadcastLobbyRooms();
            return;
          }

          if (message.type === 'CREATE_ROOM') {
            if (userSession) handleClientLeave();
            const roomCode = (message.roomCode || `pony-${Math.floor(1000 + Math.random() * 9000)}`).trim().toLowerCase();
            const p0DeckId: DeckId = message.deckId || 'SD01_TWILIGHT';
            const p1DeckId: DeckId = 'SD02_RAINBOW';

            const room: Room = {
              code: roomCode,
              state: createWaitingMatch(p0DeckId, p1DeckId),
              clients: [],
              deckP0: p0DeckId,
              deckP1: p1DeckId,
            };
            this.rooms.set(roomCode, room);

            userSession = { ws, seat: '0', roomCode, selectedDeck: p0DeckId };
            room.clients.push(userSession);
            this.broadcastRoomState(room);
            this.broadcastLobbyRooms();
            return;
          }

          if (message.type === 'JOIN_ROOM') {
            if (userSession && userSession.roomCode !== message.roomCode) handleClientLeave();
            const roomCode = (message.roomCode || '').trim().toLowerCase();
            const chosenDeckId: DeckId = message.deckId || 'SD02_RAINBOW';
            let room = this.rooms.get(roomCode);

            if (!room) {
              room = {
                code: roomCode,
                state: createWaitingMatch('SD01_TWILIGHT', chosenDeckId),
                clients: [],
                deckP0: 'SD01_TWILIGHT',
                deckP1: chosenDeckId,
              };
              this.rooms.set(roomCode, room);
            }

            room.clients = room.clients.filter(c => c.ws.readyState === WebSocket.OPEN && c.ws !== ws);
            const assignedSeat = room.clients.some(c => c.seat === '0') ? '1' : '0';

            userSession = { ws, seat: assignedSeat, roomCode, selectedDeck: chosenDeckId };
            room.clients.push(userSession);

            this.checkAndStartMatch(room);
            this.broadcastRoomState(room);
            this.broadcastLobbyRooms();
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

      ws.on('close', () => {
        handleClientLeave();
      });
    });
  }

  private broadcastLobbyRooms() {
    const roomList = Array.from(this.rooms.values()).map(r => ({
      code: r.code,
      playerCount: r.clients.filter(c => c.seat === '0' || c.seat === '1').length,
    }));
    const payload = JSON.stringify({ type: 'ROOMS_LIST', rooms: roomList });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  private broadcastRoomState(room: Room) {
    for (const client of room.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
          type: 'STATE_UPDATE',
          state: room.state,
          seat: client.seat,
          clientCount: room.clients.length,
        }));
      }
    }
  }

  private checkAndStartMatch(room: Room) {
    const client0 = room.clients.find(c => c.seat === '0');
    const client1 = room.clients.find(c => c.seat === '1');

    if (client0 && client1 && room.state.phase === 'WAITING_FOR_PLAYERS') {
      // Starter deck loader mockup
      const mockDeck = { leader: { id: 'l1', cardNumber: '01', name: 'Twilight', type: 'MainCharacter' as const, element: 'Magic' as const }, cards: [] };
      room.state = startSeatedMatch(mockDeck, mockDeck);
      this.broadcastRoomState(room);
    }
  }

  private processGameAction(state: KayouGameState, playerId: '0' | '1', action: string, payload: any): KayouGameState {
    switch (action) {
      case 'PLAY_CHARACTER': return playCharacter(state, playerId, payload.cardId, payload.laneIndex);
      case 'ADVANCE_PHASE': return advancePhase(state);
      default: return state;
    }
  }
}