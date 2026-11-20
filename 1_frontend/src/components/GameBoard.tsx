import React, { useState, useEffect, useRef } from 'react';
import { soundFX } from '../utils/soundEffects';
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
  treats?: number;
  presents?: CardDefinition[];
  preventRetireInContact?: boolean;
}

interface PendingTargetSelection {
  sourceCard: CardDefinition;
  sourceOrigin:
    | 'HAND_EVENT'
    | 'ADVENTURE_TAP'
    | 'MANE_ABILITY'
    | 'APPEAR_EFFECT'
    | 'FAREWELL_EFFECT'
    | 'PRE_PLAN_EFFECT'
    | 'STORY_PROMOTION'
    | 'DELAYED_TRIGGER';
  sourceLane?: 'left' | 'center' | 'right';
  effectAction: string;
  value: number;
  promptText: string;
  validTargets: {
    owner: 'SELF' | 'OPPONENT';
    lane: 'left' | 'center' | 'right';
  }[];
  selectedFromLane?: 'left' | 'center' | 'right';
}

interface PendingHandChoice {
  sourceCard: CardDefinition;
  playerId?: '0' | '1';
  choiceType:
    | 'DISCARD_FROM_HAND'
    | 'DISCARD_THEN_DRAW'
    | 'RECOVER_FROM_RETIREMENT'
    | 'PICK_REVEALED_TO_HAND'
    | 'TOP_OR_BOTTOM_DECK'
    | 'CHOOSE_SCENE_TO_UNTAP'
    | 'END_PHASE_HAND_LIMIT';
  count: number;
  secondaryDrawCount?: number;
  promptText: string;
  candidateCards: CardDefinition[];
  validIndices?: number[];
  filterLabel?: string;
}

interface DelayedTriggerEntry {
  id: string;
  ownerId: '0' | '1';
  ownerName: string;
  sourceCard: CardDefinition;
  sourceLane?: 'left' | 'center' | 'right';
  timing: 'END_OF_YOUR_TURN' | 'END_OF_ANY_TURN';
  conditionText?: string;
  effectClause: string;
  createdTurn: number;
}

interface ManeSpeechBubble {
  id: string;
  text: string;
  tone: 'INFO' | 'EFFECT' | 'CHOICE' | 'WARNING';
  timestamp: number;
}

interface CardFlightAnimation {
  id: string;
  playerId: '0' | '1';
  kind: 'DRAW' | 'DISCARD' | 'RETIRE';
  count: number;
  cardName?: string;
  timestamp: number;
}

interface MatchRewardSummary {
  queueTier: 'QUICK_PLAY' | 'CASUAL' | 'RANKED' | 'PRIVATE';
  basePoints: number;
  firstWinBonus: number;
  streakBonus: number;
  totalEarned: number;
  newBalance: number;
  note: string;
}

interface ActionSpotlightEvent {
  id: string;
  actorId: '0' | '1';
  actorName: string;
  actionType: string;
  comicWord?: string;
  title: string;
  subtitle: string;
  card?: CardDefinition | null;
  lane?: 'left' | 'center' | 'right';
  timestamp: number;
}

interface ActionLogEntry {
  id: string;
  turn: number;
  actor: string;
  sourceCard?: string;
  text: string;
  category: 'PLAY' | 'EFFECT' | 'CLASH' | 'STORY' | 'SYSTEM';
  timestamp: number;
}

interface PlayerState {
  id: '0' | '1';
  displayName: string;
  leader: CardDefinition | null;
  leaderAbilityUsedThisTurn?: boolean;
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
  speechBubble?: ManeSpeechBubble | null;
}

export interface LiveGameState {
  roomId: string;
  phase:
    | 'WAITING_FOR_PLAYERS'
    | 'VS_INTRO'
    | 'MULLIGAN'
    | 'MAIN_PHASE'
    | 'PENDING_TARGET'
    | 'PENDING_HAND_CHOICE'
    | 'CONTACT_INSPIRE'
    | 'CONTACT_RESOLUTION'
    | 'CLASH_HOLD'
    | 'BREAKTHROUGH_CHOICE'
    | 'REVEAL_HOLD'
    | 'END_PHASE'
    | 'GAME_OVER';
  firstPlayerId: '0' | '1';
  wheelSpinDegrees?: number;
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
  pendingTarget?: PendingTargetSelection | null;
  pendingHandChoice?: PendingHandChoice | null;
  delayedTriggers?: DelayedTriggerEntry[];
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
  lastActionBanner?: ActionSpotlightEvent | null;
  lastCardFlight?: CardFlightAnimation | null;
  rewardSummary?: Partial<Record<'0' | '1', MatchRewardSummary>>;
  announcements: { type: string; message: string; timestamp: number }[];
  actionLog?: ActionLogEntry[];
  debugTrace?: any[];
}

interface PowerBreakdownDetails {
  cardName: string;
  laneName: string;
  basePower: number;
  lines: { label: string; bonus: number; color: string }[];
  totalPower: number;
}

interface GameBoardProps {
  ws: WebSocket;
  gameState: LiveGameState;
  seat: '0' | '1' | 'spectator';
  isReconnecting?: boolean;
  onLeaveMatch: () => void;
}

function getCardFoilClass(card: CardDefinition | null | undefined): string {
  if (!card) return '';
  const id = String(card.id || '').toUpperCase();
  const rar = String(card.rarity || '').toUpperCase();
  if (id.endsWith('-S') || rar === 'GR') return 'foil-shining';
  if (rar === 'UR' || rar === 'CR') return 'foil-ur';
  if (rar === 'SR' || rar === 'SSR') return 'foil-sr';
  return '';
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
  return /Adventure\s*:/i.test(cleanCardText(card.effectText));
}

function hasManeActivatedAbility(card: CardDefinition | null): boolean {
  if (!card) return false;
  return /Main Character Ability|Mane Ability|Once per turn|Activate\s*:/i.test(cleanCardText(card.effectText));
}

function canAffordCardWithHarmony(player: PlayerState, card: CardDefinition): boolean {
  const cost = Math.max(0, Number(card.cost) || 0);
  if (cost === 0) return true;
  const readyScenes = player.sceneArea.filter((s) => !s.isExhausted);
  if (readyScenes.length < cost) return false;
  const el = String(card.element || 'Everyday').toLowerCase();
  if (!el || el === 'everyday' || el === 'none') return true;
  return readyScenes.some((s) => {
    const sEl = String(s.card.element || 'Everyday').toLowerCase();
    return sEl === el || sEl === 'everyday' || sEl === 'none';
  });
}

function computeClientPowerDetails(
  gameState: LiveGameState,
  player: PlayerState,
  laneKey: 'left' | 'center' | 'right'
): PowerBreakdownDetails {
  const slot = player.adventureArea[laneKey];
  const char = slot.character!;
  const basePower = Number(char.power) || 0;
  const lines: { label: string; bonus: number; color: string }[] = [];
  const isOwnersTurn = gameState.turnPlayerId === player.id;

  const checkPassive = (rawText?: string): number => {
    const text = cleanCardText(rawText);
    if (
      !text ||
      /Inspo Boost|Inspiration Boost|Adventure\s*:|Pre-Plan|Appear\s*:|Farewell\s*:|When promoted|at the end of/i.test(
        text
      )
    ) {
      return 0;
    }
    const m = text.match(/get[s]?\s*\+(\d+)\s*(?:Inspiration|Power)/i);
    if (!m) return 0;
    if (/during your turn/i.test(text) && !isOwnersTurn) return 0;
    if (/left\s+lane/i.test(text) && laneKey !== 'left') return 0;
    if (/center\s+lane/i.test(text) && laneKey !== 'center') return 0;
    if (/right\s+lane/i.test(text) && laneKey !== 'right') return 0;
    if (/your\s+friend/i.test(text) && !String(char.type || '').toLowerCase().includes('friend')) return 0;
    if (
      /while\s+there\s+(?:is|are)\s+(?:any\s+)?untapped\s+scenes?\s+in\s+your\s+scene\s+area/i.test(
        text
      ) &&
      !player.sceneArea.some((sc) => !sc.isExhausted)
    ) {
      return 0;
    }
    return parseInt(m[1], 10) || 0;
  };

  for (const it of slot.items) {
    lines.push({
      label: `Item (${it.name})`,
      bonus: Number(it.power) || 1,
      color: '#38bdf8',
    });
  }

  if (player.leader) {
    const lb = checkPassive(player.leader.effectText);
    if (lb > 0) {
      lines.push({ label: `Main Character Passive (${player.leader.name})`, bonus: lb, color: '#fde047' });
    }
  }

  for (const sc of player.sceneArea) {
    if (!sc.isFaceUp) continue;
    const sb = checkPassive(sc.card.effectText);
    if (sb > 0) {
      lines.push({ label: `Scene Passive (${sc.card.name})`, bonus: sb, color: '#34d399' });
    }
  }

  for (const st of player.storyStages) {
    if (!st.isStoryCompleted || !st.storyCard) continue;
    const stb = checkPassive(st.storyCard.effectText);
    if (stb > 0) {
      lines.push({ label: `Story Stage ${st.stage} (${st.storyCard.name})`, bonus: stb, color: '#c084fc' });
    }
  }

  if ((slot.inspoBoost || 0) !== 0) {
    lines.push({
      label: slot.inspoBoost > 0 ? 'Inspiration Boost / Event Modifiers' : 'Rival Debuffs',
      bonus: slot.inspoBoost,
      color: '#f472b6',
    });
  }

  const totalPower = Math.max(0, basePower + lines.reduce((sum, l) => sum + l.bonus, 0));
  return {
    cardName: char.name,
    laneName: laneKey.toUpperCase(),
    basePower,
    lines,
    totalPower,
  };
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

  const text = cleanCardText(scene.card.effectText);
  const id = String(scene.card.id || '').toUpperCase();
  const hasInspo =
    /Inspo Boost|Inspiration Boost|\+\d+\s*Inspiration/i.test(text) || id.includes('-ER');

  if (!hasInspo) {
    return { eligible: false, reason: 'No Inspiration Boost text on card' };
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
  const [viewedRetirement, setViewedRetirement] = useState<{
    ownerName: string;
    cards: CardDefinition[];
  } | null>(null);
  const [powerBreakdown, setPowerBreakdown] = useState<PowerBreakdownDetails | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(180);

  const [isMuted, setIsMuted] = useState<boolean>(() => soundFX.isMuted());

  const [wheelAngle, setWheelAngle] = useState<number>(0);
  const [wheelSettled, setWheelSettled] = useState<boolean>(false);

  const [isLogOpen, setIsLogOpen] = useState<boolean>(false);
  const [logTab, setLogTab] = useState<'LOG' | 'DEBUG'>('LOG');
  const [showLogOnboardingBubble, setShowLogOnboardingBubble] = useState<boolean>(true);
  const [spotlightBanner, setSpotlightBanner] = useState<ActionSpotlightEvent | null>(null);
  const [cardFlightToast, setCardFlightToast] = useState<CardFlightAnimation | null>(null);
  const lastSeenSpotlightIdRef = useRef<string | null>(null);
  const lastSeenFlightIdRef = useRef<string | null>(null);
  const lastSeenClashIdRef = useRef<number | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const [pickedChoiceIndices, setPickedChoiceIndices] = useState<number[]>([]);

  const [turnBannerText, setTurnBannerText] = useState<string | null>(null);
  const prevTurnKeyRef = useRef<string | null>(null);

  const [zoneFocus, setZoneFocus] = useState<'ME' | 'OPPONENT'>('ME');
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mySeat: '0' | '1' = seat === '1' ? '1' : '0';
  const oppSeat: '0' | '1' = mySeat === '0' ? '1' : '0';
  const isSpectator = seat === 'spectator';

  const me = gameState.players[mySeat];
  const opp = gameState.players[oppSeat];
  const isMyTurn = !isSpectator && gameState.turnPlayerId === mySeat;
  const isOppTurn = gameState.turnPlayerId === oppSeat;

  useEffect(() => {
    const timer = setTimeout(() => setShowLogOnboardingBubble(false), 9000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const banner = gameState.lastActionBanner;
    if (!banner) return;
    if (lastSeenSpotlightIdRef.current !== banner.id) {
      lastSeenSpotlightIdRef.current = banner.id;
      setSpotlightBanner(banner);
      if (banner.actionType === 'TRIGGER_KEYWORD' || banner.actionType === 'DELAYED_TRIGGER') {
        soundFX.playKeywordChime();
      } else {
        soundFX.playCardSnap();
      }
      const timer = setTimeout(() => setSpotlightBanner(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [gameState.lastActionBanner?.id]);

  useEffect(() => {
    const flight = gameState.lastCardFlight;
    if (!flight) return;
    if (lastSeenFlightIdRef.current !== flight.id) {
      lastSeenFlightIdRef.current = flight.id;
      setCardFlightToast(flight);
      if (flight.kind === 'DRAW') {
        soundFX.playCardDraw(flight.count);
      } else {
        soundFX.playCardSnap();
      }
      const timer = setTimeout(() => setCardFlightToast(null), 1450);
      return () => clearTimeout(timer);
    }
  }, [gameState.lastCardFlight?.id]);

  useEffect(() => {
    if (gameState.phase === 'CLASH_HOLD' && gameState.lastClashEvent) {
      if (lastSeenClashIdRef.current !== gameState.lastClashEvent.id) {
        lastSeenClashIdRef.current = gameState.lastClashEvent.id;
        soundFX.playClashImpact();
      }
    }
  }, [gameState.phase, gameState.lastClashEvent?.id]);

  useEffect(() => {
    if (isLogOpen) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isLogOpen, gameState.actionLog?.length, gameState.debugTrace?.length, logTab]);

  useEffect(() => {
    setPickedChoiceIndices([]);
  }, [gameState.phase, gameState.pendingHandChoice?.promptText]);

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
    if (gameState.phase === 'VS_INTRO') {
      setWheelSettled(false);
      setWheelAngle(0);
      soundFX.playWheelSpin();

      const targetAngle =
        gameState.wheelSpinDegrees || (gameState.firstPlayerId === '0' ? 2070 : 1890);
      const kickTimer = setTimeout(() => {
        setWheelAngle(targetAngle);
      }, 80);

      const settleTimer = setTimeout(() => {
        setWheelSettled(true);
      }, 3200);

      const ackTimer = !isSpectator
        ? setTimeout(() => {
            sendAction('ACK_VS_INTRO');
          }, 4300)
        : undefined;

      return () => {
        clearTimeout(kickTimer);
        clearTimeout(settleTimer);
        if (ackTimer) clearTimeout(ackTimer);
      };
    }
  }, [gameState.phase, gameState.wheelSpinDegrees, gameState.firstPlayerId, isSpectator]);

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

  const handleAdventureSlotClick = (
    ownerSide: 'SELF' | 'OPPONENT',
    lane: 'left' | 'center' | 'right'
  ) => {
    if (!isMyTurn) return;

    if (gameState.phase === 'PENDING_TARGET' && gameState.pendingTarget) {
      const isValid = gameState.pendingTarget.validTargets.some(
        (t) => t.owner === ownerSide && t.lane === lane
      );
      if (isValid) {
        sendAction('SELECT_TARGET', { targetOwner: ownerSide, laneIndex: lane });
      }
      return;
    }

    if (ownerSide === 'SELF' && gameState.phase === 'MAIN_PHASE' && selectedHandCard) {
      const slot = me.adventureArea[lane];
      const normType = String(selectedHandCard.type || '').toLowerCase();
      if (normType.includes('character') && slot.character !== null) return;
      if (normType === 'item' && slot.character === null) return;

      sendAction('PLAY_CARD', { cardId: selectedHandCard.id, laneIndex: lane });
      setSelectedHandCardId(null);
    }
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

  const showHandChoiceModalForMe =
    !isSpectator &&
    gameState.phase === 'PENDING_HAND_CHOICE' &&
    Boolean(gameState.pendingHandChoice) &&
    (gameState.pendingHandChoice?.playerId
      ? gameState.pendingHandChoice.playerId === mySeat
      : gameState.turnPlayerId === mySeat);

  const activeClashLaneForModal = gameState.contactState?.activeLane;
  const myCharacterInClashLane = activeClashLaneForModal
    ? me.adventureArea[activeClashLaneForModal].character
    : null;

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const activeStepIndex = (() => {
    if (gameState.phase === 'VS_INTRO' || gameState.phase === 'MULLIGAN') return 0;
    if (
      gameState.phase === 'CONTACT_INSPIRE' ||
      gameState.phase === 'CONTACT_RESOLUTION' ||
      gameState.phase === 'CLASH_HOLD' ||
      gameState.phase === 'BREAKTHROUGH_CHOICE' ||
      gameState.phase === 'REVEAL_HOLD'
    ) {
      return 2;
    }
    if (
      gameState.phase === 'END_PHASE' ||
      gameState.pendingHandChoice?.choiceType === 'END_PHASE_HAND_LIMIT' ||
      gameState.pendingTarget?.sourceOrigin === 'DELAYED_TRIGGER'
    ) {
      return 3;
    }
    return 1;
  })();

  const renderDualManePresenceBar = () => {
    const canActivateMyMane =
      isMyTurn &&
      gameState.phase === 'MAIN_PHASE' &&
      !me.leaderAbilityUsedThisTurn &&
      hasManeActivatedAbility(me.leader);

    return (
      <div className="dual-mane-presence-bar">
        {/* Player (Self) Mane Character & Live Speech Bubble */}
        <div
          className={`mane-presence-card self-mane ${
            gameState.turnPlayerId === mySeat ? 'is-active' : ''
          }`}
        >
          <img
            src={me.leader?.imageUrl || CARD_BACK_URL}
            alt={me.leader?.name || 'Your Mane'}
            className="mane-presence-avatar"
            onContextMenu={(e) => handleContextMenu(e, me.leader)}
            onTouchStart={() => handleTouchStartInspect(me.leader)}
            onTouchEnd={handleTouchEndInspect}
          />
          <div className="mane-presence-info">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '12px', color: '#0369a1' }}>
                ✨ {me.displayName} ({me.leader?.name || 'Mane'})
              </strong>
              {canActivateMyMane && (
                <button
                  type="button"
                  className="action-bar-btn gold"
                  style={{ padding: '2px 8px', fontSize: '10.5px' }}
                  onClick={() => sendAction('ACTIVATE_MANE_ABILITY')}
                >
                  ✨ Activate Mane
                </button>
              )}
            </div>
            <div
              key={me.speechBubble?.id || 'me-idle'}
              className={`mane-inline-bubble tone-${me.speechBubble?.tone || 'INFO'}`}
            >
              💬 {me.speechBubble?.text || 'Ready for our next move!'}
            </div>
          </div>
        </div>

        {/* Opponent Mane Character & Live Speech Bubble */}
        <div
          className={`mane-presence-card opp-mane ${
            gameState.turnPlayerId === oppSeat ? 'is-active' : ''
          }`}
        >
          <img
            src={opp.leader?.imageUrl || CARD_BACK_URL}
            alt={opp.leader?.name || 'Opponent Mane'}
            className="mane-presence-avatar"
            onContextMenu={(e) => handleContextMenu(e, opp.leader)}
            onTouchStart={() => handleTouchStartInspect(opp.leader)}
            onTouchEnd={handleTouchEndInspect}
          />
          <div className="mane-presence-info">
            <strong style={{ fontSize: '12px', color: '#be123c' }}>
              👑 {opp.displayName} ({opp.leader?.name || 'Rival Mane'})
            </strong>
            <div
              key={opp.speechBubble?.id || 'opp-idle'}
              className={`mane-inline-bubble tone-${opp.speechBubble?.tone || 'INFO'}`}
            >
              💬 {opp.speechBubble?.text || 'Watching the board...'}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderLaneStrip = (player: PlayerState, isOpponent: boolean) => {
    const ownerSide: 'SELF' | 'OPPONENT' = isOpponent ? 'OPPONENT' : 'SELF';

    return (
      <div className={`lane-strip-band ${isOpponent ? 'opponent-band' : 'self-band'}`}>
        <span className={`lane-band-tag ${isOpponent ? 'opponent-tag' : 'self-tag'}`}>
          {isOpponent
            ? `👑 ${player.displayName}'s Adventure Area`
            : `✨ ${player.displayName}'s Adventure Area`}
        </span>

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

            const isPendingAbilityTarget =
              isMyTurn &&
              gameState.phase === 'PENDING_TARGET' &&
              gameState.pendingTarget?.validTargets.some(
                (t) => t.owner === ownerSide && t.lane === laneKey
              );

            const selectedType = String(selectedHandCard?.type || '').toLowerCase();
            const isDeployTarget =
              !isOpponent &&
              isMyTurn &&
              gameState.phase === 'MAIN_PHASE' &&
              selectedHandCard &&
              ((selectedType.includes('character') && slot.character === null) ||
                (selectedType === 'item' && slot.character !== null));

            const isTargetable = Boolean(isPendingAbilityTarget || isDeployTarget);

            const isActiveClashLane =
              (gameState.phase === 'CONTACT_INSPIRE' || gameState.phase === 'BREAKTHROUGH_CHOICE') &&
              gameState.contactState?.activeLane === laneKey;

            const isSpotlightLane =
              spotlightBanner &&
              spotlightBanner.actorId === player.id &&
              spotlightBanner.lane === laneKey;

            const details = slot.character
              ? computeClientPowerDetails(gameState, player, laneKey)
              : null;
            const totalBonus = details ? details.totalPower - details.basePower : 0;

            return (
              <div
                key={laneKey}
                className={`adventure-slot ${isOpponent ? 'opponent-slot' : 'self-slot'} ${
                  isTargetable ? 'targetable' : ''
                } ${isActiveClashLane ? 'active-lane-glow' : ''} ${
                  isSpotlightLane ? 'lane-spotlight-pulse' : ''
                }`}
                onClick={() => handleAdventureSlotClick(ownerSide, laneKey)}
                onContextMenu={(e) => handleContextMenu(e, slot.character)}
                onTouchStart={() => handleTouchStartInspect(slot.character)}
                onTouchEnd={handleTouchEndInspect}
              >
                {isSpotlightLane && spotlightBanner?.comicWord && (
                  <div key={spotlightBanner.id} className="comic-burst-badge">
                    {spotlightBanner.comicWord}
                  </div>
                )}

                {slot.character && details ? (
                  <>
                    <div
                      className={`total-power-above-badge ${totalBonus > 0 ? 'buffed' : ''}`}
                      title="Click to view Inspiration & Passive Aura breakdown"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPowerBreakdown(details);
                      }}
                    >
                      <span>⚡ {details.totalPower}</span>
                      <span className="power-subscript-info">
                        {totalBonus > 0 ? `+${totalBonus} ⓘ` : 'ⓘ'}
                      </span>
                    </div>

                    <div
                      className={`deployed-char-card ${
                        slot.isExhausted ? 'exhausted' : ''
                      } ${getCardFoilClass(slot.character)}`}
                    >
                      <img src={slot.character.imageUrl} alt={slot.character.name} />
                      {slot.items.length > 0 && (
                        <div
                          className="item-count-tag"
                          title="Click to inspect adorned Item card"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInspectedCard(slot.items[0]);
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setInspectedCard(slot.items[0]);
                          }}
                        >
                          🗡️ {slot.items[0].name}
                        </div>
                      )}
                      {slot.preventRetireInContact && (
                        <div
                          className="item-count-tag"
                          style={{
                            top: slot.items.length > 0 ? '26px' : '4px',
                            borderColor: '#fde047',
                          }}
                        >
                          🛡️ Contact Shield
                        </div>
                      )}
                      {(hasActedThisTurn || slot.isExhausted) && (
                        <div
                          className="item-count-tag"
                          style={{
                            top: 'auto',
                            bottom: '4px',
                            left: '4px',
                            right: 'auto',
                            color: '#fde047',
                          }}
                        >
                          {slot.isExhausted ? 'Tapped ↷' : 'Acted ✓'}
                        </div>
                      )}
                      {((slot.treats || 0) > 0 || (slot.presents?.length || 0) > 0) && (
                        <div className="keyword-counter-strip">
                          {(slot.treats || 0) > 0 && (
                            <span className="keyword-pill-badge">🍬 {slot.treats}</span>
                          )}
                          {(slot.presents?.length || 0) > 0 && (
                            <span className="keyword-pill-badge">🎁 {slot.presents!.length}</span>
                          )}
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
      </div>
    );
  };

  const renderPlayerZonesMat = (player: PlayerState, isOpponent: boolean) => {
    const readyHarmony = player.sceneArea.filter((s) => !s.isExhausted).length;
    const isPlayersTurn = gameState.turnPlayerId === player.id;

    const canActivateMane =
      !isOpponent &&
      isMyTurn &&
      gameState.phase === 'MAIN_PHASE' &&
      !player.leaderAbilityUsedThisTurn &&
      hasManeActivatedAbility(player.leader);

    return (
      <div
        className={`playmat-half ${isOpponent ? 'opponent-mat' : 'self-mat'} ${
          isPlayersTurn ? 'is-active-turn' : ''
        }`}
      >
        <div className="player-hud-bar">
          <div>
            <span>{isOpponent ? '👑 Opponent Zones: ' : '✨ Your Zones: '}</span>
            <strong>{player.displayName}</strong>
            {isPlayersTurn && <span className="active-turn-mat-badge">Active Turn</span>}
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
            <span className="hud-pill story-pill">
              📖 Story Stages: {me.storyProgress}/4 (You) vs {opp.storyProgress}/4 (Opp)
            </span>
            <span className="hud-pill">
              🌈 Force of Harmony: {readyHarmony}/{player.sceneArea.length}
            </span>
            <span className="hud-pill">🃏 Hand: {player.hand.length}</span>
            <button
              type="button"
              className="board-camera-switch-btn"
              onClick={() => setZoneFocus((prev) => (prev === 'ME' ? 'OPPONENT' : 'ME'))}
            >
              {zoneFocus === 'ME' ? "👁️ View Opponent's Story/Scenes" : '👁️ View My Story/Scenes'}
            </button>
          </div>
        </div>

        {/* Row: Main Character + 4 Landscape Story Stages + Retirement Area */}
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
              <img
                src={CARD_BACK_URL}
                alt="Main Character Card Back"
                className="kayou-card-back-img"
              />
            )}
            {canActivateMane && (
              <button
                type="button"
                className="adventure-tap-btn"
                title={cleanCardText(player.leader?.effectText)}
                onClick={() => sendAction('ACTIVATE_MANE_ABILITY')}
              >
                ✨ Main Character
              </button>
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
                  onContextMenu={(e) =>
                    handleContextMenu(e, st.isStoryCompleted ? st.storyCard : null)
                  }
                  onTouchStart={() =>
                    handleTouchStartInspect(st.isStoryCompleted ? st.storyCard : null)
                  }
                  onTouchEnd={handleTouchEndInspect}
                >
                  {st.isStoryCompleted && st.storyCard?.imageUrl ? (
                    <img src={st.storyCard.imageUrl} alt={st.storyCard.name} />
                  ) : (
                    <div className="story-uncompleted-overlay">
                      <img
                        src={CARD_BACK_URL}
                        alt={`Story Stage ${st.stage}`}
                        className="kayou-card-back-img"
                      />
                      <span className="story-stage-label-pill">Story Stage {st.stage}</span>
                    </div>
                  )}

                  {st.planCard && !st.isPlanRevealed && (
                    <div
                      className={`plan-card-overlay ${
                        isNextSequentialPlan && gameState.phase === 'BREAKTHROUGH_CHOICE' && isMyTurn
                          ? 'intervene-target'
                          : ''
                      }`}
                      title={`Story Stage ${st.stage} Face-Down Plan`}
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
            className="side-portrait-zone retirement-pile-zone"
            title="Right-click or long-press to view all cards in Retirement Area"
            onContextMenu={(e) => {
              e.preventDefault();
              setViewedRetirement({
                ownerName: player.displayName,
                cards: [...player.retirement].reverse(),
              });
            }}
            onTouchStart={() => {
              longPressTimer.current = setTimeout(() => {
                setViewedRetirement({
                  ownerName: player.displayName,
                  cards: [...player.retirement].reverse(),
                });
              }, 450);
            }}
            onTouchEnd={handleTouchEndInspect}
          >
            {player.retirement.length > 0 ? (
              <>
                <img
                  src={player.retirement[player.retirement.length - 1].imageUrl}
                  alt="Retirement Area Top"
                />
                <span className="retirement-inspect-pill">🔍 Hold / R-Click</span>
              </>
            ) : (
              <span className="slot-empty-label">Empty</span>
            )}
            <span className="zone-caption">Retirement ({player.retirement.length})</span>
          </div>
        </div>

        {/* Row: Scene Deck + Scene Area + Main Deck */}
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
                Scene Area (Force of Harmony)
              </span>
            ) : (
              player.sceneArea.map((sc, idx) => (
                <div
                  key={`${sc.card.id}-${idx}`}
                  className={`scene-card-slot ${sc.isExhausted ? 'exhausted' : ''} ${
                    sc.isFaceUp ? getCardFoilClass(sc.card) : ''
                  }`}
                  title={
                    sc.isLockedFaceDown
                      ? 'First-Turn Locked Scene (Cannot be used for Inspiration Boost)'
                      : !sc.isFaceUp
                      ? 'Inspiration Boost already used'
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
                        {sc.isLockedFaceDown ? '🔒 Locked' : 'Boost Used'}
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
      </div>
    );
  };

  const winnerPlayer = gameState.winnerId ? gameState.players[gameState.winnerId] : null;
  const actionLogs = gameState.actionLog || [];
  const debugTraces = gameState.debugTrace || [];
  const delayedTriggers = gameState.delayedTriggers || [];
  const myReward = !isSpectator ? gameState.rewardSummary?.[mySeat] : undefined;

  return (
    <div className="kayou-playmat-wrapper">
      {isReconnecting && (
        <div className="reconnecting-banner">
          🔄 Connection interrupted — Reconnecting to match room...
        </div>
      )}

      {/* Card Flight Animation Toast (Draw / Discard / Retire) */}
      {cardFlightToast && (
        <div key={cardFlightToast.id} className="card-flight-toast">
          <img src={CARD_BACK_URL} alt="Card Motion" />
          <span>
            {cardFlightToast.kind === 'DRAW'
              ? `🃏 ${gameState.players[cardFlightToast.playerId]?.displayName} drew ${cardFlightToast.count} card${
                  cardFlightToast.count === 1 ? '' : 's'
                }!`
              : cardFlightToast.kind === 'DISCARD'
              ? `🪦 Discarded ${cardFlightToast.cardName || `${cardFlightToast.count} card(s)`}`
              : `🪦 ${cardFlightToast.cardName} retired`}
          </span>
        </div>
      )}

      {/* Visual Action Spotlight Banner with Comic Callout */}
      {spotlightBanner && (
        <div className="action-spotlight-banner">
          {spotlightBanner.card?.imageUrl && (
            <img src={spotlightBanner.card.imageUrl} alt={spotlightBanner.card.name} />
          )}
          <div>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 900,
                color: '#fde047',
                textTransform: 'uppercase',
              }}
            >
              {spotlightBanner.comicWord && (
                <span className="spotlight-comic-tag">{spotlightBanner.comicWord}</span>
              )}
              {spotlightBanner.title}
            </div>
            <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#fce7f3', marginTop: '3px' }}>
              {spotlightBanner.subtitle}
            </div>
          </div>
        </div>
      )}

      {/* Collapsible Action Log & Debug Trace Drawer */}
      <div className="action-log-dock">
        {showLogOnboardingBubble && !isLogOpen && (
          <div className="action-log-onboarding-bubble">
            💬 <strong>Tip:</strong> View live card logs &amp; the 🐞 Debug Trace right here!
          </div>
        )}

        {isLogOpen && (
          <div className="action-log-drawer" style={{ width: '430px', maxHeight: '360px' }}>
            <div className="action-log-drawer-header">
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setLogTab('LOG')}
                  style={{
                    background: logTab === 'LOG' ? '#fde047' : 'rgba(255,255,255,0.12)',
                    color: logTab === 'LOG' ? '#4a148c' : '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '2px 8px',
                    fontWeight: 900,
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  📜 Log ({actionLogs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setLogTab('DEBUG')}
                  style={{
                    background: logTab === 'DEBUG' ? '#fde047' : 'rgba(255,255,255,0.12)',
                    color: logTab === 'DEBUG' ? '#4a148c' : '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '2px 8px',
                    fontWeight: 900,
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  🐞 Debug ({debugTraces.length})
                </button>
                {logTab === 'DEBUG' && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(JSON.stringify(debugTraces, null, 2));
                    }}
                    style={{
                      background: '#38bdf8',
                      color: '#0f172a',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '2px 8px',
                      fontWeight: 900,
                      fontSize: '10.5px',
                      cursor: 'pointer',
                    }}
                  >
                    📋 Copy JSON
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsLogOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 900,
                }}
              >
                ✕
              </button>
            </div>
            <div className="action-log-entries">
              {logTab === 'LOG'
                ? actionLogs.map((entry) => (
                    <div key={entry.id} className={`action-log-item cat-${entry.category}`}>
                      <strong style={{ color: '#fde047' }}>
                        [T{entry.turn}] {entry.actor}:
                      </strong>{' '}
                      <span>{entry.text}</span>
                    </div>
                  ))
                : debugTraces.map((dbg: any) => (
                    <div
                      key={dbg.id}
                      className="action-log-item cat-EFFECT"
                      style={{ fontSize: '10.8px' }}
                    >
                      <div style={{ color: '#fde047', fontWeight: 900 }}>
                        [T{dbg.turn} • {dbg.phase}] Turn: {dbg.turnPlayer} | Actor: {dbg.actor}
                      </div>
                      <div>
                        <strong>Card:</strong> {dbg.cardName} ({dbg.cardId}) |{' '}
                        <strong>Trigger:</strong> {dbg.triggerType}
                      </div>
                      <div style={{ color: '#fbcfe8' }}>
                        <strong>Text:</strong> {dbg.cardText}
                      </div>
                      <div>
                        <strong>Kind:</strong> {dbg.parsedKind} | <strong>Status:</strong>{' '}
                        <span
                          style={{
                            color:
                              dbg.status === 'RESOLVED'
                                ? '#34d399'
                                : dbg.status === 'SKIPPED'
                                ? '#fb7185'
                                : '#38bdf8',
                          }}
                        >
                          {dbg.status}
                        </span>
                      </div>
                      <div>
                        <strong>Targets/Choice:</strong> {dbg.targetsOrChoice}
                      </div>
                      {dbg.detectedKeywords?.length > 0 && (
                        <div style={{ color: '#c084fc' }}>
                          <strong>Keywords:</strong> {dbg.detectedKeywords.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        <button
          type="button"
          className="action-log-toggle-pill"
          onClick={() => {
            setIsLogOpen((prev) => !prev);
            setShowLogOnboardingBubble(false);
          }}
        >
          <span>
            📜 Log ({actionLogs.length}) • 🐞 ({debugTraces.length})
          </span>
          <span>{isLogOpen ? '▼' : '▲'}</span>
        </button>
      </div>

      {turnBannerText && gameState.phase !== 'REVEAL_HOLD' && gameState.phase !== 'CLASH_HOLD' && (
        <div className="turn-transition-banner-overlay">
          <div className="turn-transition-banner">{turnBannerText}</div>
        </div>
      )}

      {/* 1. VS Intro Splash with 2-Player 50/50 Animated Spin Wheel */}
      {gameState.phase === 'VS_INTRO' && (
        <div className="vs-intro-overlay">
          <div className="vs-fighters-stage" style={{ gap: '28px', flexWrap: 'wrap' }}>
            <div className="vs-fighter-card">
              {wheelSettled && gameState.firstPlayerId === '0' ? (
                <div className="vs-first-crown">👑 Goes First!</div>
              ) : (
                <div className="vs-first-crown-placeholder" />
              )}
              <div className="vs-player-name" style={{ color: '#7dd3fc' }}>
                {gameState.players['0'].displayName}
              </div>
              <img
                src={gameState.players['0'].leader?.imageUrl}
                alt={gameState.players['0'].leader?.name}
              />
              <div className="vs-leader-name">{gameState.players['0'].leader?.name}</div>
            </div>

            <div className="spin-wheel-arena">
              <div className="spin-wheel-pointer" />
              <div
                className="spin-wheel-disc"
                style={{ transform: `rotate(${wheelAngle}deg)` }}
              >
                <span className="wheel-slice-label slice-p0">
                  {gameState.players['0'].displayName}
                </span>
                <span className="wheel-slice-label slice-p1">
                  {gameState.players['1'].displayName}
                </span>
                <div className="spin-wheel-hub">VS</div>
              </div>
            </div>

            <div className="vs-fighter-card">
              {wheelSettled && gameState.firstPlayerId === '1' ? (
                <div className="vs-first-crown">👑 Goes First!</div>
              ) : (
                <div className="vs-first-crown-placeholder" />
              )}
              <div className="vs-player-name" style={{ color: '#f9a8d4' }}>
                {gameState.players['1'].displayName}
              </div>
              <img
                src={gameState.players['1'].leader?.imageUrl}
                alt={gameState.players['1'].leader?.name}
              />
              <div className="vs-leader-name">{gameState.players['1'].leader?.name}</div>
            </div>
          </div>

          <div className="vs-first-banner">
            {wheelSettled ? (
              <>
                👑{' '}
                {gameState.firstPlayerId === '0'
                  ? gameState.players['0'].displayName
                  : gameState.players['1'].displayName}{' '}
                Won the Spin &amp; Plays First!
              </>
            ) : (
              '🎡 Spinning 50/50 Wheel to Select First Player...'
            )}
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
                className={`mulligan-card-slot ${getCardFoilClass(c)}`}
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

      {/* 2B. Interactive Hand / Retirement / Reveal / Top-or-Bottom Deck Choice Modal */}
      {showHandChoiceModalForMe && gameState.pendingHandChoice && (
        <div className="inspector-backdrop">
          <div className="hand-choice-modal">
            <h3 style={{ margin: 0, color: '#fde047', fontSize: '21px' }}>
              ✨ {gameState.pendingHandChoice.sourceCard.name} — Decision Required
            </h3>
            <p style={{ margin: 0, fontSize: '14.5px', color: '#fbcfe8', textAlign: 'center' }}>
              {gameState.pendingHandChoice.promptText}
            </p>

            {gameState.pendingHandChoice.choiceType === 'TOP_OR_BOTTOM_DECK' ? (
              <>
                <div className="hand-choice-grid">
                  {gameState.pendingHandChoice.candidateCards.map((card, idx) => (
                    <div
                      key={`${card.id}-${idx}`}
                      className={`hand-choice-card picked ${getCardFoilClass(card)}`}
                      onContextMenu={(e) => handleContextMenu(e, card)}
                    >
                      <img src={card.imageUrl || CARD_BACK_URL} alt={card.name} />
                      <span style={{ fontSize: '11.5px', fontWeight: 900, textAlign: 'center' }}>
                        {card.name} ({card.id})
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="action-bar-btn gold"
                    style={{ fontSize: '15px', padding: '12px 26px' }}
                    onClick={() => sendAction('RESOLVE_HAND_CHOICE', { selectedIndices: [0] })}
                  >
                    ⬆️ Put on Top of Deck
                  </button>
                  <button
                    type="button"
                    className="action-bar-btn primary"
                    style={{ fontSize: '15px', padding: '12px 26px' }}
                    onClick={() => sendAction('RESOLVE_HAND_CHOICE', { selectedIndices: [1] })}
                  >
                    ⬇️ Put on Bottom of Deck
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="hand-choice-grid">
                  {gameState.pendingHandChoice.candidateCards.map((card, idx) => {
                    const isPicked = pickedChoiceIndices.includes(idx);
                    const validList = gameState.pendingHandChoice!.validIndices;
                    const isValidChoice = !validList || validList.includes(idx);

                    return (
                      <div
                        key={`${card.id}-${idx}`}
                        className={`hand-choice-card ${
                          isValidChoice ? 'valid-choice' : 'invalid-choice'
                        } ${isPicked ? 'picked' : ''}`}
                        onClick={() => {
                          if (!isValidChoice) return;
                          const maxNeeded = gameState.pendingHandChoice!.count;
                          if (isPicked) {
                            setPickedChoiceIndices((prev) => prev.filter((i) => i !== idx));
                          } else if (maxNeeded === 1) {
                            setPickedChoiceIndices([idx]);
                          } else if (pickedChoiceIndices.length < maxNeeded) {
                            setPickedChoiceIndices((prev) => [...prev, idx]);
                          }
                        }}
                        onContextMenu={(e) => handleContextMenu(e, card)}
                      >
                        <img src={card.imageUrl || CARD_BACK_URL} alt={card.name} />
                        <span style={{ fontSize: '11px', fontWeight: 800, textAlign: 'center' }}>
                          {isPicked
                            ? '✅ Selected'
                            : isValidChoice
                            ? `${card.name} (${card.id})`
                            : 'Not Eligible'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="action-bar-btn gold"
                  style={{ fontSize: '15px', padding: '12px 32px' }}
                  disabled={pickedChoiceIndices.length < gameState.pendingHandChoice.count}
                  onClick={() =>
                    sendAction('RESOLVE_HAND_CHOICE', { selectedIndices: pickedChoiceIndices })
                  }
                >
                  Confirm Selection ({pickedChoiceIndices.length}/{gameState.pendingHandChoice.count}) ✓
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 3. Dedicated Inspiration Boost Popup */}
      {showInspireModalForMe && gameState.contactState && (
        <div className="inspector-backdrop">
          <div className="inspire-popup-modal">
            <h3 style={{ margin: 0, color: '#fde047', fontSize: '20px' }}>
              ✨ Inspiration Boost Step — {gameState.contactState.activeLane.toUpperCase()} Lane Contact
            </h3>
            <div style={{ fontSize: '13.5px', color: '#fbcfe8', textAlign: 'center' }}>
              Active Character: <strong>{myCharacterInClashLane?.name || 'None'}</strong>
              <br />
              Current Inspiration: <strong>⚡ {gameState.contactState.attackerPower}</strong> (Attacker) vs{' '}
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
                        fontSize: '10.5px',
                        fontWeight: 800,
                        textAlign: 'center',
                        color: eligibility.eligible ? '#fde047' : '#d1d5db',
                      }}
                    >
                      {eligibility.eligible ? '✨ Tap for Boost!' : eligibility.reason}
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
              Pass Inspiration Boost ✓
            </button>
          </div>
        </div>
      )}

      {/* 4. Clash Slam Showdown Animation Overlay */}
      {gameState.phase === 'CLASH_HOLD' && gameState.lastClashEvent && (
        <div className="clash-showdown-overlay">
          <h2 style={{ color: '#fde047', fontSize: '26px', marginBottom: '18px' }}>
            ⚔️ {gameState.lastClashEvent.lane.toUpperCase()} LANE CONTACT!
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
              <strong style={{ fontSize: '20px', color: '#fde047' }}>
                ⚡ {gameState.lastClashEvent.attackerTotalPower}
              </strong>
            </div>

            <div style={{ fontSize: '36px', fontWeight: 900, color: '#f472b6' }}>VS</div>

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
              <strong style={{ fontSize: '20px', color: '#fde047' }}>
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
              <div
                style={{
                  background: gameState.lastPlanRevealEvent.hasPrePlanTrigger
                    ? '#f59e0b'
                    : '#ec4899',
                  color: gameState.lastPlanRevealEvent.hasPrePlanTrigger ? '#4a148c' : '#fff',
                  fontSize: '12px',
                  fontWeight: 900,
                  padding: '3px 12px',
                  borderRadius: '10px',
                  alignSelf: 'flex-start',
                }}
              >
                📖 PLAN INTERVENED — STORY STAGE {gameState.lastPlanRevealEvent.stage}
              </div>

              <h3 style={{ margin: 0, color: '#fbcfe8', fontSize: '21px' }}>
                {gameState.lastPlanRevealEvent.revealedCard.name}
              </h3>

              <p style={{ fontSize: '15px', lineHeight: 1.5, color: '#f3e8ff', margin: 0 }}>
                {cleanCardText(gameState.lastPlanRevealEvent.revealedCard.effectText) ||
                  'No Pre-Plan trigger.'}
              </p>

              {gameState.lastPlanRevealEvent.triggeredEffectSummary && (
                <div
                  style={{
                    background: 'rgba(253, 224, 71, 0.16)',
                    border: '1.5px solid #fde047',
                    borderRadius: '10px',
                    padding: '8px 12px',
                    fontSize: '13.5px',
                    color: '#fde047',
                    fontWeight: 800,
                  }}
                >
                  ⚡ {gameState.lastPlanRevealEvent.triggeredEffectSummary}
                </div>
              )}

              <div style={{ fontSize: '13px', color: '#34d399', fontWeight: 800 }}>
                {gameState.lastPlanRevealEvent.hasPrePlanTrigger
                  ? `🪦 Pre-Plan resolved — ${gameState.lastPlanRevealEvent.revealedCard.name} moved to ${gameState.lastPlanRevealEvent.defenderName}'s Retirement Area!`
                  : `🃏 Card placed into ${gameState.lastPlanRevealEvent.defenderName}'s Hand!`}
              </div>

              <div className="ack-status-row">
                <span style={{ fontSize: '12px', color: '#d8b4fe' }}>
                  Confirmed: {gameState.lastPlanRevealEvent.acknowledgedBy.length} / 2 Players
                </span>

                {!isSpectator &&
                  (gameState.lastPlanRevealEvent.acknowledgedBy.includes(mySeat) ? (
                    <span style={{ fontSize: '13px', color: '#fde047', fontWeight: 800 }}>
                      ✅ Waiting for {opp.displayName}...
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="action-bar-btn primary"
                      style={{ fontSize: '13.5px', padding: '9px 20px' }}
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
              <div
                style={{
                  background: '#ec4899',
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 900,
                  padding: '3px 12px',
                  borderRadius: '10px',
                  alignSelf: 'flex-start',
                }}
              >
                ✨ {gameState.lastStoryRevealEvent.attackerName} PROGRESSED STORY (
                {gameState.lastStoryRevealEvent.stage}/4)
              </div>

              <h3 style={{ margin: 0, color: '#fbcfe8', fontSize: '21px' }}>
                {gameState.lastStoryRevealEvent.storyCard.name}
              </h3>

              <p style={{ fontSize: '15px', lineHeight: 1.5, color: '#f3e8ff', margin: 0 }}>
                {cleanCardText(gameState.lastStoryRevealEvent.storyCard.effectText) ||
                  'No printed promotion effect.'}
              </p>

              {gameState.lastStoryRevealEvent.triggeredEffectSummary && (
                <div
                  style={{
                    background: 'rgba(52, 211, 153, 0.16)',
                    border: '1.5px solid #34d399',
                    borderRadius: '10px',
                    padding: '8px 12px',
                    fontSize: '13.5px',
                    color: '#34d399',
                    fontWeight: 800,
                  }}
                >
                  ✨ {gameState.lastStoryRevealEvent.triggeredEffectSummary}
                </div>
              )}

              <div className="ack-status-row">
                <span style={{ fontSize: '12px', color: '#d8b4fe' }}>
                  Confirmed: {gameState.lastStoryRevealEvent.acknowledgedBy.length} / 2 Players
                </span>

                {!isSpectator &&
                  (gameState.lastStoryRevealEvent.acknowledgedBy.includes(mySeat) ? (
                    <span style={{ fontSize: '13px', color: '#fde047', fontWeight: 800 }}>
                      ✅ Waiting for {opp.displayName}...
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="action-bar-btn primary"
                      style={{ fontSize: '13.5px', padding: '9px 20px' }}
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

      {/* 6. Fanfare Winner Screen with Confetti + Pony Points Reward Breakdown */}
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
          <p style={{ fontSize: '16px', color: '#fbcfe8', margin: '0 0 14px', zIndex: 10 }}>
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

          {myReward && (
            <div className="match-reward-card">
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 900,
                  color: '#fde047',
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                }}
              >
                🪙 Match Rewards ({myReward.queueTier.replace('_', ' ')})
              </div>
              {myReward.totalEarned > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13.5px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Match Payout:</span>
                    <strong>+{myReward.basePoints} PP</strong>
                  </div>
                  {myReward.firstWinBonus > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#34d399' }}>
                      <span>✨ First Win of the Day:</span>
                      <strong>+{myReward.firstWinBonus} PP</strong>
                    </div>
                  )}
                  {myReward.streakBonus > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#38bdf8' }}>
                      <span>🔥 Win Streak Bonus:</span>
                      <strong>+{myReward.streakBonus} PP</strong>
                    </div>
                  )}
                  <div
                    style={{
                      borderTop: '1px solid rgba(255,255,255,0.2)',
                      paddingTop: '6px',
                      marginTop: '4px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      color: '#fde047',
                      fontSize: '15px',
                    }}
                  >
                    <span>Total Earned:</span>
                    <strong>
                      +{myReward.totalEarned} 🪙 (Balance: {myReward.newBalance})
                    </strong>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '12.5px', color: '#fbcfe8' }}>{myReward.note}</div>
              )}
            </div>
          )}

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

      {/* Inspiration & Passive Aura Breakdown Popover Modal */}
      {powerBreakdown && (
        <div className="inspector-backdrop" onClick={() => setPowerBreakdown(null)}>
          <div
            className="inspector-card-box"
            style={{ flexDirection: 'column', maxWidth: '460px', gap: '12px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: 0, color: '#fde047', fontSize: '20px' }}>
              ⚡ Total Inspiration Breakdown ({powerBreakdown.laneName} Lane)
            </h3>
            <div style={{ fontSize: '15px', fontWeight: 800, color: '#fbcfe8' }}>
              {powerBreakdown.cardName}
            </div>
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontSize: '14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Base Character Inspiration:</span>
                <strong>{powerBreakdown.basePower}</strong>
              </div>
              {powerBreakdown.lines.map((line, idx) => (
                <div
                  key={idx}
                  style={{ display: 'flex', justifyContent: 'space-between', color: line.color }}
                >
                  <span>{line.label}:</span>
                  <strong>+{line.bonus}</strong>
                </div>
              ))}
              <div
                style={{
                  borderTop: '1px solid rgba(255,255,255,0.2)',
                  paddingTop: '8px',
                  marginTop: '4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: '#fde047',
                  fontSize: '16px',
                }}
              >
                <span>Total Current Inspiration:</span>
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

      {/* Viewable Retirement Area Container Modal */}
      {viewedRetirement && (
        <div className="inspector-backdrop" onClick={() => setViewedRetirement(null)}>
          <div className="retirement-viewer-modal" onClick={(e) => e.stopPropagation()}>
            <div className="retirement-viewer-header">
              <div>
                <h3 style={{ margin: 0, color: '#fde047', fontSize: '20px' }}>
                  🪦 {viewedRetirement.ownerName}&apos;s Retirement Area (
                  {viewedRetirement.cards.length})
                </h3>
                <span style={{ fontSize: '13px', color: '#e9d5ff' }}>
                  Ordered newest (top of pile) to oldest • Click any card to inspect rules text
                </span>
              </div>
              <button
                type="button"
                className="action-bar-btn secondary"
                onClick={() => setViewedRetirement(null)}
              >
                ✕ Close
              </button>
            </div>

            {viewedRetirement.cards.length === 0 ? (
              <div style={{ padding: '36px', textAlign: 'center', color: '#d8b4fe', fontSize: '15px' }}>
                No cards in this Retirement Area yet.
              </div>
            ) : (
              <div className="retirement-cards-scroll-grid">
                {viewedRetirement.cards.map((card, idx) => (
                  <div
                    key={`${card.id}-${idx}`}
                    className={`retirement-card-entry ${isStoryCard(card) ? 'story-entry' : ''}`}
                    onClick={() => setInspectedCard(card)}
                  >
                    <span className="retirement-order-tag">
                      #{viewedRetirement.cards.length - idx}
                    </span>
                    <img src={card.imageUrl || CARD_BACK_URL} alt={card.name} />
                    <div className="retirement-card-name">{card.name}</div>
                    <div className="retirement-card-sub">{card.type}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Enlarged Card Inspector Modal */}
      {inspectedCard && (
        <div className="inspector-backdrop" onClick={() => setInspectedCard(null)}>
          <div
            className={`inspector-card-box ${
              isStoryCard(inspectedCard) ? 'story-landscape' : ''
            } ${getCardFoilClass(inspectedCard)}`}
            onClick={(e) => e.stopPropagation()}
          >
            <img src={inspectedCard.imageUrl} alt={inspectedCard.name} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
              <h3 style={{ margin: 0, color: '#fbcfe8', fontSize: '23px' }}>
                {inspectedCard.name}
              </h3>
              <div style={{ fontSize: '14px', color: '#fde047', fontWeight: 800 }}>
                {inspectedCard.type} • {inspectedCard.element} • Cost: {inspectedCard.cost} •
                Inspiration: {inspectedCard.power}
              </div>
              <p style={{ fontSize: '16px', lineHeight: 1.55, color: '#f3e8ff', margin: 0 }}>
                {cleanCardText(inspectedCard.effectText) || 'No special ability text.'}
              </p>
              <button
                type="button"
                className="action-bar-btn gold"
                style={{ marginTop: 'auto', fontSize: '14px', padding: '10px 22px' }}
                onClick={() => setInspectedCard(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dedicated Top Action Bar with 4-Step Rules v1.3.0 Turn-Phase Indicator, Cast Event Button & Sound Toggle */}
      <div
        className={`center-action-bar ${
          isMyTurn ? 'my-turn-bar' : isOppTurn ? 'opp-turn-bar' : ''
        }`}
      >
        <div className="action-bar-status">
          <span className="turn-badge">TURN {gameState.turnNumber}</span>
          <span>
            {isMyTurn ? '🔵 YOUR TURN: ' : '🔴 OPPONENT TURN: '}
            <strong>{gameState.players[gameState.turnPlayerId].displayName}</strong>
          </span>

          <div className="phase-stepper-bar" title="Rules v1.3.0 Turn Phases">
            <span className={`phase-step-pill ${activeStepIndex === 0 ? 'active' : ''}`}>
              1. Start
            </span>
            <span className={`phase-step-pill ${activeStepIndex === 1 ? 'active' : ''}`}>
              2. Main
            </span>
            <span className={`phase-step-pill ${activeStepIndex === 2 ? 'active' : ''}`}>
              3. Contact
            </span>
            <span className={`phase-step-pill ${activeStepIndex === 3 ? 'active' : ''}`}>
              4. End
            </span>
          </div>

          <span style={{ fontSize: '11px', color: secondsLeft <= 30 ? '#fca5a5' : '#fde047' }}>
            ⏱️ {formatTimer(secondsLeft)}
          </span>
        </div>

        <div className="action-bar-buttons">
          {isMyTurn && gameState.phase === 'PENDING_TARGET' && gameState.pendingTarget && (
            <>
              <span style={{ fontSize: '12px', color: '#fde047', fontWeight: 900 }}>
                🎯 {gameState.pendingTarget.promptText}
              </span>
              <button
                type="button"
                className="action-bar-btn secondary"
                onClick={() => sendAction('CANCEL_TARGET')}
              >
                Cancel
              </button>
            </>
          )}

          {isMyTurn && gameState.phase === 'MAIN_PHASE' && (
            <>
              {selectedHandCard &&
                String(selectedHandCard.type || '').toLowerCase() === 'event' && (
                  <button
                    type="button"
                    className="action-bar-btn primary"
                    style={{
                      boxShadow: '0 0 18px rgba(253, 224, 71, 0.85)',
                      border: '1.5px solid #fde047',
                    }}
                    onClick={() => {
                      sendAction('PLAY_CARD', { cardId: selectedHandCard.id });
                      setSelectedHandCardId(null);
                    }}
                  >
                    ✨ Cast Event: {selectedHandCard.name}
                  </button>
                )}

              {me.turnsTaken > 1 ? (
                <button
                  type="button"
                  className="action-bar-btn primary"
                  onClick={() => sendAction('START_CONTACT')}
                >
                  ⚔️ Contact Phase
                </button>
              ) : (
                <span style={{ fontSize: '11px', color: '#fbcfe8', fontStyle: 'italic' }}>
                  (Turn 1: No Contact)
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
                  🔮 Progress Story Stage ({me.storyProgress + 1}/4)
                </button>
              )}

              {nextOpponentPlanStage && (
                <button
                  type="button"
                  className="action-bar-btn gold"
                  onClick={() => sendAction('BREAKTHROUGH_CHOICE', { choice: 'INTERVENE_PLAN' })}
                >
                  ⚡ Intervene Plan (Flip Story Stage {nextOpponentPlanStage.stage})
                </button>
              )}
            </>
          )}

          <button
            type="button"
            className="action-bar-btn secondary"
            title={isMuted ? 'Unmute Tabletop Sound Effects' : 'Mute Tabletop Sound Effects'}
            onClick={() => setIsMuted(soundFX.toggleMute())}
          >
            {isMuted ? '🔇' : '🔊'}
          </button>

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

      {/* Both Mane Characters & Speech Bubbles Always Visible */}
      {renderDualManePresenceBar()}

      {/* Delayed Triggers Queue Dock (Shows End-of-Turn Scheduled Effects) */}
      {delayedTriggers.length > 0 && (
        <div className="delayed-triggers-strip">
          <strong style={{ color: '#fde047' }}>
            ⏳ Queued End-of-Turn Triggers ({delayedTriggers.length}):
          </strong>
          {delayedTriggers.map((trig) => (
            <div
              key={trig.id}
              className="delayed-trigger-chip"
              title="Click to inspect source card"
              onClick={() => setInspectedCard(trig.sourceCard)}
            >
              {trig.sourceCard.imageUrl && (
                <img src={trig.sourceCard.imageUrl} alt={trig.sourceCard.name} />
              )}
              <span>
                <strong>{trig.ownerName}</strong> • {trig.sourceCard.name}:{' '}
                {trig.conditionText ? `If ${trig.conditionText}, ` : ''}
                {trig.effectClause}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* FULL-SCREEN DUAL-LANE ADVENTURE ARENA */}
      <div className="dual-adventure-arena">
        {renderLaneStrip(opp, true)}

        <div className="center-clash-divider">
          <span className="lane-axis-pill">LEFT LANE</span>
          <span className="lane-axis-pill">CENTER LANE</span>
          <span className="lane-axis-pill">RIGHT LANE</span>
        </div>

        {renderLaneStrip(me, false)}
      </div>

      {/* Color-Coded Story, Scene & Deck Playmat */}
      {zoneFocus === 'ME' ? renderPlayerZonesMat(me, false) : renderPlayerZonesMat(opp, true)}

      {/* Player Hand Dock */}
      {!isSpectator && (
        <div className="player-hand-section">
          <div className="my-hand-label-pill">🃏 My Hand ({me.hand.length})</div>
          <div className="player-hand-dock">
            {me.hand.map((card, idx) => {
              const isSelected = selectedHandCardId === card.id;
              const canAfford = canAffordCardWithHarmony(me, card);
              return (
                <div
                  key={`${card.id}-${idx}`}
                  className={`hand-card-item ${isSelected ? 'selected' : ''} ${
                    !canAfford ? 'unaffordable' : getCardFoilClass(card)
                  }`}
                  onClick={() => {
                    if (!isMyTurn || gameState.phase !== 'MAIN_PHASE') return;
                    if (!canAfford) return;
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