export type DeckId = string;

export type CardType = 
  | 'MainCharacter' 
  | 'Character' 
  | 'Item' 
  | 'Event' 
  | 'Scene' 
  | 'Story';

export type HarmonyColor = 
  | 'Magic' 
  | 'Honesty' 
  | 'Loyalty' 
  | 'Laughter' 
  | 'Generosity' 
  | 'Kindness' 
  | 'None';

export interface CardDefinition {
  id: string;
  cardNumber: string;
  name: string;
  type: CardType;
  element: HarmonyColor;
  imageUrl?: string;
  power?: number;
  defense?: number;
  effectText?: string;
}

export interface PlayerState {
  id: string;
  displayName: string;
  leader: CardDefinition | null; // The Mane Character leader
  deck: CardDefinition[];
  hand: CardDefinition[];
  discard: CardDefinition[];
  points: number;
  lanes: {
    left: CardDefinition | null;
    center: CardDefinition | null;
    right: CardDefinition | null;
  };
}

export type GamePhase = 
  | 'WAITING_FOR_PLAYERS' 
  | 'MULLIGAN' 
  | 'MAIN_PHASE' 
  | 'CLASH_RESOLUTION' 
  | 'GAME_OVER';

export interface PublicAnnouncement {
  type: string;
  message: string;
  timestamp: number;
}

export interface ClashResult {
  winnerId: string | null;
  pointDelta: number;
  resolved: boolean;
}

export interface KayouGameState {
  roomId: string;
  phase: GamePhase;
  turnPlayerId: '0' | '1' | null;
  players: Record<'0' | '1', PlayerState>;
  announcements: PublicAnnouncement[];
  lastClashResult: ClashResult | null;
}