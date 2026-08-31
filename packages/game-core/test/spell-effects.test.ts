import { describe, expect, test } from "vitest";
import { RoomEngine, type GamePlayer, type RoomState } from "../src/index.js";

describe("八种咒语效果", () => {
  test("成功施展一号时所有其他玩家失去骰值生命", () => {
    const state = spellRoom(1);

    const next = RoomEngine.cast(state, "p1", 1, () => 3);

    expect(hitPoints(next)).toEqual({ p1: 4, p2: 1, p3: 1, p4: 1 });
    expect(next.game?.lastDieResult).toBe(3);
  });

  test("错误声明一号时声明者失去骰值而不是固定一点", () => {
    const state = spellRoom(2);

    const next = RoomEngine.cast(state, "p1", 1, () => 2);

    expect(hitPoints(next).p1).toBe(2);
    expect(next.game?.currentPlayerId).toBe("p2");
  });

  test("二号让其他玩家失去一点并让声明者恢复一点且不超过六", () => {
    const state = spellRoom(2, { p1: 6 });

    const next = RoomEngine.cast(state, "p1", 2);

    expect(hitPoints(next)).toEqual({ p1: 6, p2: 3, p3: 3, p4: 3 });
  });

  test("三号按骰值恢复生命且不超过六", () => {
    const state = spellRoom(3, { p1: 5 });

    const next = RoomEngine.cast(state, "p1", 3, () => 3);

    expect(hitPoints(next).p1).toBe(6);
    expect(next.game?.lastDieResult).toBe(3);
  });

  test("五号只伤害左右邻座", () => {
    const next = RoomEngine.cast(spellRoom(5), "p1", 5);

    expect(hitPoints(next)).toEqual({ p1: 4, p2: 3, p3: 4, p4: 3 });
  });

  test("六号伤害左邻而七号伤害右邻", () => {
    const afterSix = RoomEngine.cast(spellRoom(6), "p1", 6);
    const afterSeven = RoomEngine.cast(spellRoom(7), "p1", 7);

    expect(hitPoints(afterSix)).toEqual({ p1: 4, p2: 3, p3: 4, p4: 4 });
    expect(hitPoints(afterSeven)).toEqual({ p1: 4, p2: 4, p3: 4, p4: 3 });
  });

  test("两人局五号会对重合的左右邻座分别造成伤害", () => {
    const state = spellRoom(5, {}, 2);

    const next = RoomEngine.cast(state, "p1", 5);

    expect(hitPoints(next)).toEqual({ p1: 4, p2: 2 });
  });

  test("八号恢复一点生命", () => {
    const next = RoomEngine.cast(spellRoom(8, { p1: 5 }), "p1", 8);

    expect(hitPoints(next).p1).toBe(6);
  });

  test("施展不掷骰的咒语会清除上一次骰值", () => {
    const state = spellRoom(8, { p1: 5 });
    if (!state.game) throw new Error("测试房间没有游戏状态");
    state.game.lastDieResult = 3;

    const next = RoomEngine.cast(state, "p1", 8);

    expect(next.game?.lastDieResult).toBeUndefined();
  });

  test("错误声明非一号咒语也会清除上一次骰值", () => {
    const state = spellRoom(2);
    if (!state.game) throw new Error("测试房间没有游戏状态");
    state.game.lastDieResult = 3;

    const next = RoomEngine.cast(state, "p1", 5);

    expect(next.game?.lastDieResult).toBeUndefined();
  });

  test("咒语效果令另一玩家生命归零时声明者赢得本轮且其他存活者加一分", () => {
    const state = spellRoom(7, { p4: 1 });

    const next = RoomEngine.cast(state, "p1", 7);

    expect(next.game).toMatchObject({ phase: "ROUND_END", roundWinnerId: "p1" });
    expect(next.game?.players.map((player) => [player.playerId, player.score, player.alive])).toEqual([
      ["p1", 3, true],
      ["p2", 1, true],
      ["p3", 1, true],
      ["p4", 0, false]
    ]);
  });

  test("四号进入四选一阶段，选择后本人能看见取得的秘密咒语", () => {
    const state = spellRoom(4);
    if (!state.game) throw new Error("测试房间没有游戏状态");
    state.game.secretSpells = [8, 3, 6, 1];

    const choosing = RoomEngine.cast(state, "p1", 4);
    const next = RoomEngine.chooseSecret(choosing, "p1", 2);
    const ownCards = RoomEngine.view(next, "p1", 2_000).game?.players[0]?.cards;

    expect(choosing.game?.phase).toBe("CHOOSING_SECRET");
    expect(next.game?.secretSpells).toEqual([8, 3, 1]);
    expect(next.game?.players[0]).toMatchObject({ secretSpellCount: 1, knownSecretSpells: [6] });
    expect(ownCards?.at(-1)).toEqual({ hidden: false, spellId: 6, secret: true });
    expect(next.game?.events.at(-1)).toEqual({
      sequence: 3,
      type: "SECRET_TAKEN",
      actorId: "p1"
    });
  });

  test("取得的秘密咒语只向本人翻开且四号牌进入公开图板", () => {
    const state = spellRoom(4);
    if (!state.game) throw new Error("测试房间没有游戏状态");
    state.game.secretSpells = [8, 3, 6, 1];

    const choosing = RoomEngine.cast(state, "p1", 4);
    const selected = RoomEngine.chooseSecret(choosing, "p1", 2);
    const ownerCards = RoomEngine.view(selected, "p1", 2_000).game?.players[0]?.cards;
    const opponentCards = RoomEngine.view(selected, "p2", 2_000).game?.players[0]?.cards;

    expect(selected.game?.discardPile).toEqual([4]);
    expect(ownerCards).toEqual([
      { hidden: true },
      { hidden: false, spellId: 6, secret: true }
    ]);
    expect(opponentCards).toEqual([
      { hidden: false, spellId: 8 },
      { hidden: true }
    ]);
  });

  test("猫头鹰取得的秘密咒语不能作为普通手牌打出", () => {
    const state = spellRoom(4);
    if (!state.game) throw new Error("测试房间没有游戏状态");
    state.game.players[0] = {
      ...state.game.players[0]!,
      cards: [4, 8],
      hp: 4
    };
    state.game.secretSpells = [6];

    const choosing = RoomEngine.cast(state, "p1", 4);
    const selected = RoomEngine.chooseSecret(choosing, "p1", 0);
    if (!selected.game) throw new Error("测试房间没有游戏状态");
    selected.game.deck = [];
    const next = RoomEngine.cast(selected, "p1", 6);

    expect(next.game?.players[0]).toMatchObject({
      hp: 3,
      cards: [8, 6],
      knownSecretSpells: [6],
      secretSpellCount: 1
    });
    expect(next.game?.discardPile).toEqual([4]);
    expect(next.game?.currentPlayerId).toBe("p2");
  });

  test("最后一张普通牌是猫头鹰时先取得秘密牌再以空手赢得本轮", () => {
    const state = spellRoom(4);
    if (!state.game) throw new Error("测试房间没有游戏状态");
    state.game.players[0] = {
      ...state.game.players[0]!,
      cards: [4],
      hp: 4
    };
    state.game.secretSpells = [8];

    const choosing = RoomEngine.cast(state, "p1", 4);
    const next = RoomEngine.chooseSecret(choosing, "p1", 0);

    expect(next.game).toMatchObject({ phase: "ROUND_END", roundWinnerId: "p1" });
    expect(next.game?.players[0]).toMatchObject({
      cards: [8],
      knownSecretSpells: [8],
      secretSpellCount: 1,
      score: 4
    });
  });
});

const identities = ["p1", "p2", "p3", "p4"].map((playerId, index) => ({
  playerId,
  nickname: `${index + 1}号`,
  credential: `secret-${index + 1}`
}));

function spellRoom(spellId: number, hp: Record<string, number> = {}, playerCount = 4): RoomState {
  let state = RoomEngine.create("123456", identities[0]!, 1_000);
  for (const identity of identities.slice(1, playerCount)) state = RoomEngine.join(state, identity!, 1_000);
  for (const identity of identities.slice(0, playerCount)) state = RoomEngine.setReady(state, identity!.playerId, true);
  state = RoomEngine.start(state, "p1", () => 0.5);
  if (!state.game) throw new Error("测试房间没有游戏状态");
  const players: GamePlayer[] = state.game.players.map((player) => ({
    ...player,
    cards: player.playerId === "p1" ? [spellId, 8] : [8],
    hp: hp[player.playerId] ?? 4
  }));
  return { ...state, game: { ...state.game, currentPlayerId: "p1", players, discardPile: [] } };
}

function hitPoints(state: RoomState): Record<string, number> {
  return Object.fromEntries(state.game?.players.map((player) => [player.playerId, player.hp]) ?? []);
}
