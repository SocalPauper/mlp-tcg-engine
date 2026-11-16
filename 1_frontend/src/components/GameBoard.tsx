import React, { useState } from 'react';

interface CardDefinition {
  id: string;
  cardNumber: string;
  name: string;
  type: string;
  element: string;
  imageUrl?: string;
  power?: number;
  defense?: number;
  effectText?: string;
}

interface LaneSlot {
  character: CardDefinition | null;
  item: CardDefinition | null;
  story: CardDefinition | null;
  plan: CardDefinition | null;
}

interface PlayerState {
  id: string;
  displayName: string;
  leader: CardDefinition | null;
  deck: CardDefinition[];
  hand: CardDefinition[];
  discard: CardDefinition[];
  points: number;
  lanes: {
    left: LaneSlot;
    center: LaneSlot;
    right: LaneSlot;
  };
}

export interface LiveGameState {
  roomId: string;
  phase: string;
  turnPlayerId: '0' | '1' | null;
  players: Record<'0' | '1', PlayerState>;
  announcements: { type: string; message: string; timestamp: number }[];
}

interface GameBoardProps {
  ws: WebSocket;
  gameState: LiveGameState;
  seat: '0' | '1' | 'spectator';
  onLeaveMatch: () => void;
}

export default function GameBoard({ ws, gameState, seat, onLeaveMatch }: GameBoardProps) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const mySeat: '0' | '1' = seat === '1' ? '1' : '0';
  const oppSeat: '0' | '1' = mySeat === '0' ? '1' : '0';

  const me = gameState.players[mySeat];
  const opp = gameState.players[oppSeat];
  const isSpectator = seat === 'spectator';

  const sendAction = (action: string, payload: any = {}) => {
    if (isSpectator || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'GAME_ACTION', action, payload }));
  };

  const handleLaneClick = (laneIndex: 'left' | 'center' | 'right') => {
    if (!selectedCardId || isSpectator) return;
    sendAction('PLAY_CHARACTER', { cardId: selectedCardId, laneIndex });
    setSelectedCardId(null);
  };

  const renderLane = (laneKey: 'left' | 'center' | 'right', laneData: LaneSlot, isOpponent: boolean) => {
    return (
      <div
        key={laneKey}
        onClick={() => !isOpponent && handleLaneClick(laneKey)}
        style={{
          flex: 1,
          minHeight: '190px',
          background: !isOpponent && selectedCardId ? 'rgba(236, 72, 153, 0.18)' : 'rgba(30, 17, 36, 0.85)',
          border: !isOpponent && selectedCardId ? '2px dashed #f472b6' : '1px solid #6b21a8',
          borderRadius: '12px',
          padding: '10px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: !isOpponent && selectedCardId ? 'pointer' : 'default',
          position: 'relative',
          transition: 'all 0.2s ease'
        }}
      >
        <span style={{ fontSize: '11px', textTransform: 'uppercase', color: '#c084fc', fontWeight: 700 }}>
          {laneKey} Lane
        </span>

        {/* Landscape Story Card Container + Portrait Plan Overlay */}
        <div style={{ position: 'relative', width: '140px', height: '84px', background: '#140b18', border: '1px solid #4c1d95', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {laneData.story ? (
            <div style={{ fontSize: '11px', color: '#fbcfe8', textAlign: 'center', padding: '4px' }}>
              📖 {laneData.story.name}
            </div>
          ) : (
            <span style={{ fontSize: '10px', color: '#6b7280' }}>Story Slot (Landscape)</span>
          )}

          {laneData.plan && (
            <div style={{
              position: 'absolute',
              top: '-10px',
              right: '-12px',
              width: '54px',
              height: '76px',
              background: 'linear-gradient(135deg, #831843, #4c1d95)',
              border: '1px solid #f472b6',
              borderRadius: '6px',
              fontSize: '9px',
              color: '#fff',
              padding: '4px',
              boxShadow: '0 4px 10px rgba(0,0,0,0.6)'
            }}>
              📜 {laneData.plan.name}
            </div>
          )}
        </div>

        {/* Character & Item Slot */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
          {laneData.character ? (
            <div style={{
              width: '92px',
              height: '116px',
              background: 'linear-gradient(160deg, #581c87, #be185d)',
              border: '2px solid #fbcfe8',
              borderRadius: '8px',
              padding: '6px',
              color: '#fff',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 4px 12px rgba(236, 72, 153, 0.35)'
            }}>
              <div style={{ fontSize: '10px', fontWeight: 'bold', lineHeight: 1.2 }}>{laneData.character.name}</div>
              <div style={{ fontSize: '10px', color: '#fde047', fontWeight: 800 }}>
                ⚔️ {laneData.character.power ?? 0} | 🛡️ {laneData.character.defense ?? 0}
              </div>
            </div>
          ) : (
            <div style={{
              width: '92px',
              height: '116px',
              border: '1px dashed #4b5563',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              color: '#6b7280',
              textAlign: 'center',
              padding: '4px'
            }}>
              {!isOpponent && selectedCardId ? 'Click to Deploy' : 'Empty Character'}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: '16px', maxWidth: '1300px', margin: '0 auto', color: '#fbcfe8' }}>
      {/* Top Match Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(45, 27, 54, 0.95)',
        border: '1px solid #9333ea',
        borderRadius: '12px',
        padding: '12px 20px',
        marginBottom: '16px'
      }}>
        <div>
          <strong style={{ fontSize: '16px', color: '#f472b6' }}>Room: {gameState.roomId}</strong>
          <span style={{ marginLeft: '14px', fontSize: '13px', color: '#d8b4fe' }}>
            Phase: <strong>{gameState.phase}</strong> • Role: <strong>{isSpectator ? 'Spectator' : `Player ${Number(seat) + 1}`}</strong>
          </span>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {!isSpectator && (
            <>
              <button onClick={() => sendAction('DRAW_CARD')} className="mlp-btn secondary">
                Draw Card ({me.deck.length})
              </button>
              <button onClick={() => sendAction('ADVANCE_PHASE')} className="mlp-btn">
                Next Phase ⏭️
              </button>
            </>
          )}
          <button
            onClick={() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
              }
              onLeaveMatch();
            }}
            className="mlp-btn danger"
          >
            Leave Match
          </button>
        </div>
      </div>

      {/* Opponent Board */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
          <span>👑 Opponent: <strong>{opp.displayName}</strong> ({opp.leader?.name || 'No Leader'})</span>
          <span>Points: <strong>{opp.points}</strong> • Hand: <strong>{opp.hand.length}</strong> • Deck: <strong>{opp.deck.length}</strong></span>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {renderLane('left', opp.lanes.left, true)}
          {renderLane('center', opp.lanes.center, true)}
          {renderLane('right', opp.lanes.right, true)}
        </div>
      </div>

      {/* Player Board */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
          <span>✨ You: <strong>{me.displayName}</strong> ({me.leader?.name || 'No Leader'})</span>
          <span>Points: <strong>{me.points}</strong> • Deck: <strong>{me.deck.length}</strong></span>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {renderLane('left', me.lanes.left, false)}
          {renderLane('center', me.lanes.center, false)}
          {renderLane('right', me.lanes.right, false)}
        </div>
      </div>

      {/* Player Hand */}
      {!isSpectator && (
        <div style={{
          background: 'rgba(30, 17, 36, 0.95)',
          border: '1px solid #9333ea',
          borderRadius: '12px',
          padding: '14px'
        }}>
          <div style={{ fontSize: '13px', marginBottom: '10px', color: '#e9d5ff' }}>
            Your Hand ({me.hand.length}) {selectedCardId ? '— Select a lane above to play selected card!' : '— Click a card to select it'}
          </div>
          <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '6px' }}>
            {me.hand.map(card => {
              const isSelected = selectedCardId === card.id;
              return (
                <div
                  key={card.id}
                  onClick={() => setSelectedCardId(isSelected ? null : card.id)}
                  style={{
                    minWidth: '120px',
                    maxWidth: '120px',
                    height: '160px',
                    background: isSelected ? 'linear-gradient(135deg, #ec4899, #9333ea)' : '#2d1b36',
                    border: isSelected ? '2px solid #fde047' : '1px solid #9333ea',
                    borderRadius: '10px',
                    padding: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    transform: isSelected ? 'translateY(-8px)' : 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '10px', color: '#f9a8d4' }}>{card.type} • {card.element}</div>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', marginTop: '4px', color: '#fff' }}>{card.name}</div>
                  </div>
                  <div style={{ fontSize: '10px', color: '#e9d5ff' }}>{card.effectText}</div>
                  <div style={{ fontSize: '11px', fontWeight: 800, color: '#fde047' }}>
                    ⚔️ {card.power ?? 0} | 🛡️ {card.defense ?? 0}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}