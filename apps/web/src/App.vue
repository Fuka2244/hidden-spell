<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import GameTable from "./components/GameTable.vue";
import LandingPanel from "./components/LandingPanel.vue";
import RoomLobby from "./components/RoomLobby.vue";
import { loadContentPack } from "./content";
import { clearSession, loadSession, saveSession } from "./session";
import type { CharacterId, PlayerSession, RoomView, ServerMessage } from "./types";

const session = ref<PlayerSession | null>(loadSession());
const roomView = ref<RoomView | null>(null);
const busy = ref(false);
const error = ref("");
const connected = ref(false);
const reconnectStopped = ref(false);
let socket: WebSocket | null = null;
let reconnectTimer: number | undefined;
let stableTimer: number | undefined;
let leaveTimer: number | undefined;
let leaveCommandId: string | null = null;
let reconnectAttempt = 0;
let voluntarilyClosed = false;
const MAX_RECONNECT_ATTEMPTS = 6;

const screen = computed(() => {
  if (!session.value) return "landing";
  if (roomView.value?.game) return "game";
  return "room";
});

onMounted(() => {
  void loadContentPack();
  if (session.value) void connect();
});
onBeforeUnmount(() => {
  voluntarilyClosed = true;
  if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
  if (stableTimer !== undefined) window.clearTimeout(stableTimer);
  if (leaveTimer !== undefined) window.clearTimeout(leaveTimer);
  socket?.close();
});

async function createRoom(nickname: string): Promise<void> {
  await enterRoom("/api/rooms", nickname);
}

async function joinRoom(nickname: string, roomId: string): Promise<void> {
  await enterRoom(`/api/rooms/${roomId}/join`, nickname);
}

async function enterRoom(url: string, nickname: string): Promise<void> {
  busy.value = true;
  error.value = "";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: nickname.trim() })
    });
    const result = await response.json() as PlayerSession & { message?: string };
    if (!response.ok) throw new Error(result.message ?? "进入房间失败");
    session.value = result;
    saveSession(result);
    reconnectAttempt = 0;
    reconnectStopped.value = false;
    void connect();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "网络连接失败";
  } finally {
    busy.value = false;
  }
}

async function connect(): Promise<void> {
  const identity = session.value;
  if (!identity) return;
  voluntarilyClosed = false;
  if (!await validateSession(identity)) return;
  if (session.value?.playerId !== identity.playerId) return;
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${scheme}//${location.host}/api/rooms/${identity.roomId}/socket?playerId=${encodeURIComponent(identity.playerId)}&credential=${encodeURIComponent(identity.credential)}`;
  if (stableTimer !== undefined) window.clearTimeout(stableTimer);
  stableTimer = undefined;
  const previous = socket;
  socket = null;
  previous?.close();
  const connection = new WebSocket(url);
  socket = connection;
  connection.addEventListener("open", () => {
    if (socket !== connection) return;
    connected.value = true;
    reconnectStopped.value = false;
    error.value = "";
    stableTimer = window.setTimeout(() => {
      stableTimer = undefined;
      if (socket === connection && connected.value) reconnectAttempt = 0;
    }, 60_000);
  });
  connection.addEventListener("message", (event) => {
    if (socket === connection) receive(JSON.parse(event.data as string) as ServerMessage);
  });
  connection.addEventListener("close", (event) => {
    if (socket !== connection) return;
    if (stableTimer !== undefined) window.clearTimeout(stableTimer);
    stableTimer = undefined;
    connected.value = false;
    if (event.code === 4001) {
      error.value = "该玩家已在另一个页面连接";
      reconnectStopped.value = true;
      return;
    }
    if (!voluntarilyClosed && session.value) scheduleReconnect();
  });
}

async function validateSession(identity: PlayerSession): Promise<boolean> {
  try {
    const query = new URLSearchParams({
      playerId: identity.playerId,
      credential: identity.credential
    });
    const response = await fetch(`/api/rooms/${identity.roomId}/session?${query}`);
    if (response.ok) {
      const result = await response.json() as { valid?: boolean };
      if (result.valid === true) return true;
      if (result.valid === false) {
        clearExpiredSession();
        return false;
      }
    }
    // 兼容尚未更新的服务器，便于前后端滚动部署。
    if (response.status === 404 || response.status === 409) {
      clearExpiredSession();
      return false;
    }
  } catch {
    // 短暂网络故障保留原身份，稍后继续验证。
  }
  error.value = "暂时无法连接服务器，正在重试";
  scheduleReconnect();
  return false;
}

function clearExpiredSession(): void {
  voluntarilyClosed = true;
  if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
  if (stableTimer !== undefined) window.clearTimeout(stableTimer);
  if (leaveTimer !== undefined) window.clearTimeout(leaveTimer);
  reconnectTimer = stableTimer = undefined;
  leaveTimer = undefined;
  leaveCommandId = null;
  busy.value = false;
  reconnectAttempt = 0;
  reconnectStopped.value = false;
  socket?.close();
  socket = null;
  roomView.value = null;
  session.value = null;
  clearSession();
  error.value = "原房间已失效，请重新创建或加入房间";
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    reconnectTimer = undefined;
    reconnectStopped.value = true;
    error.value = "多次连接失败，已停止自动重连；请稍后手动重新连接";
    return;
  }
  const delay = Math.min(1_500 * 2 ** reconnectAttempt, 30_000);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    void connect();
  }, delay);
}

function receive(message: ServerMessage): void {
  if (message.type === "ACK" && message.commandId === leaveCommandId) {
    finishLeave();
    return;
  }
  if (message.type === "ERROR" && message.commandId === leaveCommandId) {
    if (leaveTimer !== undefined) window.clearTimeout(leaveTimer);
    leaveTimer = undefined;
    leaveCommandId = null;
    busy.value = false;
    voluntarilyClosed = false;
  }
  if (message.type === "STATE") roomView.value = message.payload;
  if (message.type === "ERROR") error.value = `${message.message}（${message.code}）`;
}

function reconnectManually(): void {
  if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  reconnectAttempt = 0;
  reconnectStopped.value = false;
  error.value = "";
  void connect();
}

function createCommandId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function send(
  type: "SELECT_CHARACTER" | "SET_READY" | "START_GAME" | "CAST_SPELL" | "CHOOSE_SECRET" | "END_TURN" | "NEXT_ROUND" | "LEAVE_ROOM" | "SYNC",
  payload?: unknown
): string | undefined {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    error.value = "正在重新连接服务器";
    return;
  }
  const commandId = createCommandId();
  socket.send(JSON.stringify({
    commandId,
    type,
    ...(payload === undefined ? {} : { payload })
  }));
  return commandId;
}

function leaveRoom(): void {
  if (busy.value) return;
  if (!window.confirm(roomView.value?.game ? "退出将立即认输，确定吗？" : "确定退出房间吗？")) return;
  const commandId = send("LEAVE_ROOM");
  if (!commandId) return;
  leaveCommandId = commandId;
  busy.value = true;
  voluntarilyClosed = true;
  leaveTimer = window.setTimeout(() => {
    if (leaveCommandId !== commandId) return;
    leaveCommandId = null;
    leaveTimer = undefined;
    busy.value = false;
    voluntarilyClosed = false;
    error.value = "退出未得到服务器确认，正在恢复连接；请稍后重试";
    void connect();
  }, 5_000);
}

function finishLeave(): void {
  if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
  if (stableTimer !== undefined) window.clearTimeout(stableTimer);
  if (leaveTimer !== undefined) window.clearTimeout(leaveTimer);
  reconnectTimer = stableTimer = leaveTimer = undefined;
  leaveCommandId = null;
  const previous = socket;
  socket = null;
  previous?.close();
  connected.value = false;
  busy.value = false;
  error.value = "";
  roomView.value = null;
  session.value = null;
  clearSession();
}
</script>

<template>
  <div class="app-frame">
    <LandingPanel v-if="screen === 'landing'" :busy="busy" :error="error" @create="createRoom" @join="joinRoom" />
    <template v-else-if="session">
      <div v-if="roomView && error" class="connection-alert panel" role="alert">
        <span>{{ error }}</span>
        <button v-if="reconnectStopped" class="secondary" @click="reconnectManually">重新连接</button>
      </div>
      <div v-if="!roomView" class="loading panel">
        <div class="rune-loader">✦</div>
        <h2>房间 {{ session.roomId }}</h2>
        <p>{{ connected ? '正在同步牌局…' : '正在连接裁决服务器…' }}</p>
        <p v-if="error" class="error">{{ error }}</p>
        <button v-if="reconnectStopped" class="secondary" @click="reconnectManually">重新连接</button>
      </div>
      <RoomLobby
        v-else-if="screen === 'room'"
        :view="roomView"
        :busy="busy"
        @select-character="(characterId: CharacterId) => send('SELECT_CHARACTER', { characterId })"
        @ready="ready => send('SET_READY', { ready })"
        @start="send('START_GAME')"
        @leave="leaveRoom"
      />
      <GameTable
        v-else
        :view="roomView"
        @cast="spellId => send('CAST_SPELL', { spellId })"
        @choose-secret="secretIndex => send('CHOOSE_SECRET', { secretIndex })"
        @end-turn="send('END_TURN')"
        @next-round="send('NEXT_ROUND')"
        @leave="leaveRoom"
      />
    </template>
  </div>
</template>
