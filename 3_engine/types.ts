export type LaneKey = 'left' | 'center' | 'right';

export type ElementType =
  | 'Magic'
  | 'Loyalty'
  | 'Honesty'
  | 'Generosity'
  | 'Kindness'
  | 'Laughter'
  | 'Everyday'
  | string;

export interface CardDefinition {
  id: string;
  cardNumber: string;
  name: string;
  type: string;
  element: ElementType;
  cost: number;
  power: number;
  defense: number;
  traits?: string;
  effectText?: string;
  imageUrl?: string;
  rarity?: string;
  setCode?: string;
}

export interface SceneCardInPlay {
  card: CardDefinition;
  isFaceUp: boolean;
  isExhausted: boolean;
  isLockedFaceDown: boolean;
}

export interface StoryStageSlot {
  stage: 1 | 2 | 3 | 4;
  storyCard: CardDefinition | null;
  isStoryCompleted: boolean;
  planCard: CardDefinition | null;
  isPlanRevealed: boolean;
}

export interface AdventureSlot {
  character: CardDefinition | null;
  items: CardDefinition[];
  inspoBoost: number;
  isExhausted: boolean;
  treats: number;
  hadTreat: boolean;
  presents: CardDefinition[];
  hadPresent: boolean;
  preventRetireInContact: boolean;
}

export interface PowerModifierLine {
  label: string;
  bonus: number;
  color: string;
}

export interface LanePowerBreakdown {
  basePower: number;
  lines: PowerModifierLine[];
  totalPower: number;
}

export interface PendingTargetSelection {
  playerId?: '0' | '1';
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
  sourceLane?: LaneKey;
  effectAction:
    | 'BUFF_POWER'
    | 'BUFF_TWO_TARGETS'
    | 'DEBUFF_OPPONENT'
    | 'TREAT_CHARACTER'
    | 'REMOVE_TREAT'
    | 'DELIVER_PRESENT'
    | 'UNWRAP_PRESENT'
    | 'SWITCH_POSITIONS'
    | 'RETIRE_OPPONENT'
    | 'READY_FRIENDLY'
    | 'MOVE_FRIENDLY'
    | 'PREVENT_RETIRE_IN_CONTACT';
  value: number;
  maxTargetCostOrPower?: number;
  secondaryNameFilter?: string;
  promptText: string;
  validTargets: {
    owner: 'SELF' | 'OPPONENT';
    lane: LaneKey;
  }[];
  selectedFromLane?: LaneKey;
  resumeAttackQueue?: LaneKey[] | null;
  resumeEndTurnForPlayer?: '0' | '1' | null;
}

export interface PendingHandChoice {
  sourceCard: CardDefinition;
  playerId?: '0' | '1';
  choiceType:
    | 'DISCARD_FROM_HAND'
    | 'DISCARD_THEN_DRAW'
    | 'RECOVER_FROM_RETIREMENT'
    | 'REVIVE_FROM_RETIREMENT'
    | 'MOVE_HAND_TO_PLAN'
    | 'PICK_REVEALED_TO_HAND'
    | 'TOP_OR_BOTTOM_DECK'
    | 'CHOOSE_SCENE_TO_UNTAP'
    | 'CHOOSE_SCENE_TO_FLIP_UP'
    | 'CHOOSE_SCENE_TO_FLIP_DOWN'
    | 'CHOOSE_RIVAL_SCENE_TO_FLIP_DOWN'
    | 'END_PHASE_HAND_LIMIT';
  count: number;
  secondaryDrawCount?: number;
  promptText: string;
  candidateCards: CardDefinition[];
  validIndices?: number[];
  filterLabel?: string;
  resumeAttackQueue?: LaneKey[] | null;
  resumeEndTurnForPlayer?: '0' | '1' | null;
}

export interface QueuedEffectItem {
  id: string;
  ownerId: '0' | '1';
  sourceCard: CardDefinition;
  sourceLane?: LaneKey;
  triggerType: 'Appear' | 'Farewell' | 'Adventure' | 'Pre-Plan' | 'StoryPromotion' | 'DelayedTrigger';
  effectClause: string;
  resumeAttackQueue?: LaneKey[] | null;
  resumeEndTurnForPlayer?: '0' | '1' | null;
}

export interface DelayedTriggerEntry {
  id: string;
  ownerId: '0' | '1';
  ownerName: string;
  sourceCard: CardDefinition;
  sourceLane?: LaneKey;
  timing: 'END_OF_YOUR_TURN' | 'END_OF_ANY_TURN';
  conditionText?: string;
  effectClause: string;
  createdTurn: number;
}

export interface ManeSpeechBubble {
  id: string;
  text: string;
  tone: 'INFO' | 'EFFECT' | 'CHOICE' | 'WARNING';
  timestamp: number;
}

export interface CardFlightAnimation {
  id: string;
  playerId: '0' | '1';
  kind: 'DRAW' | 'DISCARD' | 'RETIRE';
  count: number;
  cardName?: string;
  timestamp: number;
}

export interface MatchRewardSummary {
  queueTier: 'QUICK_PLAY' | 'CASUAL' | 'RANKED' | 'PRIVATE';
  basePoints: number;
  firstWinBonus: number;
  streakBonus: number;
  totalEarned: number;
  newBalance: number;
  note: string;
}

export interface ActionSpotlightEvent {
  id: string;
  actorId: '0' | '1';
  actorName: string;
  actionType:
    | 'PLAY_CHARACTER'
    | 'PLAY_EVENT'
    | 'ADORN_ITEM'
    | 'TRIGGER_KEYWORD'
    | 'DELAYED_TRIGGER'
    | 'SYSTEM';
  comicWord?: string;
  title: string;
  subtitle: string;
  card?: CardDefinition | null;
  lane?: LaneKey;
  timestamp: number;
}

export interface ActionLogEntry {
  id: string;
  turn: number;
  actor: string;
  sourceCard?: string;
  text: string;
  category: 'PLAY' | 'EFFECT' | 'CLASH' | 'STORY' | 'SYSTEM';
  timestamp: number;
}

export interface DebugTraceEntry {
  id: string;
  turn: number;
  phase: string;
  turnPlayer: string;
  actor: string;
  cardId: string;
  cardName: string;
  cardText: string;
  triggerType: string;
  detectedKeywords: string[];
  parsedKind: string;
  targetsOrChoice: string;
  status: 'RESOLVED' | 'AWAITING_INPUT' | 'QUEUED_STACK' | 'QUEUED_DELAYED' | 'SKIPPED';
  notes: string;
  timestamp: number;
}

export interface PlayerState {
  id: '0' | '1';
  displayName: string;
  leader: CardDefinition | null;
  leaderAbilityUsedThisTurn: boolean;
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
  actedLanesThisTurn: LaneKey[];
  nextCardCostDiscount?: { filter?: string; cardType?: string; amount: number } | null;
  isConnected: boolean;
  speechBubble?: ManeSpeechBubble | null;
}

export type GamePhase =
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

export interface ContactPhaseState {
  activeLane: LaneKey;
  laneQueue: LaneKey[];
  promptPlayerId: '0' | '1';
  consecutivePasses: number;
  attackerPower: number;
  defenderPower: number;
}

export interface ClashEvent {
  id: number;
  lane: LaneKey;
  attackerCard: CardDefinition;
  defenderCard: CardDefinition;
  attackerTotalPower: number;
  defenderTotalPower: number;
  outcome: 'ATTACKER_WINS' | 'DEFENDER_WINS' | 'TIE';
  acknowledgedBy: ('0' | '1')[];
}

export interface PlanRevealEvent {
  id: number;
  stage: 1 | 2 | 3 | 4;
  defenderId: '0' | '1';
  defenderName: string;
  revealedCard: CardDefinition;
  hasPrePlanTrigger: boolean;
  triggeredEffectSummary: string | null;
  acknowledgedBy: ('0' | '1')[];
}

export interface StoryRevealEvent {
  id: number;
  stage: 1 | 2 | 3 | 4;
  attackerId: '0' | '1';
  attackerName: string;
  storyCard: CardDefinition;
  triggeredEffectSummary: string | null;
  acknowledgedBy: ('0' | '1')[];
  isGameWinningStage: boolean;
}

export interface AnnouncementBanner {
  type: string;
  message: string;
  timestamp: number;
}

export interface KayouGameState {
  roomId: string;
  phase: GamePhase;
  firstPlayerId: '0' | '1';
  wheelSpinDegrees: number;
  turnPlayerId: '0' | '1';
  turnNumber: number;
  winnerId: '0' | '1' | null;
  winReason: string | null;
  turnDeadlineMs?: number;
  players: Record<'0' | '1', PlayerState>;
  contactState: ContactPhaseState | null;
  pendingTarget: PendingTargetSelection | null;
  pendingHandChoice: PendingHandChoice | null;
  pendingLaneQueueAfterReveal?: LaneKey[] | null;
  effectResolutionQueue: QueuedEffectItem[];
  delayedTriggers: DelayedTriggerEntry[];
  lastClashEvent: ClashEvent | null;
  lastPlanRevealEvent: PlanRevealEvent | null;
  lastStoryRevealEvent: StoryRevealEvent | null;
  lastActionBanner?: ActionSpotlightEvent | null;
  lastCardFlight?: CardFlightAnimation | null;
  rewardSummary?: Partial<Record<'0' | '1', MatchRewardSummary>>;
  announcements: AnnouncementBanner[];
  actionLog: ActionLogEntry[];
  debugTrace: DebugTraceEntry[];
}

export interface HydratedDeckPayload {
  leader: CardDefinition | null;
  storyDeck: CardDefinition[];
  sceneDeck: CardDefinition[];
  mainDeck: CardDefinition[];
}