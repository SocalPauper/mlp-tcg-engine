import React, { useState, useEffect, useRef } from 'react';
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
  actedLanesThisTurn: ('left' | 'center' | 'right')[];
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
  lastPlanRevealEvent: {
    id: number;
    stage: 1 | 2 | 3 | 4;
    defenderId: '0' | '1';
    defenderName: string;
    revealedCard: CardDefinition;
    hasPrePlanTrigger: boolean;
    triggeredEffectSummary: string | null;
    acknowledgedBy: ('0' | '1')[];
  } | null;
  announcements: { type: string; message: string; timestamp: number }[];
}

interface GameBoardProps {
  ws: WebSocket;
  gameState: LiveGameState;
  seat: '0' | '1' | 'spectator';
  onLeaveMatch: () => void;
}

function checkSceneInspireEligibility(
  scene: SceneCardInPlay,
  targetChar: CardDefinition | null
): { eligible: boolean; reason?: string } {
  if (!scene.isFaceUp || scene.isLockedFaceDown || !targetChar) {
    return { eligible: false };
  }

  const text = String(scene.card.effectText || '');
  const id = String(scene.card.id || '').toUpperCase();
  const hasInspo =
    /Inspo Boost|Inspiration Boost|\+\d+\s*Inspiration/i.test(text) || id.includes('-ER');

  if (!hasInspo) {
    return { eligible: false, reason: 'No Inspo Boost ability on this Scene.' };
  }

  const charBracketMatch = text.match(/[｢\[]([^｣\]]+)[｣\]]/);
  if (charBracketMatch) {
    const requiredName = charBracketMatch[1].trim().toLowerCase();
    if (!String(targetChar.name || '').toLowerCase().includes(requiredName)) {
      return { eligible: false, reason: `Only boosts ${charBracketMatch[1]}` };
    }
  }

  const elements = ['magic', 'loyalty', 'honesty', 'generosity', 'kindness', 'laughter'];
  for (const el of elements) {
    const elRegex = new RegExp(`your\\s+${el}\\s+character`, 'i');
    if (elRegex.test(text) && String(targetChar.element || '').toLowerCase() !== el) {
      return { eligible: false, reason: `Only boosts ${el.toUpperCase()} characters` };
    }
  }

  return { eligible: true };
}

export default function GameBoard({ ws, gameState, seat, onLeaveMatch }: GameBoardProps) {
  const [selectedHandCardId, setSelectedHandCardId] = useState<string | null>(null);
  const [inspectedCard, setInspectedCard] = useState<CardDefinition | null>(null);
  const [visibleClashId, setVisibleClashId] = useState<number | null>(null);

  const [cameraFocus, setCameraFocus] = useState<'ME' | 'OPPONENT'>('ME');
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mySeat: '0' | '1' = seat === '1' ? '1' : '0';
  const oppSeat: '0' | '1' = mySeat === '0' ? '1' : '0';
  const isSpectator = seat === 'spectator';

  const me = gameState.players[mySeat];
  const opp = gameState.players[oppSeat];
  const isMyTurn = !isSpectator && gameState.turnPlayerId === mySeat;

  const nextStoryIndex = me.storyProgress;
  const opponentPairedPlanSlot = opp.storyStages[nextStoryIndex];
  const canProgressStory =
    nextStoryIndex < 4 &&
    Boolean(opponentPairedPlanSlot?.isPlanRevealed || !opponentPairedPlanSlot?.planCard);

  const nextOpponentPlanStage = opp.storyStages.find(
    (s) => s.planCard !== null && !s.isPlanRevealed
  );

  useEffect(() => {
    if (gameState.turnPlayerId === mySeat) {
      setCameraFocus('ME');
    } else {
      setCameraFocus('OPPONENT');
    }
  }, [gameState.turnPlayerId, gameState.turnNumber, mySeat]);

  useEffect(() => {
    if (gameState.phase === 'VS_INTRO' && !isSpectator) {
      const timer = setTimeout(() => {
        sendAction('ACK_VS_INTRO');
      }, 3400);
      return () => clearTimeout(timer);
    }
  }, [gameState.phase, isSpectator]);

  useEffect(() => {
    if (gameState.lastClashEvent && gameState.lastClashEvent.id !== visibleClashId) {
      setVisibleClashId(gameState.lastClashEvent.id);
      const timer = setTimeout(() => {
        setVisibleClashId(null);
      }, 3800);
      return () => clearTimeout(timer);
    }
  }, [gameState.lastClashEvent?.id]);

  const sendAction = (action: string, payload: any = {}) => {
    if (isSpectator || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'GAME_ACTION', action, payload }));
  };

  const selectedHandCard = me.hand.find((c) => c.id === selectedHandCardId) || null;
  const availableHarmony = me.sceneArea.filter((s) => !s.isExhausted).length;

  const handleAdventureSlotClick = (lane: 'left' | 'center' | 'right') => {
    if (!isMyTurn || gameState.phase !== 'MAIN_PHASE' || !selectedHandCard) return;
    sendAction('PLAY_CARD', { cardId: selectedHandCard.id, laneIndex: lane });
    setSelectedHandCardId(null);
  };

  const handleContextMenu = (e: React.MouseEvent, card: CardDefinition | null) => {
    e.preventDefault();
    if (card) setInspectedCard(card);
  };

  const handleTouchStartInspect = (card: CardDefinition | null) => {
    if (!card) return;
    longPressTimer.current = setTimeout(() => {
      setInspectedCard(card);
    }, 450);
  };

  const handleTouchEndInspect = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const renderFocusedBoard = (player: PlayerState, isOpponent: boolean) => {
    const isInspirePromptMine =
      !isOpponent &&
      gameState.phase === 'CONTACT_INSPIRE' &&
      gameState.contactState?.promptPlayerId === mySeat;

    const activeClashLane = gameState.contactState?.activeLane;
    const activeClashChar = activeClashLane ? player.adventureArea[activeClashLane].character : null;

    const readyHarmony = player.sceneArea.filter((s) => !s.isExhausted).length;

    const renderAdventureRow = () => (
      <div className="adventure-area-row">
        {(['left', 'center', 'right'] as const).map((laneKey) => {
          const slot = player.adventureArea[laneKey];
          const hasActedThisTurn = player.actedLanesThisTurn?.includes(laneKey);

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
              onTouchStart={() => handleTouchStartInspect(slot.character)}
              onTouchEnd={handleTouchEndInspect}
            >
              {slot.character ? (
                <div className="deployed-char-card">
                  <img src={slot.character.imageUrl} alt={slot.character.name} />
                  {slot.items.length > 0 && (
                    <div className="item-count-tag">+{slot.items.length} Item</div>
                  )}
                  {hasActedThisTurn && (
                    <div
                      className="item-count-tag"
                      style={{ top: 'auto', bottom: '4px', left: '4px', color: '#fbcfe8' }}
                    >
                      Acted ✓
                    </div>
                  )}
                  <div className="char-power-badge">⚡ {totalPower}</div>
                </div>
              ) : (
                <span className="slot-empty-label">
                  {isTargetable ? 'Click to Deploy' : `${laneKey.toUpperCase()}`}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );

    const renderStoryAndCoreRow = () => (
      <div className="core-story-row">
        <div
          className="side-portrait-zone"
          onContextMenu={(e) => handleContextMenu(e, player.leader)}
          onTouchStart={() => handleTouchStartInspect(player.leader)}
          onTouchEnd={handleTouchEndInspect}
        >
          {player.leader?.imageUrl ? (
            <img src={player.leader.imageUrl} alt={player.leader.name} />
          ) : (
            <img src={CARD_BACK_URL} alt="Mane Card Back" className="kayou-card-back-img" />
          )}
          <span className="zone-caption">Main Character</span>
        </div>

        <div className="story-four-strip">
          {player.storyStages.map((st) => {
            const isNextSequentialPlan =
              isOpponent &&
              nextOpponentPlanStage &&
              nextOpponentPlanStage.stage === st.stage &&
              !st.isPlanRevealed;

            return (
              <div
                key={st.stage}
                className="story-stage-box"
                onContextMenu={(e) => handleContextMenu(e, st.isStoryCompleted ? st.storyCard : null)}
                onTouchStart={() => handleTouchStartInspect(st.isStoryCompleted ? st.storyCard : null)}
                onTouchEnd={handleTouchEndInspect}
              >
                {st.isStoryCompleted && st.storyCard?.imageUrl ? (
                  <img src={st.storyCard.imageUrl} alt={st.storyCard.name} />
                ) : (
                  <div className="story-uncompleted-overlay">
                    <img src={CARD_BACK_URL} alt={`Story ${st.stage}`} className="kayou-card-back-img" />
                    <span className="story-stage-label-pill">Story {st.stage}</span>
                  </div>
                )}

                {st.planCard && !st.isPlanRevealed && (
                  <div
                    className={`plan-card-overlay ${
                      isNextSequentialPlan && gameState.phase === 'BREAKTHROUGH_CHOICE' && isMyTurn
                        ? 'intervene-target'
                        : ''
                    }`}
                    title={`Story ${st.stage} Face-Down Plan`}
                  >
                    <img src={CARD_BACK_URL} alt="Plan Card" className="kayou-card-back-img" />
                    <span className="plan-tag-badge">Plan {st.stage}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          className="side-portrait-zone"
          onContextMenu={(e) =>
            handleContextMenu(e, player.retirement[player.retirement.length - 1] || null)
          }
          onTouchStart={() =>
            handleTouchStartInspect(player.retirement[player.retirement.length - 1] || null)
          }
          onTouchEnd={handleTouchEndInspect}
        >
          {player.retirement.length > 0 ? (
            <img
              src={player.retirement[player.retirement.length - 1].imageUrl}
              alt="Retirement Top"
            />
          ) : (
            <span className="slot-empty-label">Empty</span>
          )}
          <span className="zone-caption">Retirement ({player.retirement.length})</span>
        </div>
      </div>
    );

    const renderResourceAndDecksRow = () => (
      <div className="resource-deck-row">
        <div className="side-portrait-zone">
          <div className="deck-pile-wrapper">
            <img src={CARD_BACK_URL} alt="Scene Deck" className="kayou-card-back-img" />
            <span className="deck-count-pill">{player.sceneDeck.length}</span>
          </div>
          <span className="zone-caption">Scene Deck</span>
        </div>

        <div className="scene-area-tray">
          {player.sceneArea.length === 0 ? (
            <span className="slot-empty-label" style={{ margin: '0 auto' }}>
              Scene Area (Harmony Resources)
            </span>
          ) : (
            player.sceneArea.map((sc, idx) => {
              const inspoCheck = isInspirePromptMine
                ? checkSceneInspireEligibility(sc, activeClashChar)
                : { eligible: false };

              return (
                <div
                  key={`${sc.card.id}-${idx}`}
                  className={`scene-card-slot ${sc.isExhausted ? 'exhausted' : ''} ${
                    inspoCheck.eligible ? 'inspire-clickable' : ''
                  }`}
                  title={
                    sc.isLockedFaceDown
                      ? 'First-Turn Locked Scene (Cannot be used for Inspo)'
                      : !sc.isFaceUp
                      ? 'Inspo Boost already used'
                      : inspoCheck.eligible
                      ? `Click to flip face-down for Inspo Boost! (${sc.card.effectText || '+1 Inspiration'})`
                      : inspoCheck.reason || sc.card.name
                  }
                  onClick={() => {
                    if (inspoCheck.eligible) sendAction('INSPIRE_SCENE', { sceneIndex: idx });
                  }}
                  onContextMenu={(e) => handleContextMenu(e, sc.isFaceUp ? sc.card : null)}
                  onTouchStart={() => handleTouchStartInspect(sc.isFaceUp ? sc.card : null)}
                  onTouchEnd={handleTouchEndInspect}
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
            <span>{isOpponent ? '👑 Opponent: ' : '✨ Your Board: '}</span>
            <strong>{player.displayName}</strong>
            {gameState.firstPlayerId === player.id && (
              <span style={{ marginLeft: '6px', fontSize: '11px', color: '#ec4899' }}>★ 1st</span>
            )}
          </div>

          <div className="hud-pills">
            <span className="hud-pill story-pill">📖 Story: {player.storyProgress}/4</span>
            <span className="hud-pill">
              🌈 Harmony: {readyHarmony}/{player.sceneArea.length}
            </span>
            <span className="hud-pill">🃏 Hand: {player.hand.length}</span>
            <button
              type="button"
              className="board-camera-switch-btn"
              onClick={() => setCameraFocus((prev) => (prev === 'ME' ? 'OPPONENT' : 'ME'))}
            >
              {cameraFocus === 'ME' ? "👁️ Show Opponent's Board" : '👁️ Show My Board'}
            </button>
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
      {/* 1. Street Fighter Style VS Intro Splash with Crown Above First Player */}
      {gameState.phase === 'VS_INTRO' && (
        <div className="vs-intro-overlay">
          <div className="vs-fighters-stage">
            <div className="vs-fighter-card">
              {gameState.firstPlayerId === '0' ? (
                <div className="vs-first-crown">👑 Goes First!</div>
              ) : (
                <div className="vs-first-crown-placeholder" />
              )}
              <div className="vs-player-name">{gameState.players['0'].displayName}</div>
              <img
                src={gameState.players['0'].leader?.imageUrl}
                alt={gameState.players['0'].leader?.name}
              />
              <div className="vs-leader-name">{gameState.players['0'].leader?.name}</div>
            </div>

            <div className="vs-emblem">VS</div>

            <div className="vs-fighter-card">
              {gameState.firstPlayerId === '1' ? (
                <div className="vs-first-crown">👑 Goes First!</div>
              ) : (
                <div className="vs-first-crown-placeholder" />
              )}
              <div className="vs-player-name">{gameState.players['1'].displayName}</div>
              <img
                src={gameState.players['1'].leader?.imageUrl}
                alt={gameState.players['1'].leader?.name}
              />
              <div className="vs-leader-name">{gameState.players['1'].leader?.name}</div>
            </div>
          </div>

          <div className="vs-first-banner">
            👑{' '}
            {gameState.firstPlayerId === '0'
              ? gameState.players['0'].displayName
              : gameState.players['1'].displayName}{' '}
            Plays First!
          </div>
        </div>
      )}

      {/* 2. Simultaneous Opening Hand Mulligan Modal */}
      {gameState.phase === 'MULLIGAN' && !isSpectator && (
        <div className="mulligan-overlay">
          <h2 className="mulligan-title">✨ Opening Hand Mulligan</h2>
          <p className="mulligan-subtitle">
            {me.mulliganStatus === 'PENDING'
              ? 'Right-click or long-press any card to inspect. Keep hand or perform 1 full mulligan:'
              : `Waiting for ${opp.displayName} to keep or mulligan...`}
          </p>

          <div className="mulligan-hand-row">
            {me.hand.map((c, idx) => (
              <div
                key={`${c.id}-${idx}`}
                className="mulligan-card-slot"
                onContextMenu={(e) => handleContextMenu(e, c)}
                onTouchStart={() => handleTouchStartInspect(c)}
                onTouchEnd={handleTouchEndInspect}
              >
                <img src={c.imageUrl} alt={c.name} />
              </div>
            ))}
          </div>

          {me.mulliganStatus === 'PENDING' && (
            <div style={{ display: 'flex', gap: '14px' }}>
              <button
                type="button"
                className="action-bar-btn primary"
                style={{ fontSize: '14px', padding: '10px 24px' }}
                onClick={() => sendAction('MULLIGAN_DECISION', { doMulligan: false })}
              >
                ✅ Keep Hand
              </button>
              <button
                type="button"
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

      {/* 3. Extended Clash Slam Showdown Animation Overlay */}
      {visibleClashId && gameState.lastClashEvent && (
        <div className="clash-showdown-overlay">
          <h2 style={{ color: '#fde047', fontSize: '24px', marginBottom: '18px' }}>
            ⚔️ {gameState.lastClashEvent.lane.toUpperCase()} LANE CLASH!
          </h2>
          <div className="clash-cards-arena">
            <div
              className={`clash-combatant ${
                gameState.lastClashEvent.outcome === 'ATTACKER_WINS'
                  ? 'winner'
                  : gameState.lastClashEvent.outcome === 'TIE'
                  ? 'tie'
                  : 'loser'
              }`}
            >
              <img
                src={gameState.lastClashEvent.attackerCard.imageUrl}
                alt={gameState.lastClashEvent.attackerCard.name}
              />
              <strong style={{ fontSize: '18px', color: '#fde047' }}>
                ⚡ {gameState.lastClashEvent.attackerTotalPower}
              </strong>
            </div>

            <div style={{ fontSize: '34px', fontWeight: 900, color: '#f472b6' }}>VS</div>

            <div
              className={`clash-combatant ${
                gameState.lastClashEvent.outcome === 'DEFENDER_WINS'
                  ? 'winner'
                  : gameState.lastClashEvent.outcome === 'TIE'
                  ? 'tie'
                  : 'loser'
              }`}
            >
              <img
                src={gameState.lastClashEvent.defenderCard.imageUrl}
                alt={gameState.lastClashEvent.defenderCard.name}
              />
              <strong style={{ fontSize: '18px', color: '#fde047' }}>
                ⚡ {gameState.lastClashEvent.defenderTotalPower}
              </strong>
            </div>
          </div>
        </div>
      )}

      {/* 4. Sequential Plan Revealed Popup (Awaits Both Players' Acknowledgment) */}
      {gameState.lastPlanRevealEvent && (
        <div className="inspector-backdrop">
          <div
            className={`plan-reveal-modal ${
              gameState.lastPlanRevealEvent.hasPrePlanTrigger ? 'has-trap' : ''
            }`}
          >
            {gameState.lastPlanRevealEvent.hasPrePlanTrigger && (
              <div className="trap-exclamation-burst">❗ PRE-PLAN TRIGGERED! ❗</div>
            )}

            <img
              src={gameState.lastPlanRevealEvent.revealedCard.imageUrl}
              alt={gameState.lastPlanRevealEvent.revealedCard.name}
              className="plan-reveal-card-flip"
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
              <div
                style={{
                  background: gameState.lastPlanRevealEvent.hasPrePlanTrigger ? '#f59e0b' : '#ec4899',
                  color: gameState.lastPlanRevealEvent.hasPrePlanTrigger ? '#4a148c' : '#fff',
                  fontSize: '11px',
                  fontWeight: 900,
                  padding: '2px 10px',
                  borderRadius: '10px',
                  alignSelf: 'flex-start',
                }}
              >
                📖 PLAN INTERVENED — STORY STAGE {gameState.lastPlanRevealEvent.stage}
              </div>

              <h3 style={{ margin: 0, color: '#fbcfe8', fontSize: '18px' }}>
                {gameState.lastPlanRevealEvent.revealedCard.name}
              </h3>

              <p style={{ fontSize: '13px', lineHeight: 1.45, color: '#f3e8ff', margin: 0 }}>
                {gameState.lastPlanRevealEvent.revealedCard.effectText || 'No Pre-Plan trigger.'}
              </p>

              {gameState.lastPlanRevealEvent.triggeredEffectSummary && (
                <div
                  style={{
                    background: 'rgba(253, 224, 71, 0.16)',
                    border: '1.5px solid #fde047',
                    borderRadius: '8px',
                    padding: '6px 10px',
                    fontSize: '12px',
                    color: '#fde047',
                    fontWeight: 800,
                  }}
                >
                  ⚡ {gameState.lastPlanRevealEvent.triggeredEffectSummary}
                </div>
              )}

              <div style={{ fontSize: '12px', color: '#34d399', fontWeight: 800 }}>
                🃏 Card placed into {gameState.lastPlanRevealEvent.defenderName}&apos;s hand!
              </div>

              <div className="ack-status-row">
                <span style={{ fontSize: '11px', color: '#d8b4fe' }}>
                  Confirmed: {gameState.lastPlanRevealEvent.acknowledgedBy.length} / 2 Players
                </span>

                {!isSpectator &&
                  (gameState.lastPlanRevealEvent.acknowledgedBy.includes(mySeat) ? (
                    <span style={{ fontSize: '12px', color: '#fde047', fontWeight: 800 }}>
                      ✅ Waiting for {opp.displayName}...
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="action-bar-btn primary"
                      onClick={() => sendAction('ACK_PLAN_REVEAL')}
                    >
                      ✅ Acknowledge &amp; Continue
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Victory / Game Over Modal */}
      {gameState.phase === 'GAME_OVER' && (
        <div className="mulligan-overlay">
          <h1 style={{ fontSize: '36px', color: '#fde047', marginBottom: '10px' }}>
            🏆 {gameState.winnerId === mySeat ? 'Victory!' : 'Match Complete!'}
          </h1>
          <p style={{ fontSize: '16px', color: '#fbcfe8', marginBottom: '20px' }}>
            {gameState.players[gameState.winnerId || '0'].displayName} progressed to Story Stage 4!
          </p>
          <button
            type="button"
            className="action-bar-btn primary"
            style={{ fontSize: '15px', padding: '12px 28px' }}
            onClick={onLeaveMatch}
          >
            Return to Main Hub
          </button>
        </div>
      )}

      {/* Card Inspector Modal */}
      {inspectedCard && (
        <div className="inspector-backdrop" onClick={() => setInspectedCard(null)}>
          <div className="inspector-card-box" onClick={(e) => e.stopPropagation()}>
            <img src={inspectedCard.imageUrl} alt={inspectedCard.name} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <h3 style={{ margin: 0, color: '#fbcfe8', fontSize: '17px' }}>{inspectedCard.name}</h3>
              <div style={{ fontSize: '12px', color: '#d8b4fe' }}>
                {inspectedCard.type} • {inspectedCard.element} • Cost: {inspectedCard.cost} • Power: {inspectedCard.power}
              </div>
              <p style={{ fontSize: '13px', lineHeight: 1.45, color: '#f3e8ff', margin: 0 }}>
                {inspectedCard.effectText || 'No special ability text.'}
              </p>
              <button
                type="button"
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

      {/* Dedicated Top Action Bar */}
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
                <button
                  type="button"
                  className="action-bar-btn primary"
                  onClick={() => sendAction('START_CONTACT')}
                >
                  ⚔️ Attack / Contact
                </button>
              ) : (
                <span style={{ fontSize: '11px', color: '#fbcfe8', fontStyle: 'italic' }}>
                  (Turn 1: No Attack)
                </span>
              )}
              <button
                type="button"
                className="action-bar-btn gold"
                onClick={() => sendAction('END_TURN')}
              >
                End Turn ⏭️
              </button>
            </>
          )}

          {!isSpectator &&
            gameState.phase === 'CONTACT_INSPIRE' &&
            gameState.contactState?.promptPlayerId === mySeat && (
              <>
                <span style={{ fontSize: '11px', color: '#fde047', fontWeight: 800 }}>
                  Click eligible Inspo Scene or Pass:
                </span>
                <button
                  type="button"
                  className="action-bar-btn gold"
                  onClick={() => sendAction('PASS_INSPIRE')}
                >
                  Pass Inspire ✓
                </button>
              </>
            )}

          {isMyTurn && gameState.phase === 'BREAKTHROUGH_CHOICE' && (
            <>
              {canProgressStory && (
                <button
                  type="button"
                  className="action-bar-btn primary"
                  onClick={() => sendAction('BREAKTHROUGH_CHOICE', { choice: 'PROGRESS_STORY' })}
                >
                  🔮 Progress Story ({me.storyProgress + 1}/4)
                </button>
              )}

              {nextOpponentPlanStage && (
                <button
                  type="button"
                  className="action-bar-btn gold"
                  onClick={() => sendAction('BREAKTHROUGH_CHOICE', { choice: 'INTERVENE_PLAN' })}
                >
                  ⚡ Intervene Plan (Flip Story {nextOpponentPlanStage.stage})
                </button>
              )}
            </>
          )}

          <button
            type="button"
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

      {/* Single Focused Playmat */}
      {cameraFocus === 'ME' ? renderFocusedBoard(me, false) : renderFocusedBoard(opp, true)}

      {/* Player Hand Dock */}
      {!isSpectator && (
        <div className="player-hand-dock">
          {me.hand.map((card, idx) => {
            const isSelected = selectedHandCardId === card.id;
            const canAfford = (card.cost || 0) <= availableHarmony;
            return (
              <div
                key={`${card.id}-${idx}`}
                className={`hand-card-item ${isSelected ? 'selected' : ''} ${
                  !canAfford ? 'unaffordable' : ''
                }`}
                onClick={() => {
                  if (!isMyTurn || gameState.phase !== 'MAIN_PHASE') return;
                  if (!canAfford) return;
                  if (cameraFocus !== 'ME') setCameraFocus('ME');
                  setSelectedHandCardId(isSelected ? null : card.id);
                }}
                onContextMenu={(e) => handleContextMenu(e, card)}
                onTouchStart={() => handleTouchStartInspect(card)}
                onTouchEnd={handleTouchEndInspect}
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