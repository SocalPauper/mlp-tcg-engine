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
  isExhausted?: boolean;
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
  isConnected?: boolean;
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
    | 'CLASH_HOLD'
    | 'BREAKTHROUGH_CHOICE'
    | 'REVEAL_HOLD'
    | 'GAME_OVER';
  firstPlayerId: '0' | '1';
  turnPlayerId: '0' | '1';
  turnNumber: number;
  winnerId: '0' | '1' | null;
  winReason?: string | null;
  turnDeadlineMs?: number;
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
    acknowledgedBy: ('0' | '1')[];
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
  lastStoryRevealEvent: {
    id: number;
    stage: 1 | 2 | 3 | 4;
    attackerId: '0' | '1';
    attackerName: string;
    storyCard: CardDefinition;
    triggeredEffectSummary: string | null;
    acknowledgedBy: ('0' | '1')[];
    isGameWinningStage: boolean;
  } | null;
  announcements: { type: string; message: string; timestamp: number }[];
}

interface PowerBreakdownDetails {
  cardName: string;
  laneName: string;
  basePower: number;
  itemDetails: { name: string; bonus: number }[];
  inspoBoost: number;
  totalPower: number;
}

interface GameBoardProps {
  ws: WebSocket;
  gameState: LiveGameState;
  seat: '0' | '1' | 'spectator';
  isReconnecting?: boolean;
  onLeaveMatch: () => void;
}

function isStoryCard(card: CardDefinition | null): boolean {
  if (!card) return false;
  return (
    card.type === 'Story' ||
    String(card.name || '').includes(' - ') ||
    String(card.name || '').includes(' – ')
  );
}

function cleanCardText(text?: string): string {
  if (!text) return '';
  return text.replace(/\{\{[^}]*$/g, '').replace(/\{\{|\}\}/g, '').trim();
}

function hasAdventureTapAbility(card: CardDefinition | null): boolean {
  if (!card) return false;
  return /Adventure\s*:/i.test(String(card.effectText || ''));
}

function checkSceneInspireEligibility(
  scene: SceneCardInPlay,
  targetChar: CardDefinition | null
): { eligible: boolean; reason?: string } {
  if (scene.isLockedFaceDown) {
    return { eligible: false, reason: 'First-Turn Locked Scene' };
  }
  if (!scene.isFaceUp) {
    return { eligible: false, reason: 'Already flipped face-down' };
  }
  if (!targetChar) {
    return { eligible: false, reason: 'No character in active lane' };
  }

  const text = String(scene.card.effectText || '');
  const id = String(scene.card.id || '').toUpperCase();
  const hasInspo =
    /Inspo Boost|Inspiration Boost|\+\d+\s*Inspiration/i.test(text) || id.includes('-ER');

  if (!hasInspo) {
    return { eligible: false, reason: 'No Inspo Boost text on card' };
  }

  const actualCharName = String(targetChar.name || '').toLowerCase();

  const charBracketMatch = text.match(/[｢\[「]([^｣\]」]+)[｣\]」]/);
  if (charBracketMatch) {
    const requiredName = charBracketMatch[1].trim().toLowerCase();
    if (!actualCharName.includes(requiredName)) {
      return { eligible: false, reason: `Only boosts ${charBracketMatch[1].trim()}` };
    }
  } else {
    const namedPonies = [
      'Twilight Sparkle',
      'Rainbow Dash',
      'Applejack',
      'Rarity',
      'Fluttershy',
      'Pinkie Pie',
      'Spike',
      'Princess Celestia',
      'Princess Luna',
      'Princess Cadance',
      'Starlight Glimmer',
      'Trixie',
    ];
    for (const pony of namedPonies) {
      const ponyRegex = new RegExp(`\\b${pony}\\b`, 'i');
      if (ponyRegex.test(text) && !actualCharName.includes(pony.toLowerCase())) {
        return { eligible: false, reason: `Only boosts ${pony}` };
      }
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

const CONFETTI_COLORS = ['#fde047', '#f472b6', '#38bdf8', '#a855f7', '#34d399', '#fb7185'];

export default function GameBoard({
  ws,
  gameState,
  seat,
  isReconnecting,
  onLeaveMatch,
}: GameBoardProps) {
  const [selectedHandCardId, setSelectedHandCardId] = useState<string | null>(null);
  const [inspectedCard, setInspectedCard] = useState<CardDefinition | null>(null);
  const [powerBreakdown, setPowerBreakdown] = useState<PowerBreakdownDetails | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(180);

  const [turnBannerText, setTurnBannerText] = useState<string | null>(null);
  const prevTurnKeyRef = useRef<string | null>(null);

  const [cameraFocus, setCameraFocus] = useState<'ME' | 'OPPONENT'>('ME');
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mySeat: '0' | '1' = seat === '1' ? '1' : '0';
  const oppSeat: '0' | '1' = mySeat === '0' ? '1' : '0';
  const isSpectator = seat === 'spectator';

  const me = gameState.players[mySeat];
  const opp = gameState.players[oppSeat];
  const isMyTurn = !isSpectator && gameState.turnPlayerId === mySeat;

  // Live 3-minute inactivity countdown display
  useEffect(() => {
    const interval = setInterval(() => {
      if (gameState.turnDeadlineMs) {
        const diff = Math.max(0, Math.ceil((gameState.turnDeadlineMs - Date.now()) / 1000));
        setSecondsLeft(diff);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState.turnDeadlineMs]);

  const nextStoryIndex = me.storyProgress;
  const opponentPairedPlanSlot = opp.storyStages[nextStoryIndex];
  const canProgressStory =
    nextStoryIndex < 4 &&
    Boolean(opponentPairedPlanSlot?.isPlanRevealed || !opponentPairedPlanSlot?.planCard);

  const nextOpponentPlanStage = opp.storyStages.find(
    (s) => s.planCard !== null && !s.isPlanRevealed
  );

  useEffect(() => {
    if (gameState.phase === 'REVEAL_HOLD' || gameState.phase === 'CLASH_HOLD') return;

    if (gameState.turnPlayerId === mySeat) {
      setCameraFocus('ME');
    } else {
      setCameraFocus('OPPONENT');
    }

    if (
      gameState.phase === 'MAIN_PHASE' ||
      gameState.phase === 'CONTACT_INSPIRE' ||
      gameState.phase === 'BREAKTHROUGH_CHOICE'
    ) {
      const turnKey = `${gameState.turnNumber}-${gameState.turnPlayerId}`;
      if (prevTurnKeyRef.current !== turnKey) {
        prevTurnKeyRef.current = turnKey;
        const label = isSpectator
          ? `${gameState.players[gameState.turnPlayerId].displayName}'s Turn`
          : gameState.turnPlayerId === mySeat
          ? '✨ Your Turn! ✨'
          : "👑 Opponent's Turn";
        setTurnBannerText(label);
        const timer = setTimeout(() => setTurnBannerText(null), 1750);
        return () => clearTimeout(timer);
      }
    }
  }, [gameState.turnPlayerId, gameState.turnNumber, gameState.phase, mySeat, isSpectator]);

  useEffect(() => {
    if (gameState.phase === 'VS_INTRO' && !isSpectator) {
      const timer = setTimeout(() => {
        sendAction('ACK_VS_INTRO');
      }, 3400);
      return () => clearTimeout(timer);
    }
  }, [gameState.phase, isSpectator]);

  useEffect(() => {
    if (gameState.phase === 'CLASH_HOLD' && gameState.lastClashEvent && !isSpectator) {
      if (!gameState.lastClashEvent.acknowledgedBy.includes(mySeat)) {
        const timer = setTimeout(() => {
          sendAction('ACK_CLASH_ANIMATION');
        }, 3800);
        return () => clearTimeout(timer);
      }
    }
  }, [gameState.phase, gameState.lastClashEvent?.id, isSpectator, mySeat]);

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

  const showInspireModalForMe =
    !isSpectator &&
    gameState.phase === 'CONTACT_INSPIRE' &&
    gameState.contactState?.promptPlayerId === mySeat;

  const activeClashLaneForModal = gameState.contactState?.activeLane;
  const myCharacterInClashLane = activeClashLaneForModal
    ? me.adventureArea[activeClashLaneForModal].character
    : null;

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const renderFocusedBoard = (player: PlayerState, isOpponent: boolean) => {
    const readyHarmony = player.sceneArea.filter((s) => !s.isExhausted).length;

    const renderAdventureRow = () => (
      <div className="adventure-area-row">
        {(['left', 'center', 'right'] as const).map((laneKey) => {
          const slot = player.adventureArea[laneKey];
          const hasActedThisTurn = player.actedLanesThisTurn?.includes(laneKey);
          const canTapAdventure =
            !isOpponent &&
            isMyTurn &&
            gameState.phase === 'MAIN_PHASE' &&
            slot.character !== null &&
            !slot.isExhausted &&
            hasAdventureTapAbility(slot.character);

          const isTargetable =
            !isOpponent &&
            isMyTurn &&
            gameState.phase === 'MAIN_PHASE' &&
            selectedHandCard &&
            (selectedHandCard.type.toLowerCase() !== 'item' || slot.character !== null);

          const isActiveClashLane =
            (gameState.phase === 'CONTACT_INSPIRE' || gameState.phase === 'BREAKTHROUGH_CHOICE') &&
            gameState.contactState?.activeLane === laneKey;

          const basePower = slot.character ? Number(slot.character.power) || 0 : 0;
          const itemDetails = slot.items.map((it) => ({
            name: it.name,
            bonus: Number(it.power) || 1,
          }));
          const itemBonusTotal = itemDetails.reduce((s, d) => s + d.bonus, 0);
          const inspoBonus = slot.inspoBoost || 0;
          const totalPower = basePower + itemBonusTotal + inspoBonus;
          const isBuffed = itemBonusTotal > 0 || inspoBonus > 0;

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
                <>
                  <div
                    className={`total-power-above-badge ${isBuffed ? 'buffed' : ''}`}
                    title="Click to view Total Power breakdown"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPowerBreakdown({
                        cardName: slot.character!.name,
                        laneName: laneKey.toUpperCase(),
                        basePower,
                        itemDetails,
                        inspoBoost: inspoBonus,
                        totalPower,
                      });
                    }}
                  >
                    <span>⚡ {totalPower}</span>
                    <span className="power-subscript-info">
                      {isBuffed ? `+${itemBonusTotal + inspoBonus} ⓘ` : 'ⓘ'}
                    </span>
                  </div>

                  <div className={`deployed-char-card ${slot.isExhausted ? 'exhausted' : ''}`}>
                    <img src={slot.character.imageUrl} alt={slot.character.name} />
                    {slot.items.length > 0 && (
                      <div className="item-count-tag">+{slot.items.length} Item</div>
                    )}
                    {(hasActedThisTurn || slot.isExhausted) && (
                      <div
                        className="item-count-tag"
                        style={{ top: 'auto', bottom: '4px', left: '4px', color: '#fde047' }}
                      >
                        {slot.isExhausted ? 'Tapped ↷' : 'Acted ✓'}
                      </div>
                    )}
                  </div>

                  {canTapAdventure && (
                    <button
                      type="button"
                      className="adventure-tap-btn"
                      title={cleanCardText(slot.character.effectText)}
                      onClick={(e) => {
                        e.stopPropagation();
                        sendAction('ACTIVATE_ADVENTURE', { laneIndex: laneKey });
                      }}
                    >
                      ↷ Adventure
                    </button>
                  )}
                </>
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
            player.sceneArea.map((sc, idx) => (
              <div
                key={`${sc.card.id}-${idx}`}
                className={`scene-card-slot ${sc.isExhausted ? 'exhausted' : ''}`}
                title={
                  sc.isLockedFaceDown
                    ? 'First-Turn Locked Scene (Cannot be used for Inspo)'
                    : !sc.isFaceUp
                    ? 'Inspo Boost already used'
                    : sc.card.name
                }
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
            ))
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
            {player.isConnected === false && (
              <span style={{ marginLeft: '8px', fontSize: '11px', color: '#dc2626' }}>
                ⚠️ Disconnected (3m timer active)
              </span>
            )}
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

  const winnerPlayer = gameState.winnerId ? gameState.players[gameState.winnerId] : null;

  return (
    <div className="kayou-playmat-wrapper">
      {isReconnecting && (
        <div className="reconnecting-banner">
          🔄 Connection interrupted — Reconnecting to match room...
        </div>
      )}

      {/* Turn Transition Banner */}
      {turnBannerText && gameState.phase !== 'REVEAL_HOLD' && gameState.phase !== 'CLASH_HOLD' && (
        <div className="turn-transition-banner-overlay">
          <div className="turn-transition-banner">{turnBannerText}</div>
        </div>
      )}

      {/* 1. VS Intro Splash */}
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

      {/* 2. Opening Hand Mulligan Modal */}
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

      {/* 3. Dedicated Inspiration Boost Popup */}
      {showInspireModalForMe && gameState.contactState && (
        <div className="inspector-backdrop">
          <div className="inspire-popup-modal">
            <h3 style={{ margin: 0, color: '#fde047', fontSize: '20px' }}>
              ✨ Inspiration Boost Step — {gameState.contactState.activeLane.toUpperCase()} Lane Clash
            </h3>
            <div style={{ fontSize: '13px', color: '#fbcfe8', textAlign: 'center' }}>
              Active Character: <strong>{myCharacterInClashLane?.name || 'None'}</strong>
              <br />
              Current Clash Power: <strong>⚡ {gameState.contactState.attackerPower}</strong> (Attacker) vs{' '}
              <strong>⚡ {gameState.contactState.defenderPower}</strong> (Defender)
            </div>

            <div className="inspire-scenes-grid">
              {me.sceneArea.map((sc, idx) => {
                const eligibility = checkSceneInspireEligibility(sc, myCharacterInClashLane);
                return (
                  <div
                    key={`${sc.card.id}-${idx}`}
                    className={`inspire-modal-card ${
                      eligibility.eligible ? 'eligible' : 'ineligible'
                    }`}
                    onClick={() => {
                      if (eligibility.eligible) {
                        sendAction('INSPIRE_SCENE', { sceneIndex: idx });
                      }
                    }}
                    onContextMenu={(e) => handleContextMenu(e, sc.isFaceUp ? sc.card : null)}
                    onTouchStart={() => handleTouchStartInspect(sc.isFaceUp ? sc.card : null)}
                    onTouchEnd={handleTouchEndInspect}
                  >
                    <img
                      src={sc.isFaceUp && sc.card.imageUrl ? sc.card.imageUrl : CARD_BACK_URL}
                      alt={sc.card.name}
                    />
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 800,
                        textAlign: 'center',
                        color: eligibility.eligible ? '#fde047' : '#d1d5db',
                      }}
                    >
                      {eligibility.eligible ? '✨ Tap to Inspire!' : eligibility.reason}
                    </span>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="action-bar-btn gold"
              style={{ fontSize: '14px', padding: '10px 28px' }}
              onClick={() => sendAction('PASS_INSPIRE')}
            >
              Pass Inspiration ✓
            </button>
          </div>
        </div>
      )}

      {/* 4. Clash Slam Showdown Animation Overlay */}
      {gameState.phase === 'CLASH_HOLD' && gameState.lastClashEvent && (
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

      {/* 5A. Sequential Plan Revealed Popup */}
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
              className={`plan-reveal-card-flip ${
                isStoryCard(gameState.lastPlanRevealEvent.revealedCard) ? 'story-landscape' : ''
              }`}
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
                {cleanCardText(gameState.lastPlanRevealEvent.revealedCard.effectText) ||
                  'No Pre-Plan trigger.'}
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

      {/* 5B. Story Stage Progressed Reveal Popup */}
      {gameState.lastStoryRevealEvent && (
        <div className="inspector-backdrop">
          <div className="plan-reveal-modal has-trap">
            <div className="trap-exclamation-burst">
              📖 STORY STAGE {gameState.lastStoryRevealEvent.stage} COMPLETED!
            </div>

            <img
              src={gameState.lastStoryRevealEvent.storyCard.imageUrl}
              alt={gameState.lastStoryRevealEvent.storyCard.name}
              className="plan-reveal-card-flip story-landscape"
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
              <div
                style={{
                  background: '#ec4899',
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 900,
                  padding: '2px 10px',
                  borderRadius: '10px',
                  alignSelf: 'flex-start',
                }}
              >
                ✨ {gameState.lastStoryRevealEvent.attackerName} PROGRESSED STORY ({gameState.lastStoryRevealEvent.stage}/4)
              </div>

              <h3 style={{ margin: 0, color: '#fbcfe8', fontSize: '18px' }}>
                {gameState.lastStoryRevealEvent.storyCard.name}
              </h3>

              <p style={{ fontSize: '13px', lineHeight: 1.45, color: '#f3e8ff', margin: 0 }}>
                {cleanCardText(gameState.lastStoryRevealEvent.storyCard.effectText) ||
                  'No printed promotion effect.'}
              </p>

              {gameState.lastStoryRevealEvent.triggeredEffectSummary && (
                <div
                  style={{
                    background: 'rgba(52, 211, 153, 0.16)',
                    border: '1.5px solid #34d399',
                    borderRadius: '8px',
                    padding: '6px 10px',
                    fontSize: '12px',
                    color: '#34d399',
                    fontWeight: 800,
                  }}
                >
                  ✨ {gameState.lastStoryRevealEvent.triggeredEffectSummary}
                </div>
              )}

              <div className="ack-status-row">
                <span style={{ fontSize: '11px', color: '#d8b4fe' }}>
                  Confirmed: {gameState.lastStoryRevealEvent.acknowledgedBy.length} / 2 Players
                </span>

                {!isSpectator &&
                  (gameState.lastStoryRevealEvent.acknowledgedBy.includes(mySeat) ? (
                    <span style={{ fontSize: '12px', color: '#fde047', fontWeight: 800 }}>
                      ✅ Waiting for {opp.displayName}...
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="action-bar-btn primary"
                      onClick={() => sendAction('ACK_STORY_REVEAL')}
                    >
                      ✅ Acknowledge &amp; Continue
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Fanfare Winner Screen with Confetti */}
      {gameState.phase === 'GAME_OVER' && winnerPlayer && (
        <div className="victory-fanfare-overlay">
          <div className="confetti-container">
            {Array.from({ length: 45 }).map((_, i) => (
              <div
                key={i}
                className="confetti-piece"
                style={{
                  left: `${(i * 2.25) % 100}%`,
                  backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                  animationDuration: `${2.4 + (i % 5) * 0.45}s`,
                  animationDelay: `${(i % 7) * 0.25}s`,
                }}
              />
            ))}
          </div>

          <h1 className="victory-trophy-banner">
            🎉🏆 {winnerPlayer.displayName} WINS! 🏆🎉
          </h1>
          <p style={{ fontSize: '16px', color: '#fbcfe8', margin: '0 0 16px', zIndex: 10 }}>
            {gameState.winReason || 'Completed all 4 Story Stages in Equestria Clash!'}
          </p>

          <div className="victory-winner-card">
            {winnerPlayer.leader?.imageUrl && (
              <img src={winnerPlayer.leader.imageUrl} alt={winnerPlayer.leader.name} />
            )}
            <strong style={{ fontSize: '18px', color: '#fde047' }}>
              {winnerPlayer.leader?.name || winnerPlayer.displayName}
            </strong>
          </div>

          <button
            type="button"
            className="action-bar-btn gold"
            style={{ fontSize: '16px', padding: '14px 36px', zIndex: 10 }}
            onClick={onLeaveMatch}
          >
            ✨ Return to Main Hub
          </button>
        </div>
      )}

      {/* Power Breakdown Popover Modal */}
      {powerBreakdown && (
        <div className="inspector-backdrop" onClick={() => setPowerBreakdown(null)}>
          <div
            className="inspector-card-box"
            style={{ flexDirection: 'column', maxWidth: '380px', gap: '10px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: 0, color: '#fde047', fontSize: '18px' }}>
              ⚡ Total Power Breakdown ({powerBreakdown.laneName} Lane)
            </h3>
            <div style={{ fontSize: '14px', fontWeight: 800, color: '#fbcfe8' }}>
              {powerBreakdown.cardName}
            </div>
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: '10px',
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                fontSize: '13px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Base Character Power:</span>
                <strong>{powerBreakdown.basePower}</strong>
              </div>
              {powerBreakdown.itemDetails.map((it, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', color: '#38bdf8' }}>
                  <span>Item ({it.name}):</span>
                  <strong>+{it.bonus}</strong>
                </div>
              ))}
              {powerBreakdown.inspoBoost > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f472b6' }}>
                  <span>Inspiration / Event / Adventure Boosts:</span>
                  <strong>+{powerBreakdown.inspoBoost}</strong>
                </div>
              )}
              <div
                style={{
                  borderTop: '1px solid rgba(255,255,255,0.2)',
                  paddingTop: '6px',
                  marginTop: '2px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: '#fde047',
                  fontSize: '15px',
                }}
              >
                <span>Total Current Power:</span>
                <strong>⚡ {powerBreakdown.totalPower}</strong>
              </div>
            </div>
            <button
              type="button"
              className="action-bar-btn secondary"
              onClick={() => setPowerBreakdown(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Card Inspector Modal */}
      {inspectedCard && (
        <div className="inspector-backdrop" onClick={() => setInspectedCard(null)}>
          <div
            className={`inspector-card-box ${isStoryCard(inspectedCard) ? 'story-landscape' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <img src={inspectedCard.imageUrl} alt={inspectedCard.name} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <h3 style={{ margin: 0, color: '#fbcfe8', fontSize: '17px' }}>{inspectedCard.name}</h3>
              <div style={{ fontSize: '12px', color: '#d8b4fe' }}>
                {inspectedCard.type} • {inspectedCard.element} • Cost: {inspectedCard.cost} • Power: {inspectedCard.power}
              </div>
              <p style={{ fontSize: '13px', lineHeight: 1.45, color: '#f3e8ff', margin: 0 }}>
                {cleanCardText(inspectedCard.effectText) || 'No special ability text.'}
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
          <span style={{ fontSize: '11px', color: secondsLeft <= 30 ? '#fca5a5' : '#fde047' }}>
            ⏱️ {formatTimer(secondsLeft)}
          </span>
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
            Leave / Forfeit
          </button>
        </div>
      </div>

      {/* Single Focused Playmat */}
      {cameraFocus === 'ME' ? renderFocusedBoard(me, false) : renderFocusedBoard(opp, true)}

      {/* Player Hand Dock with "My Hand" Label */}
      {!isSpectator && (
        <div className="player-hand-section">
          <div className="my-hand-label-pill">🃏 My Hand ({me.hand.length})</div>
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
        </div>
      )}
    </div>
  );
}