import React, { useState, useEffect } from 'react';
import './GameBoard.css';

const CARD_BACK_URL = 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/CardBack.webp';

interface CardDefinition {
  id: string;
  cardNumber: string;
  name: string;
  type: string;
  element: string;
  cost: number;
  power: number;
  defense: number;
  effectText?: string;
  imageUrl?: string;
  rarity?: string;
}

interface SceneCardInPlay {
  card: CardDefinition;
  isFaceUp: boolean;
  isExhausted: boolean;
  isLockedFaceDown: boolean;
}

interface StoryStageSlot {
  stage: 1 | 2 | 3 | 4;
  storyCard: CardDefinition | null;
  isStoryCompleted: boolean;
  planCard: CardDefinition | null;
  isPlanRevealed: boolean;
}

interface AdventureSlot {
  character: CardDefinition | null;
  items: CardDefinition[];
  inspoBoost: number;
}

interface PlayerState {
  id: '0' | '1';
  displayName: string;
  leader: CardDefinition | null;
  mainDeck: CardDefinition[];
  sceneDeck: CardDefinition[];
  hand: CardDefinition[];
  retirement: CardDefinition[];
  sceneArea: SceneCardInPlay[];
  storyStages: StoryStageSlot[];
  storyProgress: number;
  adventureArea: {
    left: AdventureSlot;
    center: AdventureSlot;
    right: AdventureSlot;
  };
  mulliganStatus: 'PENDING' | 'KEPT' | 'MULLIGANED';
  turnsTaken: number;
}

export interface LiveGameState {
  roomId: string;
  phase:
    | 'WAITING_FOR_PLAYERS'
    | 'VS_INTRO'
    | 'MULLIGAN'
    | 'MAIN_PHASE'
    | 'CONTACT_INSPIRE'
    | 'CONTACT_RESOLUTION'
    | 'BREAKTHROUGH_CHOICE'
    | 'GAME_OVER';
  firstPlayerId: '0' | '1';
  turnPlayerId: '0' | '1';
  turnNumber: number;
  winnerId: '0' | '1' | null;
  players: Record<'0' | '1', PlayerState>;
  contactState: {
    activeLane: 'left' | 'center' | 'right';
    laneQueue: ('left' | 'center' | 'right')[];
    promptPlayerId: '0' | '1';
    consecutivePasses: number;
    attackerPower: number;
    defenderPower: number;
  } | null;
  lastClashEvent: {
    id: number;
    lane: 'left' | 'center' | 'right';
    attackerCard: CardDefinition;
    defenderCard: CardDefinition;
    attackerTotalPower: number;
    defenderTotalPower: number;
    outcome: 'ATTACKER_WINS' | 'DEFENDER_WINS' | 'TIE';
  } | null;
  announcements: { type: string; message: string; timestamp: number }[];
}

interface GameBoardProps {
  ws: WebSocket;
  gameState: LiveGameState;
  seat: '0' | '1' | 'spectator';
  onLeaveMatch: () => void;
}

export default function GameBoard({ ws, gameState, seat, onLeaveMatch }: GameBoardProps) {
  const [selectedHandCardId, setSelectedHandCardId] = useState<string | null>(null);
  const [inspectedCard, setInspectedCard] = useState<CardDefinition | null>(null);
  const [visibleClashId, setVisibleClashId] = useState<number | null>(null);
  const [choosingPlanTarget, setChoosingPlanTarget] = useState(false);
  const [mobileHandExpanded, setMobileHandExpanded] = useState(false);

  const mySeat: '0' | '1' = seat === '1' ? '1' : '0';
  const oppSeat: '0' | '1' = mySeat === '0' ? '1' : '0';
  const isSpectator = seat === 'spectator';

  const me = gameState.players[mySeat];
  const opp = gameState.players[oppSeat];
  const isMyTurn = !isSpectator && gameState.turnPlayerId === mySeat;

  // Attempt landscape orientation lock on mobile browsers that support it
  useEffect(() => {
    const orient = (window.screen as any)?.orientation;
    if (orient && typeof orient.lock === 'function') {
      orient.lock('landscape').catch(() => {
        // Ignored on browsers that require explicit fullscreen gesture first
      });
    }
    return () => {
      if (orient && typeof orient.unlock === 'function') {
        try {
          orient.unlock();
        } catch {
          // Ignore unlock error
        }
      }
    };
  }, []);

  // Auto-advance VS Intro screen after 3.2 seconds
  useEffect(() => {
    if (gameState.phase === 'VS_INTRO' && !isSpectator) {
      const timer = setTimeout(() => {
        sendAction('ACK_VS_INTRO');
      }, 3200);
      return () => clearTimeout(timer);
    }
  }, [gameState.phase, isSpectator]);

  // Trigger dramatic Clash showdown popup whenever a new Clash resolves
  useEffect(() => {
    if (gameState.lastClashEvent && gameState.lastClashEvent.id !== visibleClashId) {
      setVisibleClashId(gameState.lastClashEvent.id);
      const timer = setTimeout(() => {
        setVisibleClashId(null);
      }, 2200);
      return () => clearTimeout(timer);
    }
  }, [gameState.lastClashEvent?.id]);

  const sendAction = (action: string, payload: any = {}) => {
    if (isSpectator || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'GAME_ACTION', action, payload }));
  };

  const selectedHandCard = me.hand.find(c => c.id === selectedHandCardId) || null;
  const availableHarmony = me.sceneArea.filter(s => !s.isExhausted).length;

  const handleAdventureSlotClick = (lane: 'left' | 'center' | 'right') => {
    if (!isMyTurn || gameState.phase !== 'MAIN_PHASE' || !selectedHandCard) return;
    sendAction('PLAY_CARD', { cardId: selectedHandCard.id, laneIndex: lane });
    setSelectedHandCardId(null);
    setMobileHandExpanded(false);
  };

  const handleContextMenu = (e: React.MouseEvent, card: CardDefinition | null) => {
    e.preventDefault();
    if (card) setInspectedCard(card);
  };

  const renderPlayerHalf = (player: PlayerState, isOpponent: boolean) => {
    const isInspirePromptMine =
      !isOpponent &&
      gameState.phase === 'CONTACT_INSPIRE' &&
      gameState.contactState?.promptPlayerId === mySeat;

    const isPlanTargetable =
      isOpponent &&
      gameState.phase === 'BREAKTHROUGH_CHOICE' &&
      isMyTurn &&
      choosingPlanTarget;

    const readyHarmony = player.sceneArea.filter(s => !s.isExhausted).length;

    const renderAdventureRow = () => (
      <div className="adventure-area-row">
        {(['left', 'center', 'right'] as const).map((laneKey) => {
          const slot = player.adventureArea[laneKey];
          const isTargetable =
            !isOpponent &&
            isMyTurn &&
            gameState.phase === 'MAIN_PHASE' &&
            selectedHandCard &&
            (selectedHandCard.type.toLowerCase() !== 'item' || slot.character !== null);

          const isActiveClashLane =
            (gameState.phase === 'CONTACT_INSPIRE' || gameState.phase === 'BREAKTHROUGH_CHOICE') &&
            gameState.contactState?.activeLane === laneKey;

          const totalPower = slot.character
            ? (slot.character.power || 0) +
              slot.items.reduce((s, it) => s + (it.power || 1), 0) +
              slot.inspoBoost
            : 0;

          return (
            <div
              key={laneKey}
              className={`adventure-slot ${isTargetable ? 'targetable' : ''} ${
                isActiveClashLane ? 'active-lane-glow' : ''
              }`}
              onClick={() => !isOpponent && handleAdventureSlotClick(laneKey)}
              onContextMenu={(e) => handleContextMenu(e, slot.character)}
            >
              {slot.character ? (
                <div className="deployed-char-card">
                  <img src={slot.character.imageUrl} alt={slot.character.name} />
                  {slot.items.length > 0 && (
                    <div className="item-count-tag">+{slot.items.length} Item</div>
                  )}
                  <div className="char-power-badge">⚡ {totalPower}</div>
                </div>
              ) : (
                <span style={{ fontSize: '9px', color: '#9333ea', fontWeight: 700, textAlign: 'center', padding: '2px' }}>
                  {isTargetable ? 'Deploy' : laneKey.toUpperCase()}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );

    const renderStoryAndCoreRow = () => (
      <div className="core-story-row">
        {/* Main Character (Left) */}
        <div
          className="side-portrait-zone"
          onContextMenu={(e) => handleContextMenu(e, player.leader)}
        >
          {player.leader?.imageUrl ? (
            <img src={player.leader.imageUrl} alt={player.leader.name} />
          ) : (
            <img src={CARD_BACK_URL} alt="Mane Card Back" className="kayou-card-back-img" />
          )}
          <span className="zone-caption">Main Character</span>
        </div>

        {/* Story Area: 4 Landscape Stages + Overlaid Face-Down Plan Cards */}
        <div className="story-four-strip">
          {player.storyStages.map((st, idx) => (
            <div
              key={st.stage}
              className="story-stage-box"
              onContextMenu={(e) => handleContextMenu(e, st.isStoryCompleted ? st.storyCard : null)}
            >
              {st.isStoryCompleted && st.storyCard?.imageUrl ? (
                <img src={st.storyCard.imageUrl} alt={st.storyCard.name} />
              ) : (
                <div className="story-uncompleted-overlay">
                  <img src={CARD_BACK_URL} alt={`Story ${st.stage}`} className="kayou-card-back-img" />
                  <span className="story-stage-label-pill">Story {st.stage}</span>
                </div>
              )}

              {/* Face-down Plan Card dealt from Main Deck */}
              {st.planCard && !st.isPlanRevealed && (
                <div
                  className={`plan-card-overlay ${isPlanTargetable ? 'intervene-target' : ''}`}
                  title={isPlanTargetable ? 'Click to Intervene in this Plan!' : 'Face-Down Plan Card'}
                  onClick={() => {
                    if (isPlanTargetable) {
                      sendAction('BREAKTHROUGH_CHOICE', {
                        choice: 'INTERVENE_PLAN',
                        targetPlanStageIndex: idx,
                      });
                      setChoosingPlanTarget(false);
                    }
                  }}
                >
                  <img src={CARD_BACK_URL} alt="Plan Card" className="kayou-card-back-img" />
                  <span className="plan-tag-badge">Plan</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Retirement Area (Right) */}
        <div
          className="side-portrait-zone"
          onContextMenu={(e) =>
            handleContextMenu(e, player.retirement[player.retirement.length - 1] || null)
          }
        >
          {player.retirement.length > 0 ? (
            <img
              src={player.retirement[player.retirement.length - 1].imageUrl}
              alt="Retirement Top"
            />
          ) : (
            <span style={{ fontSize: '9px', color: '#9ca3af' }}>Empty</span>
          )}
          <span className="zone-caption">Retirement ({player.retirement.length})</span>
        </div>
      </div>
    );

    const renderResourceAndDecksRow = () => (
      <div className="resource-deck-row">
        {/* Scene Deck Area (Left) */}
        <div className="side-portrait-zone">
          <div className="deck-pile-wrapper">
            <img src={CARD_BACK_URL} alt="Scene Deck" className="kayou-card-back-img" />
            <span className="deck-count-pill">{player.sceneDeck.length}</span>
          </div>
          <span className="zone-caption">Scene Deck</span>
        </div>

        {/* Scene Area (Center) */}
        <div className="scene-area-tray">
          {player.sceneArea.length === 0 ? (
            <span style={{ fontSize: '10px', color: '#7e22ce', margin: '0 auto' }}>
              Scene Area (Harmony Resources)
            </span>
          ) : (
            player.sceneArea.map((sc, idx) => {
              const canInspire = isInspirePromptMine && sc.isFaceUp && !sc.isLockedFaceDown;
              return (
                <div
                  key={`${sc.card.id}-${idx}`}
                  className={`scene-card-slot ${sc.isExhausted ? 'exhausted' : ''} ${
                    canInspire ? 'inspire-clickable' : ''
                  }`}
                  title={
                    sc.isLockedFaceDown
                      ? 'First-Turn Locked Scene (Cannot be used for Inspo)'
                      : sc.isExhausted
                      ? 'Exhausted for Harmony this turn (Readies next turn)'
                      : canInspire
                      ? 'Click to flip face-down for +1 Inspo!'
                      : sc.card.name
                  }
                  onClick={() => {
                    if (canInspire) sendAction('INSPIRE_SCENE', { sceneIndex: idx });
                  }}
                  onContextMenu={(e) => handleContextMenu(e, sc.isFaceUp ? sc.card : null)}
                >
                  {sc.isFaceUp && sc.card.imageUrl ? (
                    <img src={sc.card.imageUrl} alt={sc.card.name} />
                  ) : (
                    <>
                      <img src={CARD_BACK_URL} alt="Face-Down Scene" className="kayou-card-back-img" />
                      <span className="scene-status-tag">
                        {sc.isLockedFaceDown ? '🔒 Locked' : 'Inspo Used'}
                      </span>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Main Deck Area (Right) */}
        <div className="side-portrait-zone">
          <div className="deck-pile-wrapper">
            <img src={CARD_BACK_URL} alt="Main Deck" className="kayou-card-back-img" />
            <span className="deck-count-pill">{player.mainDeck.length}</span>
          </div>
          <span className="zone-caption">Main Deck</span>
        </div>
      </div>
    );

    return (
      <div className={`playmat-half ${isOpponent ? 'opponent-half' : ''}`}>
        <div className="player-hud-bar">
          <div>
            <span>{isOpponent ? '👑 Opponent: ' : '✨ You: '}</span>
            <strong>{player.displayName}</strong>
            {gameState.firstPlayerId === player.id && (
              <span style={{ marginLeft: '6px', fontSize: '10px', color: '#ec4899' }}>★ 1st</span>
            )}
          </div>
          <div className="hud-pills">
            <span className="hud-pill story-pill">📖 Story: {player.storyProgress}/4</span>
            <span className="hud-pill">
              🌈 Harmony: {readyHarmony}/{player.sceneArea.length}
            </span>
            <span className="hud-pill">🃏 Hand: {player.hand.length}</span>
          </div>
        </div>

        {isOpponent ? (
          <>
            {renderResourceAndDecksRow()}
            {renderStoryAndCoreRow()}
            {renderAdventureRow()}
          </>
        ) : (
          <>
            {renderAdventureRow()}
            {renderStoryAndCoreRow()}
            {renderResourceAndDecksRow()}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="kayou-playmat-wrapper">
      {/* Mobile Portrait Rotate Prompt */}
      <div className="portrait-rotate-overlay">
        <div style={{ fontSize: '48px' }}>📱🔄</div>
        <h2 style={{ margin: 0, color: '#fbcfe8' }}>Rotate Device to Landscape</h2>
        <p style={{ fontSize: '14px', color: '#e9d5ff', maxWidth: '300px' }}>
          Equestria Clash uses a full horizontal tabletop playmat so every Adventure lane, Story stage, and Scene card fits without scrolling!
        </p>
      </div>

      {/* 1. Street Fighter Style VS Intro Splash */}
      {gameState.phase === 'VS_INTRO' && (
        <div className="vs-intro-overlay">
          <div className="vs-fighters-stage">
            <div className="vs-fighter-card">
              <div style={{ fontSize: '18px', fontWeight: 900, color: '#fbcfe8' }}>
                {gameState.players['0'].displayName}
              </div>
              <img
                src={gameState.players['0'].leader?.imageUrl}
                alt={gameState.players['0'].leader?.name}
              />
              <div style={{ fontSize: '13px', color: '#fde047', fontWeight: 800 }}>
                {gameState.players['0'].leader?.name}
              </div>
            </div>

            <div className="vs-emblem">VS</div>

            <div className="vs-fighter-card">
              <div style={{ fontSize: '18px', fontWeight: 900, color: '#fbcfe8' }}>
                {gameState.players['1'].displayName}
              </div>
              <img
                src={gameState.players['1'].leader?.imageUrl}
                alt={gameState.players['1'].leader?.name}
              />
              <div style={{ fontSize: '13px', color: '#fde047', fontWeight: 800 }}>
                {gameState.players['1'].leader?.name}
              </div>
            </div>
          </div>

          <div
            style={{
              background: 'rgba(255, 255, 255, 0.14)',
              border: '2px solid #ffd700',
              padding: '8px 22px',
              borderRadius: '18px',
              fontSize: '16px',
              fontWeight: 900,
              color: '#fde047',
            }}
          >
            🎲{' '}
            {gameState.firstPlayerId === '0'
              ? gameState.players['0'].displayName
              : gameState.players['1'].displayName}{' '}
            Plays First!
          </div>
        </div>
      )}

      {/* 2. Simultaneous Opening Hand Mulligan Modal */}
      {gameState.phase === 'MULLIGAN' && !isSpectator && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(24, 12, 36, 0.88)',
            zIndex: 9000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            padding: '16px',
          }}
        >
          <h2 style={{ fontSize: '22px', color: '#fbcfe8', marginBottom: '6px' }}>
            ✨ Opening Hand Mulligan
          </h2>
          <p style={{ fontSize: '13px', color: '#e9d5ff', marginBottom: '16px', textAlign: 'center' }}>
            {me.mulliganStatus === 'PENDING'
              ? 'You may perform 1 full hand mulligan (place all 5 cards on bottom and draw 5 new cards).'
              : `Waiting for ${opp.displayName} to keep or mulligan...`}
          </p>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {me.hand.map((c, idx) => (
              <div key={`${c.id}-${idx}`} style={{ width: '110px', height: '154px' }}>
                <img
                  src={c.imageUrl}
                  alt={c.name}
                  style={{ width: '100%', height: '100%', objectFit: 'fill', borderRadius: '10px', border: '2px solid #fff' }}
                />
              </div>
            ))}
          </div>

          {me.mulliganStatus === 'PENDING' && (
            <div style={{ display: 'flex', gap: '14px' }}>
              <button
                className="action-bar-btn primary"
                style={{ fontSize: '14px', padding: '10px 24px' }}
                onClick={() => sendAction('MULLIGAN_DECISION', { doMulligan: false })}
              >
                ✅ Keep Hand
              </button>
              <button
                className="action-bar-btn gold"
                style={{ fontSize: '14px', padding: '10px 24px' }}
                onClick={() => sendAction('MULLIGAN_DECISION', { doMulligan: true })}
              >
                🔄 Mulligan (Draw 5 New)
              </button>
            </div>
          )}
        </div>
      )}

      {/* 3. Clash Slam Showdown Animation Overlay */}
      {visibleClashId && gameState.lastClashEvent && (
        <div className="clash-showdown-overlay">
          <h2 style={{ color: '#fde047', fontSize: '22px', marginBottom: '16px' }}>
            ⚔️ {gameState.lastClashEvent.lane.toUpperCase()} LANE CLASH!
          </h2>
          <div className="clash-cards-arena">
            <div
              className={`clash-combatant ${
                gameState.lastClashEvent.outcome === 'ATTACKER_WINS'
                  ? 'winner'
                  : 'loser'
              }`}
            >
              <img
                src={gameState.lastClashEvent.attackerCard.imageUrl}
                alt={gameState.lastClashEvent.attackerCard.name}
              />
              <strong>⚡ {gameState.lastClashEvent.attackerTotalPower}</strong>
            </div>

            <div style={{ fontSize: '30px', fontWeight: 900, color: '#f472b6' }}>VS</div>

            <div
              className={`clash-combatant ${
                gameState.lastClashEvent.outcome === 'DEFENDER_WINS'
                  ? 'winner'
                  : 'loser'
              }`}
            >
              <img
                src={gameState.lastClashEvent.defenderCard.imageUrl}
                alt={gameState.lastClashEvent.defenderCard.name}
              />
              <strong>⚡ {gameState.lastClashEvent.defenderTotalPower}</strong>
            </div>
          </div>
        </div>
      )}

      {/* 4. Victory / Game Over Modal */}
      {gameState.phase === 'GAME_OVER' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(24, 12, 36, 0.88)',
            zIndex: 9800,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          <h1 style={{ fontSize: '36px', color: '#fde047', marginBottom: '10px' }}>
            🏆 {gameState.winnerId === mySeat ? 'Victory!' : 'Match Complete!'}
          </h1>
          <p style={{ fontSize: '16px', color: '#fbcfe8', marginBottom: '20px' }}>
            {gameState.players[gameState.winnerId || '0'].displayName} progressed to Story Stage 4!
          </p>
          <button
            className="action-bar-btn primary"
            style={{ fontSize: '15px', padding: '12px 28px' }}
            onClick={onLeaveMatch}
          >
            Return to Main Hub
          </button>
        </div>
      )}

      {/* Card Inspector Modal (Right-Click any card) */}
      {inspectedCard && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            zIndex: 9900,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setInspectedCard(null)}
        >
          <div
            style={{
              background: '#1e1124',
              border: '2px solid #f472b6',
              borderRadius: '16px',
              padding: '20px',
              display: 'flex',
              gap: '20px',
              maxWidth: '600px',
              color: '#fff',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={inspectedCard.imageUrl}
              alt={inspectedCard.name}
              style={{ width: '190px', height: '266px', objectFit: 'fill', borderRadius: '12px' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <h3 style={{ margin: 0, color: '#fbcfe8', fontSize: '18px' }}>{inspectedCard.name}</h3>
              <div style={{ fontSize: '12px', color: '#d8b4fe' }}>
                {inspectedCard.type} • {inspectedCard.element} • Cost: {inspectedCard.cost} • Power: {inspectedCard.power}
              </div>
              <p style={{ fontSize: '13px', lineHeight: 1.45, color: '#f3e8ff' }}>
                {inspectedCard.effectText || 'No special ability text.'}
              </p>
              <button
                className="action-bar-btn secondary"
                style={{ marginTop: 'auto' }}
                onClick={() => setInspectedCard(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Opponent Mirrored Playmat */}
      {renderPlayerHalf(opp, true)}

      {/* Dedicated Center Action Bar */}
      <div className="center-action-bar">
        <div className="action-bar-status">
          <span className="turn-badge">TURN {gameState.turnNumber}</span>
          <span>
            Active: <strong>{gameState.players[gameState.turnPlayerId].displayName}</strong>
          </span>
          <span>• {gameState.phase.replace('_', ' ')}</span>
          {gameState.phase === 'CONTACT_INSPIRE' && gameState.contactState && (
            <span style={{ color: '#fde047' }}>
              | {gameState.contactState.activeLane.toUpperCase()} Clash (⚡
              {gameState.contactState.attackerPower} vs ⚡{gameState.contactState.defenderPower})
            </span>
          )}
        </div>

        <div className="action-bar-buttons">
          {isMyTurn && gameState.phase === 'MAIN_PHASE' && (
            <>
              {me.turnsTaken > 1 ? (
                <button className="action-bar-btn primary" onClick={() => sendAction('START_CONTACT')}>
                  ⚔️ Attack / Contact
                </button>
              ) : (
                <span style={{ fontSize: '11px', color: '#fbcfe8', fontStyle: 'italic' }}>
                  (Turn 1: No Attack)
                </span>
              )}
              <button className="action-bar-btn gold" onClick={() => sendAction('END_TURN')}>
                End Turn ⏭️
              </button>
            </>
          )}

          {!isSpectator &&
            gameState.phase === 'CONTACT_INSPIRE' &&
            gameState.contactState?.promptPlayerId === mySeat && (
              <>
                <span style={{ fontSize: '11px', color: '#fde047', fontWeight: 800 }}>
                  Click face-up Scene to Inspire (+1) or Pass:
                </span>
                <button className="action-bar-btn gold" onClick={() => sendAction('PASS_INSPIRE')}>
                  Pass Inspire ✓
                </button>
              </>
            )}

          {isMyTurn && gameState.phase === 'BREAKTHROUGH_CHOICE' && (
            <>
              <button
                className="action-bar-btn primary"
                onClick={() => {
                  setChoosingPlanTarget(false);
                  sendAction('BREAKTHROUGH_CHOICE', { choice: 'PROGRESS_STORY' });
                }}
              >
                🔮 Progress Story ({me.storyProgress + 1}/4)
              </button>
              <button
                className="action-bar-btn gold"
                onClick={() => {
                  const hasHiddenPlans = opp.storyStages.some(s => s.planCard && !s.isPlanRevealed);
                  if (!hasHiddenPlans) {
                    sendAction('BREAKTHROUGH_CHOICE', { choice: 'PROGRESS_STORY' });
                  } else {
                    setChoosingPlanTarget(true);
                  }
                }}
              >
                {choosingPlanTarget
                  ? '👆 Click Opponent Plan Card!'
                  : '⚡ Intervene Plan'}
              </button>
            </>
          )}

          <button
            className="action-bar-btn secondary"
            onClick={() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
              }
              onLeaveMatch();
            }}
          >
            Leave
          </button>
        </div>
      </div>

      {/* Player Playmat */}
      {renderPlayerHalf(me, false)}

      {/* Player Fanned Hand (Expandable on Mobile Landscape Tap) */}
      {!isSpectator && (
        <div
          className={`player-hand-dock ${mobileHandExpanded ? 'mobile-expanded' : ''}`}
          onClick={() => setMobileHandExpanded(true)}
        >
          {me.hand.map((card, idx) => {
            const isSelected = selectedHandCardId === card.id;
            const canAfford = (card.cost || 0) <= availableHarmony;
            return (
              <div
                key={`${card.id}-${idx}`}
                className={`hand-card-item ${isSelected ? 'selected' : ''} ${
                  !canAfford ? 'unaffordable' : ''
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!mobileHandExpanded) {
                    setMobileHandExpanded(true);
                  }
                  if (!isMyTurn || gameState.phase !== 'MAIN_PHASE') return;
                  if (!canAfford) return;
                  setSelectedHandCardId(isSelected ? null : card.id);
                }}
                onContextMenu={(e) => handleContextMenu(e, card)}
              >
                <img src={card.imageUrl} alt={card.name} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}