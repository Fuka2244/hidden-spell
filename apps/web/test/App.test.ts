import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "../src/App.vue";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("连续连接失败时逐步延长重试间隔", async () => {
    vi.useFakeTimers();
    localStorage.setItem("hidden-spell-session", JSON.stringify({
      roomId: "654321",
      playerId: "retry-player",
      nickname: "重试玩家",
      credential: "retry-secret"
    }));
    let sessionRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/content/manifest.json") return Response.json({});
      if (String(input).startsWith("/api/rooms/654321/session")) {
        sessionRequests += 1;
        return Response.json({ code: "INTERNAL_ERROR" }, { status: 500 });
      }
      throw new Error(`未预期的请求：${String(input)}`);
    }));

    const wrapper = mount(App);
    await flushPromises();
    expect(sessionRequests).toBe(1);

    await vi.advanceTimersByTimeAsync(1_500);
    await flushPromises();
    expect(sessionRequests).toBe(2);

    await vi.advanceTimersByTimeAsync(1_500);
    await flushPromises();
    expect(sessionRequests).toBe(2);

    await vi.advanceTimersByTimeAsync(1_500);
    await flushPromises();
    expect(sessionRequests).toBe(3);
    wrapper.unmount();
  });

  test("使用昵称创建房间后保存身份并进入等待房间", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/content/manifest.json") return new Response(null, { status: 404 });
      if (String(input).startsWith("/api/rooms/123456/session")) {
        return Response.json({ valid: true });
      }
      return new Response(JSON.stringify({
        roomId: "123456",
        playerId: "player-1",
        nickname: "小明",
        credential: "private-secret"
      }), { status: 201, headers: { "content-type": "application/json" } });
    }));
    const wrapper = mount(App);

    await wrapper.get('[data-test="nickname"]').setValue("小明");
    await wrapper.get('[data-test="create-room"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("房间 123456");
    expect(JSON.parse(localStorage.getItem("hidden-spell-session") ?? "null")).toMatchObject({
      playerId: "player-1",
      credential: "private-secret"
    });
  });

  test("旧房间不存在时自动清除匿名身份并返回首页", async () => {
    localStorage.setItem("hidden-spell-session", JSON.stringify({
      roomId: "654321",
      playerId: "old-player",
      nickname: "旧玩家",
      credential: "expired-secret"
    }));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/content/manifest.json") return Response.json({});
      if (String(input).startsWith("/api/rooms/654321/session")) {
        return Response.json({ valid: false, code: "ROOM_NOT_FOUND", message: "房间不存在" });
      }
      throw new Error(`未预期的请求：${String(input)}`);
    }));

    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.text()).toContain("原房间已失效，请重新创建或加入房间");
    expect(wrapper.find('[data-test="create-room"]').exists()).toBe(true);
    expect(localStorage.getItem("hidden-spell-session")).toBeNull();
  });
});

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  readonly readyState = FakeWebSocket.OPEN;
  constructor(readonly url: string) {
    super();
  }
  send(): void {}
  close(): void {}
}
