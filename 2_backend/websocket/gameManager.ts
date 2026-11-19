import { WebSocket, WebSocketServer } from 'ws';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../4_data/db.js';
import {
  KayouGameState,
  CardDefinition,
  HydratedDeckPayload,
  MatchRewardSummary,
} from '../../3_engine/types.js';
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
  endTurn,
  forfeitMatch,
} from '../../3_engine/gameRules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const startermaps: any[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../routes/StartingDecks.json'), 'utf-8')
);

const TURN_DURATION_MS = 180_000;
const DISCONNECT_GRACE_MS = 180_000;
const RANKED_REMATCH_COOLDOWN_MS = 10 * 60 * 1000; // 10-minute anti-back-to-back Ranked pairing window

interface SeatConnection {
  ws: WebSocket | null;
  userId?: string;
  displayName: string;
  deckId?: string;
  hydratedDeck?: HydratedDeckPayload;
  sessionToken: string;
  disconnectTimer?: ReturnType<typeof setTimeout>;
}

interface GameRoom {
  roomCode: string;
  mode: string;
  isRandomMatch: boolean;
  isRanked: boolean;
  isPrivate: boolean;
  password?: string;
  state: KayouGameState;
  seats: Partial<Record<'0' | '1', SeatConnection>>;
  spectators: Set<WebSocket>;
  turnTimer?: ReturnType<typeof setTimeout>;
  rankedRecorded?: boolean;
  rewardsGranted?: boolean;
}

interface QueuedPlayer {
  ws: WebSocket;
  userId?: string;
  displayName: string;
  deckId: string;
  mode: string;
  queuedAt: number;
}

const QUEUE_REWARD_CONFIG: Record<
  'QUICK_PLAY' | 'CASUAL' | 'RANKED',
  { win: number; loss: number; firstWin: number }
> = {
  QUICK_PLAY: { win: 25, loss: 10, firstWin: 25 },
  CASUAL: { win: 40, loss: 15, firstWin: 40 },
  RANKED: { win: 65, loss: 20, firstWin: 50 },
};

export class GameManager {
  private wss: WebSocketServer;
  private rooms: Map<string, GameRoom> = new Map();
  private quickPlayQueue: QueuedPlayer[] = [];
  private recentRankedOpponents: Map<string, { opponentId: string; timestamp: number }> = new Map();

  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ server });
    this.setupListeners();
  }

  private setupListeners() {
    this.wss.on('connection', (ws: WebSocket) => {
      ws.on('message', async (rawData: string) => {
        try {
          const message = JSON.parse(rawData.toString());
          await this.handleMessage(ws, message);
        } catch (err) {
          console.error('[WS PARSE ERROR]', err);
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });
    });
  }

  private getClientIp(ws: WebSocket): string {
    return String((ws as any)?._socket?.remoteAddress || 'unknown');
  }

  private async handleMessage(ws: WebSocket, msg: any) {
    switch (msg.type) {
      case 'PING': {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'PONG' }));
        }
        break;
      }

      case 'GET_OPEN_ROOMS': {
        this.sendOpenRooms(ws);
        break;
      }

      case 'QUICK_PLAY': {
        const mode = msg.mode || 'Standard';
        const userId = msg.userId ? String(msg.userId) : undefined;
        const displayName = msg.displayName || 'Guest Pony';
        const deckId = msg.deckId || 'starter-sd01';

        this.quickPlayQueue = this.quickPlayQueue.filter(
          (q) => q.ws !== ws && q.ws.readyState === WebSocket.OPEN
        );

        const incomingKey = userId || `${displayName}:${this.getClientIp(ws)}`;
        const isRankedQueue = String(mode).toLowerCase() === 'ranked';

        let matchIdx = -1;
        for (let i = 0; i < this.quickPlayQueue.length; i++) {
          const candidate = this.quickPlayQueue[i];
          if (candidate.mode !== mode) continue;

          if (isRankedQueue) {
            const candidateKey =
              candidate.userId || `${candidate.displayName}:${this.getClientIp(candidate.ws)}`;
            if (candidateKey === incomingKey) continue;

            const lastForIncoming = this.recentRankedOpponents.get(incomingKey);
            const lastForCandidate = this.recentRankedOpponents.get(candidateKey);
            const now = Date.now();
            const isRecentRematch =
              (lastForIncoming &&
                lastForIncoming.opponentId === candidateKey &&
                now - lastForIncoming.timestamp < RANKED_REMATCH_COOLDOWN_MS) ||
              (lastForCandidate &&
                lastForCandidate.opponentId === incomingKey &&
                now - lastForCandidate.timestamp < RANKED_REMATCH_COOLDOWN_MS);

            // Prevent immediate back-to-back Ranked pairings (unless opponent has waited > 60s)
            if (isRecentRematch && now - candidate.queuedAt < 60_000) {
              continue;
            }
          }

          matchIdx = i;
          break;
        }

        if (matchIdx !== -1) {
          const opponent = this.quickPlayQueue.splice(matchIdx, 1)[0];
          const roomCode = this.generateRoomCode();

          if (isRankedQueue) {
            const oppKey =
              opponent.userId || `${opponent.displayName}:${this.getClientIp(opponent.ws)}`;
            const now = Date.now();
            this.recentRankedOpponents.set(incomingKey, { opponentId: oppKey, timestamp: now });
            this.recentRankedOpponents.set(oppKey, { opponentId: incomingKey, timestamp: now });
          }

          const room: GameRoom = {
            roomCode,
            mode,
            isRandomMatch: true,
            isRanked: isRankedQueue,
            isPrivate: false,
            state: createWaitingMatch(),
            seats: {},
            spectators: new Set(),
          };
          room.state.roomId = roomCode;
          this.rooms.set(roomCode, room);

          await this.seatPlayer(room, '0', opponent.ws, opponent.userId, opponent.displayName, opponent.deckId);
          await this.seatPlayer(room, '1', ws, userId, displayName, deckId);
          this.broadcastRoomList();
        } else {
          this.quickPlayQueue.push({
            ws,
            userId,
            displayName,
            deckId,
            mode,
            queuedAt: Date.now(),
          });
          ws.send(JSON.stringify({ type: 'QUEUED', mode }));
        }
        break;
      }

      case 'CANCEL_QUICK_PLAY': {
        this.quickPlayQueue = this.quickPlayQueue.filter((q) => q.ws !== ws);
        break;
      }

      case 'CREATE_ROOM': {
        const roomCode = this.generateRoomCode();
        const isPrivate = Boolean(msg.isPrivate);
        const room: GameRoom = {
          roomCode,
          mode: msg.mode || 'Standard',
          isRandomMatch: false,
          isRanked: false,
          isPrivate,
          password: msg.password || undefined,
          state: createWaitingMatch(),
          seats: {},
          spectators: new Set(),
        };
        room.state.roomId = roomCode;
        this.rooms.set(roomCode, room);

        await this.seatPlayer(
          room,
          '0',
          ws,
          msg.userId ? String(msg.userId) : undefined,
          msg.displayName || 'Host Pony',
          msg.deckId || 'starter-sd01'
        );
        this.broadcastRoomList();
        break;
      }

      case 'JOIN_ROOM': {
        const roomCode = String(msg.roomCode || '').trim().toUpperCase();
        const room = this.rooms.get(roomCode);
        if (!room) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found.' }));
          return;
        }
        if (room.isPrivate && room.password && room.password !== msg.password) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Incorrect room password.' }));
          return;
        }

        const asSpectator = Boolean(msg.asSpectator);
        if (!asSpectator && !room.seats['0']) {
          await this.seatPlayer(
            room,
            '0',
            ws,
            msg.userId ? String(msg.userId) : undefined,
            msg.displayName || 'Player 1',
            msg.deckId || 'starter-sd01'
          );
        } else if (!asSpectator && !room.seats['1']) {
          await this.seatPlayer(
            room,
            '1',
            ws,
            msg.userId ? String(msg.userId) : undefined,
            msg.displayName || 'Player 2',
            msg.deckId || 'starter-sd01'
          );
        } else {
          room.spectators.add(ws);
          ws.send(
            JSON.stringify({
              type: 'STATE_UPDATE',
              roomCode: room.roomCode,
              seat: 'spectator',
              state: room.state,
            })
          );
        }
        this.broadcastRoomList();
        break;
      }

      case 'RECONNECT_MATCH': {
        const roomCode = String(msg.roomCode || '').trim().toUpperCase();
        const seat = msg.seat as '0' | '1';
        const sessionToken = String(msg.sessionToken || '');

        const room = this.rooms.get(roomCode);
        const existingSeat = room?.seats[seat];

        if (!room || !existingSeat || existingSeat.sessionToken !== sessionToken) {
          ws.send(JSON.stringify({ type: 'RECONNECT_FAILED' }));
          return;
        }

        if (existingSeat.disconnectTimer) {
          clearTimeout(existingSeat.disconnectTimer);
          existingSeat.disconnectTimer = undefined;
        }

        existingSeat.ws = ws;
        room.state.players[seat].isConnected = true;
        this.broadcastState(room);
        break;
      }

      case 'GAME_ACTION': {
        const found = this.findRoomBySocket(ws);
        if (!found || found.seat === 'spectator') return;
        const { room, seat } = found;
        const prevTurnPlayer = room.state.turnPlayerId;
        const prevPhase = room.state.phase;

        switch (msg.action) {
          case 'ACK_VS_INTRO':
            room.state = acknowledgeVsIntro(room.state);
            break;
          case 'MULLIGAN_DECISION':
            room.state = resolveMulligan(room.state, seat, Boolean(msg.payload?.doMulligan));
            break;
          case 'PLAY_CARD':
            room.state = playCardFromHand(
              room.state,
              seat,
              msg.payload?.cardId,
              msg.payload?.laneIndex
            );
            break;
          case 'SELECT_TARGET':
            room.state = resolveTargetSelection(
              room.state,
              seat,
              msg.payload?.targetOwner,
              msg.payload?.laneIndex
            );
            break;
          case 'CANCEL_TARGET':
            room.state = cancelTargetSelection(room.state, seat);
            break;
          case 'RESOLVE_HAND_CHOICE':
            room.state = resolveHandChoice(
              room.state,
              seat,
              Array.isArray(msg.payload?.selectedIndices) ? msg.payload.selectedIndices : []
            );
            break;
          case 'ACTIVATE_ADVENTURE':
            room.state = activateCharacterAdventureAbility(
              room.state,
              seat,
              msg.payload?.laneIndex
            );
            break;
          case 'ACTIVATE_MANE_ABILITY':
            room.state = activateManeLeaderAbility(room.state, seat);
            break;
          case 'START_CONTACT':
            room.state = startContactPhase(room.state, seat);
            break;
          case 'INSPIRE_SCENE':
            room.state = inspireInContact(room.state, seat, Number(msg.payload?.sceneIndex));
            break;
          case 'PASS_INSPIRE':
            room.state = passInspireInContact(room.state, seat);
            break;
          case 'ACK_CLASH_ANIMATION':
            room.state = acknowledgeClashAnimation(room.state, seat);
            break;
          case 'BREAKTHROUGH_CHOICE':
            room.state = resolveBreakthroughChoice(
              room.state,
              seat,
              msg.payload?.choice
            );
            break;
          case 'ACK_PLAN_REVEAL':
            room.state = acknowledgePlanReveal(room.state, seat);
            break;
          case 'ACK_STORY_REVEAL':
            room.state = acknowledgeStoryReveal(room.state, seat);
            break;
          case 'END_TURN':
            room.state = endTurn(room.state, seat);
            break;
        }

        if (
          room.state.phase === 'MAIN_PHASE' &&
          (prevPhase !== 'MAIN_PHASE' || prevTurnPlayer !== room.state.turnPlayerId)
        ) {
          this.resetTurnTimer(room);
        }

        await this.finalizeMatchOutcome(room);
        this.broadcastState(room);
        break;
      }

      case 'LEAVE_ROOM': {
        const found = this.findRoomBySocket(ws);
        if (!found) return;
        const { room, seat } = found;
        if (seat === '0' || seat === '1') {
          this.clearRoomTimers(room);
          if (room.state.phase !== 'WAITING_FOR_PLAYERS' && room.state.phase !== 'GAME_OVER') {
            room.state = forfeitMatch(
              room.state,
              seat,
              `${room.state.players[seat].displayName} forfeited the match.`
            );
            await this.finalizeMatchOutcome(room);
            this.broadcastState(room);
          }
          delete room.seats[seat];
        } else {
          room.spectators.delete(ws);
        }
        if (!room.seats['0'] && !room.seats['1']) {
          this.rooms.delete(room.roomCode);
        }
        this.broadcastRoomList();
        break;
      }
    }
  }

  private async seatPlayer(
    room: GameRoom,
    seat: '0' | '1',
    ws: WebSocket,
    userId: string | undefined,
    displayName: string,
    deckId: string
  ) {
    const hydratedDeck = await this.hydrateDeckFromDatabase(deckId);
    const sessionToken = crypto.randomBytes(24).toString('hex');

    room.seats[seat] = {
      ws,
      userId,
      displayName,
      deckId,
      hydratedDeck,
      sessionToken,
    };

    room.state.players[seat].displayName = displayName;
    room.state.players[seat].leader = hydratedDeck.leader;
    room.state.players[seat].isConnected = true;

    if (room.seats['0']?.hydratedDeck && room.seats['1']?.hydratedDeck) {
      room.state = startSeatedMatch(
        room.seats['0'].hydratedDeck,
        room.seats['1'].hydratedDeck,
        room.seats['0'].displayName,
        room.seats['1'].displayName
      );
      room.state.roomId = room.roomCode;
    }

    this.broadcastState(room);
  }

  private resetTurnTimer(room: GameRoom) {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    if (room.state.phase === 'GAME_OVER' || room.state.phase === 'WAITING_FOR_PLAYERS') return;

    room.state.turnDeadlineMs = Date.now() + TURN_DURATION_MS;
    room.turnTimer = setTimeout(async () => {
      if (room.state.phase === 'GAME_OVER' || room.state.phase === 'WAITING_FOR_PLAYERS') return;
      const idleSeat = room.state.turnPlayerId;
      room.state = forfeitMatch(
        room.state,
        idleSeat,
        `${room.state.players[idleSeat].displayName} ran out of turn time (3 minutes of inactivity)!`
      );
      await this.finalizeMatchOutcome(room);
      this.broadcastState(room);
    }, TURN_DURATION_MS);
  }

  private clearRoomTimers(room: GameRoom) {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = undefined;
    }
    for (const s of ['0', '1'] as const) {
      if (room.seats[s]?.disconnectTimer) {
        clearTimeout(room.seats[s]!.disconnectTimer);
        room.seats[s]!.disconnectTimer = undefined;
      }
    }
  }

  private getQueueTier(room: GameRoom): 'QUICK_PLAY' | 'CASUAL' | 'RANKED' | 'PRIVATE' {
    if (!room.isRandomMatch || room.isPrivate) return 'PRIVATE';
    const m = String(room.mode || '').toLowerCase();
    if (room.isRanked || m === 'ranked') return 'RANKED';
    if (m.includes('quick')) return 'QUICK_PLAY';
    return 'CASUAL';
  }

  private async finalizeMatchOutcome(room: GameRoom) {
    if (room.state.phase !== 'GAME_OVER' || !room.state.winnerId) return;

    // 1. Record Ranked ELO if applicable
    if (room.isRanked && !room.rankedRecorded) {
      room.rankedRecorded = true;
      const winnerSeat = room.state.winnerId;
      const loserSeat: '0' | '1' = winnerSeat === '0' ? '1' : '0';
      const winnerUserId = room.seats[winnerSeat]?.userId;
      const loserUserId = room.seats[loserSeat]?.userId;

      if (winnerUserId && loserUserId && winnerUserId !== loserUserId) {
        try {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const wRes = await client.query(
              'SELECT ranked_elo, ranked_wins, ranked_losses FROM auth.users WHERE id = $1 FOR UPDATE',
              [winnerUserId]
            );
            const lRes = await client.query(
              'SELECT ranked_elo, ranked_wins, ranked_losses FROM auth.users WHERE id = $1 FOR UPDATE',
              [loserUserId]
            );
            if (wRes.rows.length > 0 && lRes.rows.length > 0) {
              const wElo = Number(wRes.rows[0].ranked_elo || 1200);
              const lElo = Number(lRes.rows[0].ranked_elo || 1200);
              const expectedW = 1 / (1 + Math.pow(10, (lElo - wElo) / 400));
              const delta = Math.max(8, Math.round(32 * (1 - expectedW)));
              const newWElo = wElo + delta;
              const newLElo = Math.max(100, lElo - delta);

              await client.query(
                'UPDATE auth.users SET ranked_elo = $1, ranked_wins = COALESCE(ranked_wins, 0) + 1 WHERE id = $2',
                [newWElo, winnerUserId]
              );
              await client.query(
                'UPDATE auth.users SET ranked_elo = $1, ranked_losses = COALESCE(ranked_losses, 0) + 1 WHERE id = $2',
                [newLElo, loserUserId]
              );
            }
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK');
            console.error('[RANKED ELO RECORD ERROR]', err);
          } finally {
            client.release();
          }
        } catch (err) {
          console.error('[RANKED DB CONNECT ERROR]', err);
        }
      }
    }

    // 2. Grant Tiered Pony Points Rewards (Random Public Matchmaking Only)
    if (room.rewardsGranted) return;
    room.rewardsGranted = true;

    const queueTier = this.getQueueTier(room);
    const rewardSummary: Partial<Record<'0' | '1', MatchRewardSummary>> = {};

    if (queueTier === 'PRIVATE') {
      for (const s of ['0', '1'] as const) {
        rewardSummary[s] = {
          queueTier: 'PRIVATE',
          basePoints: 0,
          firstWinBonus: 0,
          streakBonus: 0,
          totalEarned: 0,
          newBalance: 0,
          note: 'Private / Custom Lobbies award 0 Pony Points.',
        };
      }
      room.state.rewardSummary = rewardSummary;
      return;
    }

    const tierRates = QUEUE_REWARD_CONFIG[queueTier];
    const winnerSeat = room.state.winnerId;
    const loserSeat: '0' | '1' = winnerSeat === '0' ? '1' : '0';
    const reachedTurn4 = room.state.turnNumber >= 4;
    const isForfeitOrDisconnect = /forfeit|disconnected|inactivity/i.test(
      room.state.winReason || ''
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const seat of [winnerSeat, loserSeat] as ('0' | '1')[]) {
        const userId = room.seats[seat]?.userId;
        const isWinner = seat === winnerSeat;

        if (!userId) {
          rewardSummary[seat] = {
            queueTier,
            basePoints: 0,
            firstWinBonus: 0,
            streakBonus: 0,
            totalEarned: 0,
            newBalance: 0,
            note: 'Sign in to earn Pony Points from public matches!',
          };
          continue;
        }

        const uRes = await client.query(
          `SELECT reward_points, win_streak, (last_first_win_date = CURRENT_DATE) AS claimed_today
           FROM auth.users WHERE id = $1 FOR UPDATE`,
          [userId]
        );
        if (uRes.rows.length === 0) continue;

        const currentPoints = Number(uRes.rows[0].reward_points || 0);
        const currentStreak = Number(uRes.rows[0].win_streak || 0);
        const claimedToday = Boolean(uRes.rows[0].claimed_today);

        let basePoints = 0;
        let firstWinBonus = 0;
        let streakBonus = 0;
        let nextStreak = 0;
        let note = '';

        if (isWinner) {
          basePoints = tierRates.win;
          nextStreak = currentStreak + 1;
          if (!claimedToday) {
            firstWinBonus = tierRates.firstWin;
          }
          if (nextStreak >= 2 && (queueTier === 'CASUAL' || queueTier === 'RANKED')) {
            streakBonus = Math.min(30, (nextStreak - 1) * 10);
          }
          note = `Victory in ${queueTier.replace('_', ' ')}!`;
        } else {
          nextStreak = 0;
          if (reachedTurn4 && !isForfeitOrDisconnect) {
            basePoints = tierRates.loss;
            note = `Completed match (Turn ${room.state.turnNumber}) consolation reward.`;
          } else {
            note = 'Loss rewards require reaching Turn 4 without forfeiting/disconnecting.';
          }
        }

        const totalEarned = basePoints + firstWinBonus + streakBonus;
        let newBalance = currentPoints;

        if (totalEarned > 0) {
          const txRes = await client.query(
            `INSERT INTO auth.point_transactions (user_id, room_code, queue_type, delta, reason)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id, room_code) DO NOTHING
             RETURNING id`,
            [userId, room.roomCode, queueTier, totalEarned, note]
          );

          if (txRes.rows.length > 0) {
            const upd = await client.query(
              `UPDATE auth.users
               SET reward_points = reward_points + $1,
                   win_streak = $2,
                   last_first_win_date = CASE WHEN $3 > 0 THEN CURRENT_DATE ELSE last_first_win_date END
               WHERE id = $4
               RETURNING reward_points`,
              [totalEarned, nextStreak, firstWinBonus, userId]
            );
            newBalance = Number(upd.rows[0].reward_points || currentPoints + totalEarned);
          }
        } else {
          await client.query(`UPDATE auth.users SET win_streak = 0 WHERE id = $1`, [userId]);
        }

        rewardSummary[seat] = {
          queueTier,
          basePoints,
          firstWinBonus,
          streakBonus,
          totalEarned,
          newBalance,
          note,
        };
      }

      await client.query('COMMIT');
      room.state.rewardSummary = rewardSummary;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[PONY POINTS REWARD ERROR]', err);
    } finally {
      client.release();
    }
  }

  private async hydrateDeckFromDatabase(deckId: string): Promise<HydratedDeckPayload> {
    const cleanDeckId = String(deckId || 'starter-sd01').trim();
    const res = await pool.query(
      `SELECT id, name, card_type, element, cost, power, defense, traits, effect_text, image_url, rarity, set_code
       FROM game.cards;`
    );

    const cardMap = new Map<string, CardDefinition>();
    for (const row of res.rows) {
      const def: CardDefinition = {
        id: row.id,
        cardNumber: row.id,
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
        setCode: row.set_code || 'BP01',
      };
      cardMap.set(String(row.id).toLowerCase(), def);
    }

    const resolveCard = (id: string): CardDefinition | null => {
      if (!id) return null;
      return cardMap.get(String(id).toLowerCase()) || null;
    };

    const resolveManeCharacter = (
      maneId: string | null,
      deckNameHint?: string
    ): CardDefinition | null => {
      if (maneId) {
        const direct = resolveCard(maneId);
        if (direct && direct.imageUrl) return direct;
      }

      const hint = String(deckNameHint || '').split('-')[0].trim().toLowerCase();
      if (hint) {
        for (const c of cardMap.values()) {
          const t = String(c.type || '').toLowerCase();
          const n = String(c.name || '').toLowerCase();
          if (
            (t === 'mane character' || t === 'maincharacter') &&
            n.includes(hint) &&
            !n.includes(' - ') &&
            !n.includes(' – ') &&
            !String(c.id).includes('-S')
          ) {
            return c;
          }
        }
      }

      return null;
    };

    let starter = startermaps.find(
      (s: any) => String(s.id).toLowerCase() === cleanDeckId.toLowerCase()
    );

    if (!starter && !cleanDeckId.startsWith('starter-')) {
      const dbDeckRes = await pool.query(
        'SELECT name, mane_character, cards FROM auth.decks WHERE id = $1;',
        [cleanDeckId]
      );
      if (dbDeckRes.rows.length > 0) {
        const row = dbDeckRes.rows[0];
        const parsedCards =
          typeof row.cards === 'string' ? JSON.parse(row.cards) : row.cards || {};

        let rawManeId: string | null = null;
        if (typeof row.mane_character === 'string') {
          if (row.mane_character.startsWith('{')) {
            try {
              const obj = JSON.parse(row.mane_character);
              rawManeId = obj.id || obj.card_id || null;
            } catch {
              rawManeId = row.mane_character;
            }
          } else {
            rawManeId = row.mane_character;
          }
        } else if (row.mane_character && typeof row.mane_character === 'object') {
          rawManeId = row.mane_character.id || row.mane_character.card_id || null;
        }

        const expandEntries = (list: any[]): string[] => {
          const out: string[] = [];
          for (const item of list || []) {
            if (typeof item === 'string') out.push(item);
            else if (item && typeof item === 'object') {
              const cid = item.card_id || item.id;
              const qty = Number(item.quantity) || 1;
              if (cid) {
                for (let i = 0; i < qty; i++) out.push(cid);
              }
            }
          }
          return out;
        };

        const leader =
          resolveManeCharacter(rawManeId, row.name) ||
          resolveManeCharacter('SD01-RR01', 'Twilight Sparkle')!;

        return {
          leader,
          storyDeck: expandEntries(parsedCards.story_deck || parsedCards.stories)
            .map(resolveCard)
            .filter(Boolean) as CardDefinition[],
          sceneDeck: expandEntries(parsedCards.scene_deck || parsedCards.scenes)
            .map(resolveCard)
            .filter(Boolean) as CardDefinition[],
          mainDeck: expandEntries(parsedCards.main_deck || parsedCards.main)
            .map(resolveCard)
            .filter(Boolean) as CardDefinition[],
        };
      }
    }

    if (!starter) {
      starter = startermaps[0];
    }

    const leader =
      resolveManeCharacter(starter.mane_character, starter.name) ||
      resolveManeCharacter('SD01-RR01', 'Twilight Sparkle')!;

    return {
      leader,
      storyDeck: (starter.story_deck || []).map(resolveCard).filter(Boolean) as CardDefinition[],
      sceneDeck: (starter.scene_deck || []).map(resolveCard).filter(Boolean) as CardDefinition[],
      mainDeck: (starter.main_deck || []).map(resolveCard).filter(Boolean) as CardDefinition[],
    };
  }

  private broadcastState(room: GameRoom) {
    for (const seat of ['0', '1'] as const) {
      const conn = room.seats[seat];
      if (conn?.ws && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(
          JSON.stringify({
            type: 'STATE_UPDATE',
            roomCode: room.roomCode,
            seat,
            sessionToken: conn.sessionToken,
            state: room.state,
          })
        );
      }
    }
    for (const specWs of room.spectators) {
      if (specWs.readyState === WebSocket.OPEN) {
        specWs.send(
          JSON.stringify({
            type: 'STATE_UPDATE',
            roomCode: room.roomCode,
            seat: 'spectator',
            state: room.state,
          })
        );
      }
    }
  }

  private sendOpenRooms(ws: WebSocket) {
    const openRooms = Array.from(this.rooms.values()).map((r) => ({
      roomCode: r.roomCode,
      mode: r.mode,
      isPrivate: r.isPrivate,
      hasPassword: Boolean(r.password),
      player0: r.seats['0']?.displayName || null,
      player1: r.seats['1']?.displayName || null,
      spectatorCount: r.spectators.size,
      status: r.seats['0'] && r.seats['1'] ? 'IN_PROGRESS' : 'WAITING',
    }));
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'OPEN_ROOMS', rooms: openRooms }));
    }
  }

  private broadcastRoomList() {
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        this.sendOpenRooms(client);
      }
    }
  }

  private findRoomBySocket(ws: WebSocket): { room: GameRoom; seat: '0' | '1' | 'spectator' } | null {
    for (const room of this.rooms.values()) {
      if (room.seats['0']?.ws === ws) return { room, seat: '0' };
      if (room.seats['1']?.ws === ws) return { room, seat: '1' };
      if (room.spectators.has(ws)) return { room, seat: 'spectator' };
    }
    return null;
  }

  private handleDisconnect(ws: WebSocket) {
    this.quickPlayQueue = this.quickPlayQueue.filter((q) => q.ws !== ws);
    const found = this.findRoomBySocket(ws);
    if (!found) return;
    const { room, seat } = found;

    if (seat === 'spectator') {
      room.spectators.delete(ws);
      this.broadcastRoomList();
      return;
    }

    const seatConn = room.seats[seat];
    if (!seatConn) return;
    seatConn.ws = null;

    if (room.state.phase === 'WAITING_FOR_PLAYERS' || room.state.phase === 'GAME_OVER') {
      delete room.seats[seat];
      if (!room.seats['0'] && !room.seats['1']) {
        this.rooms.delete(room.roomCode);
      }
      this.broadcastRoomList();
      return;
    }

    room.state.players[seat].isConnected = false;
    this.broadcastState(room);

    seatConn.disconnectTimer = setTimeout(async () => {
      if (room.state.phase !== 'GAME_OVER') {
        room.state = forfeitMatch(
          room.state,
          seat,
          `${room.state.players[seat].displayName} disconnected and did not return within 3 minutes.`
        );
        this.clearRoomTimers(room);
        await this.finalizeMatchOutcome(room);
        this.broadcastState(room);
      }
    }, DISCONNECT_GRACE_MS);
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return this.rooms.has(code) ? this.generateRoomCode() : code;
  }
}