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
let socket: WebSocket | null = null;
let reconnectTimer: number | undefined;
let reconnectAttempt = 0;
let voluntarilyClosed = false;

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
  socket?.close();
  socket = new WebSocket(url);
  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    connected.value = true;
    error.value = "";
  });
  socket.addEventListener("message", (event) => receive(JSON.parse(event.data as string) as ServerMessage));
  socket.addEventListener("close", (event) => {
    connected.value = false;
    if (event.code === 4001) {
      error.value = "该玩家已在另一个页面连接";
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
  reconnectAttempt = 0;
  socket?.close();
  socket = null;
  roomView.value = null;
  session.value = null;
  clearSession();
  error.value = "原房间已失效，请重新创建或加入房间";
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
  const delay = Math.min(1_500 * 2 ** reconnectAttempt, 30_000);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    void connect();
  }, delay);
}

function receive(message: ServerMessage): void {
  if (message.type === "STATE") roomView.value = message.payload;
  if (message.type === "ERROR") error.value = `${message.message}（${message.code}）`;
}

function send(
  type: "SELECT_CHARACTER" | "SET_READY" | "START_GAME" | "CAST_SPELL" | "CHOOSE_SECRET" | "END_TURN" | "NEXT_ROUND" | "LEAVE_ROOM" | "SYNC",
  payload?: unknown
): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    error.value = "正在重新连接服务器";
    return;
  }
  socket.send(JSON.stringify({
    commandId: crypto.randomUUID(),
    type,
    ...(payload === undefined ? {} : { payload })
  }));
}

function leaveRoom(): void {
  if (!window.confirm(roomView.value?.game ? "退出将立即认输，确定吗？" : "确定退出房间吗？")) return;
  send("LEAVE_ROOM");
  voluntarilyClosed = true;
  socket?.close();
  socket = null;
  roomView.value = null;
  session.value = null;
  clearSession();
}
</script>

<template>
  <div class="app-frame">
    <LandingPanel v-if="screen === 'landing'" :busy="busy" :error="error" @create="createRoom" @join="joinRoom" />
    <template v-else-if="session">
      <div v-if="!roomView" class="loading panel">
        <div class="rune-loader">✦</div>
        <h2>房间 {{ session.roomId }}</h2>
        <p>{{ connected ? '正在同步牌局…' : '正在连接裁决服务器…' }}</p>
        <p v-if="error" class="error">{{ error }}</p>
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
