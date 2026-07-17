// Typed multiplayer room client for games on Metaloot hosting.
//
// Protocol-compatible with the zero-install client Metaloot hosting serves at
// /__metaloot/multiplayer.js (client protocol v1): the same wire frames, the
// same events, the same reconnect behavior — plus TypeScript types. Rooms
// live at wss://<slug>.metaloot.app/mp/rooms/<roomId> on the game's own
// origin, and the player's Metaloot session cookie authenticates the
// WebSocket, so this only works in the browser on the deployed game's origin.
//
// Limits (enforced server-side): 32 connections per room, 32 KB per message,
// up to 256 room-state keys; room state is cleared when the last player
// leaves. Messages are JSON.

import { getSession } from "./auth.js";
import type { AuthOptions } from "./auth.js";

/** Wire-protocol version this client implements. */
export const MULTIPLAYER_PROTOCOL_VERSION = "1";

const PING_INTERVAL_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 6;
const ROOM_ID_PATTERN = /^[A-Za-z0-9_.~-]{1,64}$/;

/** One connection in a room. A player with two tabs appears twice. */
export type RoomPlayer = {
  /** Unique per WebSocket connection. */
  connectionId: string;
  /** Stable Metaloot user id. */
  id: string;
  name?: string;
  imageUrl?: string;
};

export type RoomState = Record<string, unknown>;

export type RoomMessage = { from: RoomPlayer; data: unknown };
export type RoomStateUpdate = { key: string; value: unknown; from: RoomPlayer };
export type RoomResync = { players: RoomPlayer[]; state: RoomState };
export type RoomCloseEvent = { code: number; reason: string };
export type RoomError = { type: "error"; code: string };

export type RoomEventMap = {
  join: RoomPlayer;
  leave: RoomPlayer;
  message: RoomMessage;
  state: RoomStateUpdate;
  reconnect: RoomResync;
  close: RoomCloseEvent;
  error: RoomError;
};

type ServerFrame =
  | { type: "welcome"; room: string; self: RoomPlayer; players: RoomPlayer[]; state: RoomState }
  | { type: "join"; player: RoomPlayer }
  | { type: "leave"; player: RoomPlayer }
  | { type: "msg"; from: RoomPlayer; data: unknown }
  | { type: "state"; key: string; value: unknown; from: RoomPlayer }
  | { type: "pong" }
  | { type: "error"; code: string };

type ClientFrame =
  | { type: "msg"; data: unknown; to?: string }
  | { type: "state"; key: string; value: unknown };

/** Thrown by joinRoom when the player is not signed in with Metaloot. */
export class MetalootAuthRequiredError extends Error {
  signIn: () => void;

  constructor(options: JoinRoomOptions = {}) {
    super(
      "Metaloot multiplayer requires the player to be signed in. Call error.signIn() or send the player to /auth/metaloot/start."
    );
    this.name = "MetalootAuthRequiredError";
    this.signIn = () => {
      window.location.href = `${(options.authBasePath ?? "/auth/metaloot").replace(/\/+$/, "")}/start`;
    };
  }
}

export type JoinRoomOptions = {
  /**
   * Path prefix of the game's Metaloot auth endpoints, used for the session
   * check and MetalootAuthRequiredError.signIn(). @default "/auth/metaloot"
   */
  authBasePath?: string;
  /** Custom fetch for the session check. @default globalThis.fetch */
  fetch?: AuthOptions["fetch"];
};

/**
 * Joins a multiplayer room on the current origin. Room ids are 1-64 chars of
 * letters, digits, `- _ . ~`. Throws MetalootAuthRequiredError when the
 * player is signed out.
 */
export async function joinRoom(
  roomId = "lobby",
  options: JoinRoomOptions = {}
): Promise<Room> {
  if (!ROOM_ID_PATTERN.test(roomId)) {
    throw new Error("Room ids are 1-64 chars of letters, digits, - _ . ~");
  }

  const session = await getSession({
    basePath: options.authBasePath,
    fetch: options.fetch,
  });
  if (!session.signedIn) throw new MetalootAuthRequiredError(options);

  const room = new Room(roomId);
  await room.connect();
  return room;
}

/**
 * A live room connection. Mirrors the zero-install client at
 * /__metaloot/multiplayer.js: `self`, `players`, `state`, `on(event)`,
 * `send`, `setState`, `leave`, with automatic reconnect.
 */
export class Room {
  readonly id: string;
  /** This connection's own player entry (set after the welcome frame). */
  self: RoomPlayer | null = null;
  /** The room's shared key-value state, kept in sync by the server. */
  state: RoomState = {};

  private playersById = new Map<string, RoomPlayer>();
  private listeners = new Map<keyof RoomEventMap, Set<(payload: never) => void>>();
  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private reconnectAttempt = 0;

  constructor(roomId: string) {
    this.id = roomId;
  }

  /** The other connections currently in the room (excludes `self`). */
  get players(): RoomPlayer[] {
    return [...this.playersById.values()];
  }

  /** Events: join, leave, message, state, reconnect, close, error. Returns an unsubscribe function. */
  on<E extends keyof RoomEventMap>(
    event: E,
    handler: (payload: RoomEventMap[E]) => void
  ): () => void {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    handlers.add(handler as (payload: never) => void);
    return () => {
      this.listeners.get(event)?.delete(handler as (payload: never) => void);
    };
  }

  /**
   * Relay data (any JSON value, ≤ 32 KB) to every other player, or — with
   * `to` — only to connections matching that player id or connection id.
   */
  send(data: unknown, to?: string): void {
    this.sendFrame(to === undefined ? { type: "msg", data } : { type: "msg", data, to });
  }

  /**
   * Set (or delete, with null) a key in the room's shared state. The server
   * echoes the update back in a single authoritative order; `this.state` and
   * the "state" event update from that echo.
   */
  setState(key: string, value: unknown): void {
    this.sendFrame({ type: "state", key, value: value ?? null });
  }

  /** Leaves the room and stops reconnecting. */
  leave(): void {
    this.closed = true;
    this.stopPing();
    if (this.socket) this.socket.close(1000, "leave");
  }

  private emit<E extends keyof RoomEventMap>(event: E, payload: RoomEventMap[E]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        (handler as (value: RoomEventMap[E]) => void)(payload);
      }
    }
  }

  private sendFrame(frame: ClientFrame): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to the room (it may be reconnecting).");
    }
    this.socket.send(JSON.stringify(frame));
  }

  /** @internal */
  connect(): Promise<Room> {
    return new Promise((resolve, reject) => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(
        `${scheme}://${window.location.host}/mp/rooms/${encodeURIComponent(this.id)}`
      );
      this.socket = socket;
      let settled = false;

      socket.addEventListener("message", (event) => {
        let message: ServerFrame;
        try {
          message = JSON.parse(String(event.data)) as ServerFrame;
        } catch {
          return;
        }

        if (message.type === "welcome") {
          const reconnected = this.self !== null;
          this.self = message.self;
          this.state = message.state || {};
          this.playersById = new Map(
            message.players.map((player) => [player.connectionId, player])
          );
          this.reconnectAttempt = 0;
          this.startPing();
          if (!settled) {
            settled = true;
            resolve(this);
          }
          if (reconnected) {
            this.emit("reconnect", { players: this.players, state: this.state });
          }
        } else if (message.type === "join") {
          this.playersById.set(message.player.connectionId, message.player);
          this.emit("join", message.player);
        } else if (message.type === "leave") {
          this.playersById.delete(message.player.connectionId);
          this.emit("leave", message.player);
        } else if (message.type === "msg") {
          this.emit("message", { from: message.from, data: message.data });
        } else if (message.type === "state") {
          if (message.value === null) delete this.state[message.key];
          else this.state[message.key] = message.value;
          this.emit("state", {
            key: message.key,
            value: message.value,
            from: message.from,
          });
        } else if (message.type === "error") {
          this.emit("error", { type: "error", code: message.code });
        }
      });

      socket.addEventListener("close", (event) => {
        this.stopPing();
        if (this.closed || event.code === 1000) {
          this.emit("close", { code: event.code, reason: event.reason });
          if (!settled) {
            settled = true;
            reject(new Error(`Room connection closed: ${event.reason || event.code}`));
          }
          return;
        }
        if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
          this.emit("close", { code: event.code, reason: "reconnect_failed" });
          if (!settled) {
            settled = true;
            reject(new Error("Could not connect to the room."));
          }
          return;
        }
        const delay =
          Math.min(500 * 2 ** this.reconnectAttempt, 8000) * (0.5 + Math.random());
        this.reconnectAttempt += 1;
        setTimeout(() => {
          if (!this.closed) this.connect().catch(() => {});
        }, delay);
      });
    });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send('{"type":"ping"}');
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
