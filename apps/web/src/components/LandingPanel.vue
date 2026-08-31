<script setup lang="ts">
import { ref } from "vue";
import { activeContent } from "../content";

defineProps<{ busy: boolean; error: string }>();
const emit = defineEmits<{
  create: [nickname: string];
  join: [nickname: string, roomId: string];
}>();
const nickname = ref("");
const roomId = ref("");
</script>

<template>
  <main class="landing">
    <section class="hero-copy">
      <p class="eyebrow">2–4 人 · 好友联机 · 隐藏推理</p>
      <h1>{{ activeContent.title }}</h1>
      <p class="tagline">看清每个人的咒印，唯独看不见自己的。</p>
      <div class="rule-strip">
        <span>观察</span><i>→</i><span>推理</span><i>→</i><span>施法</span>
      </div>
    </section>

    <section class="entry-card panel">
      <label>
        <span>你的称呼</span>
        <input data-test="nickname" v-model="nickname" maxlength="16" placeholder="输入昵称" />
      </label>
      <button data-test="create-room" class="primary" :disabled="busy || !nickname.trim()" @click="emit('create', nickname)">
        创建私人房间
      </button>
      <div class="divider"><span>或者用游戏码加入</span></div>
      <label>
        <span>六位游戏码</span>
        <input v-model="roomId" maxlength="6" inputmode="numeric" placeholder="例如 627381" />
      </label>
      <button class="secondary" :disabled="busy || !nickname.trim() || !/^\d{6}$/.test(roomId)" @click="emit('join', nickname, roomId)">
        加入房间
      </button>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>
