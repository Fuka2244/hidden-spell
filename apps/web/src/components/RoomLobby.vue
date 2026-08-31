<script setup lang="ts">
import { computed } from "vue";
import { activeContent } from "../content";
import type { CharacterId, RoomView } from "../types";

const props = defineProps<{ view: RoomView; busy: boolean }>();
const emit = defineEmits<{
  ready: [ready: boolean];
  start: [];
  leave: [];
  "select-character": [characterId: CharacterId];
}>();
const me = () => props.view.players.find((player) => player.playerId === props.view.viewerId);
const characters = computed(() => (["red", "blue", "green", "purple"] as const).map((id) => ({
  id,
  ...activeContent.value.characters[id]
})));
const isTakenByOther = (characterId: CharacterId) => props.view.players.some(
  (player) => player.playerId !== props.view.viewerId && player.characterId === characterId
);
</script>

<template>
  <main class="room-shell">
    <header class="room-header">
      <div><p class="eyebrow">私人房间</p><h1>房间 {{ view.roomId }}</h1></div>
      <button class="ghost danger" @click="emit('leave')">退出房间</button>
    </header>
    <section class="lobby-grid">
      <div class="panel roster">
        <div class="section-title"><h2>入席者</h2><span>{{ view.players.length }} / 4</span></div>
        <article v-for="player in view.players" :key="player.playerId" class="player-row">
          <div :class="['avatar', `character-${player.characterId}`]">{{ player.nickname.slice(0, 1) }}</div>
          <div class="player-name">
            <strong>{{ player.nickname }}</strong>
            <small>{{ player.playerId === view.ownerId ? '房主' : '玩家' }}</small>
          </div>
          <span v-if="!player.connected" class="status offline">重连中</span>
          <span v-else :class="['status', player.ready ? 'ready' : 'waiting']">{{ player.ready ? '已准备' : '未准备' }}</span>
        </article>
      </div>
      <aside class="panel lobby-actions">
        <p>将游戏码发给朋友。2–4 人全部准备后，房主即可开启牌局。</p>
        <div class="character-picker">
          <strong>选择角色颜色</strong>
          <div class="character-options">
            <button
              v-for="character in characters"
              :key="character.id"
              :data-test="`character-${character.id}`"
              :class="['character-choice', `character-${character.id}`, { selected: me()?.characterId === character.id }]"
              :disabled="busy || isTakenByOther(character.id)"
              :title="isTakenByOther(character.id) ? '已被其他玩家选择' : character.name"
              @click="emit('select-character', character.id)"
            ><img v-if="character.imageUrl" :src="character.imageUrl" :alt="character.name" /><span v-else>{{ character.symbol }}</span><small>{{ character.name }}</small></button>
          </div>
        </div>
        <button class="primary" :disabled="busy" @click="emit('ready', !me()?.ready)">
          {{ me()?.ready ? '取消准备' : '我准备好了' }}
        </button>
        <button v-if="view.ownerId === view.viewerId" class="secondary" :disabled="busy || view.players.length < 2 || view.players.some(p => !p.ready || !p.connected)" @click="emit('start')">
          开始游戏
        </button>
      </aside>
    </section>
  </main>
</template>
