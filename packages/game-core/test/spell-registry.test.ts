import { describe, expect, test } from "vitest";
import { SpellRegistry, type SpellEffect } from "../src/spell-registry.js";

describe("SpellRegistry", () => {
  test("按照 spellId 调用对应策略而不让调用方判断牌号", () => {
    const effect: SpellEffect<{ hp: number }> = {
      spellId: 2,
      execute: (context) => ({ hp: context.hp + 1 })
    };
    const registry = new SpellRegistry([effect]);

    expect(registry.execute(2, { hp: 3 })).toEqual({ hp: 4 });
  });

  test("拒绝重复注册同一牌号", () => {
    const first: SpellEffect<number> = { spellId: 1, execute: (value) => value + 1 };
    const second: SpellEffect<number> = { spellId: 1, execute: (value) => value + 2 };

    expect(() => new SpellRegistry([first, second])).toThrow(/重复/);
  });

  test("拒绝执行尚未导入规则的牌号", () => {
    const registry = new SpellRegistry<number>([]);

    expect(() => registry.execute(8, 1)).toThrow(/尚未导入/);
  });
});
