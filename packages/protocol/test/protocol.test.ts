import { describe, expect, test } from "vitest";
import { parseClientCommand, ProtocolError } from "../src/index.js";

describe("parseClientCommand", () => {
  test("解析准备命令并只保留协议字段", () => {
    expect(parseClientCommand(JSON.stringify({
      commandId: "cmd-1",
      type: "SET_READY",
      payload: { ready: true, ignored: "value" }
    }))).toEqual({
      commandId: "cmd-1",
      type: "SET_READY",
      payload: { ready: true }
    });
  });

  test("解析四个角色之一的选择命令", () => {
    expect(parseClientCommand(JSON.stringify({
      commandId: "character-1",
      type: "SELECT_CHARACTER",
      payload: { characterId: "green" }
    }))).toEqual({
      commandId: "character-1",
      type: "SELECT_CHARACTER",
      payload: { characterId: "green" }
    });
  });

  test("拒绝不存在的角色", () => {
    expectProtocolError(() => parseClientCommand(JSON.stringify({
      commandId: "character-2",
      type: "SELECT_CHARACTER",
      payload: { characterId: "black" }
    })), "INVALID_COMMAND");
  });

  test("拒绝没有 commandId 的命令", () => {
    expectProtocolError(
      () => parseClientCommand('{"type":"START_GAME"}'),
      "INVALID_COMMAND"
    );
  });

  test("拒绝未知命令类型", () => {
    expectProtocolError(
      () => parseClientCommand('{"commandId":"cmd-2","type":"CHEAT"}'),
      "UNKNOWN_COMMAND"
    );
  });

  test("拒绝损坏的 JSON", () => {
    expectProtocolError(() => parseClientCommand("{"), "INVALID_JSON");
  });

  test("解析一至八号施法命令", () => {
    expect(parseClientCommand(JSON.stringify({
      commandId: "cast-1",
      type: "CAST_SPELL",
      payload: { spellId: 6 }
    }))).toEqual({ commandId: "cast-1", type: "CAST_SPELL", payload: { spellId: 6 } });
  });

  test("拒绝范围外的咒语编号", () => {
    expectProtocolError(() => parseClientCommand(JSON.stringify({
      commandId: "cast-9",
      type: "CAST_SPELL",
      payload: { spellId: 9 }
    })), "INVALID_COMMAND");
  });

  test.each(["END_TURN", "NEXT_ROUND"])("解析 %s 命令", (type) => {
    expect(parseClientCommand(JSON.stringify({ commandId: `cmd-${type}`, type }))).toEqual({
      commandId: `cmd-${type}`,
      type
    });
  });

  test("解析秘密咒语位置选择", () => {
    expect(parseClientCommand(JSON.stringify({
      commandId: "secret-1",
      type: "CHOOSE_SECRET",
      payload: { secretIndex: 2 }
    }))).toEqual({
      commandId: "secret-1",
      type: "CHOOSE_SECRET",
      payload: { secretIndex: 2 }
    });
  });

  test("拒绝四个位置以外的秘密咒语选择", () => {
    expectProtocolError(() => parseClientCommand(JSON.stringify({
      commandId: "secret-5",
      type: "CHOOSE_SECRET",
      payload: { secretIndex: 4 }
    })), "INVALID_COMMAND");
  });
});

function expectProtocolError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`预期抛出协议错误 ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolError);
    expect(error).toMatchObject({ code });
  }
}
