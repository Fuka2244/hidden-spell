export interface PlayerSession {
  roomId: string;
  playerId: string;
  nickname: string;
  credential: string;
}

export type CharacterId = "red" | "blue" | "green" | "purple";

export type CardView = { hidden: true } | { hidden: false; spellId: number; secret?: true };

export interface RoomView {
  roomId: string;
  ownerId: string | null;
  viewerId: string;
  status: "WAITING" | "PLAYING" | "PAUSED" | "FINISHED";
  serverTime: number;
  players: Array<{
    playerId: string;
    nickname: string;
    ready: boolean;
    connected: boolean;
    characterId: CharacterId;
    disconnectDeadline?: number;
  }>;
  game?: {
    phase: "WAITING_CAST" | "MAY_CONTINUE" | "CHOOSING_SECRET" | "ROUND_END" | "GAME_END";
    currentPlayerId: string;
    sequence: number;
    round: number;
    deckCount: number;
    discardPile: number[];
    secretSpellPoolCount: number;
    events: Array<
      | {
          sequence: number;
          type: "CAST";
          actorId: string;
          spellId: number;
          success: boolean;
          hpChanges: Array<{ playerId: string; delta: number }>;
          dieResult?: number;
        }
      | { sequence: number; type: "SECRET_TAKEN"; actorId: string }
    >;
    lastSpellId?: number;
    lastDieResult?: number;
    roundWinnerId?: string;
    roundLoserId?: string;
    roundScoreGains?: Record<string, number>;
    winnerId?: string;
    winnerIds?: string[];
    players: Array<{
      playerId: string;
      nickname: string;
      characterId: CharacterId;
      connected: boolean;
      hp: number;
      alive: boolean;
      score: number;
      secretSpellCount: number;
      cards: CardView[];
    }>;
  };
}

export type ServerMessage =
  | { type: "STATE"; sequence: number; payload: RoomView }
  | { type: "ACK"; commandId: string; sequence: number }
  | { type: "ERROR"; commandId?: string; code: string; message: string };
