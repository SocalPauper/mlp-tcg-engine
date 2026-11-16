import { WebSocket, WebSocketServer } from 'ws';
import { KayouGameState, DeckId } from '../3_engine/types.js';
import { createWaitingMatch, startSeatedMatch, drawCard, playCharacter, advancePhase } from '../3_engine/gameRules.js';
import { pool } from '../../4_data/db.js';

interface RoomClient {
  ws: WebSocket;
  seat: '0' | '1' | 'spectator';
  roomCode: string;
  selectedDeck: DeckId;
  username: string;
}

interface Room {
  code: string;
  name: string;
  mode: 'Casual' | 'Ranked';
  allowSpectators: boolean;
  state: KayouGameState;
  clients: RoomClient[];
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
            
            let room = this.rooms.get(roomCode);
            if (!room) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found.' }));

            room.clients = room.clients.filter(c => c.ws.readyState === WebSocket.OPEN && c.ws !== ws);
            const assignedSeat = room.clients.some(c => c.seat === '0') ? '1' : '0';

            userSession = { ws, seat: assignedSeat, roomCode, selectedDeck: chosenDeckId, username };
            room.clients.push(userSession);

            this.checkAndStartMatch(room, chosenDeckId);
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

      ws.on('close', () => {
        handleClientLeave();
      });
    });
  }

  private broadcastLobbyRooms() {
    const roomList = Array.from(this.rooms.values()).map(r => ({
      code: r.code,
      name: r.name,
      mode: r.mode,
      allowSpectators: r.allowSpectators,
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

  private checkAndStartMatch(room: Room, p1DeckId: DeckId) {
    const client0 = room.clients.find(c => c.seat === '0');
    const client1 = room.clients.find(c => c.seat === '1');

    if (client0 && client1 && room.state.phase === 'WAITING_FOR_PLAYERS') {
      const mockDeck = { leader: { id: 'l1', cardNumber: '01', name: 'Mane Leader', type: 'MainCharacter' as const, element: 'Magic' as const }, cards: [] };
      room.state = startSeatedMatch(mockDeck, mockDeck);
      room.state.roomId = room.code;
    }
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