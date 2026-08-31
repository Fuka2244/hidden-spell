import { ref } from "vue";
import type { CharacterId } from "./types";

export interface ContentItem {
  name: string;
  imageUrl?: string;
  symbol?: string;
  description?: string;
}

export interface ContentPack {
  title: string;
  logoImageUrl?: string;
  boardImageUrl: string;
  cardBackImageUrl?: string;
  characters: Record<CharacterId, ContentItem>;
  spells: Record<number, ContentItem>;
}

export const DEFAULT_CONTENT: ContentPack = {
  title: "隐咒牌局",
  boardImageUrl: "/board-reference.png",
  characters: {
    red: { name: "红色法师", symbol: "◆" },
    blue: { name: "蓝色法师", symbol: "●" },
    green: { name: "绿色法师", symbol: "▲" },
    purple: { name: "紫色法师", symbol: "✦" }
  },
  spells: {
    1: { name: "龙", description: "掷骰，所有其他玩家失去骰值生命；喊错时自己承受骰值" },
    2: { name: "幽灵", description: "其他玩家失去 1 点，自己恢复 1 点" },
    3: { name: "独角兽", description: "掷骰并恢复骰值生命" },
    4: { name: "猫头鹰", description: "选择并查看一枚秘密咒语" },
    5: { name: "闪电", description: "左右邻座各失去 1 点；两人局累计 2 点" },
    6: { name: "冰块", description: "左邻失去 1 点" },
    7: { name: "火球", description: "右邻失去 1 点" },
    8: { name: "药水", description: "自己恢复 1 点生命" }
  }
};

export const activeContent = ref<ContentPack>(structuredClone(DEFAULT_CONTENT));

export async function loadContentPack(fetcher: typeof fetch = fetch): Promise<ContentPack> {
  let content = structuredClone(DEFAULT_CONTENT);
  try {
    const response = await fetcher("/content/manifest.json", { cache: "no-store" });
    if (response.ok) content = mergeContentPack(await response.json());
  } catch {
    // 内容包是可选项；缺失或损坏时继续使用通用回退内容。
  }
  activeContent.value = content;
  return content;
}

export function mergeContentPack(input: unknown): ContentPack {
  const result = structuredClone(DEFAULT_CONTENT);
  if (!isRecord(input)) return result;
  if (isNonEmptyString(input.title)) result.title = input.title.trim();
  if (isSafeAssetUrl(input.boardImageUrl)) result.boardImageUrl = input.boardImageUrl;
  if (isSafeAssetUrl(input.logoImageUrl)) result.logoImageUrl = input.logoImageUrl;
  if (isSafeAssetUrl(input.cardBackImageUrl)) result.cardBackImageUrl = input.cardBackImageUrl;

  if (isRecord(input.characters)) {
    for (const characterId of ["red", "blue", "green", "purple"] as const) {
      result.characters[characterId] = mergeItem(
        result.characters[characterId],
        input.characters[characterId]
      );
    }
  }
  if (isRecord(input.spells)) {
    for (let spellId = 1; spellId <= 8; spellId += 1) {
      result.spells[spellId] = mergeItem(result.spells[spellId]!, input.spells[String(spellId)]);
    }
  }
  return result;
}

function mergeItem(base: ContentItem, input: unknown): ContentItem {
  if (!isRecord(input)) return base;
  const next = { ...base };
  if (isNonEmptyString(input.name)) next.name = input.name.trim();
  if (isSafeAssetUrl(input.imageUrl)) next.imageUrl = input.imageUrl;
  if (isNonEmptyString(input.symbol)) next.symbol = input.symbol.trim();
  if (isNonEmptyString(input.description)) next.description = input.description.trim();
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeAssetUrl(value: unknown): value is string {
  return isNonEmptyString(value) && (value.startsWith("/") || value.startsWith("https://"));
}
