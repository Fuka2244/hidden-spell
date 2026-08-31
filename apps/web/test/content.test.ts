import { describe, expect, test } from "vitest";
import { DEFAULT_CONTENT, mergeContentPack } from "../src/content";

describe("私有内容包", () => {
  test("只覆盖清单中提供的名称和素材并保留其他回退内容", () => {
    const content = mergeContentPack({
      title: "朋友魔法局",
      boardImageUrl: "/content/board.png",
      cardBackImageUrl: "/content/card-back.png",
      characters: { red: { name: "赤红角色", imageUrl: "/content/red.png" } },
      spells: { 1: { name: "一号原名", imageUrl: "/content/spell-1.png" } }
    });

    expect(content.title).toBe("朋友魔法局");
    expect(content.boardImageUrl).toBe("/content/board.png");
    expect(content.cardBackImageUrl).toBe("/content/card-back.png");
    expect(content.characters.red).toMatchObject({ name: "赤红角色", imageUrl: "/content/red.png" });
    expect(content.characters.blue).toEqual(DEFAULT_CONTENT.characters.blue);
    expect(content.spells[1]).toMatchObject({ name: "一号原名", imageUrl: "/content/spell-1.png" });
    expect(content.spells[8]).toEqual(DEFAULT_CONTENT.spells[8]);
  });

  test("忽略类型错误的内容包字段", () => {
    const content = mergeContentPack({ title: 42, characters: { red: { name: "" } } });

    expect(content.title).toBe(DEFAULT_CONTENT.title);
    expect(content.characters.red).toEqual(DEFAULT_CONTENT.characters.red);
  });

  test("从约定地址加载内容包并更新当前内容", async () => {
    const module = await import("../src/content");
    const loadContentPack = (module as unknown as {
      loadContentPack: (fetcher: typeof fetch) => Promise<typeof DEFAULT_CONTENT>;
    }).loadContentPack;

    const content = await loadContentPack(async () => Response.json({ title: "完整复刻" }));

    expect(content.title).toBe("完整复刻");
    expect(module.activeContent.value.title).toBe("完整复刻");
  });
});
