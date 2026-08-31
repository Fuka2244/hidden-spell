import { describe, expect, test } from "vitest";
import { RoomEngine, type RoomState } from "../src/index.js";

describe("施法回合", () => {
  test("两人局开局每人五张、中央四张秘密牌且已打出区域为空", () => {
    const state = startedRoom();

    expect(state.game?.secretSpells).toHaveLength(4);
    expect(state.game?.discardPile).toEqual([]);
    expect(state.game?.players.map((player) => player.cards.length)).toEqual([5, 5]);
    expect(state.game?.removedSpells).toEqual([]);
    expect(state.game?.deck).toHaveLength(22);
    expect(state.game?.players.map((player) => player.score)).toEqual([0, 0]);
  });

  test("喊出手中没有的咒语会失去生命并立即轮到下一人", () => {
    const state = withGame(startedRoom(), {
      currentPlayerId: "p1",
      players: [
        { playerId: "p1", cards: [1, 1], hp: 4, alive: true, score: 0, secretSpellCount: 0 },
        { playerId: "p2", cards: [2], hp: 4, alive: true, score: 0, secretSpellCount: 0 }
      ]
    });

    const next = RoomEngine.cast(state, "p1", 8);

    expect(next.game).toMatchObject({ phase: "WAITING_CAST", currentPlayerId: "p2" });
    expect(next.game?.players[0]?.hp).toBe(3);
    expect(next.game?.players[0]?.cards).toHaveLength(5);
  });

  test("成功施法只移走一枚对应石头并允许当前玩家继续", () => {
    const state = withGame(startedRoom(), {
      currentPlayerId: "p1",
      players: [
        { playerId: "p1", cards: [2, 2, 5], hp: 4, alive: true, score: 0, secretSpellCount: 0 },
        { playerId: "p2", cards: [1], hp: 4, alive: true, score: 0, secretSpellCount: 0 }
      ],
      discardPile: []
    });

    const next = RoomEngine.cast(state, "p1", 2);

    expect(next.game).toMatchObject({
      phase: "MAY_CONTINUE",
      currentPlayerId: "p1",
      lastSpellId: 2,
      discardPile: [2]
    });
    expect(next.game?.players[0]?.cards).toEqual([2, 5]);
  });

  test("成功施法会记录公开的声明结果和生命变化", () => {
    const state = withGame(startedRoom(), {
      currentPlayerId: "p1",
      players: [
        { playerId: "p1", cards: [6, 8], hp: 6, alive: true, score: 0, secretSpellCount: 0 },
        { playerId: "p2", cards: [1], hp: 6, alive: true, score: 0, secretSpellCount: 0 }
      ]
    });

    const next = RoomEngine.cast(state, "p1", 6);
    const event = RoomEngine.view(next, "p2", 2_000).game?.events.at(-1);

    expect(event).toEqual({
      sequence: 2,
      type: "CAST",
      actorId: "p1",
      spellId: 6,
      success: true,
      hpChanges: [{ playerId: "p2", delta: -1 }]
    });
  });

  test("错误声明会记录失败和声明者失去的生命", () => {
    const state = withGame(startedRoom(), {
      currentPlayerId: "p1",
      players: [
        { playerId: "p1", cards: [2], hp: 6, alive: true, score: 0, secretSpellCount: 0 },
        { playerId: "p2", cards: [1], hp: 6, alive: true, score: 0, secretSpellCount: 0 }
      ]
    });

    const next = RoomEngine.cast(state, "p1", 8);

    expect(next.game?.events.at(-1)).toEqual({
      sequence: 2,
      type: "CAST",
      actorId: "p1",
      spellId: 8,
      success: false,
      hpChanges: [{ playerId: "p1", delta: -1 }]
    });
  });

  test("同一回合不能在成功喊出五之后再喊四", () => {
    const state = withGame(startedRoom(), {
      phase: "MAY_CONTINUE",
      currentPlayerId: "p1",
      lastSpellId: 5,
      players: [
        { playerId: "p1", cards: [4, 6], hp: 4, alive: true, score: 0, secretSpellCount: 0 },
        { playerId: "p2", cards: [1], hp: 4, alive: true, score: 0, secretSpellCount: 0 }
      ]
    });

    expectRoomError(() => RoomEngine.cast(state, "p1", 4), "SPELL_NUMBER_DECREASED");
  });

  test("成功施法后主动结束回合会清除连喊下限并轮到下一人", () => {
    const state = withGame(startedRoom(), {
      phase: "MAY_CONTINUE",
      currentPlayerId: "p1",
      lastSpellId: 5
    });

    const next = RoomEngine.endTurn(state, "p1");

    expect(next.game?.phase).toBe("WAITING_CAST");
    expect(next.game?.currentPlayerId).toBe("p2");
    expect(next.game?.lastSpellId).toBeUndefined();
  });

  test("主动结束回合时给当前玩家补普通手牌到五张", () => {
    const state = withGame(startedRoom(), {
      phase: "MAY_CONTINUE",
      currentPlayerId: "p1",
      deck: [3, 4, 5, 6],
      players: [
        { playerId: "p1", cards: [2], hp: 4, alive: true, score: 0, secretSpellCount: 0 },
        { playerId: "p2", cards: [1, 8], hp: 4, alive: true, score: 0, secretSpellCount: 0 }
      ]
    });

    const next = RoomEngine.endTurn(state, "p1");

    expect(next.game?.players[0]?.cards).toEqual([2, 3, 4, 5, 6]);
    expect(next.game?.players[1]?.cards).toEqual([1, 8]);
    expect(next.game?.deck).toEqual([]);
  });

  test("错误施法自动结束回合时也给声明者补牌到五张", () => {
    const state = withGame(startedRoom(), {
      currentPlayerId: "p1",
      deck: [3, 4, 5],
      players: [
        { playerId: "p1", cards: [1, 2], hp: 4, alive: true, score: 0, secretSpellCount: 0 },
        { playerId: "p2", cards: [8], hp: 4, alive: true, score: 0, secretSpellCount: 0 }
      ]
    });

    const next = RoomEngine.cast(state, "p1", 7);

    expect(next.game?.players[0]?.cards).toEqual([1, 2, 3, 4, 5]);
    expect(next.game?.deck).toEqual([]);
    expect(next.game?.currentPlayerId).toBe("p2");
  });

  test("移走最后一枚石头会赢得本轮并增加三分", () => {
    const state = withGame(startedRoom(), {
      currentPlayerId: "p1",
      players: [
        { playerId: "p1", cards: [3], hp: 4, alive: true, score: 0, secretSpellCount: 0 },
        { playerId: "p2", cards: [1], hp: 4, alive: true, score: 0, secretSpellCount: 0 }
      ]
    });

    const next = RoomEngine.cast(state, "p1", 3);

    expect(next.status).toBe("PLAYING");
    expect(next.game).toMatchObject({ phase: "ROUND_END", roundWinnerId: "p1" });
    expect(next.game?.players[0]?.score).toBe(3);
    expect(next.game?.roundScoreGains).toEqual({ p1: 3, p2: 0 });
  });

  test("错误施法耗尽生命时本轮无胜者且其他存活者加一分", () => {
    const state = withGame(startedRoom(), {
      currentPlayerId: "p1",
      players: [
        { playerId: "p1", cards: [1], hp: 1, alive: true, score: 0, secretSpellCount: 0 },
        { playerId: "p2", cards: [2], hp: 4, alive: true, score: 0, secretSpellCount: 0 }
      ]
    });

    const next = RoomEngine.cast(state, "p1", 8);

    expect(next.game).toMatchObject({ phase: "ROUND_END", roundLoserId: "p1" });
    expect(next.game?.roundWinnerId).toBeUndefined();
    expect(next.game?.players).toEqual([
      expect.objectContaining({ playerId: "p1", alive: false, hp: 0, score: 0 }),
      expect.objectContaining({ playerId: "p2", alive: true, score: 1 })
    ]);
  });

  test("分数达到八分时整局结束", () => {
    const state = withGame(startedRoom(), {
      currentPlayerId: "p1",
      players: [
        { playerId: "p1", cards: [3], hp: 4, alive: true, score: 6, secretSpellCount: 0 },
        { playerId: "p2", cards: [1], hp: 4, alive: true, score: 2, secretSpellCount: 0 }
      ]
    });

    const next = RoomEngine.cast(state, "p1", 3);

    expect(next.status).toBe("FINISHED");
    expect(next.game).toMatchObject({ phase: "GAME_END", winnerId: "p1" });
  });

  test("多名玩家在同一次结算达到八分时并列获胜", () => {
    const state = withGame(startedRoom(3), {
      currentPlayerId: "p1",
      players: [
        { playerId: "p1", cards: [1], hp: 1, alive: true, score: 0, secretSpellCount: 0 },
        { playerId: "p2", cards: [2], hp: 6, alive: true, score: 7, secretSpellCount: 0 },
        { playerId: "p3", cards: [3], hp: 6, alive: true, score: 7, secretSpellCount: 0 }
      ]
    });

    const next = RoomEngine.cast(state, "p1", 8);

    expect(next.status).toBe("FINISHED");
    expect(next.game).toMatchObject({ phase: "GAME_END", winnerIds: ["p2", "p3"] });
  });

  test("下一轮由尚未先发的下一位玩家开始并保留分数", () => {
    const state = withGame(startedRoom(), {
      phase: "ROUND_END",
      round: 1,
      players: [
        { playerId: "p1", cards: [], hp: 2, alive: true, score: 3, secretSpellCount: 0 },
        { playerId: "p2", cards: [1], hp: 0, alive: false, score: 1, secretSpellCount: 0 }
      ]
    });

    const next = RoomEngine.nextRound(state, "p1", () => 0.5);

    expect(next.game).toMatchObject({ phase: "WAITING_CAST", round: 2, currentPlayerId: "p2" });
    expect(next.game?.players.map((player) => ({
      playerId: player.playerId,
      hp: player.hp,
      alive: player.alive,
      score: player.score,
      cardCount: player.cards.length
    }))).toEqual([
      { playerId: "p1", hp: 6, alive: true, score: 3, cardCount: 5 },
      { playerId: "p2", hp: 6, alive: true, score: 1, cardCount: 5 }
    ]);
    expect(next.game?.secretSpells).toHaveLength(4);
    expect(next.game?.discardPile).toEqual([]);
    expect(next.game?.removedSpells).toEqual([]);
    expect(next.game?.deck).toHaveLength(22);
  });
});

const identities = [
  { playerId: "p1", nickname: "一号", credential: "secret-1" },
  { playerId: "p2", nickname: "二号", credential: "secret-2" },
  { playerId: "p3", nickname: "三号", credential: "secret-3" }
] as const;

function startedRoom(playerCount = 2): RoomState {
  let state = RoomEngine.create("123456", identities[0], 1_000);
  for (const identity of identities.slice(1, playerCount)) {
    state = RoomEngine.join(state, identity, 1_001);
  }
  for (const identity of identities.slice(0, playerCount)) {
    state = RoomEngine.setReady(state, identity.playerId, true);
  }
  return RoomEngine.start(state, "p1", () => 0.5);
}

function withGame(state: RoomState, game: Partial<NonNullable<RoomState["game"]>>): RoomState {
  if (!state.game) throw new Error("测试房间尚未开局");
  return { ...state, game: { ...state.game, ...game } };
}

function expectRoomError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`预期抛出房间错误 ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}
