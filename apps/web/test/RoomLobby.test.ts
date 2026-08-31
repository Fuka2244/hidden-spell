import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import RoomLobby from "../src/components/RoomLobby.vue";
import { activeContent, DEFAULT_CONTENT, mergeContentPack } from "../src/content";
import type { RoomView } from "../src/types";

describe("RoomLobby 角色选择", () => {
  test("玩家可选择空闲角色且不能选择他人已占用的角色", async () => {
    const wrapper = mount(RoomLobby, { props: { view: lobbyView(), busy: false } });

    expect(wrapper.get('[data-test="character-blue"]').attributes("disabled")).toBeDefined();
    await wrapper.get('[data-test="character-green"]').trigger("click");

    expect(wrapper.emitted("select-character")).toEqual([["green"]]);
  });

  test("角色选择会使用私有内容包中的名称", () => {
    activeContent.value = mergeContentPack({ characters: { green: { name: "森林贤者" } } });
    const wrapper = mount(RoomLobby, { props: { view: lobbyView(), busy: false } });

    expect(wrapper.get('[data-test="character-green"]').text()).toContain("森林贤者");

    activeContent.value = structuredClone(DEFAULT_CONTENT);
  });
});

function lobbyView(): RoomView {
  return {
    roomId: "123456",
    ownerId: "p1",
    viewerId: "p1",
    status: "WAITING",
    serverTime: 1_000,
    players: [
      { playerId: "p1", nickname: "一号", ready: false, connected: true, characterId: "red" },
      { playerId: "p2", nickname: "二号", ready: false, connected: true, characterId: "blue" }
    ]
  } as RoomView;
}
