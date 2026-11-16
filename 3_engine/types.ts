export type DeckId = string;

export type CardType =
  | 'Mane Character'
  | 'MainCharacter'
  | 'Character'
  | 'Friend Character'
  | 'Item'
  | 'Event'
  | 'Scene'
  | 'Story'
  | 'Plan';

export type HarmonyColor =
  | 'Magic'
  | 'Honesty'
  | 'Loyalty'
  | 'Laughter'
  | 'Generosity'
  | 'Kindness'
  | 'Everyday'
  | 'None';

export interface CardDefinition {
  id: string;
  cardNumber: string;
  name: string;
  type: CardType | string;
  element: HarmonyColor | string;
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
  items: CardDefinition[]; // Enforced max 1 attached Item per official rules
  inspoBoost: number;
  isExhausted: boolean;
}

export interface PowerModifierLine {
  sourceName: string;
  sourceType: 'BASE' | 'ITEM' | 'MANE_PASSIVE' | 'SCENE_PASSIVE' | 'STORY_PASSIVE' | 'INSPO_BOOST';
  amount: number;
}

export interface LanePowerBreakdown {
  basePower: number;
  modifiers: PowerModifierLine[];
  totalPower: number;
}

export interface PendingTargetSelection {
  sourceCard: CardDefinition;
  sourceOrigin: 'HAND_EVENT' | 'ADVENTURE_TAP' | 'MANE_ABILITY';
  sourceLane?: LaneKey;
  effectAction: 'BUFF_POWER' | 'RETIRE_OPPONENT' | 'MOVE_FRIENDLY' | 'READY_FRIENDLY';
  value: number;
  maxTargetCostOrPower?: number;
  promptText: string;
  validTargets: {
    owner: 'SELF' | 'OPPONENT';
    lane: LaneKey;
  }[];
  // Optional second step for MOVE_FRIENDLY (pick source lane first, then destination lane)
  selectedFromLane?: LaneKey;
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
  isConnected?: boolean;
}

export type GamePhase =
  | 'WAITING_FOR_PLAYERS'
  | 'VS_INTRO'
  | 'MULLIGAN'
  | 'MAIN_PHASE'
  | 'PENDING_TARGET'
  | 'CONTACT_INSPIRE'
  | 'CONTACT_RESOLUTION'
  | 'CLASH_HOLD'
  | 'BREAKTHROUGH_CHOICE'
  | 'REVEAL_HOLD'
  | 'GAME_OVER';

export type LaneKey = 'left' | 'center' | 'right';

export interface ContactCombatState {
  activeLane: LaneKey;
  laneQueue: LaneKey[];
  promptPlayerId: '0' | '1';
  consecutivePasses: number;
  attackerPower: number;
  defenderPower: number;
}

export interface ClashAnimationEvent {
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

export interface PublicAnnouncement {
  type: string;
  message: string;
  timestamp: number;
}

export interface HydratedDeckPayload {
  leader: CardDefinition;
  storyDeck: CardDefinition[];
  sceneDeck: CardDefinition[];
  mainDeck: CardDefinition[];
}

export interface KayouGameState {
  roomId: string;
  phase: GamePhase;
  firstPlayerId: '0' | '1';
  turnPlayerId: '0' | '1';
  turnNumber: number;
  winnerId: '0' | '1' | null;
  winReason?: string | null;
  turnDeadlineMs?: number;
  players: Record<'0' | '1', PlayerState>;
  contactState: ContactCombatState | null;
  pendingTarget: PendingTargetSelection | null;
  pendingLaneQueueAfterReveal: LaneKey[] | null;
  lastClashEvent: ClashAnimationEvent | null;
  lastPlanRevealEvent: PlanRevealEvent | null;
  lastStoryRevealEvent: StoryRevealEvent | null;
  announcements: PublicAnnouncement[];
}