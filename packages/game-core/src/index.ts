export const ROOM_LIMITS = {
  minPlayers: 2,
  maxPlayers: 4,
  disconnectGraceMs: 90_000,
  handSize: 5,
  secretSpellCount: 4,
  startingHp: 6,
  winningScore: 8
} as const;

export const SPELL_COUNTS: Readonly<Record<number, number>> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8
};

export const CHARACTER_IDS = ["red", "blue", "green", "purple"] as const;
export type CharacterId = typeof CHARACTER_IDS[number];

export type RoomStatus = "WAITING" | "PLAYING" | "PAUSED" | "FINISHED";

export interface PlayerIdentity {
  playerId: string;
  nickname: string;
  credential: string;
}

export interface RoomPlayer extends PlayerIdentity {
  joinedAt: number;
  ready: boolean;
  connected: boolean;
  characterId: CharacterId;
  disconnectDeadline?: number;
}

export interface GamePlayer {
  playerId: string;
  cards: number[];
  hp: number;
  alive: boolean;
  score: number;
  secretSpellCount: number;
  knownSecretSpells?: number[];
}

export type GameEvent =
  | {
      sequence: number;
      type: "CAST";
      actorId: string;
      spellId: number;
      success: boolean;
      hpChanges: Array<{ playerId: string; delta: number }>;
      dieResult?: number;
    }
  | {
      sequence: number;
      type: "SECRET_TAKEN";
      actorId: string;
    };

export interface GameState {
  phase: "WAITING_CAST" | "MAY_CONTINUE" | "CHOOSING_SECRET" | "ROUND_END" | "GAME_END";
  currentPlayerId: string;
  players: GamePlayer[];
  deck: number[];
  discardPile: number[];
  removedSpells: number[];
  secretSpells: number[];
  events: GameEvent[];
  sequence: number;
  round: number;
  lastSpellId?: number;
  lastDieResult?: number;
  roundWinnerId?: string;
  roundLoserId?: string;
  roundScoreGains?: Record<string, number>;
  winnerId?: string;
  winnerIds?: string[];
}

export interface RoomState {
  roomId: string;
  ownerId: string | null;
  status: RoomStatus;
  players: RoomPlayer[];
  game?: GameState;
}

export type CardView =
  | { hidden: true }
  | { hidden: false; spellId: number; secret?: true };

export interface GamePlayerView {
  playerId: string;
  nickname: string;
  characterId: CharacterId;
  connected: boolean;
  hp: number;
  alive: boolean;
  score: number;
  secretSpellCount: number;
  cards: CardView[];
}

export interface RoomView {
  roomId: string;
  ownerId: string | null;
  viewerId: string;
  status: RoomStatus;
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
    phase: GameState["phase"];
    currentPlayerId: string;
    sequence: number;
    round: number;
    deckCount: number;
    discardPile: number[];
    secretSpellPoolCount: number;
    events: GameEvent[];
    lastSpellId?: number;
    lastDieResult?: number;
    roundWinnerId?: string;
    roundLoserId?: string;
    roundScoreGains?: Record<string, number>;
    players: GamePlayerView[];
    winnerId?: string;
    winnerIds?: string[];
  };
}

export class RoomRuleError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RoomRuleError";
  }
}

export class RoomEngine {
  static create(roomId: string, owner: PlayerIdentity, now: number): RoomState {
    return {
      roomId,
      ownerId: owner.playerId,
      status: "WAITING",
      players: [newRoomPlayer(owner, now, CHARACTER_IDS[0])]
    };
  }

  static join(state: RoomState, identity: PlayerIdentity, now: number): RoomState {
    requireStatus(state, "WAITING");
    if (state.players.length >= ROOM_LIMITS.maxPlayers) {
      throw new RoomRuleError("ROOM_FULL", "房间已满");
    }
    if (state.players.some((player) => player.playerId === identity.playerId)) {
      throw new RoomRuleError("PLAYER_ALREADY_JOINED", "玩家已在房间中");
    }
    const characterId = CHARACTER_IDS.find((candidate) =>
      !state.players.some((player) => player.characterId === candidate)
    );
    if (!characterId) throw new RoomRuleError("ROOM_FULL", "房间已满");
    return { ...state, players: [...state.players, newRoomPlayer(identity, now, characterId)] };
  }

  static selectCharacter(state: RoomState, playerId: string, characterId: CharacterId): RoomState {
    requireStatus(state, "WAITING");
    requirePlayer(state, playerId);
    if (state.players.some((player) =>
      player.playerId !== playerId && player.characterId === characterId
    )) {
      throw new RoomRuleError("CHARACTER_TAKEN", "该角色已被其他玩家选择");
    }
    return {
      ...state,
      players: state.players.map((player) =>
        player.playerId === playerId ? { ...player, characterId } : player
      )
    };
  }

  static setReady(state: RoomState, playerId: string, ready: boolean): RoomState {
    requireStatus(state, "WAITING");
    requirePlayer(state, playerId);
    return {
      ...state,
      players: state.players.map((player) =>
        player.playerId === playerId ? { ...player, ready } : player
      )
    };
  }

  static start(state: RoomState, actorId: string, random: () => number): RoomState {
    requireStatus(state, "WAITING");
    if (state.ownerId !== actorId) {
      throw new RoomRuleError("NOT_ROOM_OWNER", "只有房主可以开始游戏");
    }
    if (state.players.length < ROOM_LIMITS.minPlayers) {
      throw new RoomRuleError("NOT_ENOUGH_PLAYERS", "至少需要两名玩家");
    }
    if (state.players.some((player) => !player.connected)) {
      throw new RoomRuleError("PLAYER_DISCONNECTED", "存在断线玩家");
    }
    if (state.players.some((player) => !player.ready)) {
      throw new RoomRuleError("PLAYER_NOT_READY", "所有玩家准备后才能开始");
    }

    const deck = shuffle(createDeck(), random);
    const gamePlayers: GamePlayer[] = state.players.map((player) => ({
      playerId: player.playerId,
      cards: deck.splice(0, ROOM_LIMITS.handSize),
      hp: ROOM_LIMITS.startingHp,
      alive: true,
      score: 0,
      secretSpellCount: 0,
      knownSecretSpells: []
    }));
    const firstPlayer = gamePlayers[0];
    if (!firstPlayer) {
      throw new RoomRuleError("NOT_ENOUGH_PLAYERS", "至少需要两名玩家");
    }

    const secretSpells = deck.splice(0, ROOM_LIMITS.secretSpellCount);

    return {
      ...state,
      status: "PLAYING",
      game: {
        phase: "WAITING_CAST",
        currentPlayerId: firstPlayer.playerId,
        players: gamePlayers,
        deck,
        discardPile: [],
        removedSpells: [],
        secretSpells,
        events: [],
        sequence: 1,
        round: 1
      }
    };
  }

  static cast(
    state: RoomState,
    actorId: string,
    spellId: number,
    rollDie: () => number = rollSpellDie
  ): RoomState {
    const game = requireActiveGame(state, actorId);
    if (!Number.isInteger(spellId) || spellId < 1 || spellId > 8) {
      throw new RoomRuleError("INVALID_SPELL", "咒语编号必须在 1 至 8 之间");
    }
    if (game.phase !== "WAITING_CAST" && game.phase !== "MAY_CONTINUE") {
      throw new RoomRuleError("INVALID_GAME_PHASE", "当前阶段不能施法");
    }
    if (game.lastSpellId !== undefined && spellId < game.lastSpellId) {
      throw new RoomRuleError("SPELL_NUMBER_DECREASED", "连续施法的编号不能降低");
    }

    const caster = requireGamePlayer(game, actorId);
    const cardIndex = caster.cards.slice(0, normalCardCount(caster)).indexOf(spellId);
    if (cardIndex === -1) {
      const damage = spellId === 1 ? requireDieResult(rollDie()) : 1;
      const players = damagePlayers(game.players, new Set([actorId]), damage);
      const { lastDieResult: _previousDieResult, ...gameWithoutDieResult } = game;
      const gameAfterFailure: GameState = {
        ...gameWithoutDieResult,
        players,
        events: [...game.events, {
          sequence: game.sequence + 1,
          type: "CAST",
          actorId,
          spellId,
          success: false,
          hpChanges: collectHpChanges(game.players, players),
          ...(spellId === 1 ? { dieResult: damage } : {})
        }],
        sequence: game.sequence + 1,
        ...(spellId === 1 ? { lastDieResult: damage } : {})
      };
      const failedCaster = requireGamePlayer(gameAfterFailure, actorId);
      if (!failedCaster.alive) {
        return finishRound(state, gameAfterFailure, {
          loserId: actorId
        });
      }
      const refilledGame = refillNormalHand(gameAfterFailure, actorId);
      const { lastSpellId: _lastSpellId, ...gameWithoutLastSpell } = refilledGame;
      return {
        ...state,
        game: {
          ...gameWithoutLastSpell,
          phase: "WAITING_CAST",
          currentPlayerId: nextAlivePlayerId(refilledGame.players, actorId),
          sequence: gameAfterFailure.sequence
        }
      };
    }

    const updatedCaster = removeSpellCard(caster, spellId);
    const players = game.players.map((player) =>
      player.playerId === actorId ? updatedCaster : player
    );
    const { lastDieResult: _previousDieResult, ...gameWithoutDieResult } = game;
    const resolvedGame = resolveSpellEffect({
      ...gameWithoutDieResult,
      phase: "MAY_CONTINUE",
      players,
      discardPile: [...game.discardPile, spellId],
      sequence: game.sequence + 1,
      lastSpellId: spellId
    }, actorId, spellId, rollDie);
    const nextGame: GameState = {
      ...resolvedGame,
      events: [...game.events, {
        sequence: game.sequence + 1,
        type: "CAST",
        actorId,
        spellId,
        success: true,
        hpChanges: collectHpChanges(game.players, resolvedGame.players),
        ...(resolvedGame.lastDieResult === undefined ? {} : { dieResult: resolvedGame.lastDieResult })
      }]
    };
    const killedOtherPlayer = game.players.some((before) =>
      before.playerId !== actorId && before.alive && !requireGamePlayer(nextGame, before.playerId).alive
    );
    if (killedOtherPlayer) {
      return finishRound(state, nextGame, { winnerId: actorId, survivorBonus: true });
    }
    if (nextGame.phase === "CHOOSING_SECRET") return { ...state, game: nextGame };
    return normalCardCount(requireGamePlayer(nextGame, actorId)) === 0
      ? finishRound(state, nextGame, { winnerId: actorId })
      : { ...state, game: nextGame };
  }

  static chooseSecret(state: RoomState, actorId: string, secretIndex: number): RoomState {
    const game = requireActiveGame(state, actorId);
    if (game.phase !== "CHOOSING_SECRET") {
      throw new RoomRuleError("INVALID_GAME_PHASE", "当前不需要选择秘密咒语");
    }
    if (!Number.isInteger(secretIndex) || secretIndex < 0 || secretIndex >= game.secretSpells.length) {
      throw new RoomRuleError("INVALID_SECRET_INDEX", "秘密咒语位置无效");
    }
    const secretSpells = [...game.secretSpells];
    const [selectedSpell] = secretSpells.splice(secretIndex, 1);
    if (selectedSpell === undefined) throw new RoomRuleError("INVALID_SECRET_INDEX", "秘密咒语位置无效");
    const players = game.players.map((player) => {
      if (player.playerId !== actorId) return player;
      const knownSecretSpells = [...(player.knownSecretSpells ?? []), selectedSpell];
      return {
        ...player,
        cards: [...player.cards, selectedSpell],
        knownSecretSpells,
        secretSpellCount: knownSecretSpells.length
      };
    });
    const nextGame: GameState = {
      ...game,
      phase: "MAY_CONTINUE",
      players,
      secretSpells,
      events: [...game.events, {
        sequence: game.sequence + 1,
        type: "SECRET_TAKEN",
        actorId
      }],
      sequence: game.sequence + 1
    };
    return normalCardCount(requireGamePlayer(nextGame, actorId)) === 0
      ? finishRound(state, nextGame, { winnerId: actorId })
      : {
      ...state,
      game: nextGame
    };
  }

  static endTurn(state: RoomState, actorId: string): RoomState {
    const game = requireActiveGame(state, actorId);
    if (game.phase !== "MAY_CONTINUE") {
      throw new RoomRuleError("INVALID_GAME_PHASE", "成功施法后才能主动结束回合");
    }
    const { lastSpellId: _lastSpellId, ...gameWithoutLastSpell } = game;
    const refilledGame = refillNormalHand(gameWithoutLastSpell, actorId);
    return {
      ...state,
      game: {
        ...refilledGame,
        phase: "WAITING_CAST",
        currentPlayerId: nextAlivePlayerId(refilledGame.players, actorId),
        sequence: game.sequence + 1
      }
    };
  }

  static nextRound(state: RoomState, actorId: string, random: () => number): RoomState {
    if (!state.game || state.game.phase !== "ROUND_END") {
      throw new RoomRuleError("INVALID_GAME_PHASE", "当前不能开始新一轮");
    }
    if (state.ownerId !== actorId) {
      throw new RoomRuleError("NOT_ROOM_OWNER", "只有房主可以开始新一轮");
    }

    const deck = shuffle(createDeck(), random);
    const activeRoomPlayers = state.players.filter((player) => player.connected);
    const players: GamePlayer[] = activeRoomPlayers.map((roomPlayer) => {
      const previous = requireGamePlayer(state.game!, roomPlayer.playerId);
      return {
        playerId: roomPlayer.playerId,
        cards: deck.splice(0, ROOM_LIMITS.handSize),
        hp: ROOM_LIMITS.startingHp,
        alive: true,
        score: previous.score,
        secretSpellCount: 0,
        knownSecretSpells: []
      };
    });
    const nextStarter = players[state.game.round % players.length];
    if (!nextStarter) throw new RoomRuleError("NOT_ENOUGH_PLAYERS", "没有可参与的玩家");
    const secretSpells = deck.splice(0, ROOM_LIMITS.secretSpellCount);

    return {
      ...state,
      status: "PLAYING",
      game: {
        phase: "WAITING_CAST",
        currentPlayerId: nextStarter.playerId,
        players,
        deck,
        discardPile: [],
        removedSpells: [],
        secretSpells,
        events: [...state.game.events],
        sequence: state.game.sequence + 1,
        round: state.game.round + 1
      }
    };
  }

  static disconnect(state: RoomState, playerId: string, now: number): RoomState {
    requirePlayer(state, playerId);
    return {
      ...state,
      status: state.game && state.status !== "FINISHED" ? "PAUSED" : state.status,
      players: state.players.map((player) =>
        player.playerId === playerId
          ? { ...player, connected: false, disconnectDeadline: now + ROOM_LIMITS.disconnectGraceMs }
          : player
      )
    };
  }

  static reconnect(
    state: RoomState,
    playerId: string,
    credential: string,
    now: number
  ): RoomState {
    RoomEngine.validateSession(state, playerId, credential, now);
    const player = requirePlayer(state, playerId);
    const players = state.players.map((candidate) => {
      if (candidate.playerId !== playerId) return candidate;
      const { disconnectDeadline: _removed, ...rest } = candidate;
      return { ...rest, connected: true };
    });
    return {
      ...state,
      status: state.game && players.every((candidate) => candidate.connected)
        ? "PLAYING"
        : state.status === "PAUSED"
          ? "PAUSED"
          : state.status,
      players
    };
  }

  static validateSession(
    state: RoomState,
    playerId: string,
    credential: string,
    now: number
  ): RoomState {
    const player = requirePlayer(state, playerId);
    if (player.credential !== credential) {
      throw new RoomRuleError("INVALID_CREDENTIAL", "玩家凭证无效");
    }
    if (player.disconnectDeadline !== undefined && now > player.disconnectDeadline) {
      throw new RoomRuleError("RECONNECT_EXPIRED", "重连时间已过");
    }
    return state;
  }

  static leave(state: RoomState, playerId: string): RoomState {
    requirePlayer(state, playerId);
    if (!state.game) return removeWaitingPlayer(state, playerId);

    const gamePlayers = state.game.players.map((player) =>
      player.playerId === playerId ? { ...player, alive: false, hp: 0 } : player
    );
    const alivePlayers = gamePlayers.filter((player) => player.alive);
    const winner = alivePlayers.length === 1 ? alivePlayers[0] : undefined;
    const nextPlayerId = state.game.currentPlayerId === playerId
      ? nextAlivePlayerId(gamePlayers, playerId)
      : state.game.currentPlayerId;
    const players = state.players.map((player) => {
      if (player.playerId !== playerId) return player;
      const { disconnectDeadline: _removed, ...rest } = player;
      return { ...rest, connected: false };
    });

    return {
      ...state,
      status: winner ? "FINISHED" : "PLAYING",
      players,
      game: {
        ...state.game,
        phase: winner ? "GAME_END" : "WAITING_CAST",
        currentPlayerId: winner?.playerId ?? nextPlayerId,
        players: gamePlayers,
        sequence: state.game.sequence + 1,
        ...(winner ? { winnerId: winner.playerId, winnerIds: [winner.playerId] } : {})
      }
    };
  }

  static expireDisconnected(state: RoomState, now: number): RoomState {
    const expiredIds = state.players
      .filter((player) =>
        !player.connected &&
        player.disconnectDeadline !== undefined &&
        now >= player.disconnectDeadline
      )
      .map((player) => player.playerId);
    return expiredIds.reduce(
      (current, playerId) => RoomEngine.leave(current, playerId),
      state
    );
  }

  static view(state: RoomState, viewerId: string, now: number): RoomView {
    requirePlayer(state, viewerId);
    const roomPlayers = state.players.map(({ credential: _credential, ...player }) => player);
    const view: RoomView = {
      roomId: state.roomId,
      ownerId: state.ownerId,
      viewerId,
      status: state.status,
      serverTime: now,
      players: roomPlayers
    };
    if (!state.game) return view;

    return {
      ...view,
      game: {
        phase: state.game.phase,
        currentPlayerId: state.game.currentPlayerId,
        sequence: state.game.sequence,
        round: state.game.round,
        deckCount: state.game.deck.length,
        discardPile: [...state.game.discardPile],
        secretSpellPoolCount: state.game.secretSpells.length,
        events: state.game.events.map((event) => event.type === "CAST" ? {
          ...event,
          hpChanges: event.hpChanges.map((change) => ({ ...change }))
        } : { ...event }),
        ...(state.game.lastSpellId === undefined ? {} : { lastSpellId: state.game.lastSpellId }),
        ...(state.game.lastDieResult === undefined ? {} : { lastDieResult: state.game.lastDieResult }),
        ...(state.game.roundWinnerId ? { roundWinnerId: state.game.roundWinnerId } : {}),
        ...(state.game.roundLoserId ? { roundLoserId: state.game.roundLoserId } : {}),
        ...(state.game.roundScoreGains ? { roundScoreGains: { ...state.game.roundScoreGains } } : {}),
        ...(state.game.winnerId ? { winnerId: state.game.winnerId } : {}),
        ...(state.game.winnerIds ? { winnerIds: [...state.game.winnerIds] } : {}),
        players: state.game.players.map((gamePlayer) => {
          const roomPlayer = requirePlayer(state, gamePlayer.playerId);
          return {
            playerId: gamePlayer.playerId,
            nickname: roomPlayer.nickname,
            characterId: roomPlayer.characterId,
            connected: roomPlayer.connected,
            hp: gamePlayer.hp,
            alive: gamePlayer.alive,
            score: gamePlayer.score,
            secretSpellCount: gamePlayer.secretSpellCount,
            cards: gamePlayer.cards.map((spellId, index): CardView => {
              const knownSecretCount = gamePlayer.knownSecretSpells?.length ?? 0;
              const isKnownSecret = index >= gamePlayer.cards.length - knownSecretCount;
              if (isKnownSecret) {
                return gamePlayer.playerId === viewerId
                  ? { hidden: false, spellId, secret: true }
                  : { hidden: true };
              }
              if (gamePlayer.playerId === viewerId) return { hidden: true };
              return {
                hidden: false,
                spellId
              };
            })
          };
        })
      }
    };
  }
}

function removeWaitingPlayer(state: RoomState, playerId: string): RoomState {
  const players = state.players.filter((player) => player.playerId !== playerId);
  const ownerId = state.ownerId === playerId
    ? players.reduce<RoomPlayer | undefined>((earliest, player) =>
      !earliest || player.joinedAt < earliest.joinedAt ? player : earliest
    , undefined)?.playerId ?? null
    : state.ownerId;
  return {
    ...state,
    ownerId,
    status: players.length === 0 ? "FINISHED" : state.status,
    players
  };
}

function nextAlivePlayerId(players: GamePlayer[], currentPlayerId: string): string {
  const currentIndex = players.findIndex((player) => player.playerId === currentPlayerId);
  for (let offset = 1; offset <= players.length; offset += 1) {
    const candidate = players[(currentIndex + offset) % players.length];
    if (candidate?.alive) return candidate.playerId;
  }
  return currentPlayerId;
}

function newRoomPlayer(identity: PlayerIdentity, now: number, characterId: CharacterId): RoomPlayer {
  return {
    ...identity,
    joinedAt: now,
    ready: false,
    connected: true,
    characterId
  };
}

function requireStatus(state: RoomState, status: RoomStatus): void {
  if (state.status !== status) {
    throw new RoomRuleError("INVALID_ROOM_STATUS", `房间状态必须为 ${status}`);
  }
}

function requirePlayer(state: RoomState, playerId: string): RoomPlayer {
  const player = state.players.find((candidate) => candidate.playerId === playerId);
  if (!player) throw new RoomRuleError("PLAYER_NOT_IN_ROOM", "玩家不在房间中");
  return player;
}

function requireActiveGame(state: RoomState, actorId: string): GameState {
  if (state.status !== "PLAYING" || !state.game) {
    throw new RoomRuleError("GAME_NOT_ACTIVE", "对局当前不可操作");
  }
  if (state.game.currentPlayerId !== actorId) {
    throw new RoomRuleError("NOT_YOUR_TURN", "还没有轮到该玩家");
  }
  const player = requireGamePlayer(state.game, actorId);
  if (!player.alive) throw new RoomRuleError("PLAYER_ELIMINATED", "玩家已出局");
  return state.game;
}

function requireGamePlayer(game: GameState, playerId: string): GamePlayer {
  const player = game.players.find((candidate) => candidate.playerId === playerId);
  if (!player) throw new RoomRuleError("PLAYER_NOT_IN_GAME", "玩家不在对局中");
  return player;
}

function finishRound(
  state: RoomState,
  game: GameState,
  result: { winnerId?: string; loserId?: string; survivorBonus?: boolean }
): RoomState {
  const roundScoreGains = Object.fromEntries(game.players.map((player) => {
    let gained = 0;
    if (result.winnerId === player.playerId) gained += 3;
    if (result.loserId && player.alive) gained += 1;
    if (result.survivorBonus && player.alive && player.playerId !== result.winnerId) gained += 1;
    if (player.alive && player.secretSpellCount > 0) gained += 1;
    return [player.playerId, gained];
  }));
  const players = game.players.map((player) => ({
    ...player,
    score: player.score + (roundScoreGains[player.playerId] ?? 0)
  }));
  const matchWinners = players.filter((player) => player.score >= ROOM_LIMITS.winningScore);
  const matchWinner = matchWinners[0];
  return {
    ...state,
    status: matchWinner ? "FINISHED" : "PLAYING",
    game: {
      ...game,
      players,
      roundScoreGains,
      phase: matchWinner ? "GAME_END" : "ROUND_END",
      ...(result.winnerId ? { roundWinnerId: result.winnerId } : {}),
      ...(result.loserId ? { roundLoserId: result.loserId } : {}),
      ...(matchWinner ? {
        winnerId: matchWinner.playerId,
        winnerIds: matchWinners.map((player) => player.playerId)
      } : {})
    }
  };
}

function removeSpellCard(player: GamePlayer, spellId: number): GamePlayer {
  const cards = [...player.cards];
  const knownSecretSpells = [...(player.knownSecretSpells ?? [])];
  const normalCardCount = cards.length - knownSecretSpells.length;
  const cardIndex = cards.slice(0, normalCardCount).indexOf(spellId);
  if (cardIndex === -1) throw new RoomRuleError("SPELL_NOT_OWNED", "玩家没有该咒语");
  cards.splice(cardIndex, 1);
  return { ...player, cards, knownSecretSpells, secretSpellCount: knownSecretSpells.length };
}

function normalCardCount(player: GamePlayer): number {
  return player.cards.length - (player.knownSecretSpells?.length ?? 0);
}

function refillNormalHand(game: GameState, playerId: string): GameState {
  const player = requireGamePlayer(game, playerId);
  const knownSecretSpells = [...(player.knownSecretSpells ?? [])];
  const normalCards = player.cards.slice(0, player.cards.length - knownSecretSpells.length);
  const deck = [...game.deck];
  const drawnCards = deck.splice(0, Math.max(0, ROOM_LIMITS.handSize - normalCards.length));
  const players = game.players.map((candidate) => candidate.playerId === playerId ? {
    ...candidate,
    cards: [...normalCards, ...drawnCards, ...knownSecretSpells]
  } : candidate);
  return { ...game, deck, players };
}

function resolveSpellEffect(
  game: GameState,
  casterId: string,
  spellId: number,
  rollDie: () => number
): GameState {
  switch (spellId) {
    case 1: {
      const result = requireDieResult(rollDie());
      return {
        ...game,
        players: damagePlayers(
          game.players,
          new Set(game.players.filter((player) => player.playerId !== casterId).map((player) => player.playerId)),
          result
        ),
        lastDieResult: result
      };
    }
    case 2:
      return {
        ...game,
        players: healPlayer(
          damagePlayers(
            game.players,
            new Set(game.players.filter((player) => player.playerId !== casterId).map((player) => player.playerId)),
            1
          ),
          casterId,
          1
        )
      };
    case 3: {
      const result = requireDieResult(rollDie());
      return { ...game, players: healPlayer(game.players, casterId, result), lastDieResult: result };
    }
    case 4:
      return game.secretSpells.length > 0 ? { ...game, phase: "CHOOSING_SECRET" } : game;
    case 5: {
      const leftId = leftPlayerId(game.players, casterId);
      const rightId = rightPlayerId(game.players, casterId);
      return {
        ...game,
        players: leftId === rightId
          ? damagePlayers(game.players, new Set([leftId]), 2)
          : damagePlayers(game.players, new Set([leftId, rightId]), 1)
      };
    }
    case 6:
      return { ...game, players: damagePlayers(game.players, new Set([leftPlayerId(game.players, casterId)]), 1) };
    case 7:
      return { ...game, players: damagePlayers(game.players, new Set([rightPlayerId(game.players, casterId)]), 1) };
    case 8:
      return { ...game, players: healPlayer(game.players, casterId, 1) };
    default:
      return game;
  }
}

function damagePlayers(players: GamePlayer[], targetIds: ReadonlySet<string>, damage: number): GamePlayer[] {
  return players.map((player) => {
    if (!targetIds.has(player.playerId) || !player.alive) return player;
    const hp = Math.max(0, player.hp - damage);
    return { ...player, hp, alive: hp > 0 };
  });
}

function collectHpChanges(
  before: GamePlayer[],
  after: GamePlayer[]
): Array<{ playerId: string; delta: number }> {
  return after.flatMap((player) => {
    const previous = before.find((candidate) => candidate.playerId === player.playerId);
    if (!previous || previous.hp === player.hp) return [];
    return [{ playerId: player.playerId, delta: player.hp - previous.hp }];
  });
}

function healPlayer(players: GamePlayer[], playerId: string, amount: number): GamePlayer[] {
  return players.map((player) =>
    player.playerId === playerId && player.alive
      ? { ...player, hp: Math.min(6, player.hp + amount) }
      : player
  );
}

function leftPlayerId(players: GamePlayer[], playerId: string): string {
  const index = players.findIndex((player) => player.playerId === playerId);
  const player = players[(index + 1) % players.length];
  if (!player) throw new RoomRuleError("PLAYER_NOT_IN_GAME", "玩家不在对局中");
  return player.playerId;
}

function rightPlayerId(players: GamePlayer[], playerId: string): string {
  const index = players.findIndex((player) => player.playerId === playerId);
  const player = players[(index - 1 + players.length) % players.length];
  if (!player) throw new RoomRuleError("PLAYER_NOT_IN_GAME", "玩家不在对局中");
  return player.playerId;
}

function requireDieResult(result: number): number {
  if (!Number.isInteger(result) || result < 1 || result > 6) {
    throw new RoomRuleError("INVALID_DIE_RESULT", "骰子结果无效");
  }
  return result;
}

export function rollSpellDie(random: () => number = Math.random): number {
  const faceIndex = Math.floor(random() * 6);
  if (faceIndex < 3) return 1;
  if (faceIndex < 5) return 2;
  return 3;
}

function createDeck(): number[] {
  return Object.entries(SPELL_COUNTS).flatMap(([spellId, count]) =>
    Array.from({ length: count }, () => Number(spellId))
  );
}

function shuffle<T>(values: T[], random: () => number): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex]!, values[index]!];
  }
  return values;
}
export { SpellRegistry } from "./spell-registry.js";
export type { SpellEffect, SpellId } from "./spell-registry.js";
