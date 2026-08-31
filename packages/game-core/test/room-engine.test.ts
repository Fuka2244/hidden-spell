import { describe, expect, test } from "vitest";
import { RoomEngine } from "../src/index.js";

const players = [
  { playerId: "p1", nickname: "一号", credential: "secret-1" },
  { playerId: "p2", nickname: "二号", credential: "secret-2" },
  { playerId: "p3", nickname: "三号", credential: "secret-3" },
  { playerId: "p4", nickname: "四号", credential: "secret-4" }
] as const;

describe("RoomEngine", () => {
  test("玩家自动取得不同角色并可改选尚未占用的角色", () => {
    let state = RoomEngine.create("123456", players[0], 1_000);
    state = RoomEngine.join(state, players[1], 1_001);

    state = RoomEngine.selectCharacter(state, "p1", "purple");

    expect(state.players.map((player) => [player.playerId, player.characterId])).toEqual([
      ["p1", "purple"],
      ["p2", "blue"]
    ]);
    expect(RoomEngine.view(state, "p1", 2_000).players[0]?.characterId).toBe("purple");
  });

  test("不能选择已被其他玩家占用的角色", () => {
    let state = RoomEngine.create("123456", players[0], 1_000);
    state = RoomEngine.join(state, players[1], 1_001);

    expectRoomError(() => RoomEngine.selectCharacter(state, "p2", "red"), "CHARACTER_TAKEN");
  });

  test("第五名玩家不能进入四人房间", () => {
    let state = RoomEngine.create("123456", players[0], 1_000);
    for (const player of players.slice(1)) {
      state = RoomEngine.join(state, player, 1_000);
    }

    expectRoomError(() => RoomEngine.join(state, {
      playerId: "p5",
      nickname: "五号",
      credential: "secret-5"
    }, 1_000), "ROOM_FULL");
  });

  test("两人全部准备后房主可以开局", () => {
    let state = RoomEngine.create("123456", players[0], 1_000);
    state = RoomEngine.join(state, players[1], 1_001);
    state = RoomEngine.setReady(state, "p1", true);
    state = RoomEngine.setReady(state, "p2", true);

    state = RoomEngine.start(state, "p1", () => 0.5);

    expect(state.status).toBe("PLAYING");
    expect(state.game?.players).toHaveLength(2);
    expect(state.game?.players.every((player) => player.cards.length === 5)).toBe(true);
  });

  test("非房主不能开始游戏", () => {
    let state = RoomEngine.create("123456", players[0], 1_000);
    state = RoomEngine.join(state, players[1], 1_001);
    state = RoomEngine.setReady(state, "p1", true);
    state = RoomEngine.setReady(state, "p2", true);

    expectRoomError(() => RoomEngine.start(state, "p2", () => 0.5), "NOT_ROOM_OWNER");
  });

  test("有等待玩家断线时不能开局", () => {
    let state = RoomEngine.create("123456", players[0], 1_000);
    state = RoomEngine.join(state, players[1], 1_001);
    state = RoomEngine.setReady(state, "p1", true);
    state = RoomEngine.setReady(state, "p2", true);
    state = RoomEngine.disconnect(state, "p2", 2_000);

    expectRoomError(() => RoomEngine.start(state, "p1", () => 0.5), "PLAYER_DISCONNECTED");
  });

  test("玩家断线会暂停已开始的游戏并设置九十秒期限", () => {
    let state = startedRoom();

    state = RoomEngine.disconnect(state, "p2", 10_000);

    expect(state.status).toBe("PAUSED");
    expect(state.players.find((player) => player.playerId === "p2")).toMatchObject({
      connected: false,
      disconnectDeadline: 100_000
    });
  });

  test("断线玩家在期限内重连会继续对局", () => {
    let state = RoomEngine.disconnect(startedRoom(), "p2", 10_000);

    state = RoomEngine.reconnect(state, "p2", "secret-2", 50_000);

    expect(state.status).toBe("PLAYING");
    expect(state.players.find((player) => player.playerId === "p2")).toMatchObject({
      connected: true
    });
  });

  test("给玩家的视图隐藏自己的牌但展示他人的牌", () => {
    const state = startedRoom();

    const view = RoomEngine.view(state, "p1", 2_000);
    const ownCards = view.game?.players.find((player) => player.playerId === "p1")?.cards;
    const otherCards = view.game?.players.find((player) => player.playerId === "p2")?.cards;

    expect(ownCards).toEqual(Array.from({ length: 5 }, () => ({ hidden: true })));
    expect(otherCards).toHaveLength(5);
    expect(otherCards?.every((card) => !card.hidden && card.spellId !== undefined)).toBe(true);
  });

  test("等待房间的房主离开后转让给最早加入的玩家", () => {
    let state = RoomEngine.create("123456", players[0], 1_000);
    state = RoomEngine.join(state, players[1], 1_001);
    state = RoomEngine.join(state, players[2], 1_002);

    state = RoomEngine.leave(state, "p1");

    expect(state.ownerId).toBe("p2");
    expect(state.players.map((player) => player.playerId)).toEqual(["p2", "p3"]);
  });

  test("等待玩家断线超时后被移出房间", () => {
    let state = RoomEngine.create("123456", players[0], 1_000);
    state = RoomEngine.join(state, players[1], 1_001);
    state = RoomEngine.disconnect(state, "p1", 2_000);

    state = RoomEngine.expireDisconnected(state, 92_001);

    expect(state.players.map((player) => player.playerId)).toEqual(["p2"]);
    expect(state.ownerId).toBe("p2");
  });

  test("断线玩家在截止时刻精确到达时被移出房间", () => {
    let state = RoomEngine.create("123456", players[0], 1_000);
    state = RoomEngine.join(state, players[1], 1_001);
    state = RoomEngine.disconnect(state, "p1", 2_000);

    state = RoomEngine.expireDisconnected(state, 92_000);

    expect(state.players.map((player) => player.playerId)).toEqual(["p2"]);
    expect(state.ownerId).toBe("p2");
  });

  test("游戏中断线玩家超时后不再保留断线截止时间", () => {
    let state = RoomEngine.disconnect(startedRoom(), "p2", 10_000);

    state = RoomEngine.expireDisconnected(state, 100_001);

    expect(state.players.find((player) => player.playerId === "p2")?.disconnectDeadline).toBeUndefined();
  });

  test("游戏中主动退出立即认输并由最后一名玩家获胜", () => {
    let state = startedRoom();

    state = RoomEngine.leave(state, "p2");

    expect(state.status).toBe("FINISHED");
    expect(state.game?.winnerId).toBe("p1");
    expect(state.game?.players.find((player) => player.playerId === "p2")?.alive).toBe(false);
  });

  test("错误凭证不能接管断线玩家的座位", () => {
    const state = RoomEngine.disconnect(startedRoom(), "p2", 10_000);

    expectRoomError(
      () => RoomEngine.reconnect(state, "p2", "wrong-secret", 20_000),
      "INVALID_CREDENTIAL"
    );
  });

  test("会话验证接受有效身份且不改变房间状态", () => {
    const state = startedRoom();

    const validated = RoomEngine.validateSession(state, "p1", "secret-1", 20_000);

    expect(validated).toBe(state);
  });

  test("会话验证拒绝已经失效的匿名凭证", () => {
    const state = startedRoom();

    expectRoomError(
      () => RoomEngine.validateSession(state, "p1", "wrong-secret", 20_000),
      "INVALID_CREDENTIAL"
    );
  });
});

function startedRoom() {
  let state = RoomEngine.create("123456", players[0], 1_000);
  state = RoomEngine.join(state, players[1], 1_001);
  state = RoomEngine.setReady(state, "p1", true);
  state = RoomEngine.setReady(state, "p2", true);
  return RoomEngine.start(state, "p1", () => 0.5);
}

function expectRoomError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`预期抛出房间错误 ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}
