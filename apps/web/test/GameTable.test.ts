import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import GameTable from "../src/components/GameTable.vue";
import { activeContent, DEFAULT_CONTENT, mergeContentPack } from "../src/content";
import type { RoomView } from "../src/types";
import "../src/style.css";

describe("GameTable 施法操作", () => {
  test("手牌数量变化时每张牌框都保持固定宽度", () => {
    const view = gameView();
    if (!view.game) throw new Error("测试视图没有游戏状态");
    view.game.players[0]!.cards = Array.from({ length: 6 }, () => ({ hidden: true }));
    const wrapper = mount(GameTable, { props: { view }, attachTo: document.body });

    const cardStyle = getComputedStyle(wrapper.get(".spell-card").element);

    expect(cardStyle.width).toBe("58px");
    expect(cardStyle.flexBasis).toBe("58px");
    expect(cardStyle.flexShrink).toBe("0");
    wrapper.unmount();
  });

  test("出牌后手牌行保留五张牌的固定区域且剩余牌不重新居中", () => {
    const wrapper = mount(GameTable, { props: { view: gameView() }, attachTo: document.body });

    const handStyle = getComputedStyle(wrapper.get(".cards").element);

    expect(handStyle.width).toBe("326px");
    expect(handStyle.justifyContent).toBe("flex-start");
    wrapper.unmount();
  });

  test("轮到自己时可从一至八号咒语中声明一个", async () => {
    const wrapper = mount(GameTable, { props: { view: gameView() } });

    await wrapper.get('[data-test="cast-6"]').trigger("click");

    expect(wrapper.emitted("cast")).toEqual([[6]]);
    expect(wrapper.findAll('[data-test^="cast-"]')).toHaveLength(8);
  });

  test("猜牌操作显示在公开对局记录上方", () => {
    const wrapper = mount(GameTable, { props: { view: gameView() } });
    const controls = wrapper.get(".spell-controls").element;
    const publicLog = wrapper.get('[data-test="game-log"]').element;

    expect(controls.compareDocumentPosition(publicLog) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  test("咒语按钮会使用私有内容包中的名称", () => {
    activeContent.value = mergeContentPack({ spells: { 6: { name: "寒冰原名" } } });
    const wrapper = mount(GameTable, { props: { view: gameView() } });

    expect(wrapper.get('[data-test="cast-6"]').text()).toContain("寒冰原名");

    activeContent.value = structuredClone(DEFAULT_CONTENT);
  });

  test("连续施法时禁用小于上一次成功编号的咒语", () => {
    const wrapper = mount(GameTable, {
      props: { view: gameView({ phase: "MAY_CONTINUE", lastSpellId: 5 }) }
    });

    expect(wrapper.get('[data-test="cast-4"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-test="cast-5"]').attributes("disabled")).toBeUndefined();
  });

  test("成功施法后可以结束回合", async () => {
    const wrapper = mount(GameTable, {
      props: { view: gameView({ phase: "MAY_CONTINUE", lastSpellId: 2 }) }
    });

    await wrapper.get('[data-test="end-turn"]').trigger("click");

    expect(wrapper.emitted("end-turn")).toHaveLength(1);
  });

  test("本轮结束时只有房主看到开始下一轮按钮", async () => {
    const wrapper = mount(GameTable, {
      props: { view: gameView({
        phase: "ROUND_END",
        roundWinnerId: "p1",
        roundScoreGains: { p1: 3, p2: 0 }
      }) }
    });

    await wrapper.get('[data-test="next-round"]').trigger("click");

    expect(wrapper.emitted("next-round")).toHaveLength(1);
    expect(wrapper.get('[data-test="score-gain-p1"]').text()).toContain("+3");
  });

  test("猫头鹰成功后从剩余秘密咒语位置中选择一枚", async () => {
    const wrapper = mount(GameTable, {
      props: { view: gameView({ phase: "CHOOSING_SECRET", secretSpellPoolCount: 4, lastSpellId: 4 }) }
    });

    await wrapper.get('[data-test="secret-2"]').trigger("click");

    expect(wrapper.findAll('[data-test^="secret-"]')).toHaveLength(4);
    expect(wrapper.emitted("choose-secret")).toEqual([[2]]);
  });

  test("其他玩家不能操作猫头鹰的秘密咒语选择", () => {
    const view = gameView({ phase: "CHOOSING_SECRET", secretSpellPoolCount: 4, lastSpellId: 4 });
    view.viewerId = "p2";
    const wrapper = mount(GameTable, { props: { view } });

    expect(wrapper.findAll('[data-test^="secret-"]')).toHaveLength(0);
    expect(wrapper.text()).toContain("等待一号选择秘密咒语");
  });

  test("本人可以看见通过猫头鹰取得的秘密咒语", () => {
    const view = gameView();
    if (!view.game) throw new Error("测试视图没有游戏状态");
    view.game.players[0]!.cards = [
      { hidden: true },
      { hidden: false, spellId: 6, secret: true }
    ];
    const wrapper = mount(GameTable, { props: { view } });

    expect(wrapper.get(".spell-card.secret").text()).toBe("6");
    expect(wrapper.get(".spell-card.secret").attributes("title")).toBe("秘密咒语，仅供查看与计分，不能施放");
  });

  test("内容包牌背用于隐藏手牌和秘密牌选择", () => {
    activeContent.value = mergeContentPack({ cardBackImageUrl: "/content/card-back.png" });
    const wrapper = mount(GameTable, {
      props: { view: gameView({ phase: "CHOOSING_SECRET" }) }
    });

    expect(wrapper.get(".spell-card.hidden").attributes("style")).toContain("/content/card-back.png");
    expect(wrapper.get('[data-test="secret-0"]').attributes("style")).toContain("/content/card-back.png");
    expect(wrapper.get(".spell-card.hidden").text()).toBe("");
    expect(wrapper.get('[data-test="secret-0"]').text()).toBe("");

    activeContent.value = structuredClone(DEFAULT_CONTENT);
  });

  test("正式牌面图片上不重复叠加数字", () => {
    activeContent.value = mergeContentPack({
      spells: { 1: { name: "龙", imageUrl: "/content/spells/1.png" } }
    });
    const wrapper = mount(GameTable, { props: { view: gameView() } });

    expect(wrapper.get(".spell-card:not(.hidden)").text()).toBe("");

    activeContent.value = structuredClone(DEFAULT_CONTENT);
  });

  test("游戏席位显示内容包中的角色头像", () => {
    activeContent.value = mergeContentPack({
      characters: { red: { name: "角色一", imageUrl: "/content/characters/red.png" } }
    });
    const wrapper = mount(GameTable, { props: { view: gameView() } });

    expect(wrapper.get(".mini-avatar img").attributes("src")).toBe("/content/characters/red.png");

    activeContent.value = structuredClone(DEFAULT_CONTENT);
  });

  test("已打出的咒语石按编号摆到图板对应区域", () => {
    activeContent.value = mergeContentPack({
      spells: { 3: { name: "独角兽", imageUrl: "/content/spells/3.png" } }
    });
    const wrapper = mount(GameTable, {
      props: { view: gameView({ discardPile: [1, 3, 3, 8] }) }
    });

    expect(wrapper.findAll('[data-test^="board-lane-"]')).toHaveLength(8);
    expect(wrapper.findAll(".board-lane-label")).toHaveLength(0);
    expect(wrapper.get('[data-test="board-lane-1"]').findAll(".board-stone")).toHaveLength(1);
    expect(wrapper.get('[data-test="board-lane-3"]').findAll(".board-stone")).toHaveLength(2);
    expect(wrapper.get('[data-test="board-lane-8"]').findAll(".board-stone")).toHaveLength(1);
    expect(wrapper.get('[data-test="board-lane-6"]').findAll(".board-stone")).toHaveLength(0);
    expect(wrapper.get('[data-test="board-lane-3"] .board-stone').attributes("style")).toContain("/content/spells/3.png");
    expect(wrapper.get('[data-test="board-lane-3"] .board-stone').text()).toBe("");

    activeContent.value = structuredClone(DEFAULT_CONTENT);
  });

  test("魔法师计分标记移动到图板底部对应分数", () => {
    const view = gameView();
    if (!view.game) throw new Error("测试视图没有游戏状态");
    view.game.players[0]!.score = 3;
    view.game.players[1]!.score = 7;
    const wrapper = mount(GameTable, { props: { view } });

    expect(wrapper.get('[data-test="score-marker-p1"]').attributes("data-score")).toBe("3");
    expect(wrapper.get('[data-test="score-marker-p1"]').attributes("style")).toContain("left: 53.8%");
    expect(wrapper.get('[data-test="score-marker-p2"]').attributes("data-score")).toBe("7");
    expect(wrapper.get('[data-test="score-marker-p2"]').attributes("style")).toContain("left: 86.7%");
  });

  test("整局结束时展示所有并列达到八分的玩家", () => {
    const game = {
      phase: "GAME_END" as const,
      winnerIds: ["p1", "p2"]
    } as Partial<NonNullable<RoomView["game"]>> & { winnerIds: string[] };

    const wrapper = mount(GameTable, { props: { view: gameView(game) } });

    expect(wrapper.get(".round-result h2").text()).toBe("一号、二号达到 8 分并列获胜");
  });

  test("对局记录用文字显示公开的施法与生命变化", () => {
    const wrapper = mount(GameTable, { props: { view: gameView({
      events: [{
        sequence: 2,
        type: "CAST",
        actorId: "p1",
        spellId: 6,
        success: true,
        hpChanges: [{ playerId: "p2", delta: -1 }]
      }]
    }) } });

    expect(wrapper.get('[data-test="game-log"]').text()).toContain("一号成功施放 6号冰块");
    expect(wrapper.get('[data-test="game-log"]').text()).toContain("二号失去 1 点生命");
  });
});

function gameView(gameOverrides: Partial<NonNullable<RoomView["game"]>> = {}): RoomView {
  return {
    roomId: "123456",
    ownerId: "p1",
    viewerId: "p1",
    status: "PLAYING",
    serverTime: 1_000,
    players: [
      { playerId: "p1", nickname: "一号", ready: true, connected: true, characterId: "red" },
      { playerId: "p2", nickname: "二号", ready: true, connected: true, characterId: "blue" }
    ],
    game: {
      phase: "WAITING_CAST",
      currentPlayerId: "p1",
      sequence: 1,
      round: 1,
      deckCount: 10,
      discardPile: [],
      secretSpellPoolCount: 4,
      events: [],
      players: [
        { playerId: "p1", nickname: "一号", characterId: "red", connected: true, hp: 4, alive: true, score: 0, secretSpellCount: 0, cards: [{ hidden: true }] },
        { playerId: "p2", nickname: "二号", characterId: "blue", connected: true, hp: 4, alive: true, score: 0, secretSpellCount: 0, cards: [{ hidden: false, spellId: 1 }] }
      ],
      ...gameOverrides
    }
  };
}
