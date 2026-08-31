import { DurableObject } from "cloudflare:workers";
import {
  RoomEngine,
  RoomRuleError,
  type PlayerIdentity,
  type RoomState
} from "@hidden-spell/game-core";
import {
  parseClientCommand,
  ProtocolError,
  type ClientCommand,
  type ServerMessage
} from "@hidden-spell/protocol";

const ROOM_STATE_KEY = "room-state";
const PROCESSED_COMMANDS_KEY = "processed-commands";
const MAX_PROCESSED_COMMANDS = 200;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/api/rooms") {
        const nickname = await readNickname(request);
        const roomId = randomRoomCode();
        return await roomStub(env, roomId).fetch(new Request("https://room/internal/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nickname, roomId })
        }));
      }

      const match = url.pathname.match(/^\/api\/rooms\/(\d{6})\/(join|socket|session)$/);
      if (match) {
        const roomId = match[1]!;
        if (match[2] === "join" && request.method === "POST") {
          const nickname = await readNickname(request);
          return await roomStub(env, roomId).fetch(new Request("https://room/internal/join", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ nickname })
          }));
        }
        if (match[2] === "session" && request.method === "GET") {
          const internalUrl = new URL("https://room/internal/session");
          internalUrl.search = url.search;
          return await roomStub(env, roomId).fetch(new Request(internalUrl, { method: "GET" }));
        }
        if (match[2] === "socket") return await roomStub(env, roomId).fetch(request);
      }

      if (env.ASSETS) return env.ASSETS.fetch(request);
      return json({ code: "NOT_FOUND", message: "页面不存在" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }
} satisfies ExportedHandler<Env>;

export class RoomDurableObject extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/internal/create") {
        return await this.createRoom(request);
      }
      if (request.method === "POST" && url.pathname === "/internal/join") {
        return await this.joinRoom(request);
      }
      if (request.method === "GET" && url.pathname === "/internal/session") {
        return await this.validateSession(url);
      }
      if (url.pathname.endsWith("/socket")) return await this.connectSocket(request, url);
      return json({ code: "NOT_FOUND", message: "房间接口不存在" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }

  async webSocketMessage(webSocket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const { playerId } = readSocketIdentity(webSocket);
    let commandId: string | undefined;
    try {
      if (typeof message !== "string") throw new ProtocolError("INVALID_COMMAND");
      const command = parseClientCommand(message);
      commandId = command.commandId;
      let state = await this.loadRoom();
      const processed = await this.processedCommands();
      if (!processed.includes(command.commandId)) {
        state = executeCommand(state, playerId, command);
        await this.saveRoom(state);
        await this.rememberCommand([...processed, command.commandId]);
      }
      webSocket.send(JSON.stringify({
        type: "ACK",
        commandId: command.commandId,
        sequence: state.game?.sequence ?? 0
      } satisfies ServerMessage));
      await this.broadcast(state);
    } catch (error) {
      webSocket.send(JSON.stringify(toErrorMessage(error, commandId)));
    }
  }

  async webSocketClose(webSocket: WebSocket): Promise<void> {
    const { playerId } = readSocketIdentity(webSocket);
    const anotherConnectionExists = this.ctx.getWebSockets().some(
      (candidate) => candidate !== webSocket && readSocketIdentity(candidate).playerId === playerId
    );
    if (anotherConnectionExists) return;

    const state = await this.ctx.storage.get<RoomState>(ROOM_STATE_KEY);
    const gamePlayer = state?.game?.players.find((player) => player.playerId === playerId);
    if (!state || gamePlayer?.alive === false || !state.players.some((p) => p.playerId === playerId)) {
      return;
    }
    const next = RoomEngine.disconnect(state, playerId, Date.now());
    await this.saveRoom(next);
    await this.scheduleAlarm(next);
    await this.broadcast(next);
  }

  async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<RoomState>(ROOM_STATE_KEY);
    if (!state) return;
    const next = RoomEngine.expireDisconnected(state, Date.now());
    await this.saveRoom(next);
    await this.scheduleAlarm(next);
    await this.broadcast(next);
  }

  private async createRoom(request: Request): Promise<Response> {
    if (await this.ctx.storage.get(ROOM_STATE_KEY)) {
      return json({ code: "ROOM_EXISTS", message: "游戏码已被使用" }, 409);
    }
    const body = await request.json<{ nickname: string; roomId: string }>();
    const identity = newIdentity(body.nickname);
    const state = RoomEngine.create(body.roomId, identity, Date.now());
    await this.saveRoom(state);
    return json(identityResult(state.roomId, identity), 201);
  }

  private async joinRoom(request: Request): Promise<Response> {
    const state = await this.loadRoom();
    const body = await request.json<{ nickname: string }>();
    const identity = newIdentity(body.nickname);
    const next = RoomEngine.join(state, identity, Date.now());
    await this.saveRoom(next);
    return json(identityResult(next.roomId, identity), 201);
  }

  private async validateSession(url: URL): Promise<Response> {
    try {
      const state = await this.loadRoom();
      RoomEngine.validateSession(
        state,
        url.searchParams.get("playerId") ?? "",
        url.searchParams.get("credential") ?? "",
        Date.now()
      );
      return json({ valid: true });
    } catch (error) {
      if (error instanceof RoomRuleError) {
        return json({ valid: false, code: error.code, message: error.message });
      }
      throw error;
    }
  }

  private async connectSocket(request: Request, url: URL): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return json({ code: "UPGRADE_REQUIRED", message: "需要 WebSocket 连接" }, 426);
    }
    const playerId = url.searchParams.get("playerId") ?? "";
    const credential = url.searchParams.get("credential") ?? "";
    let state = await this.loadRoom();
    state = RoomEngine.reconnect(state, playerId, credential, Date.now());
    await this.saveRoom(state);

    for (const socket of this.ctx.getWebSockets()) {
      if (readSocketIdentity(socket).playerId === playerId) {
        socket.close(4001, "该玩家已在新的页面连接");
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ playerId });
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify(createStateMessage(state, playerId)));
    await this.broadcast(state, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async loadRoom(): Promise<RoomState> {
    const state = await this.ctx.storage.get<RoomState>(ROOM_STATE_KEY);
    if (!state) throw new RoomRuleError("ROOM_NOT_FOUND", "房间不存在");
    return state;
  }

  private saveRoom(state: RoomState): Promise<void> {
    return this.ctx.storage.put(ROOM_STATE_KEY, state);
  }

  private async processedCommands(): Promise<string[]> {
    return await this.ctx.storage.get<string[]>(PROCESSED_COMMANDS_KEY) ?? [];
  }

  private rememberCommand(commandIds: string[]): Promise<void> {
    return this.ctx.storage.put(PROCESSED_COMMANDS_KEY, commandIds.slice(-MAX_PROCESSED_COMMANDS));
  }

  private async broadcast(state: RoomState, except?: WebSocket): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      const { playerId } = readSocketIdentity(socket);
      if (!state.players.some((player) => player.playerId === playerId)) {
        socket.close(1000, "已离开房间");
      } else {
        socket.send(JSON.stringify(createStateMessage(state, playerId)));
      }
    }
  }

  private async scheduleAlarm(state: RoomState): Promise<void> {
    const deadlines = state.players.flatMap((player) =>
      player.disconnectDeadline === undefined ? [] : [player.disconnectDeadline]
    );
    if (deadlines.length === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }
}

export function executeCommand(state: RoomState, playerId: string, command: ClientCommand): RoomState {
  switch (command.type) {
    case "SELECT_CHARACTER":
      return RoomEngine.selectCharacter(state, playerId, command.payload.characterId);
    case "SET_READY":
      return RoomEngine.setReady(state, playerId, command.payload.ready);
    case "START_GAME":
      return RoomEngine.start(state, playerId, Math.random);
    case "CAST_SPELL":
      return RoomEngine.cast(state, playerId, command.payload.spellId);
    case "CHOOSE_SECRET":
      return RoomEngine.chooseSecret(state, playerId, command.payload.secretIndex);
    case "END_TURN":
      return RoomEngine.endTurn(state, playerId);
    case "NEXT_ROUND":
      return RoomEngine.nextRound(state, playerId, Math.random);
    case "LEAVE_ROOM":
      return RoomEngine.leave(state, playerId);
    case "SYNC":
      return state;
  }
}

function createStateMessage(state: RoomState, playerId: string): ServerMessage {
  return {
    type: "STATE",
    sequence: state.game?.sequence ?? 0,
    payload: RoomEngine.view(state, playerId, Date.now())
  };
}

function readSocketIdentity(webSocket: WebSocket): { playerId: string } {
  const identity: unknown = webSocket.deserializeAttachment();
  if (
    typeof identity !== "object" || identity === null ||
    !("playerId" in identity) || typeof identity.playerId !== "string"
  ) {
    throw new ProtocolError("INVALID_COMMAND");
  }
  return { playerId: identity.playerId };
}

function roomStub(env: Env, roomId: string): DurableObjectStub {
  return env.ROOMS.getByName(roomId);
}

function randomRoomCode(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return String(100_000 + (value % 900_000));
}

function newIdentity(nickname: string): PlayerIdentity {
  return { playerId: crypto.randomUUID(), nickname, credential: crypto.randomUUID() };
}

function identityResult(roomId: string, identity: PlayerIdentity) {
  return { roomId, ...identity };
}

async function readNickname(request: Request): Promise<string> {
  const body = await request.json<{ nickname?: unknown }>();
  if (typeof body.nickname !== "string") {
    throw new RoomRuleError("INVALID_NICKNAME", "请输入昵称");
  }
  const nickname = body.nickname.trim();
  if (nickname.length < 1 || nickname.length > 16) {
    throw new RoomRuleError("INVALID_NICKNAME", "昵称长度应为 1 至 16 个字符");
  }
  return nickname;
}

function toErrorMessage(error: unknown, commandId?: string): ServerMessage {
  const known = error instanceof RoomRuleError || error instanceof ProtocolError;
  return {
    type: "ERROR",
    ...(commandId ? { commandId } : {}),
    code: known ? error.code : "INTERNAL_ERROR",
    message: known ? error.message : "服务器内部错误"
  };
}

function errorResponse(error: unknown): Response {
  if (
    error instanceof Error &&
    error.message.includes("Exceeded allowed volume of requests in Durable Objects free tier")
  ) {
    return json({
      type: "ERROR",
      code: "SERVICE_QUOTA_EXCEEDED",
      message: "服务器今日免费额度已用完，请在北京时间 08:00 后再试"
    }, 503);
  }
  const status = error instanceof RoomRuleError
    ? error.code === "ROOM_NOT_FOUND" ? 404 : 409
    : error instanceof ProtocolError || error instanceof SyntaxError ? 400 : 500;
  return json(toErrorMessage(error), status);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}
