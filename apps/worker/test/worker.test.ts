import { SELF } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import { RoomEngine } from "@hidden-spell/game-core";
import worker, { executeCommand } from "../src/index.js";

describe("room worker", () => {
  test("Durable Object 异步失败时 API 仍返回 JSON 错误", async () => {
    const env = {
      ROOMS: {
        getByName: () => ({
          fetch: async () => { throw new Error("remote Durable Object failed"); }
        })
      }
    } as unknown as Env;

    const response = await worker.fetch(new Request("https://game.test/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "小明" })
    }), env);

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ code: "INTERNAL_ERROR", message: "服务器内部错误" });
  });

  test("Durable Object 免费额度耗尽时返回明确的稍后重试提示", async () => {
    const env = {
      ROOMS: {
        getByName: () => ({
          fetch: async () => { throw new Error("Exceeded allowed volume of requests in Durable Objects free tier."); }
        })
      }
    } as unknown as Env;

    const response = await worker.fetch(new Request("https://game.test/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "小明" })
    }), env);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "SERVICE_QUOTA_EXCEEDED",
      message: "服务器今日免费额度已用完，请在北京时间 08:00 后再试"
    });
  });

  test("将角色选择命令交给权威房间核心", () => {
    const first = { playerId: "p1", nickname: "一号", credential: "s1" };
    const state = RoomEngine.create("123456", first, 1_000);

    const next = executeCommand(state, "p1", {
      commandId: "character-1",
      type: "SELECT_CHARACTER",
      payload: { characterId: "green" }
    });

    expect(next.players[0]?.characterId).toBe("green");
  });

  test("将秘密咒语选择命令交给权威房间核心", () => {
    const first = { playerId: "p1", nickname: "一号", credential: "s1" };
    const second = { playerId: "p2", nickname: "二号", credential: "s2" };
    let state = RoomEngine.create("123456", first, 1_000);
    state = RoomEngine.join(state, second, 1_001);
    state = RoomEngine.setReady(state, "p1", true);
    state = RoomEngine.setReady(state, "p2", true);
    state = RoomEngine.start(state, "p1", () => 0.5);
    if (!state.game) throw new Error("测试房间没有游戏状态");
    state.game.phase = "CHOOSING_SECRET";
    state.game.currentPlayerId = "p1";
    state.game.secretSpells = [8, 3, 6, 1];

    const next = executeCommand(state, "p1", {
      commandId: "secret-1",
      type: "CHOOSE_SECRET",
      payload: { secretIndex: 1 }
    });

    expect(next.game?.secretSpells).toEqual([8, 6, 1]);
    expect(next.game?.players[0]?.knownSecretSpells).toEqual([3]);
  });

  test("创建房间会签发六位游戏码和私密玩家凭证", async () => {
    const response = await SELF.fetch("https://game.test/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "小明" })
    });

    expect(response.status).toBe(201);
    const result = await response.json<CreateRoomResult>();
    expect(result.roomId).toMatch(/^\d{6}$/);
    expect(result.playerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.credential).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.credential).not.toBe(result.playerId);
  });

  test("有效匿名身份可以通过会话验证接口", async () => {
    const owner = await createRoom("一号");

    const response = await SELF.fetch(
      `https://game.test/api/rooms/${owner.roomId}/session?playerId=${owner.playerId}&credential=${owner.credential}`
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: true });
  });

  test("已经不存在的旧房间通过会话验证返回无效状态", async () => {
    const response = await SELF.fetch(
      "https://game.test/api/rooms/000000/session?playerId=old-player&credential=old-secret"
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ valid: false, code: "ROOM_NOT_FOUND" });
  });

  test("第五名玩家加入时得到 ROOM_FULL", async () => {
    const owner = await createRoom("一号");
    for (const nickname of ["二号", "三号", "四号"]) {
      const response = await joinRoom(owner.roomId, nickname);
      expect(response.status).toBe(201);
    }

    const response = await joinRoom(owner.roomId, "五号");

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ROOM_FULL" });
  });

  test("开局后每名玩家只收到隐藏自己手牌的专属视图", async () => {
    const owner = await createRoom("一号");
    const joinResponse = await joinRoom(owner.roomId, "二号");
    const second = await joinResponse.json<CreateRoomResult>();
    const ownerSocket = await connectRoom(owner);
    const secondSocket = await connectRoom(second);
    const ownerInbox = new SocketInbox(ownerSocket);
    const secondInbox = new SocketInbox(secondSocket);

    ownerSocket.send(command("ready-1", "SET_READY", { ready: true }));
    await ownerInbox.nextAck("ready-1");
    secondSocket.send(command("ready-2", "SET_READY", { ready: true }));
    await secondInbox.nextAck("ready-2");
    ownerSocket.send(command("start-1", "START_GAME"));

    const ownerState = await ownerInbox.nextState("PLAYING");
    const secondState = await secondInbox.nextState("PLAYING");
    const ownerOwnCards = gameCards(ownerState, owner.playerId);
    const ownerSeesSecond = gameCards(ownerState, second.playerId);
    const secondOwnCards = gameCards(secondState, second.playerId);

    expect(ownerOwnCards).toEqual(Array.from({ length: 5 }, () => ({ hidden: true })));
    expect(secondOwnCards).toEqual(Array.from({ length: 5 }, () => ({ hidden: true })));
    expect(ownerSeesSecond.every((card) => card.hidden === false && "spellId" in card)).toBe(true);
    expect(ownerState).not.toEqual(secondState);

    const visibleOwnerCard = gameCards(secondState, owner.playerId).find(
      (card): card is { hidden: false; spellId: number } => !card.hidden && card.spellId !== undefined
    );
    if (!visibleOwnerCard) throw new Error("二号玩家没有看到一号的咒语石");
    ownerSocket.send(command("cast-1", "CAST_SPELL", { spellId: visibleOwnerCard.spellId }));
    await ownerInbox.nextAck("cast-1");
    const castState = await ownerInbox.nextGamePhase(["MAY_CONTINUE", "CHOOSING_SECRET"]);

    expect(gameCards(castState, owner.playerId)).toHaveLength(4);
    expect(castState.game?.discardPile.at(-1)).toBe(visibleOwnerCard.spellId);

    ownerSocket.close(1000, "done");
    secondSocket.close(1000, "done");
  });
});

interface CreateRoomResult {
  roomId: string;
  playerId: string;
  credential: string;
}

async function createRoom(nickname: string): Promise<CreateRoomResult> {
  const response = await SELF.fetch("https://game.test/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname })
  });
  return response.json<CreateRoomResult>();
}

function joinRoom(roomId: string, nickname: string): Promise<Response> {
  return SELF.fetch(`https://game.test/api/rooms/${roomId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname })
  });
}

async function connectRoom(identity: CreateRoomResult): Promise<WebSocket> {
  const response = await SELF.fetch(
    `https://game.test/api/rooms/${identity.roomId}/socket?playerId=${identity.playerId}&credential=${identity.credential}`,
    { headers: { upgrade: "websocket" } }
  );
  if (!response.webSocket) throw new Error(`WebSocket 连接失败：${response.status}`);
  response.webSocket.accept();
  return response.webSocket;
}

function command(commandId: string, type: string, payload?: unknown): string {
  return JSON.stringify({ commandId, type, ...(payload === undefined ? {} : { payload }) });
}

interface StateMessage {
  type: "STATE";
  payload: {
    status: string;
    game?: {
      phase: string;
      discardPile: number[];
      players: Array<{ playerId: string; cards: Array<{ hidden: boolean; spellId?: number }> }>;
    };
  };
}

class SocketInbox {
  private readonly messages: unknown[] = [];
  private waiter: (() => void) | undefined;

  constructor(socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      this.messages.push(JSON.parse(event.data as string));
      this.waiter?.();
      this.waiter = undefined;
    });
  }

  async nextState(status: string): Promise<StateMessage["payload"]> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (this.messages.length === 0) {
        await new Promise<void>((resolve) => { this.waiter = resolve; });
      }
      const message = this.messages.shift() as StateMessage | undefined;
      if (message?.type === "STATE" && message.payload.status === status) return message.payload;
    }
    throw new Error(`未收到状态 ${status}`);
  }

  async nextGamePhase(phases: string[]): Promise<StateMessage["payload"]> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (this.messages.length === 0) {
        await new Promise<void>((resolve) => { this.waiter = resolve; });
      }
      const message = this.messages.shift() as StateMessage | undefined;
      if (message?.type === "STATE" && phases.includes(message.payload.game?.phase ?? "")) {
        return message.payload;
      }
    }
    throw new Error(`未收到游戏阶段 ${phases.join("/")}`);
  }

  async nextAck(commandId: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (this.messages.length === 0) {
        await new Promise<void>((resolve) => { this.waiter = resolve; });
      }
      const message = this.messages.shift() as { type?: string; commandId?: string } | undefined;
      if (message?.type === "ACK" && message.commandId === commandId) return;
    }
    throw new Error(`未收到确认 ${commandId}`);
  }
}

function gameCards(state: StateMessage["payload"], playerId: string) {
  const player = state.game?.players.find((candidate) => candidate.playerId === playerId);
  if (!player) throw new Error(`视图中没有玩家 ${playerId}`);
  return player.cards;
}
