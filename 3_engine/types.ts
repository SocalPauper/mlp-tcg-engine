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
  effectText?: string;
  imageUrl?: string;
  rarity?: string;
  setCode?: string;
}

export interface SceneCardInPlay {
  card: CardDefinition;
  isFaceUp: boolean;
  isExhausted: boolean;      // True = rotated 90deg clockwise (spent for Harmony cost this turn)
  isLockedFaceDown: boolean; // True = Player 1's 1st scene (permanently face down)
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
}

export interface PlayerState {
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

export type GamePhase =
  | 'WAITING_FOR_PLAYERS'
  | 'VS_INTRO'
  | 'MULLIGAN'
  | 'MAIN_PHASE'
  | 'CONTACT_INSPIRE'
  | 'CONTACT_RESOLUTION'
  | 'BREAKTHROUGH_CHOICE'
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
  players: Record<'0' | '1', PlayerState>;
  contactState: ContactCombatState | null;
  lastClashEvent: ClashAnimationEvent | null;
  announcements: PublicAnnouncement[];
}