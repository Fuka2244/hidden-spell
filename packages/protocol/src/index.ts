export type CharacterId = "red" | "blue" | "green" | "purple";

export type ClientCommand =
  | { commandId: string; type: "SET_READY"; payload: { ready: boolean } }
  | { commandId: string; type: "SELECT_CHARACTER"; payload: { characterId: CharacterId } }
  | { commandId: string; type: "START_GAME" }
  | { commandId: string; type: "CAST_SPELL"; payload: { spellId: number } }
  | { commandId: string; type: "CHOOSE_SECRET"; payload: { secretIndex: number } }
  | { commandId: string; type: "END_TURN" }
  | { commandId: string; type: "NEXT_ROUND" }
  | { commandId: string; type: "LEAVE_ROOM" }
  | { commandId: string; type: "SYNC" };

export type ServerMessage<TView = unknown> =
  | { type: "STATE"; sequence: number; payload: TView }
  | { type: "ACK"; commandId: string; sequence: number }
  | { type: "ERROR"; commandId?: string; code: string; message: string };

export class ProtocolError extends Error {
  constructor(public readonly code: "INVALID_JSON" | "INVALID_COMMAND" | "UNKNOWN_COMMAND") {
    super(code === "INVALID_JSON" ? "消息不是合法 JSON" : "消息格式无效");
    this.name = "ProtocolError";
  }
}

export function parseClientCommand(raw: string): ClientCommand {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ProtocolError("INVALID_JSON");
  }
  if (!isRecord(value) || !isNonEmptyString(value.commandId) || !isNonEmptyString(value.type)) {
    throw new ProtocolError("INVALID_COMMAND");
  }
  const base = { commandId: value.commandId };
  switch (value.type) {
    case "SELECT_CHARACTER": {
      if (
        !isRecord(value.payload) ||
        !isCharacterId(value.payload.characterId)
      ) {
        throw new ProtocolError("INVALID_COMMAND");
      }
      return {
        ...base,
        type: "SELECT_CHARACTER",
        payload: { characterId: value.payload.characterId }
      };
    }
    case "SET_READY": {
      if (!isRecord(value.payload) || typeof value.payload.ready !== "boolean") {
        throw new ProtocolError("INVALID_COMMAND");
      }
      return { ...base, type: "SET_READY", payload: { ready: value.payload.ready } };
    }
    case "CAST_SPELL": {
      if (
        !isRecord(value.payload) ||
        !Number.isInteger(value.payload.spellId) ||
        (value.payload.spellId as number) < 1 ||
        (value.payload.spellId as number) > 8
      ) {
        throw new ProtocolError("INVALID_COMMAND");
      }
      return { ...base, type: "CAST_SPELL", payload: { spellId: value.payload.spellId as number } };
    }
    case "CHOOSE_SECRET": {
      if (
        !isRecord(value.payload) ||
        !Number.isInteger(value.payload.secretIndex) ||
        (value.payload.secretIndex as number) < 0 ||
        (value.payload.secretIndex as number) > 3
      ) {
        throw new ProtocolError("INVALID_COMMAND");
      }
      return {
        ...base,
        type: "CHOOSE_SECRET",
        payload: { secretIndex: value.payload.secretIndex as number }
      };
    }
    case "START_GAME":
    case "END_TURN":
    case "NEXT_ROUND":
    case "LEAVE_ROOM":
    case "SYNC":
      return { ...base, type: value.type };
    default:
      throw new ProtocolError("UNKNOWN_COMMAND");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCharacterId(value: unknown): value is CharacterId {
  return value === "red" || value === "blue" || value === "green" || value === "purple";
}
