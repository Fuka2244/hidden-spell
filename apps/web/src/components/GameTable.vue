<script setup lang="ts">
import { computed } from "vue";
import { activeContent } from "../content";
import type { CardView, RoomView } from "../types";

defineProps<{ view: RoomView }>();
const emit = defineEmits<{
  leave: [];
  cast: [spellId: number];
  "choose-secret": [secretIndex: number];
  "end-turn": [];
  "next-round": [];
}>();

const SCORE_POSITIONS = [37.5, 45.5, 53.8, 62.1, 70.4, 78.6, 86.7, 94.5] as const;

const spells = computed(() => Array.from({ length: 8 }, (_, index) => {
  const id = index + 1;
  const item = activeContent.value.spells[id]!;
  return { id, name: item.name, effect: item.description ?? "", imageUrl: item.imageUrl };
}));
const spellsDescending = computed(() => [...spells.value].reverse());
const boardStyle = computed(() => ({
  backgroundImage: `linear-gradient(rgba(10,9,18,.08), rgba(10,9,18,.2)), url("${activeContent.value.boardImageUrl}")`
}));
const secretBackStyle = computed(() => activeContent.value.cardBackImageUrl ? ({
  backgroundImage: `url("${activeContent.value.cardBackImageUrl}")`,
  backgroundSize: "cover",
  backgroundPosition: "center"
}) : {});

function cardLabel(card: CardView): string {
  if (card.hidden) return activeContent.value.cardBackImageUrl ? "" : "?";
  return activeContent.value.spells[card.spellId]?.imageUrl ? "" : String(card.spellId);
}

function canCast(view: RoomView, spellId: number): boolean {
  const game = view.game;
  if (!game || view.status !== "PLAYING" || game.currentPlayerId !== view.viewerId) return false;
  if (game.phase !== "WAITING_CAST" && game.phase !== "MAY_CONTINUE") return false;
  return game.lastSpellId === undefined || spellId >= game.lastSpellId;
}

function playerName(view: RoomView, playerId: string | undefined): string {
  return view.game?.players.find((player) => player.playerId === playerId)?.nickname ?? "未知玩家";
}

function winnerMessage(view: RoomView): string {
  const winnerIds = view.game?.winnerIds ?? (view.game?.winnerId ? [view.game.winnerId] : []);
  const names = winnerIds.map((playerId) => playerName(view, playerId));
  return names.length > 1
    ? `${names.join("、")}达到 8 分并列获胜`
    : `${names[0] ?? "未知玩家"} 达到 8 分并获胜`;
}

function playedCount(view: RoomView, spellId: number): number {
  return view.game?.discardPile.filter((value) => value === spellId).length ?? 0;
}

function spellCardStyle(card: CardView): Record<string, string> {
  if (card.hidden) {
    const imageUrl = activeContent.value.cardBackImageUrl;
    return imageUrl ? {
      backgroundImage: `url("${imageUrl}")`,
      backgroundSize: "cover",
      backgroundPosition: "center"
    } : {};
  }
  const imageUrl = activeContent.value.spells[card.spellId]?.imageUrl;
  return imageUrl ? { backgroundImage: `url("${imageUrl}")`, backgroundSize: "cover" } : {};
}

function boardStoneStyle(spellId: number): Record<string, string> {
  const imageUrl = activeContent.value.spells[spellId]?.imageUrl;
  return imageUrl ? {
    backgroundImage: `url("${imageUrl}")`,
    backgroundSize: "cover",
    backgroundPosition: "center"
  } : {};
}

function boardStoneLabel(spellId: number): string {
  return activeContent.value.spells[spellId]?.imageUrl ? "" : String(spellId);
}

function scoreMarkerStyle(score: number, playerIndex: number): Record<string, string> {
  const clampedScore = Math.max(0, Math.min(8, score));
  const left = clampedScore === 0 ? 32 : SCORE_POSITIONS[clampedScore - 1]!;
  const columnOffset = playerIndex % 2 === 0 ? -5 : 5;
  const rowOffset = Math.floor(playerIndex / 2) * 10 - 5;
  return {
    left: `${left}%`,
    top: clampedScore === 0 ? "94.5%" : "90.5%",
    transform: `translate(calc(-50% + ${columnOffset}px), calc(-50% + ${rowOffset}px))`
  };
}

function characterImageUrl(characterId: RoomView["players"][number]["characterId"]): string | undefined {
  return activeContent.value.characters[characterId]?.imageUrl;
}

function eventText(view: RoomView, event: NonNullable<RoomView["game"]>["events"][number]): string {
  const actor = playerName(view, event.actorId);
  if (event.type === "SECRET_TAKEN") return `${actor}取得了一枚秘密咒语`;
  const spell = spells.value.find((candidate) => candidate.id === event.spellId);
  return `${actor}${event.success ? "成功施放" : "声明失败"} ${event.spellId}号${spell?.name ?? "咒语"}`;
}

function hpChangeText(view: RoomView, playerId: string, delta: number): string {
  return delta < 0
    ? `${playerName(view, playerId)}失去 ${Math.abs(delta)} 点生命`
    : `${playerName(view, playerId)}恢复 ${delta} 点生命`;
}

function recentEvents(view: RoomView) {
  return [...(view.game?.events ?? [])].reverse().slice(0, 12);
}
</script>

<template>
  <main v-if="view.game" class="game-shell">
    <header class="game-header">
      <div><p class="eyebrow">房间 {{ view.roomId }} · 第 {{ view.game.round }} 轮</p><h1>{{ activeContent.title }}</h1></div>
      <div class="turn-banner">{{ view.status === 'PAUSED' ? '等待玩家重连' : `当前回合：${view.game.players.find(p => p.playerId === view.game?.currentPlayerId)?.nickname}` }}</div>
      <button class="ghost danger" @click="emit('leave')">认输退出</button>
    </header>

    <section class="game-content">
      <aside class="spell-board panel" aria-label="已打出咒语图板" :style="boardStyle">
        <div class="board-overlay">
          <div
            v-for="spell in spellsDescending"
            :key="spell.id"
            :data-test="`board-lane-${spell.id}`"
            class="board-lane"
            :style="{ width: `${13 + spell.id * 8.3}%` }"
          >
            <div class="board-stones">
              <i
                v-for="index in playedCount(view, spell.id)"
                :key="index"
                class="board-stone"
                :style="boardStoneStyle(spell.id)"
              >{{ boardStoneLabel(spell.id) }}</i>
            </div>
          </div>
        </div>
        <div class="score-track" aria-label="魔法师计分轨">
          <i
            v-for="(player, index) in view.game.players"
            :key="player.playerId"
            :data-test="`score-marker-${player.playerId}`"
            :data-score="player.score"
            :class="['score-marker', `character-${player.characterId}`]"
            :style="scoreMarkerStyle(player.score, index)"
            :title="`${player.nickname}：${player.score} 分`"
          >
            <img v-if="characterImageUrl(player.characterId)" :src="characterImageUrl(player.characterId)" :alt="player.nickname" />
            <template v-else>{{ player.nickname.slice(0, 1) }}</template>
          </i>
        </div>
      </aside>

      <section class="table panel">
        <article v-for="player in view.game.players" :key="player.playerId" :class="['seat', { me: player.playerId === view.viewerId, active: player.playerId === view.game.currentPlayerId, dead: !player.alive }]">
          <div class="seat-meta">
            <strong class="seat-identity"><i :class="['mini-avatar', `character-${player.characterId}`]"><img v-if="characterImageUrl(player.characterId)" :src="characterImageUrl(player.characterId)" :alt="activeContent.characters[player.characterId].name" /><template v-else>{{ player.nickname.slice(0, 1) }}</template></i>{{ player.nickname }} <small v-if="player.playerId === view.viewerId">（你）</small></strong>
            <div class="player-stats"><b>{{ player.score }} 分</b><span>{{ '♥'.repeat(Math.max(0, player.hp)) }}</span></div>
          </div>
          <div class="cards" style="width: 326px; max-width: 100%; margin: 0 auto; justify-content: flex-start">
            <div v-for="(card, index) in player.cards" :key="index" :class="['spell-card', { hidden: card.hidden, secret: !card.hidden && card.secret }]" style="width: 58px; min-width: 58px; flex: 0 0 58px" :style="spellCardStyle(card)" :title="!card.hidden && card.secret ? '秘密咒语，仅供查看与计分，不能施放' : undefined">
              {{ cardLabel(card) }}
            </div>
          </div>
        </article>
        <div class="table-center">
          <span>牌库 {{ view.game.deckCount }}</span>
          <strong>{{ view.game.secretSpellPoolCount }}</strong>
          <small>秘密咒语</small>
        </div>
      </section>
    </section>

    <section v-if="view.game.phase === 'CHOOSING_SECRET'" class="panel spell-controls secret-picker">
      <div>
        <p class="eyebrow">猫头鹰 · 秘密通信</p>
        <h2 v-if="view.game.currentPlayerId === view.viewerId">从中央选择一枚秘密咒语</h2>
        <h2 v-else>{{ `等待${playerName(view, view.game.currentPlayerId)}选择秘密咒语` }}</h2>
        <p v-if="view.game.currentPlayerId === view.viewerId">秘密牌背面相同；取得后仅供查看与计分，不能施放。</p>
      </div>
      <div v-if="view.game.currentPlayerId === view.viewerId" class="secret-actions">
        <button
          v-for="position in view.game.secretSpellPoolCount"
          :key="position"
          :data-test="`secret-${position - 1}`"
          class="secret-choice"
          :style="secretBackStyle"
          @click="emit('choose-secret', position - 1)"
        >{{ activeContent.cardBackImageUrl ? '' : '?' }}</button>
      </div>
    </section>

    <section v-else-if="view.game.phase === 'ROUND_END'" class="panel spell-controls round-result">
      <p class="eyebrow">本轮结束</p>
      <h2 v-if="view.game.roundWinnerId">{{ playerName(view, view.game.roundWinnerId) }} 赢得本轮</h2>
      <h2 v-else>{{ playerName(view, view.game.roundLoserId) }} 生命归零，本轮没有胜者</h2>
      <div v-if="view.game.roundScoreGains" class="score-breakdown">
        <div v-for="player in view.game.players" :key="player.playerId" :data-test="`score-gain-${player.playerId}`">
          <span>{{ player.nickname }}</span><strong>+{{ view.game.roundScoreGains[player.playerId] ?? 0 }}</strong><small>累计 {{ player.score }} 分</small>
        </div>
      </div>
      <button v-if="view.ownerId === view.viewerId" data-test="next-round" class="secondary compact" @click="emit('next-round')">开始下一轮</button>
      <p v-else>等待房主开始下一轮</p>
    </section>

    <section v-else-if="view.game.phase === 'GAME_END'" class="panel spell-controls round-result">
      <p class="eyebrow">整局结束</p>
      <h2>{{ winnerMessage(view) }}</h2>
      <div v-if="view.game.roundScoreGains" class="score-breakdown">
        <div v-for="player in view.game.players" :key="player.playerId" :data-test="`score-gain-${player.playerId}`">
          <span>{{ player.nickname }}</span><strong>+{{ view.game.roundScoreGains[player.playerId] ?? 0 }}</strong><small>最终 {{ player.score }} 分</small>
        </div>
      </div>
    </section>

    <section v-else class="panel spell-controls">
      <div>
        <p class="eyebrow">声明咒语</p>
        <h2 v-if="view.game.currentPlayerId === view.viewerId">
          {{ view.game.lastSpellId ? `继续施法：只能选择 ${view.game.lastSpellId}–8` : '选择你认为自己拥有的咒语' }}
        </h2>
        <h2 v-else>等待 {{ playerName(view, view.game.currentPlayerId) }} 施法</h2>
        <p v-if="view.game.lastDieResult">本次骰值：{{ view.game.lastDieResult }}</p>
        <p v-else>成功后立即结算咒语效果；生命恢复最高不超过 6 点。</p>
      </div>
      <div class="spell-actions">
        <button
          v-for="spell in spells"
          :key="spell.id"
          :data-test="`cast-${spell.id}`"
          class="spell-choice"
          :disabled="!canCast(view, spell.id)"
          :title="spell.effect"
          @click="emit('cast', spell.id)"
        ><strong>{{ spell.id }}</strong><small>{{ spell.name }}</small></button>
        <button
          v-if="view.game.phase === 'MAY_CONTINUE' && view.game.currentPlayerId === view.viewerId"
          data-test="end-turn"
          class="secondary compact"
          @click="emit('end-turn')"
        >结束回合</button>
      </div>
    </section>

    <section class="panel game-log" data-test="game-log">
      <div class="log-heading"><p class="eyebrow">对局记录</p><small>仅记录公开信息</small></div>
      <p v-if="recentEvents(view).length === 0" class="log-empty">等待第一位玩家施法</p>
      <ol v-else>
        <li v-for="event in recentEvents(view)" :key="event.sequence">
          <strong>{{ eventText(view, event) }}</strong>
          <span v-if="event.type === 'CAST' && event.dieResult">骰值 {{ event.dieResult }}</span>
          <span v-for="change in event.type === 'CAST' ? event.hpChanges : []" :key="change.playerId">
            {{ hpChangeText(view, change.playerId, change.delta) }}
          </span>
        </li>
      </ol>
    </section>
  </main>
</template>
