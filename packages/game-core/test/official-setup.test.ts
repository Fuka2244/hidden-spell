import { describe, expect, test } from "vitest";
import { RoomEngine, rollSpellDie, type RoomState } from "../src/index.js";

describe("正式游戏设置", () => {
  test("N 号咒语石恰好有 N 枚", () => {
    const state = startedFourPlayerRoom();
    if (!state.game) throw new Error("测试房间没有游戏状态");
    const allSpells = [
      ...state.game.players.flatMap((player) => player.cards),
      ...state.game.secretSpells,
      ...state.game.deck,
      ...state.game.discardPile,
      ...(state.game as unknown as { removedSpells?: number[] }).removedSpells ?? []
    ];
    const counts = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => {
        const spellId = index + 1;
        return [spellId, allSpells.filter((value) => value === spellId).length];
      })
    );

    expect(counts).toEqual({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 });
  });

  test("每轮所有玩家从六点生命开始", () => {
    const state = startedFourPlayerRoom();

    expect(state.game?.players.map((player) => player.hp)).toEqual([6, 6, 6, 6]);
  });

  test.each([
    [2, 22],
    [3, 17],
    [4, 12]
  ])("%i 人局不移除牌且开局补牌堆剩余 %i 张", (playerCount, expectedDeckCount) => {
    const state = startedRoom(playerCount);

    expect(state.game?.removedSpells).toEqual([]);
    expect(state.game?.deck).toHaveLength(expectedDeckCount);
  });

  test.each([
    [0, 1],
    [0.4999, 1],
    [0.5, 2],
    [0.8332, 2],
    [0.8334, 3],
    [0.9999, 3]
  ])("随机值 %s 映射到骰面 %s", (randomValue, expected) => {
    expect(rollSpellDie(() => randomValue)).toBe(expected);
  });
});

function startedFourPlayerRoom(): RoomState {
  return startedRoom(4);
}

function startedRoom(playerCount: number): RoomState {
  const identities = ["p1", "p2", "p3", "p4"].map((playerId) => ({
    playerId,
    nickname: playerId,
    credential: `secret-${playerId}`
  }));
  let state = RoomEngine.create("123456", identities[0]!, 1_000);
  for (const identity of identities.slice(1, playerCount)) state = RoomEngine.join(state, identity!, 1_000);
  for (const identity of identities.slice(0, playerCount)) state = RoomEngine.setReady(state, identity.playerId, true);
  return RoomEngine.start(state, "p1", () => 0.5);
}
