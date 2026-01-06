/* Modu Engine - Built: 2026-01-06T19:52:19.575Z - Commit: 269bb17 */
// Modu Engine + Network SDK Combined Bundle
"use strict";
var moduNetwork = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/modu-network.ts
  var modu_network_exports = {};
  __export(modu_network_exports, {
    connect: () => connect,
    decodeBinaryMessage: () => decodeBinaryMessage,
    encodeSyncHash: () => encodeSyncHash,
    getRandomRoom: () => getRandomRoom,
    hashClientId: () => hashClientId,
    listRooms: () => listRooms,
    modd: () => modd,
    registerClientId: () => registerClientId,
    unregisterClientId: () => unregisterClientId
  });

  // src/auth.ts
  var TOKEN_KEY = "modd_auth_token";
  var RETURN_URL_KEY = "modd_auth_return_url";
  var AuthModule = class {
    constructor() {
      this.appId = null;
      this.centralServiceUrl = "https://nodes.modd.io";
      this.debug = false;
      this.initialized = false;
      this.successCallbacks = [];
      this.errorCallbacks = [];
      this.stateChangeCallbacks = [];
      this.currentUser = null;
      this.pendingAuthCode = null;
      this.pendingAuthError = null;
    }
    /**
     * Initialize the auth module
     */
    init(options) {
      this.appId = options.appId;
      this.debug = options.debug || false;
      if (options.centralServiceUrl) {
        this.centralServiceUrl = options.centralServiceUrl;
      } else if (typeof window !== "undefined") {
        const hostname = window.location.hostname;
        if (hostname === "localhost" || hostname === "127.0.0.1") {
          this.centralServiceUrl = "http://localhost:9001";
        }
      }
      this.initialized = true;
      this.log("Auth module initialized", { appId: this.appId, centralServiceUrl: this.centralServiceUrl });
      this.handleAuthCallback();
      this.checkExistingSession();
    }
    /**
     * Start the login flow
     */
    login(options) {
      this.ensureInitialized();
      const provider = options?.provider;
      const returnUrl = typeof window !== "undefined" ? window.location.href : "/";
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(RETURN_URL_KEY, returnUrl);
      }
      const params = new URLSearchParams({
        appId: this.appId,
        returnUrl
      });
      let authUrl;
      if (provider) {
        authUrl = `${this.centralServiceUrl}/auth/${provider}?${params}`;
      } else {
        authUrl = `${this.centralServiceUrl}/auth/select?${params}`;
      }
      this.log("Starting login flow", { provider, authUrl });
      if (typeof window !== "undefined") {
        window.location.href = authUrl;
      }
    }
    /**
     * Logout the current user
     */
    async logout() {
      this.ensureInitialized();
      const token = this.getStoredToken();
      if (token) {
        try {
          await fetch(`${this.centralServiceUrl}/auth/logout`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`
            }
          });
        } catch (err) {
          this.log("Logout API call failed (continuing anyway)", err);
        }
      }
      this.clearStoredToken();
      this.currentUser = null;
      this.notifyStateChange(null);
      this.log("User logged out");
    }
    /**
     * Get the current user
     */
    async getUser() {
      this.ensureInitialized();
      if (this.currentUser) {
        return this.currentUser;
      }
      const token = this.getStoredToken();
      if (!token) {
        return null;
      }
      try {
        const response = await fetch(`${this.centralServiceUrl}/auth/whoami`, {
          headers: {
            "Authorization": `Bearer ${token}`
          }
        });
        if (!response.ok) {
          this.clearStoredToken();
          return null;
        }
        const data = await response.json();
        this.currentUser = data.user;
        return this.currentUser;
      } catch (err) {
        this.log("Failed to get user", err);
        return null;
      }
    }
    /**
     * Delete the user's account
     */
    async deleteAccount() {
      this.ensureInitialized();
      const token = this.getStoredToken();
      if (!token) {
        throw new Error("Not logged in");
      }
      const response = await fetch(`${this.centralServiceUrl}/auth/account`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to delete account" }));
        throw new Error(error.error);
      }
      this.clearStoredToken();
      this.currentUser = null;
      this.notifyStateChange(null);
      this.log("Account deleted");
    }
    /**
     * Register callback for successful auth
     */
    onSuccess(callback) {
      this.successCallbacks.push(callback);
      if (this.pendingAuthCode) {
        const code = this.pendingAuthCode;
        this.pendingAuthCode = null;
        callback(code);
      }
      return () => {
        const idx = this.successCallbacks.indexOf(callback);
        if (idx !== -1) this.successCallbacks.splice(idx, 1);
      };
    }
    /**
     * Register callback for auth errors
     */
    onError(callback) {
      this.errorCallbacks.push(callback);
      if (this.pendingAuthError) {
        const error = this.pendingAuthError;
        this.pendingAuthError = null;
        callback(error);
      }
      return () => {
        const idx = this.errorCallbacks.indexOf(callback);
        if (idx !== -1) this.errorCallbacks.splice(idx, 1);
      };
    }
    /**
     * Register callback for auth state changes
     */
    onAuthStateChange(callback) {
      this.stateChangeCallbacks.push(callback);
      callback(this.currentUser);
      return () => {
        const idx = this.stateChangeCallbacks.indexOf(callback);
        if (idx !== -1) this.stateChangeCallbacks.splice(idx, 1);
      };
    }
    /**
     * Get the stored session token (for backend calls)
     */
    getToken() {
      return this.getStoredToken();
    }
    /**
     * Set a session token (received from backend after code exchange)
     */
    setToken(token) {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(TOKEN_KEY, token);
      }
      this.checkExistingSession();
    }
    // Private methods
    ensureInitialized() {
      if (!this.initialized || !this.appId) {
        throw new Error("Auth module not initialized. Call moddNetwork.auth.init() first.");
      }
    }
    async handleAuthCallback() {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");
      if (error) {
        this.log("Auth error received", { error, errorDescription });
        url.searchParams.delete("error");
        url.searchParams.delete("error_description");
        window.history.replaceState({}, "", url.toString());
        this.pendingAuthError = {
          code: error,
          message: errorDescription || error
        };
        this.errorCallbacks.forEach((cb) => cb(this.pendingAuthError));
        return;
      }
      if (code) {
        this.log("Auth code received", { code: code.substring(0, 20) + "..." });
        url.searchParams.delete("code");
        window.history.replaceState({}, "", url.toString());
        try {
          const response = await fetch(`${this.centralServiceUrl}/auth/exchange`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code })
          });
          if (response.ok) {
            const { token } = await response.json();
            if (token) {
              if (typeof localStorage !== "undefined") {
                localStorage.setItem(TOKEN_KEY, token);
              }
              this.log("Session token stored");
            }
          } else {
            this.log("Failed to exchange auth code for session token");
          }
        } catch (err) {
          this.log("Error exchanging auth code:", err);
        }
        this.pendingAuthCode = code;
        this.successCallbacks.forEach((cb) => cb(code));
      }
    }
    async checkExistingSession() {
      const user = await this.getUser();
      if (user) {
        this.notifyStateChange(user);
      } else {
        const hadToken = this.getStoredToken() === null && this.currentUser !== null;
        if (hadToken) {
          this.notifyStateChange(null);
        }
      }
    }
    notifyStateChange(user) {
      this.currentUser = user;
      this.stateChangeCallbacks.forEach((cb) => cb(user));
    }
    getStoredToken() {
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem(TOKEN_KEY);
    }
    clearStoredToken() {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(RETURN_URL_KEY);
      }
    }
    log(...args) {
      if (this.debug) {
        console.log("[modd-auth]", ...args);
      }
    }
  };
  var auth = new AuthModule();
  if (typeof window !== "undefined") {
    window.moddAuth = auth;
  }

  // src/modu-network.ts
  var BinaryMessageType = {
    TICK: 1,
    INITIAL_STATE: 2,
    ROOM_JOINED: 3,
    ROOM_CREATED: 4,
    ERROR: 5,
    SNAPSHOT_UPDATE: 6,
    ROOM_LEFT: 7,
    SYNC_HASH: 8,
    CLIENT_LIST_UPDATE: 9,
    // Client-to-server markers (also used for server broadcast)
    BINARY_INPUT: 32,
    BINARY_SNAPSHOT: 33
  };
  function hashClientId(clientId) {
    let hash = 2166136261;
    for (let i = 0; i < clientId.length; i++) {
      hash ^= clientId.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash;
  }
  var clientHashMap = /* @__PURE__ */ new Map();
  function registerClientId(clientId) {
    const hash = hashClientId(clientId);
    clientHashMap.set(hash, clientId);
  }
  function unregisterClientId(clientId) {
    const hash = hashClientId(clientId);
    clientHashMap.delete(hash);
  }
  function lookupClientHash(hash) {
    return clientHashMap.get(hash);
  }
  function reResolveClientId(input) {
    if (input.clientHash === void 0) return false;
    const resolved = lookupClientHash(input.clientHash);
    if (resolved && input.clientId !== resolved) {
      input.clientId = resolved;
      return true;
    }
    return false;
  }
  function encodeSyncHash(roomId, hash, seq, frame) {
    const roomIdBytes = new TextEncoder().encode(roomId);
    const hashBytes = new TextEncoder().encode(hash);
    const buf = new Uint8Array(1 + 2 + roomIdBytes.length + 2 + hashBytes.length + 4 + 4);
    const view = new DataView(buf.buffer);
    let offset = 0;
    buf[offset++] = BinaryMessageType.SYNC_HASH;
    view.setUint16(offset, roomIdBytes.length, true);
    offset += 2;
    buf.set(roomIdBytes, offset);
    offset += roomIdBytes.length;
    view.setUint16(offset, hashBytes.length, true);
    offset += 2;
    buf.set(hashBytes, offset);
    offset += hashBytes.length;
    view.setUint32(offset, seq, true);
    offset += 4;
    view.setUint32(offset, frame, true);
    return buf;
  }
  function decodeBinaryMessage(buffer) {
    if (buffer.byteLength === 0) return null;
    const view = new DataView(buffer);
    const type = view.getUint8(0);
    try {
      switch (type) {
        case BinaryMessageType.TICK: {
          const frame = view.getUint32(1, true);
          let inputs = [];
          let snapshotFrame;
          let snapshotHash;
          if (buffer.byteLength > 9) {
            snapshotFrame = view.getUint32(5, true);
            const hashLen = view.getUint8(9);
            let offset = 10;
            if (hashLen > 0 && offset + hashLen <= buffer.byteLength) {
              snapshotHash = new TextDecoder().decode(new Uint8Array(buffer, offset, hashLen));
              offset += hashLen;
            }
            if (offset >= buffer.byteLength) {
              return { type: "TICK", frame, snapshotFrame, snapshotHash, inputs, events: inputs };
            }
            const inputCount = view.getUint8(offset);
            offset++;
            for (let i = 0; i < inputCount && offset < buffer.byteLength; i++) {
              const clientHash = view.getUint32(offset, true);
              offset += 4;
              const seq = view.getUint32(offset, true);
              offset += 4;
              const dataLen = view.getUint16(offset, true);
              offset += 2;
              if (offset + dataLen > buffer.byteLength) break;
              const rawBytes = new Uint8Array(buffer, offset, dataLen);
              offset += dataLen;
              let data;
              const firstByte = rawBytes[0];
              if (firstByte === 123 || firstByte === 91) {
                try {
                  const jsonStr = new TextDecoder().decode(rawBytes);
                  data = JSON.parse(jsonStr);
                } catch {
                  data = rawBytes;
                }
              } else {
                data = rawBytes;
              }
              let clientId;
              if (typeof data === "object" && !(data instanceof Uint8Array)) {
                if (data.clientId && !lookupClientHash(clientHash)) {
                  registerClientId(data.clientId);
                }
                clientId = data.clientId || lookupClientHash(clientHash) || `hash_${clientHash.toString(16)}`;
              } else {
                clientId = lookupClientHash(clientHash) || `hash_${clientHash.toString(16)}`;
              }
              inputs.push({ seq, data, clientId, clientHash });
            }
          }
          return { type: "TICK", frame, snapshotFrame, snapshotHash, inputs, events: inputs };
        }
        case BinaryMessageType.INITIAL_STATE: {
          let offset = 1;
          const frame = view.getUint32(offset, true);
          offset += 4;
          const roomIdLen = view.getUint16(offset, true);
          offset += 2;
          if (offset + roomIdLen > buffer.byteLength) {
            console.error("[modu-network] Buffer overflow reading INITIAL_STATE roomId");
            return null;
          }
          const roomId = new TextDecoder().decode(new Uint8Array(buffer, offset, roomIdLen));
          offset += roomIdLen;
          const snapshotLen = view.getUint32(offset, true);
          offset += 4;
          if (offset + snapshotLen > buffer.byteLength) {
            console.error("[modu-network] Buffer overflow reading INITIAL_STATE snapshot");
            return null;
          }
          const snapshotBytes = new Uint8Array(buffer, offset, snapshotLen);
          offset += snapshotLen;
          const inputCount = view.getUint16(offset, true);
          offset += 2;
          const inputs = [];
          for (let i = 0; i < inputCount && offset < buffer.byteLength; i++) {
            const clientHash = view.getUint32(offset, true);
            offset += 4;
            const seq = view.getUint32(offset, true);
            offset += 4;
            const inputFrame = view.getUint32(offset, true);
            offset += 4;
            const dataLen = view.getUint16(offset, true);
            offset += 2;
            if (offset + dataLen > buffer.byteLength) break;
            const rawBytes = new Uint8Array(buffer, offset, dataLen);
            offset += dataLen;
            let data;
            const firstByte = rawBytes[0];
            if (firstByte === 123 || firstByte === 91) {
              try {
                const jsonStr = new TextDecoder().decode(rawBytes);
                data = JSON.parse(jsonStr);
              } catch {
                data = rawBytes;
              }
            } else {
              data = rawBytes;
            }
            let clientId;
            if (typeof data === "object" && !(data instanceof Uint8Array)) {
              if (data.clientId && !lookupClientHash(clientHash)) {
                registerClientId(data.clientId);
              }
              clientId = data.clientId || lookupClientHash(clientHash) || `hash_${clientHash.toString(16)}`;
            } else {
              clientId = lookupClientHash(clientHash) || `hash_${clientHash.toString(16)}`;
            }
            inputs.push({ seq, frame: inputFrame, data, clientId, clientHash });
          }
          return { type: "INITIAL_STATE", frame, snapshot: snapshotBytes, snapshotHash: "", inputs, events: inputs };
        }
        case BinaryMessageType.ROOM_CREATED: {
          let offset = 1;
          const roomIdLen = view.getUint16(offset, true);
          offset += 2;
          const roomId = new TextDecoder().decode(new Uint8Array(buffer, offset, roomIdLen));
          offset += roomIdLen;
          const clientIdLen = view.getUint16(offset, true);
          offset += 2;
          const clientId = new TextDecoder().decode(new Uint8Array(buffer, offset, clientIdLen));
          offset += clientIdLen;
          const snapshotLen = view.getUint32(offset, true);
          offset += 4;
          const snapshotJson = new TextDecoder().decode(new Uint8Array(buffer, offset, snapshotLen));
          const { snapshot, snapshotHash } = JSON.parse(snapshotJson);
          return { type: "ROOM_CREATED", roomId, clientId, snapshot, snapshotHash };
        }
        case BinaryMessageType.ROOM_JOINED: {
          let offset = 1;
          const roomIdLen = view.getUint16(offset, true);
          offset += 2;
          const roomId = new TextDecoder().decode(new Uint8Array(buffer, offset, roomIdLen));
          offset += roomIdLen;
          const clientIdLen = view.getUint16(offset, true);
          offset += 2;
          const clientId = new TextDecoder().decode(new Uint8Array(buffer, offset, clientIdLen));
          return { type: "ROOM_JOINED", roomId, clientId };
        }
        case BinaryMessageType.ERROR: {
          const msgLen = view.getUint16(1, true);
          const message = new TextDecoder().decode(new Uint8Array(buffer, 3, msgLen));
          return { type: "ERROR", message };
        }
        case BinaryMessageType.SNAPSHOT_UPDATE: {
          let offset = 1;
          const roomIdLen = view.getUint16(offset, true);
          offset += 2;
          const roomId = new TextDecoder().decode(new Uint8Array(buffer, offset, roomIdLen));
          offset += roomIdLen;
          const snapshotLen = view.getUint32(offset, true);
          offset += 4;
          const snapshotJson = new TextDecoder().decode(new Uint8Array(buffer, offset, snapshotLen));
          const { snapshot, snapshotHash } = JSON.parse(snapshotJson);
          return { type: "SNAPSHOT_UPDATE", roomId, snapshot, snapshotHash };
        }
        case BinaryMessageType.ROOM_LEFT: {
          const roomIdLen = view.getUint16(1, true);
          const roomId = new TextDecoder().decode(new Uint8Array(buffer, 3, roomIdLen));
          return { type: "ROOM_LEFT", roomId };
        }
        case BinaryMessageType.CLIENT_LIST_UPDATE: {
          let offset = 1;
          const roomIdLen = view.getUint16(offset, true);
          offset += 2;
          const roomId = new TextDecoder().decode(new Uint8Array(buffer, offset, roomIdLen));
          offset += roomIdLen;
          const clientsLen = view.getUint32(offset, true);
          offset += 4;
          const clientsJson = new TextDecoder().decode(new Uint8Array(buffer, offset, clientsLen));
          const clients = JSON.parse(clientsJson);
          return { type: "CLIENT_LIST_UPDATE", roomId, clients };
        }
        case BinaryMessageType.BINARY_SNAPSHOT: {
          const binaryData = new Uint8Array(buffer, 1);
          return { type: "BINARY_SNAPSHOT", binaryData };
        }
        default:
          return null;
      }
    } catch (err) {
      console.error("[modu-network] Decode error:", err);
      return null;
    }
  }
  async function toArrayBuffer(data) {
    if (data instanceof ArrayBuffer) return data;
    if (typeof Blob !== "undefined" && data instanceof Blob) return await data.arrayBuffer();
    return new Uint8Array(data).buffer;
  }
  async function connect(roomId, options) {
    const initialSnapshot = options.snapshot || {};
    const user = options.user || null;
    const onConnect = options.onConnect || (() => {
    });
    const onDisconnect = options.onDisconnect || (() => {
    });
    const onError = options.onError || ((err) => console.error("[modu-network]", err));
    const onMessage = options.onMessage || (() => {
    });
    const onTick = options.onTick || null;
    const getStateHash = options.getStateHash || null;
    const appId = options.appId;
    if (!appId) {
      throw new Error("[modu-network] appId is required. Pass appId in connect options.");
    }
    const centralServiceUrl = options.centralServiceUrl || (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:9001" : "https://nodes.modd.io");
    console.log("[modu-network] Central service URL:", centralServiceUrl);
    let connected = false;
    let deliveredSeqs = /* @__PURE__ */ new Set();
    let pendingTicks = [];
    let ws = null;
    let nodeUrl = null;
    let nodeToken = null;
    let tickRate = options.fps || 20;
    let connectionResolve = null;
    let bytesIn = 0;
    let bytesOut = 0;
    let lastBytesIn = 0;
    let lastBytesOut = 0;
    let bandwidthIn = 0;
    let bandwidthOut = 0;
    let bandwidthInterval = null;
    let hashInterval = null;
    let lastSyncSeq = 0;
    let lastSyncFrame = 0;
    let currentFrame = 0;
    let myClientId = null;
    function processInputsForClientIds(inputs) {
      for (const input of inputs) {
        const data = input.data || {};
        const inputType = data.type || input.type;
        if (inputType === "join" || inputType === "reconnect") {
          const clientId = data.clientId || input.clientId;
          if (clientId) {
            registerClientId(clientId);
          }
        } else if (inputType === "leave") {
          const clientId = data.clientId || input.clientId;
          if (clientId) {
            unregisterClientId(clientId);
          }
        }
      }
    }
    try {
      const requestBody = {};
      if (options.joinToken) {
        requestBody.joinToken = options.joinToken;
      }
      const authToken = options.authToken || (typeof localStorage !== "undefined" ? localStorage.getItem("modd_auth_token") : null);
      if (authToken && !options.joinToken) {
        requestBody.authToken = authToken;
      }
      if (options.nodeUrl) {
        const portMatch = options.nodeUrl.match(/:(\d+)/);
        if (portMatch) {
          requestBody.preferredNodeId = `port_${portMatch[1]}`;
        }
        console.log("[modu-network] Requesting preferred node:", options.nodeUrl);
      }
      const connectUrl = `${centralServiceUrl}/api/apps/${appId}/rooms/${roomId}/connect`;
      const res = await fetch(connectUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(`Failed to get node assignment: ${errorData.error || res.statusText}`);
      }
      const responseData = await res.json();
      nodeUrl = responseData.url;
      nodeToken = responseData.token;
      tickRate = responseData.fps || 20;
      const assignedToPreferred = options.nodeUrl && responseData.url === options.nodeUrl;
      console.log("[modu-network] Received Node URL:", nodeUrl, "token:", nodeToken ? "yes" : "no", "fps:", tickRate, assignedToPreferred ? "(preferred)" : "");
      const WS = typeof globalThis !== "undefined" && globalThis.WebSocket ? globalThis.WebSocket : WebSocket;
      return new Promise((resolve, reject) => {
        connectionResolve = resolve;
        const wsUrl = nodeToken ? `${nodeUrl}?token=${encodeURIComponent(nodeToken)}` : nodeUrl;
        ws = new WS(wsUrl);
        ws.binaryType = "arraybuffer";
        const instance = {
          send(data) {
            if (!connected || !ws || ws.readyState !== 1) return;
            if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
              const binary = data instanceof Uint8Array ? data : new Uint8Array(data);
              const wrapper = new Uint8Array(1 + binary.length);
              wrapper[0] = 32;
              wrapper.set(binary, 1);
              bytesOut += wrapper.length;
              ws.send(wrapper);
              return;
            }
            const msg = JSON.stringify({ type: "SEND_INPUT", payload: { roomId, data } });
            bytesOut += msg.length;
            ws.send(msg);
          },
          sendSnapshot(snapshot, hash, seq, frame) {
            if (!connected || !ws) return;
            if (snapshot instanceof Uint8Array || snapshot instanceof ArrayBuffer) {
              const binary = snapshot instanceof Uint8Array ? snapshot : new Uint8Array(snapshot);
              const hashBytes = new TextEncoder().encode(hash || "");
              const wrapper = new Uint8Array(1 + 4 + 4 + 1 + hashBytes.length + binary.length);
              wrapper[0] = 35;
              const view = new DataView(wrapper.buffer);
              view.setUint32(1, seq ?? 0, true);
              view.setUint32(5, frame ?? 0, true);
              wrapper[9] = hashBytes.length;
              wrapper.set(hashBytes, 10);
              wrapper.set(binary, 10 + hashBytes.length);
              bytesOut += wrapper.length;
              ws.send(wrapper);
              return;
            }
            const msg = JSON.stringify({ type: "SEND_SNAPSHOT", payload: { roomId, snapshot, hash } });
            bytesOut += msg.length;
            ws.send(msg);
          },
          leaveRoom() {
            if (connected && ws) {
              const msg = JSON.stringify({ type: "LEAVE_ROOM", payload: { roomId } });
              bytesOut += msg.length;
              ws.send(msg);
            }
            if (ws) ws.close();
          },
          getClients() {
            if (connected && ws && ws.readyState === 1) {
              const msg = JSON.stringify({ type: "GET_CLIENTS", payload: { roomId } });
              bytesOut += msg.length;
              ws.send(msg);
            }
          },
          close() {
            if (ws) ws.close();
          },
          get connected() {
            return connected;
          },
          get clientId() {
            return myClientId;
          },
          get node() {
            return nodeUrl ? nodeUrl.match(/:(\d+)/)?.[1] || nodeUrl : null;
          },
          get bandwidthIn() {
            return bandwidthIn;
          },
          get bandwidthOut() {
            return bandwidthOut;
          },
          get totalBytesIn() {
            return bytesIn;
          },
          get totalBytesOut() {
            return bytesOut;
          },
          get frame() {
            return currentFrame;
          },
          getLatency() {
            return "0";
          }
        };
        ws.onopen = () => {
          bandwidthInterval = setInterval(() => {
            bandwidthIn = bytesIn - lastBytesIn;
            bandwidthOut = bytesOut - lastBytesOut;
            lastBytesIn = bytesIn;
            lastBytesOut = bytesOut;
          }, 1e3);
          if (getStateHash) {
            hashInterval = setInterval(() => {
              if (!connected || !ws || ws.readyState !== 1) return;
              try {
                const hash = getStateHash();
                if (hash) {
                  const hashMsg = encodeSyncHash(roomId, hash, lastSyncSeq, lastSyncFrame);
                  bytesOut += hashMsg.byteLength;
                  ws.send(hashMsg);
                }
              } catch (err) {
                console.warn("[modu-network] Error getting state hash:", err);
              }
            }, 1e3);
          }
          const joinMsg = JSON.stringify({ type: "JOIN_ROOM", payload: { roomId, user } });
          bytesOut += joinMsg.length;
          ws.send(joinMsg);
        };
        ws.onerror = (e) => {
          const errMsg = `Failed to connect to ${nodeUrl}: ${e.message || "Unknown error"}`;
          onError(errMsg);
          if (!connected) reject(new Error(errMsg));
        };
        ws.onclose = () => {
          connected = false;
          if (bandwidthInterval) clearInterval(bandwidthInterval);
          if (hashInterval) clearInterval(hashInterval);
          onDisconnect();
        };
        ws.onmessage = async (e) => {
          let buffer;
          try {
            buffer = await toArrayBuffer(e.data);
          } catch (err) {
            console.warn("[modu-network] Failed to read message data:", err);
            return;
          }
          bytesIn += buffer.byteLength;
          const msg = decodeBinaryMessage(buffer);
          if (!msg) return;
          switch (msg.type) {
            case "TICK": {
              if (!connected) {
                pendingTicks.push(msg);
                break;
              }
              currentFrame = msg.frame;
              lastSyncFrame = msg.frame;
              const tickInputs = msg.inputs || msg.events || [];
              if (tickInputs && tickInputs.length > 0) {
                const maxSeq = Math.max(...tickInputs.map((e2) => e2.seq || 0));
                if (maxSeq > lastSyncSeq) lastSyncSeq = maxSeq;
              }
              const newInputs = tickInputs.filter((e2) => !deliveredSeqs.has(e2.seq));
              newInputs.forEach((e2) => deliveredSeqs.add(e2.seq));
              if (newInputs.length > 0) {
                processInputsForClientIds(newInputs);
              }
              if (onTick) {
                onTick(msg.frame, newInputs, msg.snapshotFrame, msg.snapshotHash);
              }
              break;
            }
            case "ERROR": {
              if (msg.message === "Room not found") {
                const createMsg = JSON.stringify({
                  type: "CREATE_ROOM",
                  payload: { roomId, snapshot: initialSnapshot, user }
                });
                bytesOut += createMsg.length;
                ws.send(createMsg);
              } else {
                onError(msg.message);
                reject(new Error(msg.message));
              }
              break;
            }
            case "ROOM_CREATED": {
              connected = true;
              currentFrame = 0;
              if (msg.clientId) {
                myClientId = msg.clientId;
                registerClientId(msg.clientId);
                console.log(`[modu-network] Assigned clientId: ${msg.clientId}`);
              }
              onConnect(initialSnapshot, [], 0, nodeUrl, tickRate, myClientId);
              if (connectionResolve) connectionResolve(instance);
              break;
            }
            case "INITIAL_STATE": {
              console.log("[modu-network] Received INITIAL_STATE, connecting...");
              const { snapshot, frame, snapshotHash } = msg;
              if (snapshot && snapshotHash) {
                snapshot.snapshotHash = snapshotHash;
              }
              const inputs = msg.inputs || msg.events || [];
              currentFrame = frame;
              lastSyncFrame = frame;
              if (inputs && inputs.length > 0) {
                const maxSeq = Math.max(...inputs.map((e2) => e2.seq || 0));
                if (maxSeq > lastSyncSeq) lastSyncSeq = maxSeq;
                inputs.forEach((e2) => deliveredSeqs.add(e2.seq));
              }
              if (inputs && inputs.length > 0) {
                processInputsForClientIds(inputs);
              }
              connected = true;
              onConnect(snapshot, inputs || [], frame, nodeUrl, tickRate, myClientId);
              if (pendingTicks.length > 0) {
                pendingTicks.sort((a, b) => a.frame - b.frame);
                for (const tickMsg of pendingTicks) {
                  const tickInputs = (tickMsg.inputs || tickMsg.events || []).filter((e2) => !deliveredSeqs.has(e2.seq));
                  tickInputs.forEach((e2) => deliveredSeqs.add(e2.seq));
                  if (tickInputs.length > 0) {
                    processInputsForClientIds(tickInputs);
                  }
                  for (const inp of tickInputs) {
                    reResolveClientId(inp);
                  }
                  if (onTick && (tickInputs.length > 0 || tickMsg.frame > frame)) {
                    onTick(tickMsg.frame, tickInputs, tickMsg.snapshotFrame, tickMsg.snapshotHash);
                  }
                }
                pendingTicks = [];
              }
              if (connectionResolve) connectionResolve(instance);
              break;
            }
            case "ROOM_JOINED": {
              connected = true;
              if (msg.clientId) {
                myClientId = msg.clientId;
                registerClientId(msg.clientId);
                console.log(`[modu-network] Assigned clientId: ${msg.clientId}`);
              }
              break;
            }
            case "SNAPSHOT_UPDATE": {
              if (options.onSnapshot) options.onSnapshot(msg.snapshot, msg.snapshotHash);
              break;
            }
            case "BINARY_SNAPSHOT": {
              if (options.onBinarySnapshot) options.onBinarySnapshot(msg.binaryData);
              break;
            }
            case "ROOM_LEFT": {
              console.log(`[modu-network] Left room ${msg.roomId}`);
              break;
            }
            case "CLIENT_LIST_UPDATE": {
              if (options.onClientsUpdate) options.onClientsUpdate(msg.clients);
              break;
            }
          }
        };
      });
    } catch (err) {
      throw new Error(`Failed to get node assignment: ${err.message}`);
    }
  }
  function getCentralServiceUrl(centralServiceUrl) {
    return centralServiceUrl || (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") ? "http://localhost:9001" : "https://nodes.modd.io");
  }
  async function listRooms(appId, options = {}) {
    const centralUrl = getCentralServiceUrl(options.centralServiceUrl);
    const limit = options.limit || 50;
    const offset = options.offset || 0;
    const url = `${centralUrl}/api/apps/${encodeURIComponent(appId)}/rooms/list?limit=${limit}&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(errorData.error || `Failed to list rooms: ${response.statusText}`);
    }
    return await response.json();
  }
  async function getRandomRoom(appId, options = {}) {
    const centralUrl = getCentralServiceUrl(options.centralServiceUrl);
    const minClients = options.minClients ?? 0;
    const maxClients = options.maxClients ?? 999;
    const url = `${centralUrl}/api/apps/${encodeURIComponent(appId)}/rooms/random?minClients=${minClients}&maxClients=${maxClients}`;
    const response = await fetch(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(errorData.error || `Failed to get random room: ${response.statusText}`);
    }
    return await response.json();
  }
  var modd = connect;
  if (typeof window !== "undefined") {
    window.moddNetwork = { connect, modd, listRooms, getRandomRoom, auth };
  }
  return __toCommonJS(modu_network_exports);
})();
//# sourceMappingURL=modu-network.iife.js.map

"use strict";
var Modu = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var src_exports = {};
  __export(src_exports, {
    AutoRenderer: () => Simple2DRenderer,
    BODY_DYNAMIC: () => BODY_DYNAMIC,
    BODY_KINEMATIC: () => BODY_KINEMATIC,
    BODY_STATIC: () => BODY_STATIC,
    Body2D: () => Body2D,
    Camera2D: () => Camera2D,
    CameraSystem: () => CameraSystem,
    Entity: () => Entity,
    EntityBuilder: () => EntityBuilder,
    EntityIdAllocator: () => EntityIdAllocator,
    EntityPool: () => EntityPool,
    FP_2PI: () => FP_2PI,
    FP_HALF: () => FP_HALF,
    FP_HALF_PI: () => FP_HALF_PI,
    FP_ONE: () => FP_ONE,
    FP_PI: () => FP_PI,
    FP_SHIFT: () => FP_SHIFT,
    Game: () => Game,
    INDEX_MASK: () => INDEX_MASK,
    InputPlugin: () => InputPlugin,
    MAX_ENTITIES: () => MAX_ENTITIES,
    Physics2DSystem: () => Physics2DSystem,
    Player: () => Player,
    Prefab: () => Prefab,
    QueryEngine: () => QueryEngine,
    QueryIterator: () => QueryIterator,
    RollbackBuffer: () => RollbackBuffer,
    SHAPE_CIRCLE: () => SHAPE_CIRCLE,
    SHAPE_RECT: () => SHAPE_RECT,
    SPRITE_IMAGE: () => SPRITE_IMAGE,
    SYSTEM_PHASES: () => SYSTEM_PHASES,
    Simple2DRenderer: () => Simple2DRenderer,
    SparseSnapshotCodec: () => SparseSnapshotCodec,
    Sprite: () => Sprite,
    SystemScheduler: () => SystemScheduler,
    Transform2D: () => Transform2D,
    World: () => World,
    addLocalInput: () => addLocalInput,
    addPlayer: () => addPlayer,
    addPlayerAtFrame: () => addPlayerAtFrame,
    addRemoteInput: () => addRemoteInput,
    advanceFrame: () => advanceFrame,
    checkRollback: () => checkRollback,
    clearSnapshotsBefore: () => clearSnapshotsBefore,
    codec: () => codec_exports,
    createGame: () => createGame,
    createPhysics2DSystem: () => createPhysics2DSystem,
    createRollbackManager: () => createRollbackManager,
    dRandom: () => dRandom,
    dSqrt: () => dSqrt,
    defineComponent: () => defineComponent,
    disableDeterminismGuard: () => disableDeterminismGuard,
    enableDebugUI: () => enableDebugUI,
    enableDeterminismGuard: () => enableDeterminismGuard,
    fpAbs: () => fpAbs,
    fpAtan2: () => fpAtan2,
    fpCeil: () => fpCeil,
    fpClamp: () => fpClamp,
    fpCos: () => fpCos,
    fpDiv: () => fpDiv,
    fpFloor: () => fpFloor,
    fpMax: () => fpMax,
    fpMin: () => fpMin,
    fpMul: () => fpMul,
    fpSign: () => fpSign,
    fpSin: () => fpSin,
    fpSqrt: () => fpSqrt,
    getInputsForFrame: () => getInputsForFrame,
    getInputsToSend: () => getInputsToSend,
    getRollbackStats: () => getRollbackStats,
    getSyncState: () => getSyncState,
    loadRandomState: () => loadRandomState,
    loadSnapshot: () => loadSnapshot,
    performRollback: () => performRollback,
    physics2d: () => physics2d_exports,
    physics3d: () => physics3d_exports,
    quatClone: () => quatClone,
    quatConjugate: () => quatConjugate,
    quatFromAxisAngle: () => quatFromAxisAngle,
    quatFromEulerY: () => quatFromEulerY,
    quatIdentity: () => quatIdentity,
    quatMul: () => quatMul,
    quatNormalize: () => quatNormalize,
    quatRotateVec3: () => quatRotateVec3,
    removePlayer: () => removePlayer,
    saveRandomState: () => saveRandomState,
    saveSnapshot: () => saveSnapshot,
    toFixed: () => toFixed,
    toFloat: () => toFloat,
    vec2: () => vec2,
    vec2Add: () => vec2Add,
    vec2Clone: () => vec2Clone,
    vec2Cross: () => vec2Cross,
    vec2Distance: () => vec2Distance,
    vec2DistanceSq: () => vec2DistanceSq,
    vec2Dot: () => vec2Dot,
    vec2FromFixed: () => vec2FromFixed,
    vec2Length: () => vec2Length,
    vec2LengthSq: () => vec2LengthSq,
    vec2Lerp: () => vec2Lerp,
    vec2Neg: () => vec2Neg,
    vec2Normalize: () => vec2Normalize,
    vec2Scale: () => vec2Scale,
    vec2Sub: () => vec2Sub,
    vec2Zero: () => vec2Zero,
    vec3: () => vec3,
    vec3Add: () => vec3Add,
    vec3Clone: () => vec3Clone,
    vec3Cross: () => vec3Cross,
    vec3Distance: () => vec3Distance,
    vec3DistanceSq: () => vec3DistanceSq,
    vec3Dot: () => vec3Dot,
    vec3FromFloats: () => vec3FromFloats,
    vec3Length: () => vec3Length,
    vec3LengthSq: () => vec3LengthSq,
    vec3Lerp: () => vec3Lerp,
    vec3Neg: () => vec3Neg,
    vec3Normalize: () => vec3Normalize,
    vec3Scale: () => vec3Scale,
    vec3Sub: () => vec3Sub,
    vec3ToFloats: () => vec3ToFloats,
    vec3Zero: () => vec3Zero
  });

  // src/math/fixed.ts
  var FP_SHIFT = 16;
  var FP_ONE = 1 << FP_SHIFT;
  var FP_HALF = FP_ONE >> 1;
  var FP_PI = 205887;
  var FP_2PI = 411775;
  var FP_HALF_PI = 102944;
  function toFixed(f) {
    return Math.round(f * FP_ONE);
  }
  function toFloat(fp) {
    return fp / FP_ONE;
  }
  function fpMul(a, b) {
    return Number(BigInt(a) * BigInt(b) >> BigInt(FP_SHIFT));
  }
  function fpDiv(a, b) {
    if (b === 0)
      return a >= 0 ? 2147483647 : -2147483647;
    return Number((BigInt(a) << BigInt(FP_SHIFT)) / BigInt(b));
  }
  function fpAbs(a) {
    return a < 0 ? -a : a;
  }
  function fpSign(a) {
    return a > 0 ? FP_ONE : a < 0 ? -FP_ONE : 0;
  }
  function fpMin(a, b) {
    return a < b ? a : b;
  }
  function fpMax(a, b) {
    return a > b ? a : b;
  }
  function fpClamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }
  function fpFloor(a) {
    return a & ~(FP_ONE - 1);
  }
  function fpCeil(a) {
    return a + FP_ONE - 1 & ~(FP_ONE - 1);
  }
  function fpSqrt(a) {
    if (a <= 0)
      return 0;
    const scaled = BigInt(a) * BigInt(FP_ONE);
    if (scaled <= 0n)
      return 0;
    let bitLen = 0n;
    let temp = scaled;
    while (temp > 0n) {
      bitLen++;
      temp >>= 1n;
    }
    let x = 1n << (bitLen >> 1n);
    if (x === 0n)
      x = 1n;
    let prevX = 0n;
    for (let i = 0; i < 30; i++) {
      const xNew = x + scaled / x >> 1n;
      if (xNew === x || xNew === prevX)
        break;
      prevX = x;
      x = xNew;
    }
    while (x * x > scaled)
      x--;
    while ((x + 1n) * (x + 1n) <= scaled)
      x++;
    return Number(x);
  }
  function dSqrt(x) {
    return toFloat(fpSqrt(toFixed(x)));
  }
  var SIN_TABLE_SIZE = 256;
  var SIN_TABLE = [
    0,
    402,
    804,
    1206,
    1608,
    2010,
    2412,
    2814,
    3216,
    3617,
    4019,
    4420,
    4821,
    5222,
    5623,
    6023,
    6424,
    6824,
    7224,
    7623,
    8022,
    8421,
    8820,
    9218,
    9616,
    10014,
    10411,
    10808,
    11204,
    11600,
    11996,
    12391,
    12785,
    13180,
    13573,
    13966,
    14359,
    14751,
    15143,
    15534,
    15924,
    16314,
    16703,
    17091,
    17479,
    17867,
    18253,
    18639,
    19024,
    19409,
    19792,
    20175,
    20557,
    20939,
    21320,
    21699,
    22078,
    22457,
    22834,
    23210,
    23586,
    23961,
    24335,
    24708,
    25080,
    25451,
    25821,
    26190,
    26558,
    26925,
    27291,
    27656,
    28020,
    28383,
    28745,
    29106,
    29466,
    29824,
    30182,
    30538,
    30893,
    31248,
    31600,
    31952,
    32303,
    32652,
    33e3,
    33347,
    33692,
    34037,
    34380,
    34721,
    35062,
    35401,
    35738,
    36075,
    36410,
    36744,
    37076,
    37407,
    37736,
    38064,
    38391,
    38716,
    39040,
    39362,
    39683,
    40002,
    40320,
    40636,
    40951,
    41264,
    41576,
    41886,
    42194,
    42501,
    42806,
    43110,
    43412,
    43713,
    44011,
    44308,
    44604,
    44898,
    45190,
    45480,
    45769,
    46056,
    46341,
    46624,
    46906,
    47186,
    47464,
    47741,
    48015,
    48288,
    48559,
    48828,
    49095,
    49361,
    49624,
    49886,
    50146,
    50404,
    50660,
    50914,
    51166,
    51417,
    51665,
    51911,
    52156,
    52398,
    52639,
    52878,
    53114,
    53349,
    53581,
    53812,
    54040,
    54267,
    54491,
    54714,
    54934,
    55152,
    55368,
    55582,
    55794,
    56004,
    56212,
    56418,
    56621,
    56823,
    57022,
    57219,
    57414,
    57607,
    57798,
    57986,
    58172,
    58356,
    58538,
    58718,
    58896,
    59071,
    59244,
    59415,
    59583,
    59750,
    59914,
    60075,
    60235,
    60392,
    60547,
    60700,
    60851,
    60999,
    61145,
    61288,
    61429,
    61568,
    61705,
    61839,
    61971,
    62101,
    62228,
    62353,
    62476,
    62596,
    62714,
    62830,
    62943,
    63054,
    63162,
    63268,
    63372,
    63473,
    63572,
    63668,
    63763,
    63854,
    63944,
    64031,
    64115,
    64197,
    64277,
    64354,
    64429,
    64501,
    64571,
    64639,
    64704,
    64766,
    64827,
    64884,
    64940,
    64993,
    65043,
    65091,
    65137,
    65180,
    65220,
    65259,
    65294,
    65328,
    65358,
    65387,
    65413,
    65436,
    65457,
    65476,
    65492,
    65505,
    65516,
    65525,
    65531,
    65535,
    65536
    // sin(PI/2) = 1.0 = FP_ONE
  ];
  var FP_ANGLE_TO_INDEX = 10680707;
  function fpSin(angle) {
    if (angle < 0) {
      const periods = (-angle / FP_2PI | 0) + 1;
      angle += periods * FP_2PI;
    }
    if (angle >= FP_2PI) {
      angle = angle % FP_2PI;
    }
    let quadrant = 0;
    if (angle >= FP_PI) {
      angle -= FP_PI;
      quadrant = 2;
    }
    if (angle >= FP_HALF_PI) {
      angle = FP_PI - angle;
      quadrant += 1;
    }
    const indexFp = fpMul(angle, FP_ANGLE_TO_INDEX);
    const index = indexFp >> FP_SHIFT;
    const frac = indexFp & FP_ONE - 1;
    const clampedIndex = index < 0 ? 0 : index > SIN_TABLE_SIZE ? SIN_TABLE_SIZE : index;
    const nextIndex = index + 1;
    const clampedIndexNext = nextIndex < 0 ? 0 : nextIndex > SIN_TABLE_SIZE ? SIN_TABLE_SIZE : nextIndex;
    const a = SIN_TABLE[clampedIndex] ?? 0;
    const b = SIN_TABLE[clampedIndexNext] ?? FP_ONE;
    let result = a + fpMul(b - a, frac);
    if (quadrant >= 2)
      result = -result;
    return result;
  }
  function fpCos(angle) {
    return fpSin(angle + FP_HALF_PI);
  }
  function fpAtan2(y, x) {
    if (x === 0 && y === 0)
      return 0;
    const absX = fpAbs(x);
    const absY = fpAbs(y);
    let angle;
    if (absX >= absY) {
      const ratio = fpDiv(absY, absX);
      angle = fpMul(ratio, 51472);
    } else {
      const ratio = fpDiv(absX, absY);
      angle = FP_HALF_PI - fpMul(ratio, 51472);
    }
    if (x < 0)
      angle = FP_PI - angle;
    if (y < 0)
      angle = -angle;
    return angle;
  }

  // src/math/vec.ts
  function vec2(x, y) {
    return { x: toFixed(x), y: toFixed(y) };
  }
  function vec2Zero() {
    return { x: 0, y: 0 };
  }
  function vec2FromFixed(x, y) {
    return { x, y };
  }
  function vec2Clone(v) {
    return { x: v.x, y: v.y };
  }
  function vec2Add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
  }
  function vec2Sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }
  function vec2Scale(v, s) {
    return { x: fpMul(v.x, s), y: fpMul(v.y, s) };
  }
  function vec2Neg(v) {
    return { x: -v.x, y: -v.y };
  }
  function vec2Dot(a, b) {
    return fpMul(a.x, b.x) + fpMul(a.y, b.y);
  }
  function vec2Cross(a, b) {
    return fpMul(a.x, b.y) - fpMul(a.y, b.x);
  }
  function vec2LengthSq(v) {
    return fpMul(v.x, v.x) + fpMul(v.y, v.y);
  }
  function vec2Length(v) {
    return fpSqrt(vec2LengthSq(v));
  }
  function vec2Normalize(v) {
    const len = vec2Length(v);
    if (len === 0)
      return vec2Zero();
    return { x: fpDiv(v.x, len), y: fpDiv(v.y, len) };
  }
  function vec2Lerp(a, b, t) {
    const oneMinusT = FP_ONE - t;
    return {
      x: fpMul(a.x, oneMinusT) + fpMul(b.x, t),
      y: fpMul(a.y, oneMinusT) + fpMul(b.y, t)
    };
  }
  function vec2Distance(a, b) {
    return vec2Length(vec2Sub(b, a));
  }
  function vec2DistanceSq(a, b) {
    return vec2LengthSq(vec2Sub(b, a));
  }
  function vec3(x, y, z) {
    return { x, y, z };
  }
  function vec3Zero() {
    return { x: 0, y: 0, z: 0 };
  }
  function vec3FromFloats(x, y, z) {
    return { x: toFixed(x), y: toFixed(y), z: toFixed(z) };
  }
  function vec3ToFloats(v) {
    return { x: toFloat(v.x), y: toFloat(v.y), z: toFloat(v.z) };
  }
  function vec3Clone(v) {
    return { x: v.x, y: v.y, z: v.z };
  }
  function vec3Add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }
  function vec3Sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }
  function vec3Scale(v, s) {
    return { x: fpMul(v.x, s), y: fpMul(v.y, s), z: fpMul(v.z, s) };
  }
  function vec3Neg(v) {
    return { x: -v.x, y: -v.y, z: -v.z };
  }
  function vec3Dot(a, b) {
    return fpMul(a.x, b.x) + fpMul(a.y, b.y) + fpMul(a.z, b.z);
  }
  function vec3Cross(a, b) {
    return {
      x: fpMul(a.y, b.z) - fpMul(a.z, b.y),
      y: fpMul(a.z, b.x) - fpMul(a.x, b.z),
      z: fpMul(a.x, b.y) - fpMul(a.y, b.x)
    };
  }
  function vec3LengthSq(v) {
    return fpMul(v.x, v.x) + fpMul(v.y, v.y) + fpMul(v.z, v.z);
  }
  function vec3Length(v) {
    return fpSqrt(vec3LengthSq(v));
  }
  function vec3Normalize(v) {
    const len = vec3Length(v);
    if (len === 0)
      return vec3Zero();
    return { x: fpDiv(v.x, len), y: fpDiv(v.y, len), z: fpDiv(v.z, len) };
  }
  function vec3Lerp(a, b, t) {
    const oneMinusT = FP_ONE - t;
    return {
      x: fpMul(a.x, oneMinusT) + fpMul(b.x, t),
      y: fpMul(a.y, oneMinusT) + fpMul(b.y, t),
      z: fpMul(a.z, oneMinusT) + fpMul(b.z, t)
    };
  }
  function vec3Distance(a, b) {
    return vec3Length(vec3Sub(b, a));
  }
  function vec3DistanceSq(a, b) {
    return vec3LengthSq(vec3Sub(b, a));
  }

  // src/math/quat.ts
  function quatIdentity() {
    return { x: 0, y: 0, z: 0, w: FP_ONE };
  }
  function quatFromAxisAngle(axis, angle) {
    const halfAngle = angle >> 1;
    const s = fpSin(halfAngle);
    const c = fpCos(halfAngle);
    const normAxis = vec3Normalize(axis);
    return {
      x: fpMul(normAxis.x, s),
      y: fpMul(normAxis.y, s),
      z: fpMul(normAxis.z, s),
      w: c
    };
  }
  function quatFromEulerY(yaw) {
    const halfAngle = yaw >> 1;
    return {
      x: 0,
      y: fpSin(halfAngle),
      z: 0,
      w: fpCos(halfAngle)
    };
  }
  function quatMul(a, b) {
    return {
      x: fpMul(a.w, b.x) + fpMul(a.x, b.w) + fpMul(a.y, b.z) - fpMul(a.z, b.y),
      y: fpMul(a.w, b.y) - fpMul(a.x, b.z) + fpMul(a.y, b.w) + fpMul(a.z, b.x),
      z: fpMul(a.w, b.z) + fpMul(a.x, b.y) - fpMul(a.y, b.x) + fpMul(a.z, b.w),
      w: fpMul(a.w, b.w) - fpMul(a.x, b.x) - fpMul(a.y, b.y) - fpMul(a.z, b.z)
    };
  }
  function quatRotateVec3(q, v) {
    const qv = vec3(q.x, q.y, q.z);
    const uv = vec3Cross(qv, v);
    const uuv = vec3Cross(qv, uv);
    return vec3Add(v, vec3Add(vec3Scale(uv, q.w << 1), vec3Scale(uuv, FP_ONE << 1)));
  }
  function quatNormalize(q) {
    const lenSq = fpMul(q.x, q.x) + fpMul(q.y, q.y) + fpMul(q.z, q.z) + fpMul(q.w, q.w);
    const len = fpSqrt(lenSq);
    if (len === 0)
      return quatIdentity();
    return {
      x: fpDiv(q.x, len),
      y: fpDiv(q.y, len),
      z: fpDiv(q.z, len),
      w: fpDiv(q.w, len)
    };
  }
  function quatConjugate(q) {
    return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  }
  function quatClone(q) {
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  }

  // src/math/random.ts
  var s0 = 1;
  var s1 = 2;
  function next() {
    let x = s0;
    const y = s1;
    s0 = y;
    x ^= x << 23 >>> 0;
    x ^= x >>> 17;
    x ^= y;
    x ^= y >>> 26;
    s1 = x >>> 0;
    return s0 + s1 >>> 0;
  }
  function setSeed(seed) {
    seed = seed >>> 0;
    if (seed === 0)
      seed = 1;
    let s = seed;
    s = (s >>> 16 ^ s) * 73244475 >>> 0;
    s = (s >>> 16 ^ s) * 73244475 >>> 0;
    s0 = (s >>> 16 ^ s) >>> 0;
    s = seed * 2654435769 >>> 0;
    s = (s >>> 16 ^ s) * 73244475 >>> 0;
    s = (s >>> 16 ^ s) * 73244475 >>> 0;
    s1 = (s >>> 16 ^ s) >>> 0;
    if (s0 === 0 && s1 === 0)
      s0 = 1;
  }
  function dRandom() {
    return next() / 4294967296;
  }
  function saveRandomState() {
    return { s0, s1 };
  }
  function loadRandomState(state) {
    s0 = state.s0;
    s1 = state.s1;
  }
  setSeed(1);

  // src/core/constants.ts
  var MAX_ENTITIES = 1e4;
  var GENERATION_BITS = 12;
  var INDEX_BITS = 20;
  var INDEX_MASK = (1 << INDEX_BITS) - 1;
  var MAX_GENERATION = (1 << GENERATION_BITS) - 1;
  var SYSTEM_PHASES = [
    "input",
    "update",
    "prePhysics",
    "physics",
    "postPhysics",
    "render"
  ];

  // src/core/component.ts
  function inferFieldDef(value) {
    if (typeof value === "object" && value !== null && "type" in value) {
      const def = value;
      if (def.type === "f32") {
        console.warn(
          `Component field uses f32 which is NON-DETERMINISTIC. Only use for render-only data, never for synced state.`
        );
      }
      return {
        type: def.type,
        default: def.default ?? (def.type === "bool" ? false : 0)
      };
    }
    if (typeof value === "boolean") {
      return { type: "bool", default: value };
    }
    if (typeof value === "number") {
      return { type: "i32", default: value };
    }
    if (value === null || value === void 0) {
      return { type: "i32", default: 0 };
    }
    throw new Error(
      `Unsupported field type: ${typeof value}. Components can only contain numbers and booleans. Use game.internString() for string values.`
    );
  }
  function createFieldArray(type) {
    switch (type) {
      case "i32":
        return new Int32Array(MAX_ENTITIES);
      case "u8":
      case "bool":
        return new Uint8Array(MAX_ENTITIES);
      case "f32":
        return new Float32Array(MAX_ENTITIES);
      default:
        throw new Error(`Unknown field type: ${type}`);
    }
  }
  function createComponentStorage(schema) {
    const fields = {};
    for (const [name, def] of Object.entries(schema)) {
      fields[name] = createFieldArray(def.type);
    }
    return {
      mask: new Uint32Array(Math.ceil(MAX_ENTITIES / 32)),
      fields,
      schema
    };
  }
  function generateAccessorClass(name, schema, storage) {
    const AccessorClass = function(index) {
      this._index = index;
    };
    AccessorClass.prototype = {};
    for (const [fieldName, fieldDef] of Object.entries(schema)) {
      const fieldArray = storage.fields[fieldName];
      const isFixedPoint = fieldDef.type === "i32";
      const isBool = fieldDef.type === "bool";
      Object.defineProperty(AccessorClass.prototype, fieldName, {
        get: function() {
          const value = fieldArray[this._index];
          if (isBool)
            return value !== 0;
          if (isFixedPoint)
            return toFloat(value);
          return value;
        },
        set: function(value) {
          if (isBool) {
            fieldArray[this._index] = value ? 1 : 0;
          } else if (isFixedPoint) {
            fieldArray[this._index] = toFixed(value);
          } else {
            fieldArray[this._index] = value;
          }
        },
        enumerable: true,
        configurable: false
      });
    }
    Object.defineProperty(AccessorClass.prototype, "_index", {
      value: 0,
      writable: true,
      enumerable: false,
      configurable: false
    });
    return AccessorClass;
  }
  var componentRegistry = /* @__PURE__ */ new Map();
  function defineComponent(name, defaults, options) {
    if (componentRegistry.has(name)) {
      throw new Error(`Component '${name}' is already defined`);
    }
    const schema = {};
    for (const [fieldName, defaultValue] of Object.entries(defaults)) {
      schema[fieldName] = inferFieldDef(defaultValue);
    }
    const storage = createComponentStorage(schema);
    const AccessorClass = generateAccessorClass(name, schema, storage);
    const componentType = {
      name,
      schema,
      storage,
      AccessorClass,
      fieldNames: Object.keys(schema),
      sync: options?.sync !== false
      // Default to true
    };
    componentRegistry.set(name, componentType);
    return componentType;
  }
  function hasComponent(storage, index) {
    const word = index >>> 5;
    const bit = 1 << (index & 31);
    return (storage.mask[word] & bit) !== 0;
  }
  function addComponentToEntity(storage, index) {
    const word = index >>> 5;
    const bit = 1 << (index & 31);
    storage.mask[word] |= bit;
  }
  function removeComponentFromEntity(storage, index) {
    const word = index >>> 5;
    const bit = 1 << (index & 31);
    storage.mask[word] &= ~bit;
  }
  function initializeComponentDefaults(storage, index) {
    for (const [fieldName, fieldDef] of Object.entries(storage.schema)) {
      const arr = storage.fields[fieldName];
      if (fieldDef.type === "i32") {
        arr[index] = toFixed(fieldDef.default);
      } else if (fieldDef.type === "bool") {
        arr[index] = fieldDef.default ? 1 : 0;
      } else {
        arr[index] = fieldDef.default;
      }
    }
  }
  function getAllComponents() {
    return componentRegistry;
  }

  // src/core/entity-id.ts
  var EntityIdAllocator = class {
    constructor() {
      /** Free list of available indices (sorted ascending for determinism) */
      this.freeList = [];
      /** Next index to allocate if free list is empty */
      this.nextIndex = 0;
      this.generations = new Uint16Array(MAX_ENTITIES);
    }
    /**
     * Allocate a new entity ID.
     * Returns entity ID with generation encoded.
     */
    allocate() {
      let index;
      if (this.freeList.length > 0) {
        index = this.freeList.shift();
      } else {
        if (this.nextIndex >= MAX_ENTITIES) {
          throw new Error(
            `Entity limit exceeded (MAX_ENTITIES=${MAX_ENTITIES}). Consider destroying unused entities or increasing the limit.`
          );
        }
        index = this.nextIndex++;
      }
      const generation = this.generations[index];
      return generation << INDEX_BITS | index;
    }
    /**
     * Free an entity ID, returning it to the pool.
     * Increments generation to invalidate stale references.
     */
    free(eid) {
      const index = eid & INDEX_MASK;
      this.generations[index] = this.generations[index] + 1 & MAX_GENERATION;
      const insertIdx = this.findInsertIndex(index);
      this.freeList.splice(insertIdx, 0, index);
    }
    /**
     * Check if an entity ID is still valid (generation matches).
     */
    isValid(eid) {
      const index = eid & INDEX_MASK;
      const generation = eid >>> INDEX_BITS;
      return index < this.nextIndex && this.generations[index] === generation;
    }
    /**
     * Get the index portion of an entity ID.
     */
    getIndex(eid) {
      return eid & INDEX_MASK;
    }
    /**
     * Get the generation portion of an entity ID.
     */
    getGeneration(eid) {
      return eid >>> INDEX_BITS;
    }
    /**
     * Get current state for snapshotting.
     */
    getState() {
      return {
        nextIndex: this.nextIndex,
        freeList: [...this.freeList],
        generations: Array.from(this.generations.slice(0, this.nextIndex))
      };
    }
    /**
     * Restore state from snapshot.
     */
    setState(state) {
      this.nextIndex = state.nextIndex;
      this.freeList = [...state.freeList];
      for (let i = 0; i < state.generations.length; i++) {
        this.generations[i] = state.generations[i];
      }
    }
    /**
     * Reset allocator to initial state.
     */
    reset() {
      this.nextIndex = 0;
      this.freeList = [];
      this.generations.fill(0);
    }
    /**
     * Get number of active entities.
     */
    getActiveCount() {
      return this.nextIndex - this.freeList.length;
    }
    /**
     * Binary search to find insert position for sorted free list.
     */
    /**
     * Get next ID that will be allocated (for snapshots).
     */
    getNextId() {
      return this.nextIndex;
    }
    /**
     * Set next ID (for snapshot restore).
     */
    setNextId(id) {
      this.nextIndex = id;
    }
    /**
     * Allocate a specific entity ID (for snapshot restore).
     * This bypasses normal allocation and marks the specific eid as used.
     * Returns the requested eid.
     */
    allocateSpecific(eid) {
      const index = eid & INDEX_MASK;
      const generation = eid >>> INDEX_BITS;
      if (index >= this.nextIndex) {
        this.nextIndex = index + 1;
      }
      const freeIdx = this.freeList.indexOf(index);
      if (freeIdx !== -1) {
        this.freeList.splice(freeIdx, 1);
      }
      this.generations[index] = generation;
      return eid;
    }
    findInsertIndex(index) {
      let lo = 0;
      let hi = this.freeList.length;
      while (lo < hi) {
        const mid = lo + hi >>> 1;
        if (this.freeList[mid] < index) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      return lo;
    }
  };

  // src/components/index.ts
  var Transform2D = defineComponent("Transform2D", {
    x: 0,
    y: 0,
    angle: 0
  });
  var Body2D = defineComponent("Body2D", {
    // Velocity
    vx: 0,
    vy: 0,
    // Angular velocity
    angularVelocity: 0,
    // Force accumulator (added to velocity each frame, then cleared)
    forceX: 0,
    forceY: 0,
    // Impulse accumulator (added to velocity once, then cleared)
    impulseX: 0,
    impulseY: 0,
    // Size (use width/height OR radius)
    width: 0,
    height: 0,
    radius: 0,
    // Physics properties
    mass: 1,
    restitution: 0,
    // Bounciness (0-1)
    friction: 0,
    // Body type: 0=dynamic, 1=static, 2=kinematic
    bodyType: 0,
    // Shape type: 0=rect, 1=circle
    shapeType: 1,
    // Is sensor (no collision response, just events)
    damping: 0,
    isSensor: false
  });
  var Player = defineComponent("Player", {
    clientId: 0
    // Interned clientId string
  });
  var Sprite = defineComponent("Sprite", {
    // Shape type: 0=rect, 1=circle, 2=image
    shape: 1,
    // Default circle
    // Size (for shapes)
    width: 0,
    height: 0,
    radius: 10,
    // Color (interned string ID, e.g., '#ff0000')
    color: 0,
    // Image sprite ID (interned string, for shape=SPRITE_IMAGE)
    spriteId: 0,
    // Render offset from transform position
    offsetX: 0,
    offsetY: 0,
    // Scale
    scaleX: 1,
    scaleY: 1,
    // Layer for z-ordering (higher = in front)
    layer: 0,
    // Visibility
    visible: true
  });
  var SPRITE_IMAGE = 2;
  var Camera2D = defineComponent("Camera2D", {
    // Position (world coordinates the camera is centered on)
    x: 0,
    y: 0,
    // Zoom level (1 = normal, >1 = zoomed in, <1 = zoomed out)
    zoom: 1,
    // Target zoom for smooth transitions
    targetZoom: 1,
    // Smoothing factor for position interpolation (0-1, higher = snappier)
    smoothing: 0.1,
    // Optional: follow entity ID (0 = no target)
    followEntity: 0,
    // Viewport bounds (set by renderer)
    viewportWidth: 0,
    viewportHeight: 0
  }, { sync: false });
  var BODY_DYNAMIC = 0;
  var BODY_STATIC = 1;
  var BODY_KINEMATIC = 2;
  var SHAPE_RECT = 0;
  var SHAPE_CIRCLE = 1;

  // src/core/entity.ts
  var Entity = class {
    constructor() {
      /** Entity ID (includes generation) */
      this.eid = -1;
      /** Entity type name */
      this.type = "";
      /** Whether entity is destroyed */
      this.destroyed = false;
      /** Render-only state (client-only, never serialized) */
      this.render = {
        prevX: 0,
        prevY: 0,
        interpX: 0,
        interpY: 0,
        screenX: 0,
        screenY: 0,
        visible: true
      };
      /** Component types this entity has */
      this._components = [];
      /** Cached accessor instances */
      this._accessors = /* @__PURE__ */ new Map();
      /** Reference to world for operations */
      this._world = null;
      /** Current frame's input data (set during tick) */
      this._inputData = null;
    }
    /**
     * Get component accessor.
     * Returns typed accessor for reading/writing component data.
     */
    get(component) {
      const index = this.eid & INDEX_MASK;
      if (!hasComponent(component.storage, index)) {
        throw new Error(
          `Entity ${this.eid} (type: ${this.type}) does not have component '${component.name}'`
        );
      }
      let accessor = this._accessors.get(component);
      if (!accessor) {
        accessor = new component.AccessorClass(index);
        this._accessors.set(component, accessor);
      } else {
        accessor._index = index;
      }
      return accessor;
    }
    /**
     * Check if entity has a component.
     */
    has(component) {
      return hasComponent(component.storage, this.eid & INDEX_MASK);
    }
    /**
     * Add a component to this entity at runtime.
     */
    addComponent(component, data) {
      const index = this.eid & INDEX_MASK;
      if (hasComponent(component.storage, index)) {
        throw new Error(
          `Entity ${this.eid} already has component '${component.name}'`
        );
      }
      addComponentToEntity(component.storage, index);
      initializeComponentDefaults(component.storage, index);
      this._components.push(component);
      if (this._world) {
        this._world.queryEngine.addComponent(this.eid, component);
      }
      const accessor = this.get(component);
      if (data) {
        for (const [key, value] of Object.entries(data)) {
          accessor[key] = value;
        }
      }
      return accessor;
    }
    /**
     * Remove a component from this entity at runtime.
     */
    removeComponent(component) {
      const index = this.eid & INDEX_MASK;
      if (!hasComponent(component.storage, index)) {
        throw new Error(
          `Entity ${this.eid} does not have component '${component.name}'`
        );
      }
      removeComponentFromEntity(component.storage, index);
      const idx = this._components.indexOf(component);
      if (idx !== -1) {
        this._components.splice(idx, 1);
      }
      if (this._world) {
        this._world.queryEngine.removeComponent(this.eid, component);
      }
      this._accessors.delete(component);
    }
    /**
     * Destroy this entity.
     */
    destroy() {
      if (this.destroyed)
        return;
      this.destroyed = true;
      if (this._world) {
        this._world.destroyEntity(this);
      }
    }
    /**
     * Get all components on this entity.
     */
    getComponents() {
      return [...this._components];
    }
    /**
     * Get current frame's input data.
     * Returns null if no input was received this tick.
     */
    get input() {
      return this._inputData;
    }
    /**
     * Set input data for this tick (called by World).
     */
    _setInputData(data) {
      this._inputData = data;
    }
    /**
     * Save current position to render.prev* for interpolation.
     * Should be called in prePhysics phase before physics updates position.
     */
    _savePreviousState() {
      for (const component of this._components) {
        const index = this.eid & INDEX_MASK;
        if ("x" in component.storage.fields && "y" in component.storage.fields) {
          const xArr = component.storage.fields["x"];
          const yArr = component.storage.fields["y"];
          this.render.prevX = toFloat(xArr[index]);
          this.render.prevY = toFloat(yArr[index]);
          return;
        }
      }
    }
    /**
     * Calculate interpolated position for rendering.
     * @param alpha Interpolation factor (0-1) between previous and current state
     */
    interpolate(alpha) {
      for (const component of this._components) {
        const index = this.eid & INDEX_MASK;
        if ("x" in component.storage.fields && "y" in component.storage.fields) {
          const currentX = toFloat(component.storage.fields["x"][index]);
          const currentY = toFloat(component.storage.fields["y"][index]);
          this.render.interpX = this.render.prevX + (currentX - this.render.prevX) * alpha;
          this.render.interpY = this.render.prevY + (currentY - this.render.prevY) * alpha;
          return;
        }
      }
    }
    /**
     * Initialize entity (called by world).
     */
    _init(eid, type, components, world) {
      this.eid = eid;
      this.type = type;
      this.destroyed = false;
      this._components = components;
      this._world = world;
      this._accessors.clear();
      this.render.prevX = 0;
      this.render.prevY = 0;
      this.render.interpX = 0;
      this.render.interpY = 0;
      this.render.screenX = 0;
      this.render.screenY = 0;
      this.render.visible = true;
      this._inputData = null;
    }
    /**
     * Clean up entity (called when returned to pool).
     */
    _cleanup() {
      this._world = null;
      this._components = [];
      this._accessors.clear();
      this._inputData = null;
    }
    // ==========================================
    // Movement Helpers (Deterministic)
    // ==========================================
    /**
     * Set velocity toward a target point.
     * Uses fixed-point math internally for determinism.
     *
     * @param target Target position {x, y}
     * @param speed Speed in units per second
     */
    moveTowards(target, speed) {
      if (!this.has(Transform2D) || !this.has(Body2D))
        return;
      const transform = this.get(Transform2D);
      const body = this.get(Body2D);
      const dx = toFixed(target.x) - toFixed(transform.x);
      const dy = toFixed(target.y) - toFixed(transform.y);
      const distSq = fpMul(dx, dx) + fpMul(dy, dy);
      if (distSq === 0) {
        body.vx = 0;
        body.vy = 0;
        return;
      }
      const dist = fpSqrt(distSq);
      const speedFp = toFixed(speed * 60);
      body.vx = toFloat(fpDiv(fpMul(dx, speedFp), dist));
      body.vy = toFloat(fpDiv(fpMul(dy, speedFp), dist));
    }
    /**
     * Set velocity toward a target, but stop if within radius.
     *
     * @param target Target position {x, y}
     * @param speed Speed in units per second
     * @param stopRadius Stop moving when within this distance (default: 0)
     */
    moveTowardsWithStop(target, speed, stopRadius = 0) {
      if (!this.has(Transform2D) || !this.has(Body2D))
        return;
      const transform = this.get(Transform2D);
      const body = this.get(Body2D);
      const dx = toFixed(target.x) - toFixed(transform.x);
      const dy = toFixed(target.y) - toFixed(transform.y);
      const distSq = fpMul(dx, dx) + fpMul(dy, dy);
      const stopRadiusFp = toFixed(stopRadius);
      const stopRadiusSq = fpMul(stopRadiusFp, stopRadiusFp);
      if (distSq <= stopRadiusSq) {
        body.vx = 0;
        body.vy = 0;
        return;
      }
      const dist = fpSqrt(distSq);
      const speedFp = toFixed(speed * 60);
      body.vx = toFloat(fpDiv(fpMul(dx, speedFp), dist));
      body.vy = toFloat(fpDiv(fpMul(dy, speedFp), dist));
    }
    /**
     * Stop all movement.
     */
    stop() {
      if (!this.has(Body2D))
        return;
      const body = this.get(Body2D);
      body.vx = 0;
      body.vy = 0;
    }
    /**
     * Set velocity directly.
     *
     * @param vx X velocity
     * @param vy Y velocity
     */
    setVelocity(vx, vy) {
      if (!this.has(Body2D))
        return;
      const body = this.get(Body2D);
      body.vx = vx;
      body.vy = vy;
    }
    /**
     * Get distance to a point (deterministic).
     */
    distanceTo(target) {
      if (!this.has(Transform2D))
        return 0;
      const transform = this.get(Transform2D);
      const dx = toFixed(target.x) - toFixed(transform.x);
      const dy = toFixed(target.y) - toFixed(transform.y);
      const distSq = fpMul(dx, dx) + fpMul(dy, dy);
      return toFloat(fpSqrt(distSq));
    }
    /**
     * Check if within distance of a point (deterministic).
     */
    isWithin(target, distance) {
      if (!this.has(Transform2D))
        return false;
      const transform = this.get(Transform2D);
      const dx = toFixed(target.x) - toFixed(transform.x);
      const dy = toFixed(target.y) - toFixed(transform.y);
      const distSq = fpMul(dx, dx) + fpMul(dy, dy);
      const distFp = toFixed(distance);
      const distSqThreshold = fpMul(distFp, distFp);
      return distSq <= distSqThreshold;
    }
  };
  var EntityPool = class {
    constructor() {
      this.pool = [];
      this.active = /* @__PURE__ */ new Map();
    }
    /**
     * Get or create an entity wrapper.
     */
    acquire(eid) {
      let entity = this.active.get(eid);
      if (entity) {
        return entity;
      }
      entity = this.pool.pop() || new Entity();
      this.active.set(eid, entity);
      return entity;
    }
    /**
     * Return entity wrapper to pool.
     */
    release(eid) {
      const entity = this.active.get(eid);
      if (entity) {
        entity._cleanup();
        this.active.delete(eid);
        this.pool.push(entity);
      }
    }
    /**
     * Get entity by eid if it exists.
     */
    get(eid) {
      return this.active.get(eid);
    }
    /**
     * Check if entity exists.
     */
    has(eid) {
      return this.active.has(eid);
    }
    /**
     * Clear all entities.
     */
    clear() {
      for (const entity of this.active.values()) {
        entity._cleanup();
        this.pool.push(entity);
      }
      this.active.clear();
    }
    /**
     * Get count of active entities.
     */
    get size() {
      return this.active.size;
    }
  };

  // src/core/query.ts
  var QueryIterator = class {
    constructor(matchingEids, getEntity, isDestroyed) {
      this.index = 0;
      this.eids = matchingEids.slice();
      this.getEntity = getEntity;
      this.isDestroyed = isDestroyed;
    }
    [Symbol.iterator]() {
      this.index = 0;
      return {
        next: () => {
          while (this.index < this.eids.length) {
            const eid = this.eids[this.index++];
            if (this.isDestroyed(eid))
              continue;
            const entity = this.getEntity(eid);
            if (entity) {
              return { done: false, value: entity };
            }
          }
          return { done: true, value: void 0 };
        }
      };
    }
    /**
     * Convert to array (allocates).
     */
    toArray() {
      const result = [];
      for (const entity of this) {
        result.push(entity);
      }
      return result;
    }
    /**
     * Get first matching entity.
     */
    first() {
      for (const entity of this) {
        return entity;
      }
      return null;
    }
    /**
     * Find entity matching predicate.
     */
    find(predicate) {
      for (const entity of this) {
        if (predicate(entity)) {
          return entity;
        }
      }
      return null;
    }
    /**
     * Count entities without allocating array.
     */
    count() {
      let count = 0;
      for (const _ of this) {
        count++;
      }
      return count;
    }
  };
  var QueryEngine = class {
    constructor(getEntity, isDestroyed) {
      /** Type index: entity type -> set of eids */
      this.typeIndex = /* @__PURE__ */ new Map();
      /** Component index: component -> set of eids */
      this.componentIndex = /* @__PURE__ */ new Map();
      /** Client ID index: clientId -> eid (O(1) lookup) */
      this.clientIdIndex = /* @__PURE__ */ new Map();
      this.getEntity = getEntity;
      this.isDestroyed = isDestroyed;
    }
    /**
     * Register an entity in the indices.
     */
    addEntity(eid, type, components, clientId) {
      let typeSet = this.typeIndex.get(type);
      if (!typeSet) {
        typeSet = /* @__PURE__ */ new Set();
        this.typeIndex.set(type, typeSet);
      }
      typeSet.add(eid);
      for (const component of components) {
        let compSet = this.componentIndex.get(component);
        if (!compSet) {
          compSet = /* @__PURE__ */ new Set();
          this.componentIndex.set(component, compSet);
        }
        compSet.add(eid);
      }
      if (clientId !== void 0) {
        this.clientIdIndex.set(clientId, eid);
      }
    }
    /**
     * Remove an entity from all indices.
     */
    removeEntity(eid, type, components, clientId) {
      this.typeIndex.get(type)?.delete(eid);
      for (const component of components) {
        this.componentIndex.get(component)?.delete(eid);
      }
      if (clientId !== void 0) {
        this.clientIdIndex.delete(clientId);
      }
    }
    /**
     * Add component to an existing entity.
     */
    addComponent(eid, component) {
      let compSet = this.componentIndex.get(component);
      if (!compSet) {
        compSet = /* @__PURE__ */ new Set();
        this.componentIndex.set(component, compSet);
      }
      compSet.add(eid);
    }
    /**
     * Remove component from an existing entity.
     */
    removeComponent(eid, component) {
      this.componentIndex.get(component)?.delete(eid);
    }
    /**
     * Update clientId mapping for an entity.
     */
    setClientId(eid, clientId) {
      this.clientIdIndex.set(clientId, eid);
    }
    /**
     * Remove clientId mapping.
     */
    removeClientId(clientId) {
      this.clientIdIndex.delete(clientId);
    }
    /**
     * Query by entity type.
     */
    byType(type) {
      const typeSet = this.typeIndex.get(type);
      const eids = typeSet ? this.sortedEids(typeSet) : [];
      return new QueryIterator(eids, this.getEntity, this.isDestroyed);
    }
    /**
     * Query by component(s) - entities must have ALL specified components.
     */
    byComponents(...components) {
      if (components.length === 0) {
        return new QueryIterator([], this.getEntity, this.isDestroyed);
      }
      let smallestSet;
      let smallestSize = Infinity;
      for (const component of components) {
        const compSet = this.componentIndex.get(component);
        if (!compSet || compSet.size === 0) {
          return new QueryIterator([], this.getEntity, this.isDestroyed);
        }
        if (compSet.size < smallestSize) {
          smallestSize = compSet.size;
          smallestSet = compSet;
        }
      }
      if (!smallestSet) {
        return new QueryIterator([], this.getEntity, this.isDestroyed);
      }
      const result = [];
      for (const eid of smallestSet) {
        let hasAll = true;
        for (const component of components) {
          if (component.storage && !hasComponent(component.storage, eid & INDEX_MASK)) {
            hasAll = false;
            break;
          }
        }
        if (hasAll) {
          result.push(eid);
        }
      }
      result.sort((a, b) => a - b);
      return new QueryIterator(result, this.getEntity, this.isDestroyed);
    }
    /**
     * Query by type or component.
     */
    query(typeOrComponent, ...moreComponents) {
      if (typeof typeOrComponent === "string") {
        if (moreComponents.length > 0) {
          const typeSet = this.typeIndex.get(typeOrComponent);
          if (!typeSet || typeSet.size === 0) {
            return new QueryIterator([], this.getEntity, this.isDestroyed);
          }
          const result = [];
          for (const eid of typeSet) {
            let hasAll = true;
            for (const component of moreComponents) {
              if (component.storage && !hasComponent(component.storage, eid & INDEX_MASK)) {
                hasAll = false;
                break;
              }
            }
            if (hasAll) {
              result.push(eid);
            }
          }
          result.sort((a, b) => a - b);
          return new QueryIterator(result, this.getEntity, this.isDestroyed);
        }
        return this.byType(typeOrComponent);
      }
      return this.byComponents(typeOrComponent, ...moreComponents);
    }
    /**
     * O(1) lookup by clientId.
     */
    getByClientId(clientId) {
      return this.clientIdIndex.get(clientId);
    }
    /**
     * Get all entity IDs (sorted for determinism).
     */
    getAllEids() {
      const allEids = /* @__PURE__ */ new Set();
      for (const typeSet of this.typeIndex.values()) {
        for (const eid of typeSet) {
          allEids.add(eid);
        }
      }
      return Array.from(allEids).sort((a, b) => a - b);
    }
    /**
     * Clear all indices (for reset).
     */
    clear() {
      this.typeIndex.clear();
      this.componentIndex.clear();
      this.clientIdIndex.clear();
    }
    /**
     * Get sorted eids from a set (for deterministic iteration).
     */
    sortedEids(set) {
      return Array.from(set).sort((a, b) => a - b);
    }
  };

  // src/core/system.ts
  var SystemScheduler = class {
    constructor() {
      /** Systems organized by phase */
      this.systems = /* @__PURE__ */ new Map();
      /** Whether we're running on client or server */
      this.isClient = true;
      /** System ID counter for ordering */
      this.nextSystemId = 0;
      for (const phase of SYSTEM_PHASES) {
        this.systems.set(phase, []);
      }
    }
    /**
     * Set whether this scheduler is running on client or server.
     */
    setIsClient(isClient) {
      this.isClient = isClient;
    }
    /**
     * Add a system to the scheduler.
     *
     * @param fn System function to execute
     * @param options System options (phase, client/server, order)
     * @returns Function to remove the system
     */
    add(fn, options = {}) {
      const phase = options.phase || "update";
      const systems = this.systems.get(phase);
      if (!systems) {
        throw new Error(`Unknown system phase: ${phase}`);
      }
      const entry = {
        fn,
        options,
        order: options.order ?? this.nextSystemId++
      };
      systems.push(entry);
      systems.sort((a, b) => a.order - b.order);
      return () => this.remove(fn);
    }
    /**
     * Remove a system from the scheduler.
     */
    remove(fn) {
      for (const systems of this.systems.values()) {
        const index = systems.findIndex((s) => s.fn === fn);
        if (index !== -1) {
          systems.splice(index, 1);
          return true;
        }
      }
      return false;
    }
    /**
     * Run all systems in a specific phase.
     */
    runPhase(phase) {
      const systems = this.systems.get(phase);
      if (!systems)
        return;
      for (const system of systems) {
        if (system.options.client && !this.isClient)
          continue;
        if (system.options.server && this.isClient)
          continue;
        try {
          const result = system.fn();
          if (result && typeof result === "object" && "then" in result) {
            throw new Error(
              `System returned a Promise. Async systems are not allowed as they break determinism. Remove 'await' from your system.`
            );
          }
        } catch (error) {
          console.error(`Error in system during '${phase}' phase:`, error);
          throw error;
        }
      }
    }
    /**
     * Run all phases in order (except render if not client).
     */
    runAll() {
      for (const phase of SYSTEM_PHASES) {
        if (phase === "render" && !this.isClient)
          continue;
        this.runPhase(phase);
      }
    }
    /**
     * Get count of systems in each phase (for debugging).
     */
    getSystemCounts() {
      const counts = {};
      for (const [phase, systems] of this.systems) {
        counts[phase] = systems.length;
      }
      return counts;
    }
    /**
     * Clear all systems (for testing).
     */
    clear() {
      for (const systems of this.systems.values()) {
        systems.length = 0;
      }
      this.nextSystemId = 0;
    }
  };

  // src/core/snapshot.ts
  var SparseSnapshotCodec = class {
    /**
     * Encode world state to sparse snapshot.
     */
    encode(activeEids, getEntityType, getEntityClientId, getComponentsForEntity, allocatorState, stringsState, frame = 0, seq = 0, rng) {
      const entityMask = new Uint32Array(Math.ceil(MAX_ENTITIES / 32));
      const entityMeta = [];
      const sortedEids = [...activeEids].sort((a, b) => a - b);
      for (const eid of sortedEids) {
        const index = eid & INDEX_MASK;
        entityMask[index >>> 5] |= 1 << (index & 31);
        entityMeta.push({
          eid,
          type: getEntityType(eid),
          clientId: getEntityClientId(eid)
        });
      }
      const componentData = /* @__PURE__ */ new Map();
      const allComponents = getAllComponents();
      for (const [name, component] of allComponents) {
        if (!component.sync)
          continue;
        const fieldCount = component.fieldNames.length;
        if (fieldCount === 0)
          continue;
        let totalSize = 0;
        for (const fieldName of component.fieldNames) {
          const arr = component.storage.fields[fieldName];
          totalSize += sortedEids.length * arr.BYTES_PER_ELEMENT;
        }
        const buffer = new ArrayBuffer(totalSize);
        let offset = 0;
        for (const fieldName of component.fieldNames) {
          const sourceArr = component.storage.fields[fieldName];
          const bytesPerElement = sourceArr.BYTES_PER_ELEMENT;
          const packedArr = new sourceArr.constructor(
            buffer,
            offset,
            sortedEids.length
          );
          for (let i = 0; i < sortedEids.length; i++) {
            const index = sortedEids[i] & INDEX_MASK;
            packedArr[i] = sourceArr[index];
          }
          offset += sortedEids.length * bytesPerElement;
        }
        componentData.set(name, buffer);
      }
      return {
        frame,
        seq,
        entityMask,
        entityMeta,
        componentData,
        entityCount: sortedEids.length,
        allocator: allocatorState,
        strings: stringsState,
        rng
      };
    }
    /**
     * Decode sparse snapshot back to world state.
     */
    decode(snapshot, clearWorld, setAllocatorState, setStringsState, createEntity, setRng) {
      clearWorld();
      setAllocatorState(snapshot.allocator);
      setStringsState(snapshot.strings);
      if (snapshot.rng && setRng) {
        setRng(snapshot.rng);
      }
      const allComponents = getAllComponents();
      for (let i = 0; i < snapshot.entityMeta.length; i++) {
        const meta = snapshot.entityMeta[i];
        createEntity(meta.eid, meta.type, meta.clientId);
      }
      for (const [name, buffer] of snapshot.componentData) {
        const component = allComponents.get(name);
        if (!component)
          continue;
        let offset = 0;
        for (const fieldName of component.fieldNames) {
          const targetArr = component.storage.fields[fieldName];
          const bytesPerElement = targetArr.BYTES_PER_ELEMENT;
          const packedArr = new targetArr.constructor(
            buffer,
            offset,
            snapshot.entityCount
          );
          for (let i = 0; i < snapshot.entityMeta.length; i++) {
            const index = snapshot.entityMeta[i].eid & INDEX_MASK;
            targetArr[index] = packedArr[i];
          }
          offset += snapshot.entityCount * bytesPerElement;
        }
      }
    }
    /**
     * Calculate snapshot size in bytes.
     */
    getSize(snapshot) {
      let size = 0;
      size += snapshot.entityMask.byteLength;
      size += snapshot.entityMeta.length * 32;
      for (const buffer of snapshot.componentData.values()) {
        size += buffer.byteLength;
      }
      size += snapshot.allocator.freeList.length * 4;
      size += snapshot.allocator.generations.length * 2;
      return size;
    }
    /**
     * Serialize snapshot to binary for network transfer.
     */
    toBinary(snapshot) {
      const metaJson = JSON.stringify({
        frame: snapshot.frame,
        seq: snapshot.seq,
        entityMeta: snapshot.entityMeta,
        allocator: snapshot.allocator,
        strings: snapshot.strings,
        rng: snapshot.rng,
        componentNames: Array.from(snapshot.componentData.keys())
      });
      const metaBytes = new TextEncoder().encode(metaJson);
      const metaLength = metaBytes.length;
      let componentDataSize = 0;
      const componentSizes = [];
      for (const buffer2 of snapshot.componentData.values()) {
        componentSizes.push(buffer2.byteLength);
        componentDataSize += buffer2.byteLength;
      }
      const totalSize = 4 + metaLength + 4 + snapshot.entityMask.byteLength + componentDataSize;
      const buffer = new ArrayBuffer(totalSize);
      const view = new DataView(buffer);
      let offset = 0;
      view.setUint32(offset, metaLength, true);
      offset += 4;
      new Uint8Array(buffer, offset, metaLength).set(metaBytes);
      offset += metaLength;
      view.setUint32(offset, snapshot.entityMask.byteLength, true);
      offset += 4;
      new Uint8Array(buffer, offset, snapshot.entityMask.byteLength).set(
        new Uint8Array(snapshot.entityMask.buffer)
      );
      offset += snapshot.entityMask.byteLength;
      for (const compBuffer of snapshot.componentData.values()) {
        new Uint8Array(buffer, offset, compBuffer.byteLength).set(
          new Uint8Array(compBuffer)
        );
        offset += compBuffer.byteLength;
      }
      return buffer;
    }
    /**
     * Deserialize snapshot from binary.
     */
    fromBinary(buffer) {
      const view = new DataView(buffer);
      let offset = 0;
      const metaLength = view.getUint32(offset, true);
      offset += 4;
      const metaBytes = new Uint8Array(buffer, offset, metaLength);
      const metaJson = new TextDecoder().decode(metaBytes);
      const meta = JSON.parse(metaJson);
      offset += metaLength;
      const maskLength = view.getUint32(offset, true);
      offset += 4;
      const entityMask = new Uint32Array(
        buffer.slice(offset, offset + maskLength)
      );
      offset += maskLength;
      const componentData = /* @__PURE__ */ new Map();
      const allComponents = getAllComponents();
      for (const name of meta.componentNames) {
        const component = allComponents.get(name);
        if (!component)
          continue;
        let compSize = 0;
        for (const fieldName of component.fieldNames) {
          const arr = component.storage.fields[fieldName];
          compSize += meta.entityMeta.length * arr.BYTES_PER_ELEMENT;
        }
        const compBuffer = buffer.slice(offset, offset + compSize);
        componentData.set(name, compBuffer);
        offset += compSize;
      }
      return {
        frame: meta.frame,
        seq: meta.seq,
        entityMask,
        entityMeta: meta.entityMeta,
        componentData,
        entityCount: meta.entityMeta.length,
        allocator: meta.allocator,
        strings: meta.strings,
        rng: meta.rng
      };
    }
  };
  var RollbackBuffer = class {
    constructor(maxFrames = 60) {
      this.maxFrames = maxFrames;
      this.snapshots = /* @__PURE__ */ new Map();
      this.codec = new SparseSnapshotCodec();
    }
    /**
     * Save a snapshot for a frame.
     */
    save(frame, snapshot) {
      this.snapshots.set(frame, snapshot);
      const minFrame = frame - this.maxFrames + 1;
      for (const f of this.snapshots.keys()) {
        if (f < minFrame) {
          this.snapshots.delete(f);
        }
      }
    }
    /**
     * Get snapshot for a frame.
     */
    get(frame) {
      return this.snapshots.get(frame);
    }
    /**
     * Check if snapshot exists for frame.
     */
    has(frame) {
      return this.snapshots.has(frame);
    }
    /**
     * Get oldest available frame.
     */
    getOldestFrame() {
      let oldest;
      for (const frame of this.snapshots.keys()) {
        if (oldest === void 0 || frame < oldest) {
          oldest = frame;
        }
      }
      return oldest;
    }
    /**
     * Get newest available frame.
     */
    getNewestFrame() {
      let newest;
      for (const frame of this.snapshots.keys()) {
        if (newest === void 0 || frame > newest) {
          newest = frame;
        }
      }
      return newest;
    }
    /**
     * Clear all snapshots.
     */
    clear() {
      this.snapshots.clear();
    }
    /**
     * Get number of stored snapshots.
     */
    get size() {
      return this.snapshots.size;
    }
  };

  // src/core/string-registry.ts
  var StringRegistry = class {
    constructor() {
      this.stringToId = /* @__PURE__ */ new Map();
      this.idToString = /* @__PURE__ */ new Map();
      this.nextId = /* @__PURE__ */ new Map();
    }
    /**
     * Intern a string, get back an integer ID.
     * If the string was already interned, returns the existing ID.
     *
     * @param namespace - Category for the string (e.g., 'color', 'sprite')
     * @param str - The string to intern
     * @returns Integer ID for the string
     */
    intern(namespace, str) {
      let nsMap = this.stringToId.get(namespace);
      if (!nsMap) {
        nsMap = /* @__PURE__ */ new Map();
        this.stringToId.set(namespace, nsMap);
      }
      const existing = nsMap.get(str);
      if (existing !== void 0)
        return existing;
      const id = this.nextId.get(namespace) ?? 1;
      this.nextId.set(namespace, id + 1);
      nsMap.set(str, id);
      let idMap = this.idToString.get(namespace);
      if (!idMap) {
        idMap = /* @__PURE__ */ new Map();
        this.idToString.set(namespace, idMap);
      }
      idMap.set(id, str);
      return id;
    }
    /**
     * Look up string by ID.
     *
     * @param namespace - Category for the string
     * @param id - Integer ID to look up
     * @returns The original string, or null if not found
     */
    getString(namespace, id) {
      return this.idToString.get(namespace)?.get(id) ?? null;
    }
    /**
     * Get state for snapshotting.
     * Returns a serializable representation of all interned strings.
     */
    getState() {
      const tables = {};
      const nextIds = {};
      for (const [ns, nsMap] of this.stringToId) {
        tables[ns] = Object.fromEntries(nsMap);
        nextIds[ns] = this.nextId.get(ns) ?? 1;
      }
      return { tables, nextIds };
    }
    /**
     * Restore state from snapshot.
     * Replaces all current data with the snapshot state.
     */
    setState(state) {
      this.stringToId.clear();
      this.idToString.clear();
      this.nextId.clear();
      for (const [ns, table] of Object.entries(state.tables)) {
        const nsMap = new Map(Object.entries(table));
        this.stringToId.set(ns, nsMap);
        const idMap = /* @__PURE__ */ new Map();
        for (const [str, id] of nsMap) {
          idMap.set(id, str);
        }
        this.idToString.set(ns, idMap);
        this.nextId.set(ns, state.nextIds[ns] ?? 1);
      }
    }
    /**
     * Clear all data.
     */
    clear() {
      this.stringToId.clear();
      this.idToString.clear();
      this.nextId.clear();
    }
  };

  // src/core/input-history.ts
  var FrameInputImpl = class {
    constructor(frame) {
      this.frame = frame;
      this.inputs = /* @__PURE__ */ new Map();
      this.confirmed = false;
    }
    /**
     * Get inputs sorted by clientId for deterministic iteration.
     */
    getSortedInputs() {
      const entries = Array.from(this.inputs.entries());
      entries.sort((a, b) => a[0] - b[0]);
      return entries;
    }
  };
  var InputHistory = class {
    /**
     * Create InputHistory with optional max frame limit.
     * @param maxFrames Maximum frames to keep (default 120)
     */
    constructor(maxFrames = 120) {
      /** Stored frames: frame number -> FrameInput */
      this.history = /* @__PURE__ */ new Map();
      this.maxFrames = maxFrames;
    }
    /**
     * Store input for a frame from a client.
     * Used for local predictions before server confirmation.
     *
     * @param frame Frame number
     * @param clientId Client ID (numeric)
     * @param input Input data
     */
    setInput(frame, clientId, input) {
      let frameInput = this.history.get(frame);
      if (!frameInput) {
        frameInput = new FrameInputImpl(frame);
        this.history.set(frame, frameInput);
      }
      frameInput.inputs.set(clientId, input);
    }
    /**
     * Mark a frame as server-confirmed with authoritative inputs.
     * This replaces any local predictions with server-provided data.
     *
     * @param frame Frame number
     * @param inputs Map of clientId -> input data from server
     */
    confirmFrame(frame, inputs) {
      const frameInput = new FrameInputImpl(frame);
      frameInput.confirmed = true;
      for (const [clientId, data] of inputs) {
        frameInput.inputs.set(clientId, data);
      }
      this.history.set(frame, frameInput);
    }
    /**
     * Get input data for a specific frame.
     *
     * @param frame Frame number
     * @returns FrameInput or undefined if not found
     */
    getFrame(frame) {
      return this.history.get(frame);
    }
    /**
     * Get ordered frames for resimulation.
     * Returns frames in ascending order, skipping any missing frames.
     *
     * CRITICAL: Order must be deterministic for rollback to work.
     *
     * @param fromFrame Start frame (inclusive)
     * @param toFrame End frame (inclusive)
     * @returns Array of FrameInput in ascending frame order
     */
    getRange(fromFrame, toFrame) {
      if (fromFrame > toFrame) {
        return [];
      }
      const result = [];
      for (const [frame, frameInput] of this.history) {
        if (frame >= fromFrame && frame <= toFrame) {
          result.push(frameInput);
        }
      }
      result.sort((a, b) => a.frame - b.frame);
      return result;
    }
    /**
     * Remove frames before the specified frame number.
     * Called to limit memory usage.
     *
     * @param beforeFrame Remove all frames with frame < beforeFrame
     */
    prune(beforeFrame) {
      const toRemove = [];
      for (const frame of this.history.keys()) {
        if (frame < beforeFrame) {
          toRemove.push(frame);
        }
      }
      for (const frame of toRemove) {
        this.history.delete(frame);
      }
    }
    /**
     * Serialize for snapshots (late joiner sync).
     * CRITICAL: Must produce identical output across all clients.
     *
     * @returns Serializable state object
     */
    getState() {
      const frames = [];
      const sortedFrames = Array.from(this.history.entries()).sort((a, b) => a[0] - b[0]);
      for (const [, frameInput] of sortedFrames) {
        const sortedInputs = frameInput.getSortedInputs().map(([clientId, data]) => ({
          clientId,
          data
        }));
        frames.push({
          frame: frameInput.frame,
          inputs: sortedInputs,
          confirmed: frameInput.confirmed
        });
      }
      return { frames };
    }
    /**
     * Restore from serialized state (for late joiner sync).
     * Clears existing data before restoring.
     *
     * @param state Previously serialized state
     */
    setState(state) {
      this.history.clear();
      for (const frameData of state.frames) {
        const frameInput = new FrameInputImpl(frameData.frame);
        frameInput.confirmed = frameData.confirmed;
        for (const { clientId, data } of frameData.inputs) {
          frameInput.inputs.set(clientId, data);
        }
        this.history.set(frameData.frame, frameInput);
      }
    }
    /**
     * Get the number of frames currently stored.
     * Useful for debugging and monitoring memory usage.
     */
    get size() {
      return this.history.size;
    }
    /**
     * Clear all stored history.
     */
    clear() {
      this.history.clear();
    }
  };

  // src/core/world.ts
  var EntityBuilder = class {
    constructor(world, name) {
      this.world = world;
      this.name = name;
      this.components = [];
      this.registered = false;
    }
    /**
     * Add a component to this entity definition.
     */
    with(component, defaults) {
      this.components.push({
        type: component,
        defaults
      });
      this.register();
      return this;
    }
    /**
     * Set sync fields for this entity (internal - use GameEntityBuilder.syncOnly()).
     */
    _setSyncFields(fields) {
      this._syncFields = fields;
    }
    /**
     * Set restore callback for this entity (internal - use GameEntityBuilder.onRestore()).
     */
    _setOnRestore(callback) {
      this._onRestore = callback;
    }
    /**
     * Finalize entity definition.
     */
    register() {
      this.world._registerEntityDef({
        name: this.name,
        components: this.components,
        syncFields: this._syncFields,
        onRestore: this._onRestore
      });
    }
    /**
     * Force immediate registration (for sync usage).
     */
    _ensureRegistered() {
      if (!this.registered) {
        this.registered = true;
      }
      this.register();
    }
    /**
     * Get the entity definition (for internal use).
     */
    _getDefinition() {
      return {
        name: this.name,
        components: this.components,
        syncFields: this._syncFields,
        onRestore: this._onRestore
      };
    }
  };
  var World = class {
    constructor() {
      /** Entity definitions */
      this.entityDefs = /* @__PURE__ */ new Map();
      /** Active entity eids */
      this.activeEntities = /* @__PURE__ */ new Set();
      /** Entity type by eid */
      this.entityTypes = /* @__PURE__ */ new Map();
      /** Entity components by eid */
      this.entityComponents = /* @__PURE__ */ new Map();
      /** Client ID by eid */
      this.entityClientIds = /* @__PURE__ */ new Map();
      /** Input registry: clientId → input data */
      this.inputRegistry = /* @__PURE__ */ new Map();
      /** Whether running on client */
      this._isClient = true;
      // ==========================================
      // Sparse Snapshot API (Efficient)
      // ==========================================
      /** Snapshot codec */
      this.snapshotCodec = new SparseSnapshotCodec();
      /** Current frame number */
      this.frame = 0;
      /** Current sequence number */
      this.seq = 0;
      // ==========================================
      // Network Integration (Phase 3)
      // ==========================================
      /**
       * Network input format.
       */
      this.inputBuffer = /* @__PURE__ */ new Map();
      /**
       * Run a single game tick with network inputs.
       *
       * Executes all system phases in order:
       * 1. INPUT - Apply network inputs to entities
       * 2. UPDATE - Game logic systems
       * 3. PREPHYSICS - Save state for interpolation
       * 4. PHYSICS - Physics simulation (external hook)
       * 5. POSTPHYSICS - Post-physics cleanup
       * 6. RENDER - Rendering (client only)
       */
      /** True while running deterministic simulation phases */
      this._isSimulating = false;
      // ==========================================
      // Client-Side Prediction (Phase 4)
      // ==========================================
      /** Local client ID for prediction */
      this.localClientId = null;
      /** Pending predictions awaiting server confirmation */
      this.predictions = [];
      /** Rollback buffer for state restoration */
      this.rollbackBuffer = /* @__PURE__ */ new Map();
      /** Maximum frames to keep in rollback buffer */
      this.rollbackBufferSize = 60;
      /** Input history for rollback resimulation */
      this.inputHistory = new InputHistory(120);
      this.idAllocator = new EntityIdAllocator();
      this.entityPool = new EntityPool();
      this.strings = new StringRegistry();
      this.queryEngine = new QueryEngine(
        (eid) => this.getEntity(eid),
        (eid) => this.isDestroyed(eid)
      );
      this.scheduler = new SystemScheduler();
      this.addSystem(() => this.saveInterpolationState(), { phase: "prePhysics", order: -1e3 });
    }
    /**
     * Set whether running on client.
     */
    setIsClient(isClient) {
      this._isClient = isClient;
      this.scheduler.setIsClient(isClient);
    }
    /**
     * Check if running on client.
     */
    get isClient() {
      return this._isClient;
    }
    // ==========================================
    // Component API
    // ==========================================
    /**
     * Define a new component type.
     */
    defineComponent(name, defaults) {
      return defineComponent(name, defaults);
    }
    // ==========================================
    // Entity Definition API
    // ==========================================
    /**
     * Define a new entity type.
     */
    defineEntity(name) {
      const builder = new EntityBuilder(this, name);
      return builder;
    }
    /**
     * Register an entity definition (internal).
     */
    _registerEntityDef(def) {
      this.entityDefs.set(def.name, def);
    }
    /**
     * Get entity definition by type name.
     */
    getEntityDef(typeName) {
      return this.entityDefs.get(typeName);
    }
    // ==========================================
    // Entity Spawning/Destruction
    // ==========================================
    /**
     * Spawn a new entity.
     */
    spawn(typeOrBuilder, props = {}) {
      let typeName;
      if (typeof typeOrBuilder === "string") {
        typeName = typeOrBuilder;
      } else {
        const def2 = typeOrBuilder._getDefinition();
        this._registerEntityDef(def2);
        typeName = def2.name;
      }
      const def = this.entityDefs.get(typeName);
      if (!def) {
        throw new Error(`Unknown entity type: '${typeName}'`);
      }
      const eid = this.idAllocator.allocate();
      const index = eid & INDEX_MASK;
      const entity = this.entityPool.acquire(eid);
      this.activeEntities.add(eid);
      this.entityTypes.set(eid, typeName);
      const componentTypes = [];
      for (const compDef of def.components) {
        const component = compDef.type;
        componentTypes.push(component);
        addComponentToEntity(component.storage, index);
        initializeComponentDefaults(component.storage, index);
        if (compDef.defaults) {
          for (const [key, value] of Object.entries(compDef.defaults)) {
            const arr = component.storage.fields[key];
            if (arr) {
              const fieldDef = component.storage.schema[key];
              if (fieldDef.type === "i32") {
                arr[index] = toFixed(value);
              } else if (fieldDef.type === "bool") {
                arr[index] = value ? 1 : 0;
              } else {
                arr[index] = value;
              }
            }
          }
        }
      }
      let clientId;
      for (const [key, value] of Object.entries(props)) {
        if (key === "clientId") {
          clientId = value;
          this.entityClientIds.set(eid, clientId);
        }
        for (const component of componentTypes) {
          if (key in component.storage.schema) {
            const arr = component.storage.fields[key];
            const fieldDef = component.storage.schema[key];
            if (fieldDef.type === "i32") {
              arr[index] = toFixed(value);
            } else if (fieldDef.type === "bool") {
              arr[index] = value ? 1 : 0;
            } else {
              arr[index] = value;
            }
            break;
          }
        }
      }
      this.entityComponents.set(eid, componentTypes);
      entity._init(eid, typeName, componentTypes, this);
      if (props.x !== void 0 || props.y !== void 0) {
        const spawnX = props.x ?? 0;
        const spawnY = props.y ?? 0;
        entity.render.prevX = spawnX;
        entity.render.prevY = spawnY;
        entity.render.interpX = spawnX;
        entity.render.interpY = spawnY;
      }
      this.queryEngine.addEntity(eid, typeName, componentTypes, clientId);
      return entity;
    }
    /**
     * Spawn an entity with a specific eid (for snapshot restore).
     * This is used when restoring entities to preserve their original IDs.
     */
    spawnWithId(typeOrBuilder, targetEid, props = {}) {
      let typeName;
      if (typeof typeOrBuilder === "string") {
        typeName = typeOrBuilder;
      } else {
        const def2 = typeOrBuilder._getDefinition();
        this._registerEntityDef(def2);
        typeName = def2.name;
      }
      const def = this.entityDefs.get(typeName);
      if (!def) {
        throw new Error(`Unknown entity type: '${typeName}'`);
      }
      const eid = this.idAllocator.allocateSpecific(targetEid);
      const index = eid & INDEX_MASK;
      const entity = this.entityPool.acquire(eid);
      this.activeEntities.add(eid);
      this.entityTypes.set(eid, typeName);
      const componentTypes = [];
      for (const compDef of def.components) {
        const component = compDef.type;
        componentTypes.push(component);
        addComponentToEntity(component.storage, index);
        initializeComponentDefaults(component.storage, index);
        if (compDef.defaults) {
          for (const [key, value] of Object.entries(compDef.defaults)) {
            const arr = component.storage.fields[key];
            if (arr) {
              const fieldDef = component.storage.schema[key];
              if (fieldDef.type === "i32") {
                arr[index] = toFixed(value);
              } else if (fieldDef.type === "bool") {
                arr[index] = value ? 1 : 0;
              } else {
                arr[index] = value;
              }
            }
          }
        }
      }
      let clientId;
      for (const [key, value] of Object.entries(props)) {
        if (key === "clientId") {
          clientId = value;
          this.entityClientIds.set(eid, clientId);
        }
        for (const compDef of def.components) {
          const arr = compDef.type.storage.fields[key];
          if (arr) {
            const fieldDef = compDef.type.storage.schema[key];
            if (fieldDef.type === "i32") {
              arr[index] = toFixed(value);
            } else if (fieldDef.type === "bool") {
              arr[index] = value ? 1 : 0;
            } else {
              arr[index] = value;
            }
            break;
          }
        }
      }
      this.entityComponents.set(eid, componentTypes);
      entity._init(eid, typeName, componentTypes, this);
      if (props.x !== void 0 || props.y !== void 0) {
        const spawnX = props.x ?? 0;
        const spawnY = props.y ?? 0;
        entity.render.prevX = spawnX;
        entity.render.prevY = spawnY;
        entity.render.interpX = spawnX;
        entity.render.interpY = spawnY;
      }
      this.queryEngine.addEntity(eid, typeName, componentTypes, clientId);
      return entity;
    }
    /**
     * Destroy an entity.
     */
    destroyEntity(entity) {
      const eid = entity.eid;
      if (!this.activeEntities.has(eid)) {
        return;
      }
      const typeName = this.entityTypes.get(eid) || "";
      const components = this.entityComponents.get(eid) || [];
      const clientId = this.entityClientIds.get(eid);
      const index = eid & INDEX_MASK;
      for (const component of components) {
        removeComponentFromEntity(component.storage, index);
      }
      this.queryEngine.removeEntity(eid, typeName, components, clientId);
      this.activeEntities.delete(eid);
      this.entityTypes.delete(eid);
      this.entityComponents.delete(eid);
      this.entityClientIds.delete(eid);
      this.entityPool.release(eid);
      this.idAllocator.free(eid);
    }
    /**
     * Get entity by eid.
     */
    getEntity(eid) {
      if (!this.activeEntities.has(eid)) {
        return null;
      }
      const entity = this.entityPool.get(eid);
      if (entity && !entity.destroyed) {
        return entity;
      }
      return null;
    }
    /**
     * Check if entity is destroyed.
     */
    isDestroyed(eid) {
      return !this.activeEntities.has(eid);
    }
    /**
     * Get entity by clientId (O(1) lookup).
     */
    getEntityByClientId(clientId) {
      const eid = this.queryEngine.getByClientId(clientId);
      if (eid === void 0)
        return null;
      return this.getEntity(eid);
    }
    /**
     * Set clientId for an entity (for snapshot restore).
     * Updates both entityClientIds map and queryEngine index.
     */
    setEntityClientId(eid, clientId) {
      this.entityClientIds.set(eid, clientId);
      this.queryEngine.setClientId(eid, clientId);
    }
    // ==========================================
    // Query API
    // ==========================================
    /**
     * Query entities by type or component.
     */
    query(typeOrComponent, ...moreComponents) {
      return this.queryEngine.query(typeOrComponent, ...moreComponents);
    }
    /**
     * Get all active entities.
     */
    getAllEntities() {
      const result = [];
      const sortedEids = Array.from(this.activeEntities).sort((a, b) => a - b);
      for (const eid of sortedEids) {
        const entity = this.entityPool.get(eid);
        if (entity) {
          result.push(entity);
        }
      }
      return result;
    }
    /**
     * Get all active entity IDs.
     */
    getAllEntityIds() {
      return Array.from(this.activeEntities).sort((a, b) => a - b);
    }
    // ==========================================
    // System API
    // ==========================================
    /**
     * Add a system.
     */
    addSystem(fn, options) {
      return this.scheduler.add(fn, options);
    }
    /**
     * Run all systems.
     */
    runSystems() {
      this.scheduler.runAll();
    }
    // ==========================================
    // String Interning API
    // ==========================================
    /**
     * Intern a string, get back an integer ID.
     */
    internString(namespace, str) {
      return this.strings.intern(namespace, str);
    }
    /**
     * Look up string by ID.
     */
    getString(namespace, id) {
      return this.strings.getString(namespace, id);
    }
    // ==========================================
    // Input Registry
    // ==========================================
    /**
     * Set input data for a client.
     */
    setInput(clientId, data) {
      this.inputRegistry.set(clientId, data);
      const entity = this.getEntityByClientId(clientId);
      if (entity) {
        entity._setInputData(data);
      }
    }
    /**
     * Get input data for a client.
     */
    getInput(clientId) {
      return this.inputRegistry.get(clientId);
    }
    /**
     * Clear all input data (call at end of tick).
     */
    clearInputs() {
      this.inputRegistry.clear();
    }
    /**
     * Get input state for snapshot.
     * Returns a map of clientId -> input data.
     */
    getInputState() {
      const state = {};
      for (const [clientId, data] of this.inputRegistry) {
        state[clientId] = data;
      }
      return state;
    }
    /**
     * Set input state from snapshot.
     * Restores the input registry and entity input caches.
     */
    setInputState(state) {
      this.inputRegistry.clear();
      for (const [clientIdStr, data] of Object.entries(state)) {
        const clientId = parseInt(clientIdStr, 10);
        this.inputRegistry.set(clientId, data);
        const entity = this.getEntityByClientId(clientId);
        if (entity) {
          entity._setInputData(data);
        }
      }
    }
    // ==========================================
    // State Management
    // ==========================================
    /**
     * Get full world state for snapshotting.
     */
    getState() {
      const entities = [];
      for (const eid of this.activeEntities) {
        const typeName = this.entityTypes.get(eid);
        const components = this.entityComponents.get(eid) || [];
        const index = eid & INDEX_MASK;
        const componentData = {};
        for (const component of components) {
          const data = {};
          for (const [fieldName, arr] of Object.entries(component.storage.fields)) {
            data[fieldName] = arr[index];
          }
          componentData[component.name] = data;
        }
        entities.push({
          eid,
          type: typeName,
          components: componentData,
          clientId: this.entityClientIds.get(eid)
        });
      }
      return {
        entities,
        allocator: this.idAllocator.getState(),
        strings: this.strings.getState()
      };
    }
    /**
     * Restore world state from snapshot.
     */
    setState(state) {
      this.clear();
      this.idAllocator.setState(state.allocator);
      this.strings.setState(state.strings);
      for (const entityState of state.entities) {
        const def = this.entityDefs.get(entityState.type);
        if (!def) {
          console.warn(`Unknown entity type in snapshot: ${entityState.type}`);
          continue;
        }
        const eid = entityState.eid;
        const index = eid & INDEX_MASK;
        const entity = this.entityPool.acquire(eid);
        this.activeEntities.add(eid);
        this.entityTypes.set(eid, entityState.type);
        if (entityState.clientId !== void 0) {
          this.entityClientIds.set(eid, entityState.clientId);
        }
        const componentTypes = [];
        for (const compDef of def.components) {
          const component = compDef.type;
          componentTypes.push(component);
          addComponentToEntity(component.storage, index);
          const savedData = entityState.components[component.name];
          if (savedData) {
            for (const [fieldName, value] of Object.entries(savedData)) {
              const arr = component.storage.fields[fieldName];
              if (arr) {
                arr[index] = value;
              }
            }
          }
        }
        this.entityComponents.set(eid, componentTypes);
        entity._init(eid, entityState.type, componentTypes, this);
        this.queryEngine.addEntity(eid, entityState.type, componentTypes, entityState.clientId);
      }
    }
    /**
     * Clear all world state.
     */
    clear() {
      for (const eid of this.activeEntities) {
        const components = this.entityComponents.get(eid) || [];
        const index = eid & INDEX_MASK;
        for (const component of components) {
          removeComponentFromEntity(component.storage, index);
        }
        this.entityPool.release(eid);
      }
      this.activeEntities.clear();
      this.entityTypes.clear();
      this.entityComponents.clear();
      this.entityClientIds.clear();
      this.queryEngine.clear();
      this.idAllocator.reset();
      this.strings.clear();
    }
    /**
     * Reset world (keeps definitions, clears entities).
     */
    reset() {
      this.clear();
    }
    /**
     * Get entity count.
     */
    get entityCount() {
      return this.activeEntities.size;
    }
    /**
     * Get sparse snapshot (efficient format).
     */
    getSparseSnapshot() {
      return this.snapshotCodec.encode(
        Array.from(this.activeEntities),
        (eid) => this.entityTypes.get(eid) || "",
        (eid) => this.entityClientIds.get(eid),
        (eid) => this.entityComponents.get(eid) || [],
        this.idAllocator.getState(),
        this.strings.getState(),
        this.frame,
        this.seq,
        saveRandomState()
        // CRITICAL: Save actual RNG state for deterministic rollback
      );
    }
    /**
     * Load sparse snapshot (efficient format).
     */
    loadSparseSnapshot(snapshot) {
      this.snapshotCodec.decode(
        snapshot,
        () => this.clearForSnapshot(),
        (state) => this.idAllocator.setState(state),
        (state) => this.strings.setState(state),
        (eid, type, clientId) => this.createEntityFromSnapshot(eid, type, clientId),
        (rng) => {
          if (rng) {
            loadRandomState(rng);
          }
        }
      );
      this.frame = snapshot.frame;
      this.seq = snapshot.seq;
      this.syncRenderStateFromTransforms();
    }
    /**
     * Sync render state with current transform positions.
     * Called after snapshot restore to prevent interpolation artifacts.
     */
    syncRenderStateFromTransforms() {
      for (const eid of this.activeEntities) {
        const entity = this.getEntity(eid);
        if (!entity)
          continue;
        const components = this.entityComponents.get(eid) || [];
        const index = eid & INDEX_MASK;
        for (const component of components) {
          if (component.name === "Transform2D") {
            const xArr = component.storage.fields["x"];
            const yArr = component.storage.fields["y"];
            if (xArr && yArr) {
              const x = xArr[index] / 65536;
              const y = yArr[index] / 65536;
              entity.render.prevX = x;
              entity.render.prevY = y;
              entity.render.interpX = x;
              entity.render.interpY = y;
            }
            break;
          }
        }
      }
    }
    /**
     * Clear world for snapshot restore (doesn't reset allocator).
     */
    clearForSnapshot() {
      for (const eid of this.activeEntities) {
        const components = this.entityComponents.get(eid) || [];
        const index = eid & INDEX_MASK;
        for (const component of components) {
          removeComponentFromEntity(component.storage, index);
        }
        this.entityPool.release(eid);
      }
      this.activeEntities.clear();
      this.entityTypes.clear();
      this.entityComponents.clear();
      this.entityClientIds.clear();
      this.queryEngine.clear();
    }
    /**
     * Create entity from snapshot data (without allocating new ID).
     */
    createEntityFromSnapshot(eid, type, clientId) {
      const def = this.entityDefs.get(type);
      if (!def) {
        console.warn(`Unknown entity type in snapshot: ${type}`);
        return;
      }
      const index = eid & INDEX_MASK;
      const entity = this.entityPool.acquire(eid);
      this.activeEntities.add(eid);
      this.entityTypes.set(eid, type);
      if (clientId !== void 0) {
        this.entityClientIds.set(eid, clientId);
      }
      const componentTypes = [];
      for (const compDef of def.components) {
        const component = compDef.type;
        componentTypes.push(component);
        addComponentToEntity(component.storage, index);
      }
      this.entityComponents.set(eid, componentTypes);
      entity._init(eid, type, componentTypes, this);
      this.queryEngine.addEntity(eid, type, componentTypes, clientId);
    }
    /**
     * Serialize snapshot to binary for network transfer.
     */
    snapshotToBinary(snapshot) {
      return this.snapshotCodec.toBinary(snapshot);
    }
    /**
     * Deserialize snapshot from binary.
     */
    snapshotFromBinary(buffer) {
      return this.snapshotCodec.fromBinary(buffer);
    }
    /**
     * Get snapshot size estimate.
     */
    getSnapshotSize(snapshot) {
      return this.snapshotCodec.getSize(snapshot);
    }
    tick(frame, inputs = []) {
      this.frame = frame;
      this.applyNetworkInputs(inputs);
      this._isSimulating = true;
      try {
        this.scheduler.runPhase("input");
        this.scheduler.runPhase("update");
        this.scheduler.runPhase("prePhysics");
        this.scheduler.runPhase("physics");
        this.scheduler.runPhase("postPhysics");
      } finally {
        this._isSimulating = false;
      }
      if (this._isClient) {
        this.scheduler.runPhase("render");
      }
      this.inputBuffer.clear();
    }
    /**
     * Apply network inputs to entities via O(1) clientId lookup.
     */
    applyNetworkInputs(inputs) {
      for (const input of inputs) {
        const entity = this.getEntityByClientId(input.clientId);
        if (entity) {
          this.inputBuffer.set(input.clientId, input.data);
          const data = input.data;
          if (data) {
            entity._setInputData(data);
          }
        }
      }
    }
    /**
     * Get input data for a clientId.
     */
    getInputForClient(clientId) {
      return this.inputBuffer.get(clientId);
    }
    /**
     * Check if we have input for a clientId this tick.
     */
    hasInputForClient(clientId) {
      return this.inputBuffer.has(clientId);
    }
    /**
     * Run only physics phase (for external physics integration).
     */
    runPhysics() {
      this.scheduler.runPhase("physics");
    }
    /**
     * Set physics step callback (called during PHYSICS phase).
     */
    setPhysicsStep(fn) {
      return this.addSystem(fn, { phase: "physics", order: 0 });
    }
    /**
     * Save previous positions for interpolation (called in prePhysics).
     */
    saveInterpolationState() {
      for (const eid of this.activeEntities) {
        const entity = this.getEntity(eid);
        if (entity) {
          entity._savePreviousState();
        }
      }
    }
    /**
     * Handle local player input (client-side prediction).
     * Applies input immediately for responsiveness.
     */
    handleLocalInput(input) {
      if (this.localClientId === null) {
        console.warn("Cannot handle local input: localClientId not set");
        return;
      }
      const entity = this.getEntityByClientId(this.localClientId);
      if (entity) {
        entity._setInputData(input);
      }
      this.inputHistory.setInput(this.frame, this.localClientId, input);
      this.predictions.push({
        frame: this.frame,
        input,
        hash: this.getStateHash()
      });
    }
    /**
     * Process server-confirmed inputs.
     * Detects mispredictions and triggers rollback if needed.
     */
    onServerTick(serverFrame, inputs) {
      this.saveSnapshot(this.frame);
      const inputMap = /* @__PURE__ */ new Map();
      for (const input of inputs) {
        inputMap.set(input.clientId, input.data);
      }
      this.inputHistory.confirmFrame(serverFrame, inputMap);
      const minFrame = serverFrame - 120;
      if (minFrame > 0) {
        this.inputHistory.prune(minFrame);
      }
      const predictionIdx = this.predictions.findIndex((p) => p.frame === serverFrame);
      if (predictionIdx !== -1) {
        const prediction = this.predictions[predictionIdx];
        const snapshot = this.rollbackBuffer.get(serverFrame);
        if (snapshot) {
          this.loadSparseSnapshot(snapshot);
        }
        this.tick(serverFrame, inputs);
        const serverHash = this.getStateHash();
        const mispredicted = serverHash !== prediction.hash;
        if (mispredicted) {
          this.onRollback?.(serverFrame);
          this.resimulateFrom(serverFrame);
        }
        this.predictions = this.predictions.filter((p) => p.frame > serverFrame);
        return mispredicted;
      } else {
        this.tick(serverFrame, inputs);
        return false;
      }
    }
    /**
     * Save snapshot for potential rollback.
     */
    saveSnapshot(frame) {
      const snapshot = this.getSparseSnapshot();
      this.rollbackBuffer.set(frame, snapshot);
      const minFrame = frame - this.rollbackBufferSize + 1;
      for (const f of this.rollbackBuffer.keys()) {
        if (f < minFrame) {
          this.rollbackBuffer.delete(f);
        }
      }
    }
    /**
     * Restore state from snapshot at frame.
     */
    restoreSnapshot(frame) {
      const snapshot = this.rollbackBuffer.get(frame);
      if (!snapshot) {
        return false;
      }
      this.loadSparseSnapshot(snapshot);
      return true;
    }
    /**
     * Check if snapshot exists for frame.
     */
    hasSnapshot(frame) {
      return this.rollbackBuffer.has(frame);
    }
    /**
     * Get oldest frame in rollback buffer.
     */
    getOldestSnapshotFrame() {
      let oldest;
      for (const frame of this.rollbackBuffer.keys()) {
        if (oldest === void 0 || frame < oldest) {
          oldest = frame;
        }
      }
      return oldest;
    }
    /**
     * Resimulate from a frame forward to current frame.
     * Uses stored inputs from input history.
     *
     * NOTE: This retrieves data from InputHistory but full tick logic
     * will be implemented in Phase 2 of the rollback implementation plan.
     */
    resimulateFrom(fromFrame) {
      const currentFrame = this.frame;
      const framesToResim = this.inputHistory.getRange(fromFrame + 1, currentFrame);
      if (framesToResim.length > 0) {
        for (const frameInput of framesToResim) {
          const inputs = [];
          for (const [clientId, data] of frameInput.getSortedInputs()) {
            inputs.push({ clientId, data });
          }
          this.tick(frameInput.frame, inputs);
        }
      }
      this.frame = currentFrame;
    }
    /**
     * Get deterministic hash of world state.
     * Used for comparing state between clients.
     * Excludes components with sync: false (client-only state).
     */
    getStateHash() {
      const sortedEids = Array.from(this.activeEntities).sort((a, b) => a - b);
      let hash = 0;
      for (const eid of sortedEids) {
        const index = eid & INDEX_MASK;
        const components = this.entityComponents.get(eid) || [];
        hash = hash * 31 + eid | 0;
        for (const component of components) {
          if (!component.sync)
            continue;
          const fieldNames = [...component.fieldNames].sort();
          for (const fieldName of fieldNames) {
            const arr = component.storage.fields[fieldName];
            const value = arr[index];
            hash = hash * 31 + value | 0;
          }
        }
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    }
    /**
     * Clear rollback buffer.
     */
    clearRollbackBuffer() {
      this.rollbackBuffer.clear();
      this.predictions = [];
    }
    /**
     * Get pending prediction count.
     */
    getPendingPredictionCount() {
      return this.predictions.length;
    }
    /**
     * Check if we have pending predictions.
     */
    hasPendingPredictions() {
      return this.predictions.length > 0;
    }
  };

  // src/codec/index.ts
  var codec_exports = {};
  __export(codec_exports, {
    decode: () => decode,
    encode: () => encode
  });

  // src/codec/binary.ts
  var TYPE_NULL = 0;
  var TYPE_FALSE = 1;
  var TYPE_TRUE = 2;
  var TYPE_INT32 = 5;
  var TYPE_FLOAT64 = 6;
  var TYPE_STRING = 7;
  var TYPE_ARRAY = 8;
  var TYPE_OBJECT = 9;
  var TYPE_UINT8 = 10;
  var TYPE_UINT16 = 11;
  var TYPE_UINT32 = 12;
  var BinaryEncoder = class {
    constructor() {
      this.buffer = [];
    }
    writeByte(b) {
      this.buffer.push(b & 255);
    }
    writeUint16(n) {
      this.buffer.push(n >> 8 & 255);
      this.buffer.push(n & 255);
    }
    writeUint32(n) {
      this.buffer.push(n >> 24 & 255);
      this.buffer.push(n >> 16 & 255);
      this.buffer.push(n >> 8 & 255);
      this.buffer.push(n & 255);
    }
    writeInt32(n) {
      this.writeUint32(n >>> 0);
    }
    writeFloat64(n) {
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, n, false);
      for (let i = 0; i < 8; i++) {
        this.buffer.push(view.getUint8(i));
      }
    }
    writeString(s) {
      const encoded = new TextEncoder().encode(s);
      this.writeUint16(encoded.length);
      for (let i = 0; i < encoded.length; i++) {
        this.buffer.push(encoded[i]);
      }
    }
    writeValue(value) {
      if (value === null || value === void 0) {
        this.writeByte(TYPE_NULL);
      } else if (value === false) {
        this.writeByte(TYPE_FALSE);
      } else if (value === true) {
        this.writeByte(TYPE_TRUE);
      } else if (typeof value === "number") {
        if (Number.isInteger(value)) {
          if (value >= 0 && value <= 255) {
            this.writeByte(TYPE_UINT8);
            this.writeByte(value);
          } else if (value >= 0 && value <= 65535) {
            this.writeByte(TYPE_UINT16);
            this.writeUint16(value);
          } else if (value >= -2147483648 && value <= 2147483647) {
            this.writeByte(TYPE_INT32);
            this.writeInt32(value);
          } else {
            this.writeByte(TYPE_FLOAT64);
            this.writeFloat64(value);
          }
        } else {
          this.writeByte(TYPE_FLOAT64);
          this.writeFloat64(value);
        }
      } else if (typeof value === "string") {
        this.writeByte(TYPE_STRING);
        this.writeString(value);
      } else if (Array.isArray(value)) {
        this.writeByte(TYPE_ARRAY);
        this.writeUint16(value.length);
        for (const item of value) {
          this.writeValue(item);
        }
      } else if (typeof value === "object") {
        this.writeByte(TYPE_OBJECT);
        const keys = Object.keys(value);
        this.writeUint16(keys.length);
        for (const key of keys) {
          this.writeString(key);
          this.writeValue(value[key]);
        }
      } else {
        this.writeByte(TYPE_NULL);
      }
    }
    toUint8Array() {
      return new Uint8Array(this.buffer);
    }
  };
  var BinaryDecoder = class {
    constructor(data) {
      this.pos = 0;
      this.data = data;
    }
    readByte() {
      return this.data[this.pos++];
    }
    readUint16() {
      const b1 = this.data[this.pos++];
      const b2 = this.data[this.pos++];
      return b1 << 8 | b2;
    }
    readUint32() {
      const b1 = this.data[this.pos++];
      const b2 = this.data[this.pos++];
      const b3 = this.data[this.pos++];
      const b4 = this.data[this.pos++];
      return (b1 << 24 | b2 << 16 | b3 << 8 | b4) >>> 0;
    }
    readInt32() {
      const u = this.readUint32();
      return u > 2147483647 ? u - 4294967296 : u;
    }
    readFloat64() {
      const view = new DataView(new ArrayBuffer(8));
      for (let i = 0; i < 8; i++) {
        view.setUint8(i, this.data[this.pos++]);
      }
      return view.getFloat64(0, false);
    }
    readString() {
      const len = this.readUint16();
      const bytes = this.data.slice(this.pos, this.pos + len);
      this.pos += len;
      return new TextDecoder().decode(bytes);
    }
    readValue() {
      const type = this.readByte();
      switch (type) {
        case TYPE_NULL:
          return null;
        case TYPE_FALSE:
          return false;
        case TYPE_TRUE:
          return true;
        case TYPE_UINT8:
          return this.readByte();
        case TYPE_UINT16:
          return this.readUint16();
        case TYPE_INT32:
          return this.readInt32();
        case TYPE_UINT32:
          return this.readUint32();
        case TYPE_FLOAT64:
          return this.readFloat64();
        case TYPE_STRING:
          return this.readString();
        case TYPE_ARRAY: {
          const len = this.readUint16();
          const arr = [];
          for (let i = 0; i < len; i++) {
            arr.push(this.readValue());
          }
          return arr;
        }
        case TYPE_OBJECT: {
          const len = this.readUint16();
          const obj = {};
          for (let i = 0; i < len; i++) {
            const key = this.readString();
            obj[key] = this.readValue();
          }
          return obj;
        }
        default:
          return null;
      }
    }
  };
  function encode(value) {
    const encoder = new BinaryEncoder();
    encoder.writeValue(value);
    return encoder.toUint8Array();
  }
  function decode(data) {
    const decoder = new BinaryDecoder(data);
    return decoder.readValue();
  }

  // src/game.ts
  var DEBUG_NETWORK = false;
  var Prefab = class {
    constructor(game, typeName, builder) {
      this.game = game;
      this.typeName = typeName;
      this.builder = builder;
    }
    /**
     * Spawn a new entity from this prefab.
     */
    spawn(props = {}) {
      return this.game.spawn(this.typeName, props);
    }
  };
  var Game = class {
    constructor() {
      /** Physics system (optional) */
      this.physics = null;
      // ==========================================
      // Network State
      // ==========================================
      /** WebSocket connection */
      this.connection = null;
      /** Game callbacks */
      this.callbacks = {};
      /** Connected room ID */
      this.connectedRoomId = null;
      /** Local client ID (string form) */
      this.localClientIdStr = null;
      /** All connected client IDs (in join order for determinism) */
      this.connectedClients = [];
      /** Authority client (first joiner, sends snapshots) */
      this.authorityClientId = null;
      /** Current server frame */
      this.currentFrame = 0;
      /** Last processed frame (for skipping old frames after catchup) */
      this.lastProcessedFrame = 0;
      /** Last processed input sequence */
      this.lastInputSeq = 0;
      /** Server tick rate */
      this.serverFps = 20;
      /** RequestAnimationFrame handle */
      this.gameLoop = null;
      /** Deferred snapshot flag (send after tick completes) */
      this.pendingSnapshotUpload = false;
      /** Last snapshot info for debug UI */
      this.lastSnapshotHash = null;
      this.lastSnapshotFrame = 0;
      this.lastSnapshotSize = 0;
      this.lastSnapshotEntityCount = 0;
      /** Drift tracking stats for debug UI */
      this.driftStats = {
        determinismPercent: 100,
        totalChecks: 0,
        matchingFieldCount: 0,
        totalFieldCount: 0
      };
      /** Divergence tracking */
      this.lastSyncPercent = 100;
      this.firstDivergenceFrame = null;
      this.divergenceHistory = [];
      this.recentInputs = [];
      this.lastServerSnapshot = { raw: null, decoded: null, frame: 0 };
      this.lastGoodSnapshot = null;
      this.divergenceCaptured = false;
      this.divergenceCapture = null;
      /** Tick timing for render interpolation */
      this.lastTickTime = 0;
      this.tickIntervalMs = 50;
      // 20fps default
      // ==========================================
      // String Interning
      // ==========================================
      /** String to ID mapping for clientIds */
      this.clientIdToNum = /* @__PURE__ */ new Map();
      this.numToClientId = /* @__PURE__ */ new Map();
      this.nextClientNum = 1;
      /** Prefab registry */
      this.prefabs = /* @__PURE__ */ new Map();
      /** Collision handlers (type:type -> handler) */
      this.collisionHandlers = /* @__PURE__ */ new Map();
      /** Clients that already have entities from snapshot (skip onConnect for them during catchup) */
      this.clientsWithEntitiesFromSnapshot = /* @__PURE__ */ new Set();
      /** Attached renderer */
      this.renderer = null;
      /** Installed plugins */
      this.plugins = /* @__PURE__ */ new Map();
      this.world = new World();
    }
    // ==========================================
    // Plugin API
    // ==========================================
    /**
     * Add a plugin to the game.
     *
     * Plugins can be classes or factory functions that integrate with the game.
     * Common plugins include Physics2DSystem and AutoRenderer.
     *
     * @example
     * const physics = game.addPlugin(Physics2DSystem, { gravity: { x: 0, y: 0 } });
     * game.addPlugin(AutoRenderer, canvas);
     *
     * @param Plugin - Plugin class or factory
     * @param args - Arguments to pass to the plugin constructor
     * @returns The created plugin instance
     */
    addPlugin(Plugin, ...args) {
      const plugin = new Plugin(this, ...args);
      const name = Plugin.name || "anonymous";
      this.plugins.set(name, plugin);
      return plugin;
    }
    /**
     * Get a previously added plugin by class.
     */
    getPlugin(Plugin) {
      return this.plugins.get(Plugin.name);
    }
    /**
     * Current frame number.
     */
    get frame() {
      return this.currentFrame;
    }
    /**
     * Deterministic time in milliseconds.
     * Use this instead of Date.now() for game logic.
     *
     * @example
     * const RESPAWN_TIME = 3000; // 3 seconds
     * deadPlayers.set(clientId, game.time + RESPAWN_TIME);
     * if (game.time >= respawnTime) spawnPlayer(clientId);
     */
    get time() {
      return this.currentFrame * this.tickIntervalMs;
    }
    // ==========================================
    // Entity Definition API
    // ==========================================
    /**
     * Define a new entity type.
     *
     * @example
     * const Cell = game.defineEntity('cell')
     *     .with(Transform2D)
     *     .with(Body2D, { shapeType: 1, radius: 20 })
     *     .with(Player);
     */
    defineEntity(name) {
      return new GameEntityBuilder(this, name);
    }
    /**
     * Register a prefab (internal).
     */
    _registerPrefab(name, builder) {
      const prefab = new Prefab(this, name, builder);
      this.prefabs.set(name, prefab);
      return prefab;
    }
    // ==========================================
    // Entity Spawning
    // ==========================================
    /**
     * Spawn an entity.
     *
     * @param type Entity type name
     * @param props Property overrides
     */
    spawn(type, props = {}) {
      let numericProps = { ...props };
      if (props.clientId && typeof props.clientId === "string") {
        numericProps.clientId = this.internClientId(props.clientId);
      }
      return this.world.spawn(type, numericProps);
    }
    /**
     * Get a prefab by name.
     */
    getPrefab(name) {
      return this.prefabs.get(name);
    }
    // ==========================================
    // Query API
    // ==========================================
    /**
     * Query entities by type.
     */
    query(type) {
      return this.world.query(type);
    }
    /**
     * Get entities by type as array.
     */
    getEntitiesByType(type) {
      return this.world.query(type).toArray();
    }
    /**
     * Get all entities.
     */
    getAllEntities() {
      return this.world.getAllEntities();
    }
    /**
     * Get entity by client ID.
     */
    getEntityByClientId(clientId) {
      const numId = this.clientIdToNum.get(clientId);
      if (numId === void 0)
        return null;
      return this.world.getEntityByClientId(numId);
    }
    /**
     * Get player by client ID (alias for getEntityByClientId).
     */
    getPlayer(clientId) {
      return this.getEntityByClientId(clientId);
    }
    /**
     * Get all players (entities with Player component).
     */
    getPlayers() {
      return this.world.query(Player).toArray();
    }
    // ==========================================
    // System API
    // ==========================================
    /**
     * Add a system.
     */
    addSystem(fn, options) {
      return this.world.addSystem(fn, options);
    }
    // ==========================================
    // Collision API
    // ==========================================
    /**
     * Register a collision handler.
     */
    onCollision(typeA, typeB, handler) {
      if (this.physics) {
        this.physics.onCollision(typeA, typeB, handler);
      } else {
        const key = `${typeA}:${typeB}`;
        this.collisionHandlers.set(key, handler);
      }
      return this;
    }
    // ==========================================
    // String Interning
    // ==========================================
    /**
     * Intern a client ID string, get back a number.
     */
    internClientId(clientId) {
      let num = this.clientIdToNum.get(clientId);
      if (num === void 0) {
        num = this.nextClientNum++;
        this.clientIdToNum.set(clientId, num);
        this.numToClientId.set(num, clientId);
      }
      return num;
    }
    /**
     * Get client ID string from number.
     */
    getClientIdString(num) {
      return this.numToClientId.get(num);
    }
    /**
     * Intern any string in a namespace.
     */
    internString(namespace, str) {
      return this.world.internString(namespace, str);
    }
    /**
     * Get string by ID from namespace.
     */
    getString(namespace, id) {
      return this.world.getString(namespace, id);
    }
    // ==========================================
    // State Management
    // ==========================================
    /**
     * Get deterministic state hash.
     */
    getStateHash() {
      return this.world.getStateHash();
    }
    /**
     * Reset game state.
     */
    reset() {
      this.world.reset();
      this.currentFrame = 0;
    }
    // ==========================================
    // Network Connection
    // ==========================================
    /**
     * Connect to a multiplayer room.
     */
    async connect(roomId, callbacks, options = {}) {
      this.callbacks = callbacks;
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        if (params.get("room"))
          roomId = params.get("room");
        if (params.get("nodeUrl"))
          options.nodeUrl = params.get("nodeUrl");
      }
      this.connectedRoomId = roomId;
      const network = window.moduNetwork;
      if (!network) {
        throw new Error("moduNetwork not found. Include modu-network SDK before calling connect().");
      }
      console.log(`[ecs] Connecting to room "${roomId}"...`);
      try {
        this.connection = await network.connect(roomId, {
          nodeUrl: options.nodeUrl,
          centralServiceUrl: options.centralServiceUrl,
          appId: "dev",
          joinToken: options.joinToken,
          onConnect: (snapshot, inputs, frame, nodeUrl, fps, clientId) => {
            this.handleConnect(snapshot, inputs, frame, fps, clientId);
          },
          onTick: (frame, inputs) => {
            this.handleTick(frame, inputs);
          },
          onDisconnect: () => {
            this.handleDisconnect();
          },
          onBinarySnapshot: (data) => {
            this.handleServerSnapshot(data);
          },
          onError: (error) => {
            console.error("[ecs] Network error:", error);
          }
        });
        this.localClientIdStr = this.connection.clientId;
      } catch (err) {
        console.warn("[ecs] Connection failed:", err?.message || err);
        this.connection = null;
        this.connectedRoomId = null;
      }
    }
    /**
     * Handle initial connection (first join or late join).
     */
    handleConnect(snapshot, inputs, frame, fps, clientId) {
      let snapshotSize = 0;
      if (snapshot instanceof Uint8Array) {
        snapshotSize = snapshot.length;
        if (snapshot.length < 2) {
          snapshot = null;
        } else {
          try {
            snapshot = decode(snapshot)?.snapshot || null;
          } catch (e) {
            console.error("[ecs] Failed to decode snapshot:", e);
            snapshot = null;
          }
        }
      }
      this.localClientIdStr = clientId;
      this.serverFps = fps;
      this.tickIntervalMs = 1e3 / fps;
      this.currentFrame = frame;
      if (snapshot?.hash !== void 0) {
        this.lastSnapshotHash = typeof snapshot.hash === "number" ? snapshot.hash.toString(16).padStart(8, "0") : String(snapshot.hash);
        this.lastSnapshotFrame = snapshot.frame || frame;
        this.lastSnapshotSize = snapshotSize;
        this.lastSnapshotEntityCount = snapshot.entities?.length || 0;
      }
      if (DEBUG_NETWORK) {
        console.log(`[ecs] Connected as ${clientId}, frame ${frame}, fps ${fps}`);
        console.log(`[ecs] Snapshot:`, snapshot ? { frame: snapshot.frame, entityCount: snapshot.entities?.length } : "none");
        console.log(`[ecs] Inputs: ${inputs.length}`);
      }
      const hasValidSnapshot = snapshot?.entities && snapshot.entities.length > 0;
      if (hasValidSnapshot) {
        if (DEBUG_NETWORK)
          console.log(`[ecs] Late join: restoring snapshot frame=${snapshot.frame}`);
        this.currentFrame = snapshot.frame || frame;
        this.loadNetworkSnapshot(snapshot);
        for (const input of inputs) {
          this.processAuthorityChainInput(input);
        }
        if (this.callbacks.onSnapshot) {
          this.callbacks.onSnapshot(this.world.getAllEntities());
        }
        const snapshotSeq = snapshot.seq || 0;
        const pendingInputs = inputs.filter((i) => i.seq > snapshotSeq).sort((a, b) => a.seq - b.seq);
        const snapshotFrame = this.currentFrame;
        const isPostTick = snapshot.postTick === true;
        const startFrame = isPostTick ? snapshotFrame + 1 : snapshotFrame;
        const ticksToRun = frame - startFrame + 1;
        if (DEBUG_NETWORK) {
          console.log(`[ecs] Catchup: from ${startFrame} to ${frame} (${ticksToRun} ticks), ${pendingInputs.length} pending inputs`);
        }
        if (ticksToRun > 0) {
          this.runCatchup(startFrame, frame, pendingInputs);
        }
      } else {
        if (DEBUG_NETWORK)
          console.log("[ecs] First join: creating room");
        this.currentFrame = frame;
        this.callbacks.onRoomCreate?.();
        for (const input of inputs) {
          this.processInput(input);
        }
      }
      if (this.checkIsAuthority()) {
        this.sendSnapshot("init");
      }
      this.startGameLoop();
      if (DEBUG_NETWORK)
        console.log("[ecs] Game loop started");
    }
    /**
     * Handle server tick.
     */
    handleTick(frame, inputs) {
      if (frame <= this.lastProcessedFrame) {
        if (DEBUG_NETWORK) {
          console.log(`[ecs] Skipping old frame ${frame} (already at ${this.lastProcessedFrame})`);
        }
        return;
      }
      this.currentFrame = frame;
      this.lastProcessedFrame = frame;
      if (DEBUG_NETWORK && inputs.length > 0) {
        const types = inputs.map((i) => i.data?.type || "game").join(",");
        console.log(`[ecs] onTick frame=${frame}: ${inputs.length} inputs (${types})`);
      }
      const sortedInputs = inputs.length > 1 ? [...inputs].sort((a, b) => (a.seq || 0) - (b.seq || 0)) : inputs;
      for (const input of sortedInputs) {
        this.processInput(input);
      }
      this.world.tick(frame, []);
      this.callbacks.onTick?.(frame);
      if (this.pendingSnapshotUpload && this.checkIsAuthority()) {
        this.sendSnapshot("join");
        this.pendingSnapshotUpload = false;
      }
      this.lastTickTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    }
    /**
     * Process a network input (join/leave/game).
     */
    processInput(input) {
      let data = input.data;
      if (data instanceof Uint8Array) {
        try {
          data = decode(data);
        } catch (e) {
          console.warn("[ecs] Failed to decode input:", e);
          return;
        }
      }
      const clientId = data?.clientId || input.clientId;
      const type = data?.type;
      this.recentInputs.push({
        frame: this.currentFrame,
        seq: input.seq,
        clientId,
        data: JSON.parse(JSON.stringify(data))
      });
      if (this.recentInputs.length > 500) {
        this.recentInputs.shift();
      }
      if (input.seq > this.lastInputSeq) {
        this.lastInputSeq = input.seq;
      }
      if (type === "join") {
        if (!this.connectedClients.includes(clientId)) {
          this.connectedClients.push(clientId);
        }
        if (this.authorityClientId === null) {
          this.authorityClientId = clientId;
        }
        if (DEBUG_NETWORK) {
          console.log(`[ecs] Join: ${clientId.slice(0, 8)}, authority=${this.authorityClientId?.slice(0, 8)}`);
        }
        if (this.clientsWithEntitiesFromSnapshot.has(clientId)) {
          if (DEBUG_NETWORK) {
            console.log(`[ecs] Skipping onConnect for ${clientId.slice(0, 8)} - already has entity from snapshot`);
          }
        } else {
          this.callbacks.onConnect?.(clientId);
        }
        if (this.checkIsAuthority()) {
          this.pendingSnapshotUpload = true;
        }
      } else if (type === "leave" || type === "disconnect") {
        const idx = this.connectedClients.indexOf(clientId);
        if (idx !== -1) {
          this.connectedClients.splice(idx, 1);
        }
        if (clientId === this.authorityClientId) {
          this.authorityClientId = this.connectedClients[0] || null;
        }
        if (DEBUG_NETWORK) {
          console.log(`[ecs] Leave: ${clientId.slice(0, 8)}, new authority=${this.authorityClientId?.slice(0, 8)}`);
        }
        this.callbacks.onDisconnect?.(clientId);
      } else if (data) {
        this.routeInputToEntity(clientId, data);
      }
    }
    /**
     * Route game input to the world's input registry for systems to read.
     */
    routeInputToEntity(clientId, data) {
      const numId = this.internClientId(clientId);
      const entity = this.world.getEntityByClientId(numId);
      if (DEBUG_NETWORK) {
        console.log(`[ecs] routeInput: clientId=${clientId.slice(0, 8)}, numId=${numId}, entity=${entity?.eid || "null"}, data=${JSON.stringify(data)}`);
      }
      if (entity) {
        this.world.setInput(numId, data);
      } else if (DEBUG_NETWORK) {
        console.log(`[ecs] WARNING: No entity for clientId ${clientId.slice(0, 8)} (numId=${numId})`);
      }
    }
    /**
     * Process input for authority chain only (no game logic).
     */
    processAuthorityChainInput(input) {
      let data = input.data;
      if (data instanceof Uint8Array) {
        try {
          data = decode(data);
        } catch {
          return;
        }
      }
      const clientId = data?.clientId || input.clientId;
      const type = data?.type;
      if (type === "join") {
        if (!this.connectedClients.includes(clientId)) {
          this.connectedClients.push(clientId);
        }
        if (this.authorityClientId === null) {
          this.authorityClientId = clientId;
        }
      } else if (type === "leave" || type === "disconnect") {
        const idx = this.connectedClients.indexOf(clientId);
        if (idx !== -1) {
          this.connectedClients.splice(idx, 1);
        }
        if (clientId === this.authorityClientId) {
          this.authorityClientId = this.connectedClients[0] || null;
        }
      }
    }
    /**
     * Run catchup simulation.
     */
    runCatchup(startFrame, endFrame, inputs) {
      const ticksToRun = endFrame - startFrame + 1;
      if (DEBUG_NETWORK) {
        console.log(`[ecs] Catchup: ${ticksToRun} ticks from ${startFrame} to ${endFrame}, ${inputs.length} inputs`);
      }
      const sortedInputs = [...inputs].sort((a, b) => (a.seq || 0) - (b.seq || 0));
      const inputsByFrame = /* @__PURE__ */ new Map();
      for (const input of sortedInputs) {
        const frame = input.frame ?? startFrame;
        if (!inputsByFrame.has(frame)) {
          inputsByFrame.set(frame, []);
        }
        inputsByFrame.get(frame).push(input);
      }
      for (let f = 0; f < ticksToRun; f++) {
        const tickFrame = startFrame + f;
        const frameInputs = inputsByFrame.get(tickFrame) || [];
        for (const input of frameInputs) {
          this.processInput(input);
        }
        this.world.tick(tickFrame, []);
        this.callbacks.onTick?.(tickFrame);
      }
      this.currentFrame = endFrame;
      this.lastProcessedFrame = endFrame;
      this.clientsWithEntitiesFromSnapshot.clear();
      if (DEBUG_NETWORK) {
        console.log(`[ecs] Catchup complete at frame ${this.currentFrame}, hash=${this.getStateHash()}`);
      }
    }
    // ==========================================
    // Snapshot Methods
    // ==========================================
    /**
     * Convert ECS snapshot to network wire format.
     */
    getNetworkSnapshot() {
      const types = [];
      const typeToIndex = /* @__PURE__ */ new Map();
      const schema = [];
      const typeSyncFields = /* @__PURE__ */ new Map();
      const entities = [];
      for (const entity of this.world.getAllEntities()) {
        const index = entity.eid & INDEX_MASK;
        const type = entity.type;
        if (!typeToIndex.has(type)) {
          const typeIdx = types.length;
          types.push(type);
          typeToIndex.set(type, typeIdx);
          const entityDef = this.world.getEntityDef(type);
          const syncFieldsSet2 = entityDef?.syncFields ? new Set(entityDef.syncFields) : null;
          typeSyncFields.set(type, syncFieldsSet2);
          const typeSchema = [];
          for (const comp of entity.getComponents()) {
            const fieldsToSync = syncFieldsSet2 ? comp.fieldNames.filter((f) => syncFieldsSet2.has(f)) : comp.fieldNames;
            if (fieldsToSync.length > 0) {
              typeSchema.push([comp.name, fieldsToSync]);
            }
          }
          schema.push(typeSchema);
        }
        const syncFieldsSet = typeSyncFields.get(type);
        const values = [];
        for (const comp of entity.getComponents()) {
          for (const fieldName of comp.fieldNames) {
            if (!syncFieldsSet || syncFieldsSet.has(fieldName)) {
              values.push(comp.storage.fields[fieldName][index]);
            }
          }
        }
        entities.push([
          entity.eid,
          // eid as number (no need for hex conversion)
          typeToIndex.get(type),
          // type INDEX (1 byte) instead of string
          values
        ]);
      }
      let maxIndex = 0;
      const activeGenerations = {};
      for (const e of entities) {
        const eid = e[0];
        const index = eid & INDEX_MASK;
        const gen = eid >>> 20;
        if (index >= maxIndex)
          maxIndex = index + 1;
        activeGenerations[index] = gen;
      }
      return {
        frame: this.currentFrame,
        seq: this.lastInputSeq,
        format: 5,
        // Format 5: type-indexed compact encoding
        types,
        // Type names array (sent once)
        schema,
        // Component schemas indexed by type index
        entities,
        // Array of [eid, typeIndex, values[]]
        idAllocatorState: {
          nextIndex: maxIndex,
          freeList: [],
          generations: activeGenerations
        },
        rng: saveRandomState(),
        strings: this.world.strings.getState(),
        clientIdMap: {
          toNum: Object.fromEntries(this.clientIdToNum),
          nextNum: this.nextClientNum
        },
        inputState: this.world.getInputState()
      };
    }
    /**
     * Load network snapshot into ECS world.
     */
    loadNetworkSnapshot(snapshot) {
      if (DEBUG_NETWORK) {
        console.log(`[ecs] Loading snapshot: ${snapshot.entities?.length} entities`);
      }
      this.world.reset();
      if (this.physics) {
        this.physics.clear();
      }
      if (snapshot.rng) {
        loadRandomState(snapshot.rng);
      }
      if (snapshot.strings) {
        this.world.strings.setState(snapshot.strings);
      }
      if (snapshot.clientIdMap) {
        this.clientIdToNum = new Map(Object.entries(snapshot.clientIdMap.toNum).map(([k, v]) => [k, v]));
        this.numToClientId = new Map(Array.from(this.clientIdToNum.entries()).map(([k, v]) => [v, k]));
        this.nextClientNum = snapshot.clientIdMap.nextNum || 1;
      }
      const types = snapshot.types;
      const schema = snapshot.schema;
      const entitiesData = snapshot.entities;
      const loadedEntitiesByType = /* @__PURE__ */ new Map();
      for (const entityData of entitiesData) {
        const [eid, typeIndex, values] = entityData;
        const type = types[typeIndex];
        const typeSchema = schema[typeIndex];
        let entity;
        try {
          entity = this.world.spawnWithId(type, eid, {});
        } catch (e) {
          console.warn(`[ecs] Failed to spawn ${type} with eid ${eid}:`, e);
          continue;
        }
        if (!loadedEntitiesByType.has(type)) {
          loadedEntitiesByType.set(type, []);
        }
        loadedEntitiesByType.get(type).push(entity);
        const index = eid & INDEX_MASK;
        let valueIdx = 0;
        for (const [compName, fieldNames] of typeSchema) {
          for (const comp of entity.getComponents()) {
            if (comp.name === compName) {
              for (const fieldName of fieldNames) {
                comp.storage.fields[fieldName][index] = values[valueIdx++];
              }
              break;
            }
          }
        }
        if (entity.has(Player)) {
          const player = entity.get(Player);
          if (player.clientId !== 0) {
            this.world.setEntityClientId(entity.eid, player.clientId);
          }
        }
      }
      for (const [type, entities] of loadedEntitiesByType) {
        const entityDef = this.world.getEntityDef(type);
        if (entityDef?.onRestore) {
          for (const entity of entities) {
            entityDef.onRestore(entity, this);
          }
        }
      }
      this.lastInputSeq = snapshot.seq || 0;
      if (snapshot.idAllocatorState) {
        const state = snapshot.idAllocatorState;
        if (snapshot.format >= 3 && typeof state.generations === "object" && !Array.isArray(state.generations)) {
          this.world.idAllocator.reset();
          this.world.idAllocator.setNextId(state.nextIndex);
          for (const [indexStr, gen] of Object.entries(state.generations)) {
            const index = parseInt(indexStr, 10);
            this.world.idAllocator.generations[index] = gen;
          }
          const freeList = [];
          for (let i = 0; i < state.nextIndex; i++) {
            if (!(i.toString() in state.generations)) {
              freeList.push(i);
            }
          }
          this.world.idAllocator.freeList = freeList;
        } else {
          this.world.idAllocator.setState(state);
        }
      }
      this.clientsWithEntitiesFromSnapshot.clear();
      for (const entity of this.world.query(Player)) {
        const player = entity.get(Player);
        if (player.clientId !== 0) {
          const clientIdStr = this.getClientIdString(player.clientId);
          if (clientIdStr) {
            this.clientsWithEntitiesFromSnapshot.add(clientIdStr);
            if (DEBUG_NETWORK) {
              console.log(`[ecs] Snapshot has entity for client ${clientIdStr.slice(0, 8)}`);
            }
          }
        }
      }
      if (this.physics) {
        this.physics.wakeAllBodies();
      }
      if (snapshot.inputState) {
        this.world.setInputState(snapshot.inputState);
      }
      if (DEBUG_NETWORK) {
        console.log(`[ecs] Snapshot loaded: ${this.world.getAllEntities().length} entities, hash=${this.getStateHash()}`);
        const firstEntity = this.world.getAllEntities()[0];
        if (firstEntity) {
          const components = {};
          for (const comp of firstEntity.getComponents()) {
            const data = {};
            for (const fieldName of comp.fieldNames) {
              data[fieldName] = firstEntity.get(comp)[fieldName];
            }
            components[comp.name] = data;
          }
          console.log(`[ecs] Restored first entity: type=${firstEntity.type}, components=`, JSON.stringify(components));
        }
      }
    }
    /**
     * Send snapshot to network.
     */
    sendSnapshot(source) {
      if (!this.connection)
        return;
      if (this.physics) {
        this.physics.wakeAllBodies();
      }
      const snapshot = this.getNetworkSnapshot();
      const hash = this.world.getStateHash();
      const binary = encode({ snapshot, hash });
      const entitiesSize = encode(snapshot.entities).length;
      const schemaSize = encode(snapshot.schema).length;
      const entityCount = snapshot.entities.length;
      console.log(`[SNAPSHOT-SIZE] Total: ${binary.length}B | entities: ${entitiesSize}B (${entityCount}) | schema: ${schemaSize}B`);
      if (DEBUG_NETWORK) {
        console.log(`[ecs] Sending snapshot (${source}): ${binary.length} bytes, ${entityCount} entities, hash=${hash}`);
      }
      this.connection.sendSnapshot(binary, hash, snapshot.seq, snapshot.frame);
      this.lastSnapshotHash = hash;
      this.lastSnapshotFrame = snapshot.frame;
      this.lastSnapshotSize = binary.length;
      this.lastSnapshotEntityCount = entityCount;
    }
    /**
     * Handle server snapshot (for drift detection).
     */
    handleServerSnapshot(data) {
      if (DEBUG_NETWORK) {
        console.log(`[ecs] Received server snapshot: ${data.length} bytes`);
      }
      try {
        const decoded = decode(data);
        const serverSnapshot = decoded?.snapshot;
        const serverHash = decoded?.hash;
        if (serverSnapshot) {
          this.lastSnapshotHash = serverHash;
          this.lastSnapshotFrame = serverSnapshot.frame;
          this.lastSnapshotSize = data.length;
          this.lastSnapshotEntityCount = serverSnapshot.entities?.length || 0;
          if (this.currentFrame === serverSnapshot.frame) {
            this.compareSnapshotFields(serverSnapshot);
            const localHash = this.getStateHash();
            if (localHash !== serverHash) {
              console.warn(`[ecs] DRIFT detected at frame ${serverSnapshot.frame}: local=${localHash}, server=${serverHash}`);
            }
          } else {
            this.driftStats = {
              determinismPercent: 100,
              totalChecks: 0,
              matchingFieldCount: 0,
              totalFieldCount: 0
            };
          }
        }
      } catch (e) {
        console.warn("[ecs] Failed to decode server snapshot:", e);
      }
    }
    /**
     * Compare server snapshot fields with local state for drift tracking.
     */
    compareSnapshotFields(serverSnapshot) {
      const frame = serverSnapshot.frame;
      let matchingFields = 0;
      let totalFields = 0;
      const diffs = [];
      this.lastServerSnapshot = { raw: null, decoded: serverSnapshot, frame };
      const types = serverSnapshot.types || [];
      const serverEntities = serverSnapshot.entities || [];
      const schema = serverSnapshot.schema || [];
      const serverEntityMap = /* @__PURE__ */ new Map();
      for (const e of serverEntities) {
        serverEntityMap.set(e[0], e);
      }
      for (const entity of this.world.getAllEntities()) {
        const eid = entity.eid;
        const serverEntity = serverEntityMap.get(eid);
        const index = eid & INDEX_MASK;
        if (!serverEntity) {
          for (const comp of entity.getComponents()) {
            totalFields += comp.fieldNames.length;
            for (const fieldName of comp.fieldNames) {
              diffs.push({ entity: entity.type, eid, comp: comp.name, field: fieldName, local: "EXISTS", server: "MISSING" });
            }
          }
          continue;
        }
        const [, typeIndex, serverValues] = serverEntity;
        const typeSchema = schema[typeIndex];
        if (!typeSchema)
          continue;
        let valueIdx = 0;
        for (const [compName, fieldNames] of typeSchema) {
          const localComp = entity.getComponents().find((c) => c.name === compName);
          for (const fieldName of fieldNames) {
            totalFields++;
            const serverValue = serverValues[valueIdx++];
            if (localComp) {
              const localValue = localComp.storage.fields[fieldName][index];
              const fieldDef = localComp.schema[fieldName];
              let valuesMatch = false;
              if (fieldDef?.type === "bool") {
                const localBool = localValue !== 0;
                const serverBool = serverValue !== 0 && serverValue !== false;
                valuesMatch = localBool === serverBool;
              } else {
                valuesMatch = localValue === serverValue;
              }
              if (valuesMatch) {
                matchingFields++;
              } else {
                diffs.push({ entity: entity.type, eid, comp: compName, field: fieldName, local: localValue, server: serverValue });
              }
            }
          }
        }
      }
      for (const [eid, serverEntity] of serverEntityMap) {
        if (this.world.getEntity(eid) === null) {
          const [, typeIndex, serverValues] = serverEntity;
          const serverType = types[typeIndex] || `type${typeIndex}`;
          totalFields += serverValues.length;
          diffs.push({ entity: serverType, eid, comp: "*", field: "*", local: "MISSING", server: "EXISTS" });
        }
      }
      const newPercent = totalFields > 0 ? matchingFields / totalFields * 100 : 100;
      const wasSync = this.lastSyncPercent === 100;
      const isSync = newPercent === 100;
      if (isSync) {
        this.lastGoodSnapshot = {
          snapshot: JSON.parse(JSON.stringify(serverSnapshot)),
          frame,
          hash: this.getStateHash()
        };
      }
      if (wasSync && !isSync && !this.divergenceCaptured) {
        this.firstDivergenceFrame = frame;
        this.divergenceHistory = [];
        this.divergenceCaptured = true;
        const lastGoodFrame = this.lastGoodSnapshot?.frame ?? 0;
        const inputsInRange = this.recentInputs.filter((i) => i.frame > lastGoodFrame && i.frame <= frame);
        const localSnapshot = this.world.getState();
        this.divergenceCapture = {
          lastGoodSnapshot: this.lastGoodSnapshot?.snapshot ?? null,
          lastGoodFrame,
          inputs: inputsInRange,
          localSnapshot,
          serverSnapshot,
          diffs,
          divergenceFrame: frame,
          clientId: this.localClientIdStr,
          isAuthority: this.checkIsAuthority()
        };
        this.showDivergenceDiff(diffs, inputsInRange, frame);
      }
      this.lastSyncPercent = newPercent;
      this.driftStats.totalChecks++;
      this.driftStats.matchingFieldCount = matchingFields;
      this.driftStats.totalFieldCount = totalFields;
      this.driftStats.determinismPercent = newPercent;
      if (diffs.length > 0 && newPercent < 100 && this.divergenceCaptured && frame % 60 === 0) {
        console.warn(`[DIVERGENCE] Frame ${frame}: still diverged (${newPercent.toFixed(1)}% sync, first at ${this.firstDivergenceFrame})`);
      }
    }
    /**
     * Show divergence debug data (auto-called on first divergence).
     */
    showDivergenceDiff(diffs, inputs, frame) {
      const lines = [];
      const lastGoodFrame = this.lastGoodSnapshot?.frame ?? 0;
      lines.push(`=== DIVERGENCE DEBUG DATA ===`);
      lines.push(`Frame: ${frame} | Last good: ${lastGoodFrame} | Client: ${this.localClientIdStr?.slice(0, 8)} | Authority: ${this.checkIsAuthority()}`);
      lines.push(``);
      lines.push(`DIVERGENT FIELDS (${diffs.length}):`);
      for (const d of diffs) {
        const delta = typeof d.local === "number" && typeof d.server === "number" ? ` \u0394${d.local - d.server}` : "";
        lines.push(`  ${d.entity}#${d.eid.toString(16)}.${d.comp}.${d.field}: local=${d.local} server=${d.server}${delta}`);
      }
      lines.push(``);
      lines.push(`INPUTS (${inputs.length}):`);
      for (const input of inputs) {
        lines.push(`  f${input.frame} ${input.clientId.slice(0, 8)}: ${JSON.stringify(input.data)}`);
      }
      lines.push(``);
      if (this.lastGoodSnapshot) {
        const goodEnts = Object.keys(this.lastGoodSnapshot.snapshot.entities || {}).length;
        lines.push(`LAST GOOD SNAPSHOT (f${lastGoodFrame}): ${goodEnts} entities`);
      } else {
        lines.push(`LAST GOOD SNAPSHOT: none (never had 100% sync)`);
      }
      if (this.lastServerSnapshot.decoded) {
        const serverEnts = Object.keys(this.lastServerSnapshot.decoded.entities || {}).length;
        lines.push(`SERVER SNAPSHOT (f${this.lastServerSnapshot.frame}): ${serverEnts} entities`);
      }
      lines.push(`=== END DEBUG DATA ===`);
      lines.push(`To get detailed replay data: game.getDivergenceReplay()`);
      console.error(lines.join("\n"));
    }
    /**
     * Download divergence replay data as JSON.
     */
    getDivergenceReplay() {
      if (!this.divergenceCapture) {
        console.warn("[REPLAY] No divergence captured yet.");
        return;
      }
      const json = JSON.stringify(this.divergenceCapture, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `divergence-${this.divergenceCapture.divergenceFrame}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log(`[REPLAY] Downloaded (${(json.length / 1024).toFixed(1)} KB)`);
    }
    // ==========================================
    // Game Loop
    // ==========================================
    /**
     * Start the render loop.
     */
    startGameLoop() {
      if (this.gameLoop)
        return;
      let lastSnapshotFrame = 0;
      const SNAPSHOT_INTERVAL = 100;
      const loop = () => {
        if (this.renderer?.render) {
          this.renderer.render();
        } else if (this.callbacks.render) {
          this.callbacks.render();
        }
        if (this.checkIsAuthority() && this.currentFrame - lastSnapshotFrame >= SNAPSHOT_INTERVAL) {
          this.sendSnapshot("loop");
          lastSnapshotFrame = this.currentFrame;
        }
        this.gameLoop = requestAnimationFrame(loop);
      };
      this.gameLoop = requestAnimationFrame(loop);
    }
    /**
     * Stop the render loop.
     */
    stopGameLoop() {
      if (this.gameLoop) {
        cancelAnimationFrame(this.gameLoop);
        this.gameLoop = null;
      }
    }
    /**
     * Handle disconnect.
     */
    handleDisconnect() {
      if (DEBUG_NETWORK)
        console.log("[ecs] Disconnected");
      this.stopGameLoop();
    }
    // ==========================================
    // Utility Methods
    // ==========================================
    /**
     * Check if this client is the authority.
     * Handles potential length mismatch between SDK and server client IDs.
     */
    checkIsAuthority() {
      if (this.localClientIdStr === null || this.authorityClientId === null) {
        return false;
      }
      const minLen = Math.min(this.localClientIdStr.length, this.authorityClientId.length);
      return this.localClientIdStr.substring(0, minLen) === this.authorityClientId.substring(0, minLen);
    }
    /**
     * Check if this client is the authority (public).
     */
    isAuthority() {
      return this.checkIsAuthority();
    }
    /**
     * Check if connected.
     */
    isConnected() {
      return this.connection !== null;
    }
    /**
     * Get current frame.
     */
    getFrame() {
      return this.currentFrame;
    }
    /**
     * Get server tick rate.
     */
    getServerFps() {
      return this.serverFps;
    }
    /**
     * Get render interpolation alpha (0-1).
     */
    getRenderAlpha() {
      if (this.lastTickTime === 0)
        return 1;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = now - this.lastTickTime;
      return Math.min(elapsed / this.tickIntervalMs, 1);
    }
    /**
     * Send input to network.
     */
    sendInput(input) {
      if (!this.connection)
        return;
      const binary = encode(input);
      this.connection.send(binary);
    }
    /**
     * Leave current room.
     */
    leaveRoom() {
      if (this.connection) {
        this.connection.leaveRoom();
        this.connection = null;
        this.stopGameLoop();
      }
    }
    /**
     * Get local client ID.
     */
    get localClientId() {
      return this.localClientIdStr;
    }
    /**
     * Set local client ID.
     */
    setLocalClientId(clientId) {
      this.localClientIdStr = clientId;
      const numId = this.internClientId(clientId);
      this.world.localClientId = numId;
    }
    /**
     * Get room ID.
     */
    getRoomId() {
      return this.connectedRoomId;
    }
    /**
     * Get last snapshot info.
     */
    getLastSnapshot() {
      return {
        hash: this.lastSnapshotHash,
        frame: this.lastSnapshotFrame,
        size: this.lastSnapshotSize,
        entityCount: this.lastSnapshotEntityCount
      };
    }
    /**
     * Get connected clients.
     */
    getClients() {
      return this.connectedClients;
    }
    /**
     * Get client ID (for debug UI).
     */
    getClientId() {
      return this.localClientIdStr;
    }
    /**
     * Get node URL (for debug UI).
     */
    getNodeUrl() {
      return null;
    }
    /**
     * Get upload rate in bytes/second (for debug UI).
     */
    getUploadRate() {
      return this.connection?.bandwidthOut || 0;
    }
    /**
     * Get download rate in bytes/second (for debug UI).
     */
    getDownloadRate() {
      return this.connection?.bandwidthIn || 0;
    }
    /**
     * Get drift stats (for debug UI).
     * Authority clients show 100% until they receive a comparison snapshot.
     */
    getDriftStats() {
      if (this.driftStats.totalChecks === 0) {
        const entityCount = this.world.getAllEntities().length;
        let estimatedFields = 0;
        for (const entity of this.world.getAllEntities()) {
          for (const comp of entity.getComponents()) {
            estimatedFields += comp.fieldNames.length;
          }
        }
        return {
          determinismPercent: 100,
          totalChecks: 0,
          matchingFieldCount: estimatedFields,
          totalFieldCount: estimatedFields
        };
      }
      return { ...this.driftStats };
    }
    /**
     * Attach a renderer.
     */
    setRenderer(renderer) {
      this.renderer = renderer;
    }
    /**
     * Get canvas from attached renderer.
     */
    getCanvas() {
      return this.renderer?.element ?? null;
    }
  };
  var GameEntityBuilder = class {
    constructor(game, name) {
      this.game = game;
      this.name = name;
      this.inputCommandsDef = null;
      this.worldBuilder = game.world.defineEntity(name);
    }
    /**
     * Add a component to the entity definition.
     */
    with(component, defaults) {
      this.worldBuilder.with(component, defaults);
      return this;
    }
    /**
     * Define input commands for this entity type.
     */
    commands(def) {
      this.inputCommandsDef = def;
      return this;
    }
    /**
     * Specify which fields to sync in snapshots (field-level sync).
     * Only the specified fields are included in network snapshots.
     *
     * Use this to reduce bandwidth by only syncing essential fields.
     * Non-synced fields can be reconstructed via onRestore().
     *
     * @example
     * game.defineEntity('snake-segment')
     *     .with(Transform2D)
     *     .with(Sprite)
     *     .with(SnakeSegment)
     *     .syncOnly(['x', 'y', 'ownerId', 'spawnFrame'])
     *     .register();
     */
    syncOnly(fields) {
      this.worldBuilder._setSyncFields(fields);
      return this;
    }
    /**
     * Exclude all fields from syncing for this entity type.
     * The entity will not be included in network snapshots at all.
     *
     * Use this for purely client-local entities like cameras, UI, or effects.
     *
     * @example
     * game.defineEntity('local-camera')
     *     .with(Camera2D)
     *     .syncNone()
     *     .register();
     */
    syncNone() {
      this.worldBuilder._setSyncFields([]);
      return this;
    }
    /**
     * @deprecated Use syncOnly() instead for clarity
     */
    sync(fields) {
      return this.syncOnly(fields);
    }
    /**
     * Set a callback to reconstruct non-synced fields after snapshot load.
     * Called for each entity of this type after loading a snapshot.
     *
     * @example
     * game.defineEntity('snake-segment')
     *     .with(Transform2D)
     *     .with(Sprite)
     *     .with(SnakeSegment)
     *     .syncOnly(['x', 'y', 'ownerId', 'spawnFrame'])
     *     .onRestore((entity, game) => {
     *         const owner = game.world.getEntityByClientId(entity.get(SnakeSegment).ownerId);
     *         if (owner) {
     *             entity.get(Sprite).color = owner.get(Sprite).color;
     *             entity.get(Sprite).radius = SEGMENT_RADIUS;
     *         }
     *     })
     *     .register();
     */
    onRestore(callback) {
      this.worldBuilder._setOnRestore(callback);
      return this;
    }
    /**
     * Finalize and register the entity definition.
     */
    register() {
      this.worldBuilder._ensureRegistered();
      return this.game._registerPrefab(this.name, this.worldBuilder);
    }
  };
  function createGame() {
    return new Game();
  }

  // src/plugins/simple-2d-renderer.ts
  var Simple2DRenderer = class {
    constructor(game, canvas, options = {}) {
      this.imageCache = /* @__PURE__ */ new Map();
      this._cameraEntity = null;
      this.game = game;
      if (typeof canvas === "string") {
        const el = document.querySelector(canvas);
        if (!el)
          throw new Error(`Canvas not found: ${canvas}`);
        this.canvas = el;
      } else {
        this.canvas = canvas;
      }
      const ctx = this.canvas.getContext("2d");
      if (!ctx)
        throw new Error("Could not get 2d context");
      this.ctx = ctx;
      this.options = {
        background: options.background ?? "#111",
        autoClear: options.autoClear ?? true
      };
      game.setRenderer(this);
    }
    /** Canvas width */
    get width() {
      return this.canvas.width;
    }
    /** Canvas height */
    get height() {
      return this.canvas.height;
    }
    /** The canvas element */
    get element() {
      return this.canvas;
    }
    /** The 2D context (for custom drawing) */
    get context() {
      return this.ctx;
    }
    /**
     * Set the camera entity to use for rendering.
     * When set, the renderer will apply camera transform (position, zoom).
     */
    set camera(entity) {
      this._cameraEntity = entity;
      if (entity) {
        try {
          const cam = entity.get(Camera2D);
          cam.viewportWidth = this.canvas.width;
          cam.viewportHeight = this.canvas.height;
        } catch {
        }
      }
    }
    get camera() {
      return this._cameraEntity;
    }
    /**
     * Render all entities with Sprite component.
     */
    render() {
      const { ctx, canvas, options, game } = this;
      if (options.autoClear) {
        ctx.fillStyle = options.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      const alpha = game.getRenderAlpha();
      let camX = 0, camY = 0, camZoom = 1;
      if (this._cameraEntity && !this._cameraEntity.destroyed) {
        try {
          const cam = this._cameraEntity.get(Camera2D);
          camX = cam.x;
          camY = cam.y;
          camZoom = cam.zoom;
          cam.viewportWidth = canvas.width;
          cam.viewportHeight = canvas.height;
        } catch {
        }
      }
      const entities = [];
      for (const entity of game.getAllEntities()) {
        if (entity.destroyed)
          continue;
        try {
          const sprite = entity.get(Sprite);
          if (sprite && sprite.visible) {
            entity.interpolate(alpha);
            entities.push({ entity, layer: sprite.layer });
          }
        } catch {
        }
      }
      entities.sort((a, b) => a.layer - b.layer);
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(camZoom, camZoom);
      ctx.translate(-camX, -camY);
      for (const { entity } of entities) {
        this.drawEntity(entity);
      }
      ctx.restore();
    }
    /**
     * Draw a single entity.
     */
    drawEntity(entity) {
      const { ctx, game } = this;
      const sprite = entity.get(Sprite);
      const x = entity.render.interpX + sprite.offsetX;
      const y = entity.render.interpY + sprite.offsetY;
      const scaleX = sprite.scaleX;
      const scaleY = sprite.scaleY;
      const colorStr = game.getString("color", sprite.color) || "#fff";
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scaleX, scaleY);
      const shape = sprite.shape;
      if (shape === SHAPE_CIRCLE) {
        const radius = sprite.radius;
        ctx.fillStyle = colorStr;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape === SHAPE_RECT) {
        const w = sprite.width;
        const h = sprite.height;
        ctx.fillStyle = colorStr;
        ctx.fillRect(-w / 2, -h / 2, w, h);
      } else if (shape === SPRITE_IMAGE) {
        const imageId = game.getString("sprite", sprite.spriteId);
        if (imageId) {
          const img = this.getImage(imageId);
          if (img && img.complete) {
            const w = sprite.width || img.width;
            const h = sprite.height || img.height;
            ctx.drawImage(img, -w / 2, -h / 2, w, h);
          }
        }
      }
      ctx.restore();
    }
    /**
     * Get or load an image.
     */
    getImage(src) {
      let img = this.imageCache.get(src);
      if (!img) {
        img = new Image();
        img.src = src;
        this.imageCache.set(src, img);
      }
      return img;
    }
    /**
     * Preload images for faster rendering.
     */
    preload(images) {
      return Promise.all(
        images.map((src) => new Promise((resolve) => {
          const img = this.getImage(src);
          if (img?.complete) {
            resolve();
          } else if (img) {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          }
        }))
      ).then(() => {
      });
    }
  };

  // src/plugins/input-plugin.ts
  var InputPlugin = class {
    constructor(game, canvas) {
      /** Action definitions */
      this.actions = /* @__PURE__ */ new Map();
      /** Current bindings (may differ from defaults after rebind) */
      this.bindings = /* @__PURE__ */ new Map();
      /** Raw input state */
      this.mousePos = { x: 0, y: 0 };
      this.keysDown = /* @__PURE__ */ new Set();
      this.mouseButtons = /* @__PURE__ */ new Set();
      /** Send interval handle */
      this.sendInterval = null;
      /** Last sent input (for deduplication) */
      this.lastSentInput = "";
      this.game = game;
      if (typeof canvas === "string") {
        const el = document.querySelector(canvas);
        if (!el)
          throw new Error(`Canvas not found: ${canvas}`);
        this.canvas = el;
      } else {
        this.canvas = canvas;
      }
      this.setupListeners();
      this.startSendLoop();
    }
    /**
     * Define an action with default bindings.
     */
    action(name, def) {
      this.actions.set(name, def);
      if (!this.bindings.has(name)) {
        this.bindings.set(name, [...def.bindings]);
      }
      return this;
    }
    /**
     * Rebind an action to new bindings.
     */
    rebind(name, bindings) {
      if (!this.actions.has(name)) {
        console.warn(`[InputPlugin] Unknown action: ${name}`);
        return this;
      }
      this.bindings.set(name, bindings);
      return this;
    }
    /**
     * Reset action to default bindings.
     */
    resetBinding(name) {
      const action = this.actions.get(name);
      if (action) {
        this.bindings.set(name, [...action.bindings]);
      }
      return this;
    }
    /**
     * Reset all bindings to defaults.
     */
    resetAllBindings() {
      for (const [name, action] of this.actions) {
        this.bindings.set(name, [...action.bindings]);
      }
      return this;
    }
    /**
     * Get current bindings for serialization.
     * Only includes string bindings (callbacks can't be serialized).
     */
    getBindings() {
      const result = {};
      for (const [name, sources] of this.bindings) {
        result[name] = sources.filter((s) => typeof s === "string");
      }
      return result;
    }
    /**
     * Load bindings from serialized data.
     */
    loadBindings(data) {
      for (const [name, sources] of Object.entries(data)) {
        if (this.actions.has(name)) {
          this.bindings.set(name, sources);
        }
      }
      return this;
    }
    /**
     * Get current value of an action.
     */
    get(name) {
      const action = this.actions.get(name);
      const sources = this.bindings.get(name);
      if (!action || !sources)
        return null;
      if (action.type === "button") {
        return this.resolveButton(sources);
      } else {
        return this.resolveVector(sources);
      }
    }
    /**
     * Get all action values as an object.
     */
    getAll() {
      const result = {};
      for (const name of this.actions.keys()) {
        result[name] = this.get(name);
      }
      return result;
    }
    /**
     * Resolve button value from sources (OR logic).
     */
    resolveButton(sources) {
      for (const source of sources) {
        if (typeof source === "function") {
          if (source())
            return true;
        } else if (this.resolveStringButton(source)) {
          return true;
        }
      }
      return false;
    }
    /**
     * Resolve vector value from sources (additive, clamped).
     */
    resolveVector(sources) {
      let x = 0, y = 0;
      for (const source of sources) {
        let vec = null;
        if (typeof source === "function") {
          vec = source();
        } else {
          vec = this.resolveStringVector(source);
        }
        if (vec) {
          x += vec.x;
          y += vec.y;
        }
      }
      if (Math.abs(x) <= 1 && Math.abs(y) <= 1) {
        const len = Math.sqrt(x * x + y * y);
        if (len > 1) {
          x /= len;
          y /= len;
        }
      }
      return { x, y };
    }
    /**
     * Resolve a string binding to button value.
     */
    resolveStringButton(source) {
      if (source.startsWith("key:")) {
        const key = source.slice(4).toLowerCase();
        return this.keysDown.has(key);
      }
      if (source.startsWith("mouse:")) {
        const button = source.slice(6);
        if (button === "left")
          return this.mouseButtons.has(0);
        if (button === "right")
          return this.mouseButtons.has(2);
        if (button === "middle")
          return this.mouseButtons.has(1);
      }
      return false;
    }
    /**
     * Resolve a string binding to vector value.
     */
    resolveStringVector(source) {
      if (source === "mouse") {
        return { ...this.mousePos };
      }
      if (source === "keys:wasd") {
        return this.getWASD();
      }
      if (source === "keys:arrows") {
        return this.getArrows();
      }
      if (source === "keys:wasd+arrows") {
        const wasd = this.getWASD();
        const arrows = this.getArrows();
        return {
          x: Math.max(-1, Math.min(1, wasd.x + arrows.x)),
          y: Math.max(-1, Math.min(1, wasd.y + arrows.y))
        };
      }
      return null;
    }
    /**
     * Get WASD direction.
     */
    getWASD() {
      let x = 0, y = 0;
      if (this.keysDown.has("a"))
        x -= 1;
      if (this.keysDown.has("d"))
        x += 1;
      if (this.keysDown.has("w"))
        y -= 1;
      if (this.keysDown.has("s"))
        y += 1;
      return { x, y };
    }
    /**
     * Get arrow keys direction.
     */
    getArrows() {
      let x = 0, y = 0;
      if (this.keysDown.has("arrowleft"))
        x -= 1;
      if (this.keysDown.has("arrowright"))
        x += 1;
      if (this.keysDown.has("arrowup"))
        y -= 1;
      if (this.keysDown.has("arrowdown"))
        y += 1;
      return { x, y };
    }
    /**
     * Set up event listeners.
     */
    setupListeners() {
      this.canvas.addEventListener("mousemove", (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.mousePos.x = e.clientX - rect.left;
        this.mousePos.y = e.clientY - rect.top;
      });
      this.canvas.addEventListener("mousedown", (e) => {
        this.mouseButtons.add(e.button);
      });
      this.canvas.addEventListener("mouseup", (e) => {
        this.mouseButtons.delete(e.button);
      });
      window.addEventListener("keydown", (e) => {
        this.keysDown.add(e.key.toLowerCase());
      });
      window.addEventListener("keyup", (e) => {
        this.keysDown.delete(e.key.toLowerCase());
      });
      window.addEventListener("blur", () => {
        this.keysDown.clear();
        this.mouseButtons.clear();
      });
    }
    /**
     * Start the send loop.
     */
    startSendLoop() {
      const sendRate = 1e3 / (this.game.getServerFps?.() || 20);
      this.sendInterval = window.setInterval(() => {
        if (this.game.isConnected() && this.game.localClientId && this.actions.size > 0) {
          const input = this.getAll();
          const inputStr = this.inputToString(input);
          if (inputStr !== this.lastSentInput) {
            this.lastSentInput = inputStr;
            this.game.sendInput(input);
          }
        }
      }, sendRate);
    }
    /**
     * Convert input to string for comparison.
     * Uses rounding for vectors to avoid sending tiny mouse movements.
     */
    inputToString(input) {
      const normalized = {};
      for (const [key, value] of Object.entries(input)) {
        if (value && typeof value === "object" && "x" in value && "y" in value) {
          normalized[key] = { x: Math.round(value.x / 10) * 10, y: Math.round(value.y / 10) * 10 };
        } else {
          normalized[key] = value;
        }
      }
      return JSON.stringify(normalized);
    }
    /**
     * Stop the send loop.
     */
    destroy() {
      if (this.sendInterval !== null) {
        clearInterval(this.sendInterval);
        this.sendInterval = null;
      }
    }
  };

  // src/plugins/camera-system.ts
  var CameraSystem = class {
    constructor(game, options = {}) {
      this.game = game;
      this.options = {
        defaultZoom: options.defaultZoom ?? 1,
        defaultSmoothing: options.defaultSmoothing ?? 0.1,
        minZoom: options.minZoom ?? 0.1,
        maxZoom: options.maxZoom ?? 10
      };
      game.addSystem(this.update.bind(this), { phase: "render" });
    }
    /**
     * Update all cameras.
     */
    update() {
      for (const entity of this.game.query("Camera2D")) {
        this.updateCamera(entity);
      }
    }
    /**
     * Update a single camera entity.
     */
    updateCamera(cameraEntity) {
      const cam = cameraEntity.get(Camera2D);
      if (cam.followEntity !== 0) {
        const target = this.game.world.getEntity(cam.followEntity);
        if (target && !target.destroyed) {
          try {
            const transform = target.get(Transform2D);
            cam.x += (transform.x - cam.x) * cam.smoothing;
            cam.y += (transform.y - cam.y) * cam.smoothing;
          } catch {
          }
        }
      }
      if (cam.zoom !== cam.targetZoom) {
        cam.zoom += (cam.targetZoom - cam.zoom) * cam.smoothing;
        cam.zoom = Math.max(this.options.minZoom, Math.min(this.options.maxZoom, cam.zoom));
      }
    }
    /**
     * Set camera to follow an entity.
     */
    follow(cameraEntity, targetEntity) {
      const cam = cameraEntity.get(Camera2D);
      cam.followEntity = targetEntity ? targetEntity.eid : 0;
    }
    /**
     * Center camera on multiple entities (weighted by optional areas).
     */
    centerOn(cameraEntity, entities, weights) {
      if (entities.length === 0)
        return;
      const cam = cameraEntity.get(Camera2D);
      let totalWeight = 0;
      let centerX = 0;
      let centerY = 0;
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (entity.destroyed)
          continue;
        try {
          const transform = entity.get(Transform2D);
          const weight = weights?.[i] ?? 1;
          centerX += transform.x * weight;
          centerY += transform.y * weight;
          totalWeight += weight;
        } catch {
        }
      }
      if (totalWeight > 0) {
        cam.x += (centerX / totalWeight - cam.x) * cam.smoothing;
        cam.y += (centerY / totalWeight - cam.y) * cam.smoothing;
      }
    }
    /**
     * Convert world coordinates to screen coordinates.
     */
    worldToScreen(cameraEntity, worldX, worldY) {
      const cam = cameraEntity.get(Camera2D);
      return {
        x: (worldX - cam.x) * cam.zoom + cam.viewportWidth / 2,
        y: (worldY - cam.y) * cam.zoom + cam.viewportHeight / 2
      };
    }
    /**
     * Convert screen coordinates to world coordinates.
     */
    screenToWorld(cameraEntity, screenX, screenY) {
      const cam = cameraEntity.get(Camera2D);
      return {
        x: (screenX - cam.viewportWidth / 2) / cam.zoom + cam.x,
        y: (screenY - cam.viewportHeight / 2) / cam.zoom + cam.y
      };
    }
    /**
     * Set zoom with optional target position.
     */
    setZoom(cameraEntity, zoom, immediate = false) {
      const cam = cameraEntity.get(Camera2D);
      const clampedZoom = Math.max(this.options.minZoom, Math.min(this.options.maxZoom, zoom));
      cam.targetZoom = clampedZoom;
      if (immediate) {
        cam.zoom = clampedZoom;
      }
    }
    /**
     * Get visible bounds in world coordinates.
     */
    getVisibleBounds(cameraEntity) {
      const cam = cameraEntity.get(Camera2D);
      const halfWidth = cam.viewportWidth / 2 / cam.zoom;
      const halfHeight = cam.viewportHeight / 2 / cam.zoom;
      return {
        left: cam.x - halfWidth,
        top: cam.y - halfHeight,
        right: cam.x + halfWidth,
        bottom: cam.y + halfHeight
      };
    }
    /**
     * Check if a world point is visible.
     */
    isPointVisible(cameraEntity, worldX, worldY, margin = 0) {
      const bounds = this.getVisibleBounds(cameraEntity);
      return worldX >= bounds.left - margin && worldX <= bounds.right + margin && worldY >= bounds.top - margin && worldY <= bounds.bottom + margin;
    }
  };

  // src/plugins/determinism-guard.ts
  var originalFunctions = {};
  var installedGame = null;
  var warnedFunctions = /* @__PURE__ */ new Set();
  function isSimulating() {
    return installedGame?.world?._isSimulating ?? false;
  }
  function warnOnce(key, message) {
    if (!warnedFunctions.has(key)) {
      warnedFunctions.add(key);
      console.warn(message);
    }
  }
  function enableDeterminismGuard(game) {
    if (installedGame) {
      console.warn("Determinism guard already installed for another game instance");
      return;
    }
    installedGame = game;
    warnedFunctions.clear();
    originalFunctions.mathRandom = Math.random;
    Math.random = function() {
      if (isSimulating()) {
        warnOnce(
          "Math.random",
          "\u26A0\uFE0F Math.random() is non-deterministic!\n   Use dRandom() instead for deterministic random numbers.\n   Example: const r = dRandom();"
        );
      }
      return originalFunctions.mathRandom();
    };
    originalFunctions.mathSqrt = Math.sqrt;
    Math.sqrt = function(x) {
      if (isSimulating()) {
        warnOnce(
          "Math.sqrt",
          "\u26A0\uFE0F Math.sqrt() is non-deterministic!\n   Use dSqrt() instead for deterministic square root.\n   Example: const dist = dSqrt(dx * dx + dy * dy);"
        );
      }
      return originalFunctions.mathSqrt(x);
    };
    originalFunctions.dateNow = Date.now;
    Date.now = function() {
      if (isSimulating()) {
        warnOnce(
          "Date.now",
          "\u26A0\uFE0F Date.now() is non-deterministic!\n   Use game.time instead for deterministic timing.\n   Example: const respawnAt = game.time + 3000;"
        );
      }
      return originalFunctions.dateNow();
    };
    if (typeof performance !== "undefined") {
      originalFunctions.performanceNow = performance.now.bind(performance);
      performance.now = function() {
        if (isSimulating()) {
          warnOnce(
            "performance.now",
            "\u26A0\uFE0F performance.now() is non-deterministic!\n   Use game.time instead for deterministic timing."
          );
        }
        return originalFunctions.performanceNow();
      };
    }
    console.log("\u{1F6E1}\uFE0F Determinism guard enabled");
  }
  function disableDeterminismGuard() {
    if (originalFunctions.mathRandom) {
      Math.random = originalFunctions.mathRandom;
    }
    if (originalFunctions.mathSqrt) {
      Math.sqrt = originalFunctions.mathSqrt;
    }
    if (originalFunctions.dateNow) {
      Date.now = originalFunctions.dateNow;
    }
    if (originalFunctions.performanceNow && typeof performance !== "undefined") {
      performance.now = originalFunctions.performanceNow;
    }
    installedGame = null;
    warnedFunctions.clear();
    Object.keys(originalFunctions).forEach((key) => {
      delete originalFunctions[key];
    });
  }

  // src/plugins/debug-ui.ts
  var debugDiv = null;
  var updateInterval = null;
  var hashCallback = null;
  var debugTarget = null;
  var frameCount = 0;
  var renderFps = 0;
  var fpsUpdateTime = 0;
  function enableDebugUI(target, options = {}) {
    if (debugDiv)
      return debugDiv;
    debugTarget = target || null;
    if (target && "world" in target) {
      enableDeterminismGuard(target);
    }
    const pos = options.position || "top-right";
    debugDiv = document.createElement("div");
    debugDiv.id = "modu-debug-ui";
    debugDiv.style.cssText = `
        position: fixed;
        ${pos.includes("top") ? "top: 10px" : "bottom: 10px"};
        ${pos.includes("right") ? "right: 10px" : "left: 10px"};
        background: rgba(0, 0, 0, 0.8);
        color: #0f0;
        font: 12px monospace;
        padding: 8px 12px;
        border-radius: 4px;
        z-index: 10000;
        min-width: 180px;
        pointer-events: none;
    `;
    document.body.appendChild(debugDiv);
    const update = (now) => {
      if (!debugDiv)
        return;
      frameCount++;
      if (now - fpsUpdateTime >= 1e3) {
        renderFps = frameCount;
        frameCount = 0;
        fpsUpdateTime = now;
      }
      const eng = debugTarget;
      if (!eng) {
        debugDiv.innerHTML = '<div style="color:#f00">No engine instance</div>';
        return;
      }
      const clientId = eng.getClientId();
      const frame = eng.getFrame();
      const nodeUrl = eng.getNodeUrl();
      const lastSnap = eng.getLastSnapshot();
      const fps = eng.getServerFps();
      const roomId = eng.getRoomId();
      const up = eng.getUploadRate();
      const down = eng.getDownloadRate();
      const clients = eng.getClients();
      const isAuthority = eng.isAuthority?.() || false;
      let currentHash = "--------";
      try {
        if (hashCallback) {
          const hash = hashCallback();
          currentHash = typeof hash === "number" ? hash.toString(16).padStart(8, "0") : String(hash).slice(0, 8);
        } else {
          currentHash = eng.getStateHash();
        }
      } catch (e) {
        currentHash = "error";
      }
      const formatBandwidth = (bytes) => {
        if (bytes >= 1024) {
          return (bytes / 1024).toFixed(1) + " kB/s";
        }
        return Math.round(bytes) + " B/s";
      };
      const upStr = formatBandwidth(up);
      const downStr = formatBandwidth(down);
      const driftStats = eng.getDriftStats?.() || { determinismPercent: 100, totalChecks: 0, matchingFieldCount: 0, totalFieldCount: 0 };
      const detPct = driftStats.determinismPercent.toFixed(1);
      const detColor = driftStats.determinismPercent >= 99.9 ? "#0f0" : driftStats.determinismPercent >= 95 ? "#ff0" : "#f00";
      let syncStatus;
      if (isAuthority) {
        syncStatus = `<span style="color:#888">I'm authority</span>`;
      } else if (driftStats.totalChecks === 0) {
        syncStatus = '<span style="color:#888">waiting...</span>';
      } else {
        syncStatus = `<span style="color:${detColor}">${detPct}%</span> <span style="color:#888">(${driftStats.matchingFieldCount}/${driftStats.totalFieldCount})</span>`;
      }
      const framesAgo = lastSnap.frame ? frame - lastSnap.frame : 0;
      const snapInfo = lastSnap.hash ? `${lastSnap.hash.slice(0, 8)} <span style="color:#888">(${framesAgo} ago)</span>` : "none";
      const formatSize = (bytes) => {
        if (bytes >= 1024 * 1024) {
          return (bytes / (1024 * 1024)).toFixed(2) + " MB";
        } else if (bytes >= 1024) {
          return (bytes / 1024).toFixed(1) + " KB";
        }
        return bytes + " B";
      };
      const sizeStr = lastSnap.size > 0 ? formatSize(lastSnap.size) : "-";
      const entityStr = lastSnap.entityCount > 0 ? String(lastSnap.entityCount) : "-";
      const sectionStyle = "color:#666;font-size:10px;margin-top:6px;margin-bottom:2px;border-bottom:1px solid #333;";
      debugDiv.innerHTML = `
            <div style="${sectionStyle}">ROOM</div>
            <div>ID: <span style="color:#fff">${roomId || "-"}</span></div>
            <div>Players: <span style="color:#ff0">${clients.length}</span></div>
            <div>Frame: <span style="color:#fff">${frame}</span></div>
            <div>URL: <span style="color:#0ff">${nodeUrl || "-"}</span></div>

            <div style="${sectionStyle}">ME</div>
            <div>Authority: <span style="color:${isAuthority ? "#0ff" : "#888"}">${isAuthority ? "Yes" : "No"}</span></div>
            <div>Client: <span style="color:#ff0">${clientId ? clientId.slice(0, 8) : "-"}</span></div>

            <div style="${sectionStyle}">ENGINE</div>
            <div>FPS: <span style="color:#0f0">${renderFps}</span> render, <span style="color:#0f0">${fps}</span> tick</div>
            <div>Net: <span style="color:#0f0">${upStr}</span> up, <span style="color:#f80">${downStr}</span> down</div>

            <div style="${sectionStyle}">SNAPSHOT</div>
            <div>Current: <span style="color:#f0f">${currentHash}</span></div>
            <div>Received: <span style="color:#f80">${snapInfo}</span></div>
            <div>Size: <span style="color:#fff">${sizeStr}</span>, Entities: <span style="color:#fff">${entityStr}</span></div>
            <div>Last Sync: ${syncStatus}</div>
        `;
    };
    const loop = (now) => {
      update(now);
      updateInterval = requestAnimationFrame(loop);
    };
    fpsUpdateTime = performance.now();
    requestAnimationFrame(loop);
    return debugDiv;
  }

  // src/plugins/physics2d/index.ts
  var physics2d_exports = {};
  __export(physics2d_exports, {
    BodyType2D: () => BodyType2D,
    DEFAULT_FILTER: () => DEFAULT_FILTER,
    Layers: () => Layers,
    QuadTree2D: () => QuadTree2D,
    Shape2DType: () => Shape2DType,
    SpatialHash2D: () => SpatialHash2D,
    TriggerState: () => TriggerState,
    aabb2DArea: () => aabb2DArea,
    aabb2DOverlap: () => aabb2DOverlap,
    aabb2DUnion: () => aabb2DUnion,
    addBody2D: () => addBody2D,
    applyForce2D: () => applyForce2D,
    applyImpulse2D: () => applyImpulse2D,
    computeAABB2D: () => computeAABB2D,
    createBody2D: () => createBody2D,
    createBox2D: () => createBox2D,
    createBox2DFromSize: () => createBox2DFromSize,
    createCircle: () => createCircle,
    createFilter: () => createFilter,
    createWorld2D: () => createWorld2D,
    detectCollision2D: () => detectCollision2D,
    filterCollidingWith: () => filterCollidingWith,
    filterExcluding: () => filterExcluding,
    getBody2DIdCounter: () => getBody2DIdCounter,
    loadWorldState2D: () => loadWorldState2D,
    makeTrigger: () => makeTrigger,
    removeBody2D: () => removeBody2D,
    resetBody2DIdCounter: () => resetBody2DIdCounter,
    resolveCollision2D: () => resolveCollision2D,
    saveWorldState2D: () => saveWorldState2D,
    setBody2DIdCounter: () => setBody2DIdCounter,
    setBody2DMass: () => setBody2DMass,
    setBody2DVelocity: () => setBody2DVelocity,
    shouldCollide: () => shouldCollide,
    stepWorld2D: () => stepWorld2D,
    vec2: () => vec22,
    vec2Add: () => vec2Add2,
    vec2Clone: () => vec2Clone2,
    vec2Cross: () => vec2Cross2,
    vec2Dot: () => vec2Dot2,
    vec2LengthSq: () => vec2LengthSq2,
    vec2Scale: () => vec2Scale2,
    vec2Sub: () => vec2Sub2,
    vec2Zero: () => vec2Zero2
  });

  // src/plugins/physics2d/shapes.ts
  var Shape2DType = /* @__PURE__ */ ((Shape2DType2) => {
    Shape2DType2[Shape2DType2["Circle"] = 0] = "Circle";
    Shape2DType2[Shape2DType2["Box"] = 1] = "Box";
    return Shape2DType2;
  })(Shape2DType || {});
  function aabb2DOverlap(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }
  function aabb2DUnion(a, b) {
    return {
      minX: fpMin(a.minX, b.minX),
      minY: fpMin(a.minY, b.minY),
      maxX: fpMax(a.maxX, b.maxX),
      maxY: fpMax(a.maxY, b.maxY)
    };
  }
  function aabb2DArea(aabb) {
    const width = aabb.maxX - aabb.minX;
    const height = aabb.maxY - aabb.minY;
    return fpMul(width, height);
  }
  function createCircle(radius) {
    return {
      type: 0 /* Circle */,
      radius: toFixed(radius)
    };
  }
  function createBox2D(halfWidth, halfHeight) {
    return {
      type: 1 /* Box */,
      halfWidth: toFixed(halfWidth),
      halfHeight: toFixed(halfHeight)
    };
  }
  function createBox2DFromSize(width, height) {
    const halfWidth = toFixed(width) >> 1;
    const halfHeight = toFixed(height) >> 1;
    return {
      type: 1 /* Box */,
      halfWidth,
      halfHeight
    };
  }

  // src/plugins/physics2d/layers.ts
  var Layers = {
    NONE: 0,
    DEFAULT: 1 << 0,
    // 1
    PLAYER: 1 << 1,
    // 2
    ENEMY: 1 << 2,
    // 4
    PROJECTILE: 1 << 3,
    // 8
    ITEM: 1 << 4,
    // 16
    TRIGGER: 1 << 5,
    // 32
    WORLD: 1 << 6,
    // 64
    PROP: 1 << 7,
    // 128
    // Layers 8-15 reserved for game-specific use
    CUSTOM_1: 1 << 8,
    CUSTOM_2: 1 << 9,
    CUSTOM_3: 1 << 10,
    CUSTOM_4: 1 << 11,
    CUSTOM_5: 1 << 12,
    CUSTOM_6: 1 << 13,
    CUSTOM_7: 1 << 14,
    CUSTOM_8: 1 << 15,
    ALL: 65535
    // All layers
  };
  var DEFAULT_FILTER = {
    layer: Layers.DEFAULT,
    mask: Layers.ALL
  };
  function createFilter(layer, mask = Layers.ALL) {
    return { layer, mask };
  }
  function shouldCollide(a, b) {
    return (a.mask & b.layer) !== 0 && (b.mask & a.layer) !== 0;
  }
  function filterCollidingWith(layer, ...collidesWithLayers) {
    let mask = 0;
    for (const l of collidesWithLayers) {
      mask |= l;
    }
    return { layer, mask };
  }
  function filterExcluding(layer, ...excludeLayers) {
    let mask = Layers.ALL;
    for (const l of excludeLayers) {
      mask &= ~l;
    }
    return { layer, mask };
  }

  // src/plugins/physics2d/rigid-body.ts
  var RESTITUTION_DEFAULT = toFixed(0);
  var FRICTION_DEFAULT = toFixed(0.5);
  var FP_ONE_TWELFTH = 5461;
  var BodyType2D = /* @__PURE__ */ ((BodyType2D2) => {
    BodyType2D2[BodyType2D2["Static"] = 0] = "Static";
    BodyType2D2[BodyType2D2["Kinematic"] = 1] = "Kinematic";
    BodyType2D2[BodyType2D2["Dynamic"] = 2] = "Dynamic";
    return BodyType2D2;
  })(BodyType2D || {});
  function vec2Zero2() {
    return { x: 0, y: 0 };
  }
  function vec22(x, y) {
    return { x: toFixed(x), y: toFixed(y) };
  }
  function vec2Clone2(v) {
    return { x: v.x, y: v.y };
  }
  function vec2Add2(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
  }
  function vec2Sub2(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }
  function vec2Scale2(v, s) {
    return { x: fpMul(v.x, s), y: fpMul(v.y, s) };
  }
  function vec2Dot2(a, b) {
    return fpMul(a.x, b.x) + fpMul(a.y, b.y);
  }
  function vec2LengthSq2(v) {
    return fpMul(v.x, v.x) + fpMul(v.y, v.y);
  }
  function vec2Cross2(a, b) {
    return fpMul(a.x, b.y) - fpMul(a.y, b.x);
  }
  var nextBodyId2D = 1;
  function resetBody2DIdCounter() {
    nextBodyId2D = 1;
  }
  function getBody2DIdCounter() {
    return nextBodyId2D;
  }
  function setBody2DIdCounter(value) {
    nextBodyId2D = value;
  }
  function createBody2D(type, shape, x, y, label) {
    const mass = type === 2 /* Dynamic */ ? toFixed(1) : 0;
    const invMass = type === 2 /* Dynamic */ ? FP_ONE : 0;
    let inertia = 0;
    if (type === 2 /* Dynamic */) {
      if (shape.type === 0 /* Circle */) {
        const r = shape.radius;
        inertia = fpMul(fpMul(mass, FP_HALF), fpMul(r, r));
      } else {
        const w = shape.halfWidth << 1;
        const h = shape.halfHeight << 1;
        inertia = fpMul(fpMul(mass, FP_ONE_TWELFTH), fpMul(w, w) + fpMul(h, h));
      }
    }
    const bodyId = nextBodyId2D++;
    const bodyLabel = label || "body2d_" + bodyId;
    return {
      id: bodyId,
      type,
      shape,
      label: bodyLabel,
      position: vec22(x, y),
      angle: 0,
      linearVelocity: vec2Zero2(),
      angularVelocity: 0,
      mass,
      invMass,
      inertia: inertia || FP_ONE,
      invInertia: inertia ? fpDiv(FP_ONE, inertia) : 0,
      restitution: RESTITUTION_DEFAULT,
      friction: FRICTION_DEFAULT,
      isSleeping: false,
      sleepFrames: 0,
      lockRotation: false,
      isSensor: false,
      isBullet: false,
      filter: { ...DEFAULT_FILTER },
      userData: null
    };
  }
  function setBody2DMass(body, mass) {
    if (body.type !== 2 /* Dynamic */)
      return;
    body.mass = toFixed(mass);
    body.invMass = mass > 0 ? fpDiv(FP_ONE, body.mass) : 0;
  }
  function setBody2DVelocity(body, vx, vy) {
    body.linearVelocity = vec22(vx, vy);
    body.isSleeping = false;
  }
  function applyImpulse2D(body, impulse, point) {
    if (body.type !== 2 /* Dynamic */ || body.invMass === 0)
      return;
    body.linearVelocity = vec2Add2(body.linearVelocity, vec2Scale2(impulse, body.invMass));
    if (point && !body.lockRotation) {
      const r = vec2Sub2(point, body.position);
      const torque = vec2Cross2(r, impulse);
      body.angularVelocity = body.angularVelocity + fpMul(torque, body.invInertia);
    }
    body.isSleeping = false;
  }
  function applyForce2D(body, force, dt) {
    if (body.type !== 2 /* Dynamic */ || body.invMass === 0)
      return;
    const impulse = vec2Scale2(force, dt);
    applyImpulse2D(body, impulse);
  }

  // src/plugins/physics2d/collision.ts
  function computeAABB2D(body) {
    const { position, shape, angle } = body;
    if (shape.type === 0 /* Circle */) {
      const radius = shape.radius;
      return {
        minX: position.x - radius,
        minY: position.y - radius,
        maxX: position.x + radius,
        maxY: position.y + radius
      };
    } else {
      const box = shape;
      const halfWidth = box.halfWidth;
      const halfHeight = box.halfHeight;
      if (angle === 0) {
        return {
          minX: position.x - halfWidth,
          minY: position.y - halfHeight,
          maxX: position.x + halfWidth,
          maxY: position.y + halfHeight
        };
      }
      const cosAngle = fpCos(angle);
      const sinAngle = fpSin(angle);
      const absCos = fpAbs(cosAngle);
      const absSin = fpAbs(sinAngle);
      const extentX = fpMul(halfWidth, absCos) + fpMul(halfHeight, absSin);
      const extentY = fpMul(halfWidth, absSin) + fpMul(halfHeight, absCos);
      return {
        minX: position.x - extentX,
        minY: position.y - extentY,
        maxX: position.x + extentX,
        maxY: position.y + extentY
      };
    }
  }
  function detectCollision2D(bodyA, bodyB) {
    const shapeA = bodyA.shape;
    const shapeB = bodyB.shape;
    if (shapeA.type === 0 /* Circle */ && shapeB.type === 0 /* Circle */) {
      return detectCircleCircle(bodyA, bodyB);
    }
    if (shapeA.type === 1 /* Box */ && shapeB.type === 1 /* Box */) {
      return detectBoxBox(bodyA, bodyB);
    }
    if (shapeA.type === 0 /* Circle */ && shapeB.type === 1 /* Box */) {
      return detectCircleBox(bodyA, bodyB);
    }
    if (shapeA.type === 1 /* Box */ && shapeB.type === 0 /* Circle */) {
      const contact = detectCircleBox(bodyB, bodyA);
      if (contact) {
        return {
          bodyA,
          bodyB,
          point: contact.point,
          normal: { x: -contact.normal.x, y: -contact.normal.y },
          depth: contact.depth
        };
      }
      return null;
    }
    return null;
  }
  function detectCircleCircle(circleA, circleB) {
    const radiusA = circleA.shape.radius;
    const radiusB = circleB.shape.radius;
    const sumRadius = radiusA + radiusB;
    const deltaX = circleB.position.x - circleA.position.x;
    const deltaY = circleB.position.y - circleA.position.y;
    const distanceSq = fpMul(deltaX, deltaX) + fpMul(deltaY, deltaY);
    const minDistSq = fpMul(sumRadius, sumRadius);
    if (distanceSq >= minDistSq)
      return null;
    const distance = fpSqrt(distanceSq);
    const penetration = sumRadius - distance;
    let normalX, normalY;
    if (distance > 0) {
      const invDist = fpDiv(FP_ONE, distance);
      normalX = fpMul(deltaX, invDist);
      normalY = fpMul(deltaY, invDist);
    } else {
      normalX = FP_ONE;
      normalY = 0;
    }
    const contactX = circleA.position.x + fpMul(normalX, radiusA);
    const contactY = circleA.position.y + fpMul(normalY, radiusA);
    return {
      bodyA: circleA,
      bodyB: circleB,
      point: { x: contactX, y: contactY },
      normal: { x: normalX, y: normalY },
      depth: penetration
    };
  }
  function detectBoxBox(boxA, boxB) {
    const shapeA = boxA.shape;
    const shapeB = boxB.shape;
    const deltaX = boxB.position.x - boxA.position.x;
    const deltaY = boxB.position.y - boxA.position.y;
    const overlapX = shapeA.halfWidth + shapeB.halfWidth - fpAbs(deltaX);
    const overlapY = shapeA.halfHeight + shapeB.halfHeight - fpAbs(deltaY);
    if (overlapX <= 0 || overlapY <= 0)
      return null;
    let normalX, normalY;
    let penetration;
    if (overlapX < overlapY) {
      penetration = overlapX;
      normalX = deltaX > 0 ? FP_ONE : -FP_ONE;
      normalY = 0;
    } else {
      penetration = overlapY;
      normalX = 0;
      normalY = deltaY > 0 ? FP_ONE : -FP_ONE;
    }
    const contactX = boxA.position.x + boxB.position.x >> 1;
    const contactY = boxA.position.y + boxB.position.y >> 1;
    return {
      bodyA: boxA,
      bodyB: boxB,
      point: { x: contactX, y: contactY },
      normal: { x: normalX, y: normalY },
      depth: penetration
    };
  }
  function detectCircleBox(circle, box) {
    const radius = circle.shape.radius;
    const boxShape = box.shape;
    const localX = circle.position.x - box.position.x;
    const localY = circle.position.y - box.position.y;
    const clampedX = fpMax(-boxShape.halfWidth, fpMin(boxShape.halfWidth, localX));
    const clampedY = fpMax(-boxShape.halfHeight, fpMin(boxShape.halfHeight, localY));
    const centerInside = fpAbs(localX) < boxShape.halfWidth && fpAbs(localY) < boxShape.halfHeight;
    let normalX, normalY;
    let penetration;
    if (centerInside) {
      const distToRight = boxShape.halfWidth - localX;
      const distToLeft = boxShape.halfWidth + localX;
      const distToTop = boxShape.halfHeight - localY;
      const distToBottom = boxShape.halfHeight + localY;
      let minDist = distToRight;
      normalX = FP_ONE;
      normalY = 0;
      if (distToLeft < minDist) {
        minDist = distToLeft;
        normalX = -FP_ONE;
        normalY = 0;
      }
      if (distToTop < minDist) {
        minDist = distToTop;
        normalX = 0;
        normalY = FP_ONE;
      }
      if (distToBottom < minDist) {
        minDist = distToBottom;
        normalX = 0;
        normalY = -FP_ONE;
      }
      penetration = minDist + radius;
    } else {
      const diffX = localX - clampedX;
      const diffY = localY - clampedY;
      const distanceSq = fpMul(diffX, diffX) + fpMul(diffY, diffY);
      if (distanceSq >= fpMul(radius, radius))
        return null;
      const distance = fpSqrt(distanceSq);
      penetration = radius - distance;
      if (distance > 0) {
        const invDist = fpDiv(FP_ONE, distance);
        normalX = fpMul(-diffX, invDist);
        normalY = fpMul(-diffY, invDist);
      } else {
        normalX = FP_ONE;
        normalY = 0;
      }
    }
    const contactX = circle.position.x + fpMul(normalX, radius);
    const contactY = circle.position.y + fpMul(normalY, radius);
    return {
      bodyA: circle,
      bodyB: box,
      point: { x: contactX, y: contactY },
      normal: { x: normalX, y: normalY },
      depth: penetration
    };
  }
  function resolveCollision2D(contact) {
    const { bodyA, bodyB, normal, depth } = contact;
    if (bodyA.isSensor || bodyB.isSensor)
      return;
    const typeA = bodyA.type;
    const typeB = bodyB.type;
    if (typeA === 0 /* Static */ && typeB === 0 /* Static */)
      return;
    applyPositionCorrection(bodyA, bodyB, normal, depth);
    if (typeA === 2 /* Dynamic */ || typeB === 2 /* Dynamic */) {
      applyVelocityImpulse(bodyA, bodyB, normal);
    }
  }
  function applyPositionCorrection(bodyA, bodyB, normal, depth) {
    const typeA = bodyA.type;
    const typeB = bodyB.type;
    const aMovable = typeA !== 0 /* Static */;
    const bMovable = typeB !== 0 /* Static */;
    if (!aMovable && !bMovable)
      return;
    const slop = toFixed(0.01);
    const correctionDepth = fpMax(0, depth - slop);
    if (correctionDepth <= 0)
      return;
    if (aMovable && bMovable) {
      const halfCorrection = correctionDepth >> 1;
      bodyA.position.x = bodyA.position.x - fpMul(normal.x, halfCorrection);
      bodyA.position.y = bodyA.position.y - fpMul(normal.y, halfCorrection);
      bodyB.position.x = bodyB.position.x + fpMul(normal.x, halfCorrection);
      bodyB.position.y = bodyB.position.y + fpMul(normal.y, halfCorrection);
    } else if (aMovable) {
      bodyA.position.x = bodyA.position.x - fpMul(normal.x, correctionDepth);
      bodyA.position.y = bodyA.position.y - fpMul(normal.y, correctionDepth);
    } else {
      bodyB.position.x = bodyB.position.x + fpMul(normal.x, correctionDepth);
      bodyB.position.y = bodyB.position.y + fpMul(normal.y, correctionDepth);
    }
  }
  function applyVelocityImpulse(bodyA, bodyB, normal) {
    const invMassA = bodyA.type === 2 /* Dynamic */ ? bodyA.invMass : 0;
    const invMassB = bodyB.type === 2 /* Dynamic */ ? bodyB.invMass : 0;
    const totalInvMass = invMassA + invMassB;
    if (totalInvMass === 0)
      return;
    const relVelX = bodyB.linearVelocity.x - bodyA.linearVelocity.x;
    const relVelY = bodyB.linearVelocity.y - bodyA.linearVelocity.y;
    const velAlongNormal = fpMul(relVelX, normal.x) + fpMul(relVelY, normal.y);
    if (velAlongNormal > 0)
      return;
    const restitution = fpMin(bodyA.restitution, bodyB.restitution);
    const impulseMag = fpDiv(
      fpMul(-(FP_ONE + restitution), velAlongNormal),
      totalInvMass
    );
    const impulseX = fpMul(normal.x, impulseMag);
    const impulseY = fpMul(normal.y, impulseMag);
    if (bodyA.type === 2 /* Dynamic */) {
      bodyA.linearVelocity.x = bodyA.linearVelocity.x - fpMul(impulseX, invMassA);
      bodyA.linearVelocity.y = bodyA.linearVelocity.y - fpMul(impulseY, invMassA);
    }
    if (bodyB.type === 2 /* Dynamic */) {
      bodyB.linearVelocity.x = bodyB.linearVelocity.x + fpMul(impulseX, invMassB);
      bodyB.linearVelocity.y = bodyB.linearVelocity.y + fpMul(impulseY, invMassB);
    }
    applyFrictionImpulse(bodyA, bodyB, normal, impulseMag, invMassA, invMassB, totalInvMass);
  }
  function applyFrictionImpulse(bodyA, bodyB, normal, normalImpulse, invMassA, invMassB, totalInvMass) {
    const relVelX = bodyB.linearVelocity.x - bodyA.linearVelocity.x;
    const relVelY = bodyB.linearVelocity.y - bodyA.linearVelocity.y;
    const velAlongNormal = fpMul(relVelX, normal.x) + fpMul(relVelY, normal.y);
    const tangentX = relVelX - fpMul(normal.x, velAlongNormal);
    const tangentY = relVelY - fpMul(normal.y, velAlongNormal);
    const tangentLenSq = fpMul(tangentX, tangentX) + fpMul(tangentY, tangentY);
    if (tangentLenSq === 0)
      return;
    const tangentLen = fpSqrt(tangentLenSq);
    const invTangentLen = fpDiv(FP_ONE, tangentLen);
    const tangentNormX = fpMul(tangentX, invTangentLen);
    const tangentNormY = fpMul(tangentY, invTangentLen);
    const friction = fpMul(bodyA.friction, bodyB.friction);
    const tangentVel = fpMul(relVelX, tangentNormX) + fpMul(relVelY, tangentNormY);
    let frictionMag = fpDiv(-tangentVel, totalInvMass);
    const maxFriction = fpMul(friction, fpAbs(normalImpulse));
    if (fpAbs(frictionMag) > maxFriction) {
      frictionMag = frictionMag > 0 ? maxFriction : -maxFriction;
    }
    const frictionX = fpMul(tangentNormX, frictionMag);
    const frictionY = fpMul(tangentNormY, frictionMag);
    if (bodyA.type === 2 /* Dynamic */) {
      bodyA.linearVelocity.x = bodyA.linearVelocity.x - fpMul(frictionX, invMassA);
      bodyA.linearVelocity.y = bodyA.linearVelocity.y - fpMul(frictionY, invMassA);
    }
    if (bodyB.type === 2 /* Dynamic */) {
      bodyB.linearVelocity.x = bodyB.linearVelocity.x + fpMul(frictionX, invMassB);
      bodyB.linearVelocity.y = bodyB.linearVelocity.y + fpMul(frictionY, invMassB);
    }
  }

  // src/plugins/physics2d/spatial-hash.ts
  function getBodyRadius(body) {
    if (body.shape.type === 0 /* Circle */) {
      return toFloat(body.shape.radius);
    } else {
      const box = body.shape;
      const hw = toFloat(box.halfWidth);
      const hh = toFloat(box.halfHeight);
      return Math.sqrt(hw * hw + hh * hh);
    }
  }
  var SpatialHash2D = class {
    /**
     * Create a spatial hash grid.
     * @param cellSize Size of each cell. Entities larger than this are
     *                 handled specially (checked against all others).
     */
    constructor(cellSize = 64) {
      this.cells = /* @__PURE__ */ new Map();
      this.bodyToCell = /* @__PURE__ */ new Map();
      // Oversized entities (diameter > cellSize) - checked against all others
      this.oversized = [];
      // All regular (non-oversized) bodies for oversized checks
      this.allRegular = [];
      this.cellSize = cellSize;
      this.invCellSize = 1 / cellSize;
    }
    /**
     * Hash a position to a cell key.
     * Uses bit packing for fast integer key: (x << 16) | y
     */
    hashPosition(x, y) {
      const cellX = Math.floor(x * this.invCellSize) & 65535;
      const cellY = Math.floor(y * this.invCellSize) & 65535;
      return cellX << 16 | cellY;
    }
    /**
     * Clear all cells (call at start of each frame).
     */
    clear() {
      this.cells.clear();
      this.bodyToCell.clear();
      this.oversized.length = 0;
      this.allRegular.length = 0;
    }
    /**
     * Insert a body into the grid.
     * Oversized bodies (diameter > cellSize) are tracked separately.
     */
    insert(body) {
      const radius = getBodyRadius(body);
      const diameter = radius * 2;
      if (diameter > this.cellSize) {
        this.oversized.push(body);
        return;
      }
      this.allRegular.push(body);
      const x = toFloat(body.position.x);
      const y = toFloat(body.position.y);
      const key = this.hashPosition(x, y);
      let cell = this.cells.get(key);
      if (!cell) {
        cell = [];
        this.cells.set(key, cell);
      }
      cell.push(body);
      this.bodyToCell.set(body, key);
    }
    /**
     * Insert all bodies into the grid.
     */
    insertAll(bodies) {
      for (const body of bodies) {
        this.insert(body);
      }
    }
    /**
     * Get all bodies in the same cell as a position.
     */
    queryPoint(x, y) {
      const key = this.hashPosition(x, y);
      return this.cells.get(key) || [];
    }
    /**
     * Get all bodies in the same and adjacent cells (3x3 neighborhood).
     * This handles bodies near cell boundaries.
     */
    queryNearby(body) {
      const x = toFloat(body.position.x);
      const y = toFloat(body.position.y);
      const cellX = Math.floor(x * this.invCellSize);
      const cellY = Math.floor(y * this.invCellSize);
      const result = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = cellX + dx & 65535;
          const ny = cellY + dy & 65535;
          const key = nx << 16 | ny;
          const cell = this.cells.get(key);
          if (cell) {
            for (const other of cell) {
              if (other !== body) {
                result.push(other);
              }
            }
          }
        }
      }
      return result;
    }
    /**
     * Query bodies within a radius (for larger entities that span multiple cells).
     */
    queryRadius(x, y, radius) {
      const cellRadius = Math.ceil(radius * this.invCellSize);
      const cellX = Math.floor(x * this.invCellSize);
      const cellY = Math.floor(y * this.invCellSize);
      const result = [];
      const seen = /* @__PURE__ */ new Set();
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        for (let dy = -cellRadius; dy <= cellRadius; dy++) {
          const nx = cellX + dx & 65535;
          const ny = cellY + dy & 65535;
          const key = nx << 16 | ny;
          const cell = this.cells.get(key);
          if (cell) {
            for (const body of cell) {
              if (!seen.has(body)) {
                seen.add(body);
                result.push(body);
              }
            }
          }
        }
      }
      return result;
    }
    /**
     * Iterate over potential collision pairs, calling the callback for each.
     * Each pair is visited exactly once. No Set or deduplication needed -
     * the algorithm structure guarantees uniqueness.
     */
    forEachPair(callback) {
      for (const [key, cell] of this.cells) {
        for (let i = 0; i < cell.length; i++) {
          for (let j = i + 1; j < cell.length; j++) {
            callback(cell[i], cell[j]);
          }
        }
        const cellX = key >> 16 & 65535;
        const cellY = key & 65535;
        const neighbors = [
          (cellX + 1 & 65535) << 16 | cellY,
          // Right (+x)
          cellX << 16 | cellY + 1 & 65535,
          // Below (+y)
          (cellX + 1 & 65535) << 16 | cellY + 1 & 65535
          // Below-right (+x,+y)
        ];
        for (const neighborKey of neighbors) {
          if (neighborKey <= key)
            continue;
          const neighborCell = this.cells.get(neighborKey);
          if (!neighborCell)
            continue;
          for (const a of cell) {
            for (const b of neighborCell) {
              callback(a, b);
            }
          }
        }
        const belowLeftKey = (cellX - 1 & 65535) << 16 | cellY + 1 & 65535;
        const belowLeftCell = this.cells.get(belowLeftKey);
        if (belowLeftCell) {
          for (const a of cell) {
            for (const b of belowLeftCell) {
              callback(a, b);
            }
          }
        }
      }
      const oversized = this.oversized;
      const allRegular = this.allRegular;
      for (let i = 0; i < oversized.length; i++) {
        for (let j = i + 1; j < oversized.length; j++) {
          callback(oversized[i], oversized[j]);
        }
      }
      for (const big of oversized) {
        for (const small of allRegular) {
          callback(big, small);
        }
      }
    }
    /**
     * Get potential collision pairs as an array.
     * For large body counts, prefer forEachPair() to avoid array allocation.
     */
    getPotentialPairs() {
      const pairs = [];
      this.forEachPair((a, b) => pairs.push([a, b]));
      return pairs;
    }
    /**
     * Get statistics for debugging.
     */
    getStats() {
      let maxPerCell = 0;
      let totalBodies = 0;
      for (const cell of this.cells.values()) {
        maxPerCell = Math.max(maxPerCell, cell.length);
        totalBodies += cell.length;
      }
      return {
        cellCount: this.cells.size,
        maxPerCell,
        avgPerCell: this.cells.size > 0 ? totalBodies / this.cells.size : 0,
        oversizedCount: this.oversized.length
      };
    }
  };

  // src/plugins/physics2d/world.ts
  var GRAVITY_2D = { x: 0, y: toFixed(-30) };
  var LINEAR_DAMPING = toFixed(0.1);
  var ANGULAR_DAMPING = toFixed(0.1);
  var SLEEP_THRESHOLD = toFixed(0.12);
  var SLEEP_FRAMES_REQUIRED = 20;
  var DEFAULT_CELL_SIZE = 64;
  function createWorld2D(dt = 1 / 60) {
    const world = {
      bodies: [],
      gravity: { x: GRAVITY_2D.x, y: GRAVITY_2D.y },
      dt: toFixed(dt),
      step() {
        stepWorld2D(world);
      }
    };
    return world;
  }
  function addBody2D(world, body) {
    world.bodies.push(body);
  }
  function removeBody2D(world, body) {
    const index = world.bodies.indexOf(body);
    if (index >= 0) {
      world.bodies.splice(index, 1);
    }
  }
  function stepWorld2D(world) {
    const { gravity, dt } = world;
    const contacts = [];
    const triggerOverlaps = [];
    const collisionPairs = [];
    const bodies = [...world.bodies].sort((a, b) => a.label.localeCompare(b.label));
    for (const body of bodies) {
      if (body.type !== 2 /* Dynamic */)
        continue;
      if (body.isSleeping)
        continue;
      body.linearVelocity = vec2Add2(body.linearVelocity, vec2Scale2(gravity, dt));
      const linearDamp = FP_ONE - LINEAR_DAMPING;
      const angularDamp = FP_ONE - ANGULAR_DAMPING;
      body.linearVelocity = vec2Scale2(body.linearVelocity, linearDamp);
      body.angularVelocity = fpMul(body.angularVelocity, angularDamp);
    }
    const spatialHash = new SpatialHash2D(DEFAULT_CELL_SIZE);
    spatialHash.insertAll(bodies);
    spatialHash.forEachPair((bodyA, bodyB) => {
      if (bodyA.type === 0 /* Static */ && bodyB.type === 0 /* Static */)
        return;
      if (!shouldCollide(bodyA.filter, bodyB.filter))
        return;
      const aabbA = computeAABB2D(bodyA);
      const aabbB = computeAABB2D(bodyB);
      if (!aabb2DOverlap(aabbA, aabbB))
        return;
      const contact = detectCollision2D(bodyA, bodyB);
      if (!contact)
        return;
      const entityA = bodyA.userData;
      const entityB = bodyB.userData;
      if (entityA || entityB) {
        collisionPairs.push({
          entityA,
          entityB,
          labelA: bodyA.label,
          labelB: bodyB.label
        });
      }
      if (bodyA.isSensor || bodyB.isSensor) {
        if (bodyA.isSensor)
          triggerOverlaps.push({ trigger: bodyA, other: bodyB });
        if (bodyB.isSensor)
          triggerOverlaps.push({ trigger: bodyB, other: bodyA });
        return;
      }
      contacts.push(contact);
      if (world.contactListener)
        world.contactListener.onContact(bodyA, bodyB);
      resolveCollision2D(contact);
    });
    collisionPairs.sort((a, b) => {
      const cmp = a.labelA.localeCompare(b.labelA);
      return cmp !== 0 ? cmp : a.labelB.localeCompare(b.labelB);
    });
    for (const pair of collisionPairs) {
      if (pair.entityA?.active === false || pair.entityB?.active === false)
        continue;
      if (world.physics2d?.handleCollision?.(pair.entityA, pair.entityB)) {
        continue;
      }
      if (pair.entityA?.onCollision) {
        pair.entityA.onCollision(pair.entityB);
      }
      if (pair.entityB?.onCollision) {
        pair.entityB.onCollision(pair.entityA);
      }
    }
    for (const body of bodies) {
      if (body.type === 0 /* Static */)
        continue;
      if (body.isSleeping)
        continue;
      const linearClamp = toFixed(0.05);
      const angularClamp = toFixed(0.01);
      if (fpAbs(body.linearVelocity.x) < linearClamp)
        body.linearVelocity.x = 0;
      if (fpAbs(body.linearVelocity.y) < linearClamp)
        body.linearVelocity.y = 0;
      if (fpAbs(body.angularVelocity) < angularClamp)
        body.angularVelocity = 0;
      body.position = vec2Add2(body.position, vec2Scale2(body.linearVelocity, dt));
      if (!body.lockRotation && body.angularVelocity !== 0) {
        body.angle = body.angle + fpMul(body.angularVelocity, dt);
      }
      const speedSq = vec2LengthSq2(body.linearVelocity);
      const angSpeedSq = fpMul(body.angularVelocity, body.angularVelocity);
      const sleepThreshSq = fpMul(SLEEP_THRESHOLD, SLEEP_THRESHOLD);
      if (speedSq < sleepThreshSq && angSpeedSq < sleepThreshSq) {
        body.sleepFrames++;
        if (body.sleepFrames >= SLEEP_FRAMES_REQUIRED) {
          body.isSleeping = true;
          body.linearVelocity = vec2Zero2();
          body.angularVelocity = 0;
        }
      } else {
        body.sleepFrames = 0;
        body.isSleeping = false;
      }
    }
    return { contacts, triggers: triggerOverlaps };
  }
  function serializeShape(shape) {
    if (shape.type === 0 /* Circle */) {
      return {
        type: 0 /* Circle */,
        radius: shape.radius
      };
    } else {
      const box = shape;
      return {
        type: 1 /* Box */,
        halfWidth: box.halfWidth,
        halfHeight: box.halfHeight
      };
    }
  }
  function deserializeShape(state) {
    if (state.type === 0 /* Circle */) {
      return {
        type: 0 /* Circle */,
        radius: state.radius
      };
    } else {
      return {
        type: 1 /* Box */,
        halfWidth: state.halfWidth,
        halfHeight: state.halfHeight
      };
    }
  }
  function serializeBody(b) {
    return {
      id: b.id,
      label: b.label,
      bodyType: b.type,
      shape: serializeShape(b.shape),
      px: b.position.x,
      py: b.position.y,
      angle: b.angle,
      vx: b.linearVelocity.x,
      vy: b.linearVelocity.y,
      av: b.angularVelocity,
      mass: b.mass,
      restitution: b.restitution,
      friction: b.friction,
      isSleeping: b.isSleeping,
      sleepFrames: b.sleepFrames,
      lockRotation: b.lockRotation,
      isSensor: b.isSensor,
      isBullet: b.isBullet,
      filter: { ...b.filter },
      userData: b.userData
    };
  }
  function saveWorldState2D(world) {
    return {
      bodies: world.bodies.map(serializeBody)
    };
  }
  function createBodyFromState(bs) {
    const shape = deserializeShape(bs.shape);
    const savedCounter = getBody2DIdCounter();
    const body = createBody2D(bs.bodyType, shape, 0, 0, bs.label);
    body.id = bs.id;
    setBody2DIdCounter(savedCounter);
    body.position = { x: bs.px, y: bs.py };
    body.angle = bs.angle;
    body.linearVelocity = { x: bs.vx, y: bs.vy };
    body.angularVelocity = bs.av;
    body.mass = bs.mass;
    body.invMass = bs.mass > 0 ? fpDiv(FP_ONE, bs.mass) : 0;
    if (bs.bodyType === 2 /* Dynamic */ && bs.mass > 0) {
      if (shape.type === 0 /* Circle */) {
        const r = shape.radius;
        body.inertia = fpMul(fpMul(bs.mass, FP_HALF), fpMul(r, r));
      } else {
        const box = shape;
        const w = box.halfWidth << 1;
        const h = box.halfHeight << 1;
        const FP_ONE_TWELFTH2 = 5461;
        body.inertia = fpMul(fpMul(bs.mass, FP_ONE_TWELFTH2), fpMul(w, w) + fpMul(h, h));
      }
      body.invInertia = body.inertia > 0 ? fpDiv(FP_ONE, body.inertia) : 0;
    }
    body.restitution = bs.restitution;
    body.friction = bs.friction;
    body.isSleeping = bs.isSleeping;
    body.sleepFrames = bs.sleepFrames;
    body.lockRotation = bs.lockRotation;
    body.isSensor = bs.isSensor;
    body.isBullet = bs.isBullet ?? false;
    body.filter = { ...bs.filter };
    body.userData = bs.userData;
    return body;
  }
  function loadWorldState2D(world, state) {
    const sortedBodies = [...state.bodies].sort((a, b) => a.label.localeCompare(b.label));
    const snapshotLabels = new Set(sortedBodies.map((bs) => bs.label));
    for (let i = world.bodies.length - 1; i >= 0; i--) {
      if (!snapshotLabels.has(world.bodies[i].label)) {
        world.bodies.splice(i, 1);
      }
    }
    const bodyMap = new Map(world.bodies.map((b) => [b.label, b]));
    let maxId = 0;
    for (const bs of sortedBodies) {
      if (bs.id > maxId)
        maxId = bs.id;
      const existingBody = bodyMap.get(bs.label);
      if (existingBody) {
        existingBody.position = { x: bs.px, y: bs.py };
        existingBody.angle = bs.angle;
        existingBody.linearVelocity = { x: bs.vx, y: bs.vy };
        existingBody.angularVelocity = bs.av;
        existingBody.isSleeping = bs.isSleeping;
        existingBody.sleepFrames = bs.sleepFrames;
        existingBody.lockRotation = bs.lockRotation;
        existingBody.isSensor = bs.isSensor;
        existingBody.restitution = bs.restitution;
        existingBody.friction = bs.friction;
        existingBody.filter = { ...bs.filter };
        if (bs.userData !== void 0) {
          existingBody.userData = bs.userData;
        }
      } else {
        const newBody = createBodyFromState(bs);
        world.bodies.push(newBody);
      }
    }
    const currentCounter = getBody2DIdCounter();
    if (maxId >= currentCounter) {
      setBody2DIdCounter(maxId + 1);
    }
    world.bodies.sort((a, b) => a.label.localeCompare(b.label));
  }

  // src/plugins/physics2d/quad-tree.ts
  var DEFAULT_MAX_ENTITIES = 8;
  var DEFAULT_MAX_DEPTH = 8;
  function boundsIntersects(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }
  function getBodyBounds(body) {
    const aabb = computeAABB2D(body);
    return {
      minX: toFloat(aabb.minX),
      minY: toFloat(aabb.minY),
      maxX: toFloat(aabb.maxX),
      maxY: toFloat(aabb.maxY)
    };
  }
  var QuadTreeNode = class _QuadTreeNode {
    constructor(bounds, depth, maxEntities, maxDepth) {
      // Entities stored in this node (entities that span multiple children stay here)
      this.entities = [];
      // Child quadrants: NW, NE, SW, SE (null until subdivided)
      this.children = null;
      this.bounds = bounds;
      this.depth = depth;
      this.maxEntities = maxEntities;
      this.maxDepth = maxDepth;
    }
    /**
     * Insert an entity into the tree.
     */
    insert(body, bodyBounds) {
      if (this.children) {
        const index = this.getChildIndex(bodyBounds);
        if (index !== -1) {
          this.children[index].insert(body, bodyBounds);
          return;
        }
        this.entities.push(body);
        return;
      }
      this.entities.push(body);
      if (this.entities.length > this.maxEntities && this.depth < this.maxDepth) {
        this.subdivide();
      }
    }
    /**
     * Subdivide this node into 4 children.
     */
    subdivide() {
      const { minX, minY, maxX, maxY } = this.bounds;
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;
      this.children = [
        new _QuadTreeNode({ minX, minY, maxX: midX, maxY: midY }, this.depth + 1, this.maxEntities, this.maxDepth),
        // NW (top-left)
        new _QuadTreeNode({ minX: midX, minY, maxX, maxY: midY }, this.depth + 1, this.maxEntities, this.maxDepth),
        // NE (top-right)
        new _QuadTreeNode({ minX, minY: midY, maxX: midX, maxY }, this.depth + 1, this.maxEntities, this.maxDepth),
        // SW (bottom-left)
        new _QuadTreeNode({ minX: midX, minY: midY, maxX, maxY }, this.depth + 1, this.maxEntities, this.maxDepth)
        // SE (bottom-right)
      ];
      const oldEntities = this.entities;
      this.entities = [];
      for (const body of oldEntities) {
        const bodyBounds = getBodyBounds(body);
        const index = this.getChildIndex(bodyBounds);
        if (index !== -1) {
          this.children[index].insert(body, bodyBounds);
        } else {
          this.entities.push(body);
        }
      }
    }
    /**
     * Get the child index for an entity, or -1 if it spans multiple children.
     */
    getChildIndex(bodyBounds) {
      const { minX, minY, maxX, maxY } = this.bounds;
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;
      const inTop = bodyBounds.maxY <= midY;
      const inBottom = bodyBounds.minY >= midY;
      const inLeft = bodyBounds.maxX <= midX;
      const inRight = bodyBounds.minX >= midX;
      if (inTop && inLeft)
        return 0;
      if (inTop && inRight)
        return 1;
      if (inBottom && inLeft)
        return 2;
      if (inBottom && inRight)
        return 3;
      return -1;
    }
    /**
     * Query all entities that might collide with the given bounds.
     */
    query(queryBounds, result) {
      for (const body of this.entities) {
        result.push(body);
      }
      if (this.children) {
        for (const child of this.children) {
          if (boundsIntersects(child.bounds, queryBounds)) {
            child.query(queryBounds, result);
          }
        }
      }
    }
    /**
     * Iterate all potential collision pairs (iterative version).
     * Uses stack-based traversal to avoid recursive overhead.
     */
    forEachPairIterative(callback) {
      const stack = [];
      const ancestors = [];
      stack.push({ node: this, ancestorStart: 0 });
      while (stack.length > 0) {
        const { node, ancestorStart } = stack.pop();
        ancestors.length = ancestorStart;
        const entities = node.entities;
        for (let i = 0; i < entities.length; i++) {
          for (let j = i + 1; j < entities.length; j++) {
            callback(entities[i], entities[j]);
          }
        }
        for (let i = 0; i < ancestorStart; i++) {
          for (const entity of entities) {
            callback(ancestors[i], entity);
          }
        }
        const newAncestorStart = ancestors.length;
        for (const entity of entities) {
          ancestors.push(entity);
        }
        if (node.children) {
          for (let i = 3; i >= 0; i--) {
            stack.push({ node: node.children[i], ancestorStart: ancestors.length });
          }
        }
      }
    }
    /**
     * Iterate all potential collision pairs.
     * Callback receives each unique pair exactly once.
     */
    forEachPair(callback, ancestors = []) {
      this.forEachPairIterative(callback);
    }
    /**
     * Get statistics about this subtree.
     */
    getStats() {
      let nodeCount = 1;
      let maxDepth = this.depth;
      let entityCount = this.entities.length;
      if (this.children) {
        for (const child of this.children) {
          const childStats = child.getStats();
          nodeCount += childStats.nodeCount;
          maxDepth = Math.max(maxDepth, childStats.maxDepth);
          entityCount += childStats.entityCount;
        }
      }
      return { nodeCount, maxDepth, entityCount };
    }
  };
  var QuadTree2D = class {
    constructor(maxEntities = DEFAULT_MAX_ENTITIES, maxDepth = DEFAULT_MAX_DEPTH) {
      this.root = null;
      this.maxEntities = maxEntities;
      this.maxDepth = maxDepth;
    }
    /**
     * Clear the tree.
     */
    clear() {
      this.root = null;
    }
    /**
     * Insert all bodies into the tree.
     * Automatically computes world bounds from entities.
     */
    insertAll(bodies) {
      if (bodies.length === 0)
        return;
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;
      for (const body of bodies) {
        const bounds = getBodyBounds(body);
        minX = Math.min(minX, bounds.minX);
        minY = Math.min(minY, bounds.minY);
        maxX = Math.max(maxX, bounds.maxX);
        maxY = Math.max(maxY, bounds.maxY);
      }
      const padding = 1;
      this.root = new QuadTreeNode(
        { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding },
        0,
        this.maxEntities,
        this.maxDepth
      );
      for (const body of bodies) {
        const bounds = getBodyBounds(body);
        this.root.insert(body, bounds);
      }
    }
    /**
     * Query entities that might collide with the given body.
     */
    queryNearby(body) {
      if (!this.root)
        return [];
      const result = [];
      const bounds = getBodyBounds(body);
      this.root.query(bounds, result);
      return result.filter((b) => b !== body);
    }
    /**
     * Iterate all potential collision pairs.
     * Each pair is visited exactly once.
     * Order is deterministic (depth-first, NW→NE→SW→SE).
     */
    forEachPair(callback) {
      if (!this.root)
        return;
      this.root.forEachPair(callback);
    }
    /**
     * Get tree statistics for debugging.
     */
    getStats() {
      if (!this.root)
        return { nodeCount: 0, maxDepth: 0, entityCount: 0 };
      return this.root.getStats();
    }
  };

  // src/plugins/physics2d/trigger.ts
  var TriggerState = class {
    constructor() {
      this.overlaps = /* @__PURE__ */ new Map();
      this.enterCallbacks = [];
      this.stayCallbacks = [];
      this.exitCallbacks = [];
      this.pendingPairs = [];
    }
    onEnter(cb) {
      this.enterCallbacks.push(cb);
    }
    onStay(cb) {
      this.stayCallbacks.push(cb);
    }
    onExit(cb) {
      this.exitCallbacks.push(cb);
    }
    processOverlaps(currentOverlaps) {
      const currentKeys = /* @__PURE__ */ new Set();
      const sortedOverlaps = [...currentOverlaps].sort((a, b) => {
        return this.makeKey(a.trigger, a.other).localeCompare(this.makeKey(b.trigger, b.other));
      });
      for (const overlap of sortedOverlaps) {
        const key = this.makeKey(overlap.trigger, overlap.other);
        currentKeys.add(key);
        if (this.overlaps.has(key)) {
          for (const cb of this.stayCallbacks)
            cb(overlap);
        } else {
          this.overlaps.set(key, overlap);
          for (const cb of this.enterCallbacks)
            cb(overlap);
        }
      }
      const sortedExistingKeys = [...this.overlaps.keys()].sort();
      for (const key of sortedExistingKeys) {
        if (!currentKeys.has(key)) {
          const overlap = this.overlaps.get(key);
          this.overlaps.delete(key);
          for (const cb of this.exitCallbacks)
            cb(overlap);
        }
      }
    }
    clear() {
      this.overlaps.clear();
    }
    removeBody(body) {
      const keysToRemove = [];
      for (const [key, overlap] of this.overlaps) {
        if (overlap.trigger === body || overlap.other === body) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.sort();
      for (const key of keysToRemove) {
        const overlap = this.overlaps.get(key);
        this.overlaps.delete(key);
        for (const cb of this.exitCallbacks)
          cb(overlap);
      }
    }
    getOverlappingBodies(trigger) {
      const bodies = [];
      for (const overlap of this.overlaps.values()) {
        if (overlap.trigger === trigger) {
          bodies.push(overlap.other);
        }
      }
      return bodies.sort((a, b) => a.label.localeCompare(b.label));
    }
    isBodyInTrigger(trigger, body) {
      return this.overlaps.has(this.makeKey(trigger, body));
    }
    overlapCount() {
      return this.overlaps.size;
    }
    saveState() {
      const pairs = [];
      for (const overlap of this.overlaps.values()) {
        pairs.push([overlap.trigger.label, overlap.other.label]);
      }
      return pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    }
    loadState(pairs) {
      this.overlaps.clear();
      this.pendingPairs = pairs;
    }
    syncWithWorld(bodies) {
      const bodyByLabel = /* @__PURE__ */ new Map();
      for (const body of bodies)
        bodyByLabel.set(body.label, body);
      for (const [triggerLabel, otherLabel] of this.pendingPairs) {
        const trigger = bodyByLabel.get(triggerLabel);
        const other = bodyByLabel.get(otherLabel);
        if (trigger && other) {
          this.overlaps.set(this.makeKey(trigger, other), { trigger, other });
        }
      }
      this.pendingPairs = [];
    }
    makeKey(trigger, other) {
      return `${trigger.label}:${other.label}`;
    }
  };
  function makeTrigger(body) {
    body.isSensor = true;
    return body;
  }

  // src/plugins/physics2d/system.ts
  var Physics2DSystem = class {
    /**
     * Create a Physics2D system.
     *
     * @param gameOrConfig - Game instance (plugin mode) or config (standalone mode)
     * @param config - Config when using plugin mode
     */
    constructor(gameOrConfig, config) {
      /** ECS World reference */
      this.world = null;
      /** Map entity ID to physics body */
      this.entityToBody = /* @__PURE__ */ new Map();
      /** Map body ID to entity ID */
      this.bodyToEntity = /* @__PURE__ */ new Map();
      /** Collision handlers by type pair */
      this.collisionHandlers = /* @__PURE__ */ new Map();
      /** Entities pending body creation */
      this.pendingEntities = /* @__PURE__ */ new Set();
      let actualConfig;
      let game = null;
      if (gameOrConfig && "world" in gameOrConfig) {
        game = gameOrConfig;
        actualConfig = config ?? {};
      } else {
        actualConfig = gameOrConfig ?? {};
      }
      this.physicsWorld = createWorld2D(actualConfig.dt ?? 1 / 60);
      if (actualConfig.gravity) {
        this.physicsWorld.gravity = {
          x: toFixed(actualConfig.gravity.x),
          y: toFixed(actualConfig.gravity.y)
        };
      }
      const system = this;
      this.physicsWorld.contactListener = {
        onContact(bodyA, bodyB) {
          system.handleCollision(bodyA, bodyB);
        }
      };
      this.physicsWorld.physics2d = {
        handleCollision: (entityA, entityB) => {
          return this.handleCollisionByType(entityA, entityB);
        }
      };
      if (game) {
        this.attach(game.world);
        game.physics = this;
      }
    }
    /**
     * Attach to an ECS World.
     * Registers prePhysics and physics systems.
     */
    attach(world) {
      this.world = world;
      world.addSystem(() => this.syncBodiesToPhysics(), { phase: "prePhysics", order: 0 });
      world.addSystem(() => this.step(), { phase: "physics", order: 0 });
      world.addSystem(() => this.syncPhysicsToComponents(), { phase: "postPhysics", order: 0 });
      return this;
    }
    /**
     * Register collision handler for two entity types.
     *
     * For different types (e.g., 'cell', 'food'), the handler is called once
     * with arguments in the registered order.
     *
     * For same types (e.g., 'cell', 'cell'), the handler is called twice -
     * once as (A, B) and once as (B, A). This lets you write "first acts on second"
     * logic without manually checking both directions.
     *
     * @example
     * // Cell eats food - called once per collision
     * physics.onCollision('cell', 'food', (cell, food) => {
     *     food.destroy();
     * });
     *
     * // Cell eats smaller cell - called twice, just check if first > second
     * physics.onCollision('cell', 'cell', (eater, prey) => {
     *     if (eater.get(Sprite).radius > prey.get(Sprite).radius * 1.2) {
     *         prey.destroy();
     *     }
     * });
     */
    onCollision(typeA, typeB, handler) {
      const key1 = `${typeA}:${typeB}`;
      const key2 = `${typeB}:${typeA}`;
      this.collisionHandlers.set(key1, handler);
      if (typeA !== typeB) {
        this.collisionHandlers.set(key2, (a, b) => handler(b, a));
      }
      return this;
    }
    /**
     * Set gravity.
     */
    setGravity(x, y) {
      this.physicsWorld.gravity = { x: toFixed(x), y: toFixed(y) };
      return this;
    }
    /**
     * Create or get physics body for entity.
     */
    ensureBody(entity) {
      const eid = entity.eid;
      let body = this.entityToBody.get(eid);
      if (body)
        return body;
      if (!entity.has(Transform2D) || !entity.has(Body2D)) {
        return null;
      }
      const transform = entity.get(Transform2D);
      const bodyData = entity.get(Body2D);
      let bodyType;
      switch (bodyData.bodyType) {
        case BODY_STATIC:
          bodyType = 0 /* Static */;
          break;
        case BODY_KINEMATIC:
          bodyType = 1 /* Kinematic */;
          break;
        default:
          bodyType = 2 /* Dynamic */;
      }
      let shape;
      if (bodyData.shapeType === SHAPE_CIRCLE || bodyData.radius > 0) {
        shape = createCircle(bodyData.radius || 10);
      } else {
        shape = createBox2DFromSize(bodyData.width || 10, bodyData.height || 10);
      }
      body = createBody2D(bodyType, shape, transform.x, transform.y);
      body.angle = toFixed(transform.angle);
      body.linearVelocity = { x: toFixed(bodyData.vx), y: toFixed(bodyData.vy) };
      body.isSensor = bodyData.isSensor;
      body.isSleeping = false;
      body.sleepFrames = 0;
      body.userData = entity;
      body.label = eid.toString();
      addBody2D(this.physicsWorld, body);
      this.entityToBody.set(eid, body);
      this.bodyToEntity.set(body.id, eid);
      return body;
    }
    /**
     * Remove physics body for entity.
     */
    removeBody(entity) {
      const eid = entity.eid;
      const body = this.entityToBody.get(eid);
      if (body) {
        removeBody2D(this.physicsWorld, body);
        this.entityToBody.delete(eid);
        this.bodyToEntity.delete(body.id);
      }
    }
    /**
     * Sync component data to physics bodies (prePhysics).
     */
    syncBodiesToPhysics() {
      if (!this.world)
        return;
      for (const entity of this.world.query(Body2D)) {
        const body = this.ensureBody(entity);
        if (!body)
          continue;
        const bodyData = entity.get(Body2D);
        if (bodyData.bodyType === BODY_KINEMATIC || bodyData.bodyType === BODY_STATIC) {
          const transform = entity.get(Transform2D);
          body.position.x = toFixed(transform.x);
          body.position.y = toFixed(transform.y);
          body.angle = toFixed(transform.angle);
        }
        if (bodyData.impulseX !== 0 || bodyData.impulseY !== 0) {
          bodyData.vx += bodyData.impulseX;
          bodyData.vy += bodyData.impulseY;
          bodyData.impulseX = 0;
          bodyData.impulseY = 0;
        }
        if (bodyData.forceX !== 0 || bodyData.forceY !== 0) {
          bodyData.vx += bodyData.forceX;
          bodyData.vy += bodyData.forceY;
          bodyData.forceX = 0;
          bodyData.forceY = 0;
        }
        if (bodyData.damping > 0) {
          const damp = 1 - bodyData.damping;
          bodyData.vx *= damp;
          bodyData.vy *= damp;
        }
        const newVelX = toFixed(bodyData.vx);
        const newVelY = toFixed(bodyData.vy);
        body.linearVelocity.x = newVelX;
        body.linearVelocity.y = newVelY;
        if (newVelX !== 0 || newVelY !== 0) {
          body.isSleeping = false;
          body.sleepFrames = 0;
        }
        if (body.shape.type === 0) {
          const currentRadius = body.shape.radius;
          const newRadius = toFixed(bodyData.radius);
          if (currentRadius !== newRadius) {
            body.shape.radius = newRadius;
          }
        }
      }
      for (const [eid, body] of this.entityToBody) {
        if (this.world.isDestroyed(eid)) {
          removeBody2D(this.physicsWorld, body);
          this.entityToBody.delete(eid);
          this.bodyToEntity.delete(body.id);
        }
      }
    }
    /**
     * Step physics simulation.
     */
    step() {
      stepWorld2D(this.physicsWorld);
    }
    /**
     * Sync physics results back to components (postPhysics).
     */
    syncPhysicsToComponents() {
      for (const [eid, body] of this.entityToBody) {
        const entity = this.world?.getEntity(eid);
        if (!entity || entity.destroyed)
          continue;
        const transform = entity.get(Transform2D);
        const bodyData = entity.get(Body2D);
        transform.x = toFloat(body.position.x);
        transform.y = toFloat(body.position.y);
        transform.angle = toFloat(body.angle);
        bodyData.vx = toFloat(body.linearVelocity.x);
        bodyData.vy = toFloat(body.linearVelocity.y);
      }
    }
    /**
     * Handle collision between two bodies.
     */
    handleCollision(bodyA, bodyB) {
      const entityA = bodyA.userData;
      const entityB = bodyB.userData;
      if (!entityA || !entityB)
        return;
      if (entityA.destroyed || entityB.destroyed)
        return;
      this.handleCollisionByType(entityA, entityB);
    }
    /**
     * Handle collision by entity types. Returns true if a handler was found.
     * Used by physics world for both regular and sensor collisions.
     */
    handleCollisionByType(entityA, entityB) {
      if (!entityA || !entityB)
        return false;
      if (entityA.destroyed || entityB.destroyed)
        return false;
      const key = `${entityA.type}:${entityB.type}`;
      const handler = this.collisionHandlers.get(key);
      if (handler) {
        handler(entityA, entityB);
        if (entityA.type === entityB.type && !entityA.destroyed && !entityB.destroyed) {
          handler(entityB, entityA);
        }
        return true;
      }
      return false;
    }
    /**
     * Get body for entity (for advanced use).
     */
    getBody(entity) {
      return this.entityToBody.get(entity.eid);
    }
    /**
     * Get entity for body (for advanced use).
     */
    getEntityForBody(body) {
      const eid = this.bodyToEntity.get(body.id);
      if (eid === void 0)
        return null;
      return this.world?.getEntity(eid) ?? null;
    }
    /**
     * Clear all physics state.
     * Used during snapshot restoration to ensure fresh physics state.
     */
    clear() {
      for (const body of this.entityToBody.values()) {
        removeBody2D(this.physicsWorld, body);
      }
      this.entityToBody.clear();
      this.bodyToEntity.clear();
      resetBody2DIdCounter();
    }
    /**
     * Wake all physics bodies.
     * Used after snapshot load/send to ensure deterministic state.
     * Without this, existing clients have sleeping bodies while late joiners
     * have awake bodies, causing physics divergence.
     */
    wakeAllBodies() {
      for (const body of this.physicsWorld.bodies) {
        body.isSleeping = false;
        body.sleepFrames = 0;
      }
    }
  };
  function createPhysics2DSystem(config = {}) {
    return new Physics2DSystem(config);
  }

  // src/plugins/physics3d/index.ts
  var physics3d_exports = {};
  __export(physics3d_exports, {
    BodyType: () => BodyType,
    DEFAULT_FILTER: () => DEFAULT_FILTER3,
    Layers: () => Layers2,
    ShapeType: () => ShapeType,
    TriggerState: () => TriggerState2,
    aabbOverlap: () => aabbOverlap,
    addBody: () => addBody,
    applyForce: () => applyForce,
    applyImpulse: () => applyImpulse,
    computeAABB: () => computeAABB,
    createBody: () => createBody,
    createBox: () => createBox,
    createFilter: () => createFilter2,
    createSphere: () => createSphere,
    createWorld: () => createWorld,
    detectCollision: () => detectCollision,
    filterCollidingWith: () => filterCollidingWith2,
    filterExcluding: () => filterExcluding2,
    getBodyIdCounter: () => getBodyIdCounter,
    isGrounded: () => isGrounded,
    loadWorldState: () => loadWorldState,
    makeTrigger: () => makeTrigger2,
    raycast: () => raycast,
    removeBody: () => removeBody,
    resetBodyIdCounter: () => resetBodyIdCounter,
    resolveCollision: () => resolveCollision,
    saveWorldState: () => saveWorldState,
    setBodyIdCounter: () => setBodyIdCounter,
    setBodyMass: () => setBodyMass,
    setBodyVelocity: () => setBodyVelocity,
    shouldCollide: () => shouldCollide2,
    stepWorld: () => stepWorld
  });

  // src/plugins/physics3d/shapes.ts
  var ShapeType = /* @__PURE__ */ ((ShapeType2) => {
    ShapeType2[ShapeType2["Box"] = 0] = "Box";
    ShapeType2[ShapeType2["Sphere"] = 1] = "Sphere";
    return ShapeType2;
  })(ShapeType || {});
  function createBox(hx, hy, hz) {
    return { type: 0 /* Box */, halfExtents: vec3FromFloats(hx, hy, hz) };
  }
  function createSphere(radius) {
    return { type: 1 /* Sphere */, radius: toFixed(radius) };
  }
  function aabbOverlap(a, b) {
    return a.max.x >= b.min.x && a.min.x <= b.max.x && a.max.y >= b.min.y && a.min.y <= b.max.y && a.max.z >= b.min.z && a.min.z <= b.max.z;
  }

  // src/plugins/physics3d/layers.ts
  var Layers2 = {
    NONE: 0,
    DEFAULT: 1 << 0,
    // 1
    PLAYER: 1 << 1,
    // 2
    ENEMY: 1 << 2,
    // 4
    PROJECTILE: 1 << 3,
    // 8
    ITEM: 1 << 4,
    // 16
    TRIGGER: 1 << 5,
    // 32
    WORLD: 1 << 6,
    // 64
    PROP: 1 << 7,
    // 128
    // Layers 8-15 reserved for game-specific use
    CUSTOM_1: 1 << 8,
    CUSTOM_2: 1 << 9,
    CUSTOM_3: 1 << 10,
    CUSTOM_4: 1 << 11,
    CUSTOM_5: 1 << 12,
    CUSTOM_6: 1 << 13,
    CUSTOM_7: 1 << 14,
    CUSTOM_8: 1 << 15,
    ALL: 65535
    // All layers
  };
  var DEFAULT_FILTER3 = {
    layer: Layers2.DEFAULT,
    mask: Layers2.ALL
  };
  function createFilter2(layer, mask = Layers2.ALL) {
    return { layer, mask };
  }
  function shouldCollide2(a, b) {
    return (a.mask & b.layer) !== 0 && (b.mask & a.layer) !== 0;
  }
  function filterCollidingWith2(layer, ...collidesWithLayers) {
    let mask = 0;
    for (const l of collidesWithLayers) {
      mask |= l;
    }
    return { layer, mask };
  }
  function filterExcluding2(layer, ...excludeLayers) {
    let mask = Layers2.ALL;
    for (const l of excludeLayers) {
      mask &= ~l;
    }
    return { layer, mask };
  }

  // src/plugins/physics3d/rigid-body.ts
  var RESTITUTION_DEFAULT2 = toFixed(0);
  var FRICTION_DEFAULT2 = toFixed(0.5);
  var BodyType = /* @__PURE__ */ ((BodyType3) => {
    BodyType3[BodyType3["Static"] = 0] = "Static";
    BodyType3[BodyType3["Kinematic"] = 1] = "Kinematic";
    BodyType3[BodyType3["Dynamic"] = 2] = "Dynamic";
    return BodyType3;
  })(BodyType || {});
  var nextBodyId = 1;
  function resetBodyIdCounter() {
    nextBodyId = 1;
  }
  function getBodyIdCounter() {
    return nextBodyId;
  }
  function setBodyIdCounter(value) {
    nextBodyId = value;
  }
  function createBody(type, shape, x, y, z, label) {
    const mass = type === 2 /* Dynamic */ ? toFixed(1) : 0;
    const invMass = type === 2 /* Dynamic */ ? FP_ONE : 0;
    let inertia = 0;
    if (type === 2 /* Dynamic */) {
      if (shape.type === 0 /* Box */) {
        const h = shape.halfExtents;
        inertia = fpMul(mass, fpMul(
          toFixed(1 / 6),
          fpMul(h.x, h.x) + fpMul(h.y, h.y) + fpMul(h.z, h.z)
        ));
      } else {
        const r = shape.radius;
        inertia = fpMul(mass, fpMul(toFixed(0.4), fpMul(r, r)));
      }
    }
    const bodyLabel = label || "body_" + nextBodyId;
    const bodyId = nextBodyId++;
    return {
      id: bodyId,
      label: bodyLabel,
      type,
      shape,
      position: vec3FromFloats(x, y, z),
      rotation: quatIdentity(),
      linearVelocity: vec3Zero(),
      angularVelocity: vec3Zero(),
      mass,
      invMass,
      inertia: inertia || FP_ONE,
      invInertia: inertia ? fpDiv(FP_ONE, inertia) : 0,
      restitution: RESTITUTION_DEFAULT2,
      friction: FRICTION_DEFAULT2,
      isSleeping: false,
      sleepFrames: 0,
      lockRotationX: false,
      lockRotationY: false,
      lockRotationZ: false,
      isTrigger: false,
      filter: { ...DEFAULT_FILTER3 },
      userData: null
    };
  }
  function setBodyMass(body, mass) {
    if (body.type !== 2 /* Dynamic */)
      return;
    body.mass = toFixed(mass);
    body.invMass = mass > 0 ? fpDiv(FP_ONE, body.mass) : 0;
  }
  function setBodyVelocity(body, vx, vy, vz) {
    body.linearVelocity = vec3FromFloats(vx, vy, vz);
    body.isSleeping = false;
  }
  function applyImpulse(body, impulse, point) {
    if (body.type !== 2 /* Dynamic */ || body.invMass === 0)
      return;
    body.linearVelocity = vec3Add(body.linearVelocity, vec3Scale(impulse, body.invMass));
    if (point) {
      const r = vec3Sub(point, body.position);
      const torque = vec3Cross(r, impulse);
      body.angularVelocity = vec3Add(body.angularVelocity, vec3Scale(torque, body.invInertia));
    }
    body.isSleeping = false;
  }
  function applyForce(body, force, dt) {
    if (body.type !== 2 /* Dynamic */ || body.invMass === 0)
      return;
    const impulse = vec3Scale(force, dt);
    applyImpulse(body, impulse);
  }

  // src/plugins/physics3d/collision.ts
  var POSITION_CORRECTION = toFixed(0.6);
  var SLOP = toFixed(0.05);
  var WAKE_VELOCITY_THRESHOLD = toFixed(1.5);
  function computeAABB(body) {
    const pos = body.position;
    const shape = body.shape;
    if (shape.type === 1 /* Sphere */) {
      const r = shape.radius;
      return {
        min: { x: pos.x - r, y: pos.y - r, z: pos.z - r },
        max: { x: pos.x + r, y: pos.y + r, z: pos.z + r }
      };
    } else {
      const h = shape.halfExtents;
      const axisX = quatRotateVec3(body.rotation, vec3(FP_ONE, 0, 0));
      const axisY = quatRotateVec3(body.rotation, vec3(0, FP_ONE, 0));
      const axisZ = quatRotateVec3(body.rotation, vec3(0, 0, FP_ONE));
      const extentX = fpAbs(fpMul(axisX.x, h.x)) + fpAbs(fpMul(axisY.x, h.y)) + fpAbs(fpMul(axisZ.x, h.z));
      const extentY = fpAbs(fpMul(axisX.y, h.x)) + fpAbs(fpMul(axisY.y, h.y)) + fpAbs(fpMul(axisZ.y, h.z));
      const extentZ = fpAbs(fpMul(axisX.z, h.x)) + fpAbs(fpMul(axisY.z, h.y)) + fpAbs(fpMul(axisZ.z, h.z));
      return {
        min: { x: pos.x - extentX, y: pos.y - extentY, z: pos.z - extentZ },
        max: { x: pos.x + extentX, y: pos.y + extentY, z: pos.z + extentZ }
      };
    }
  }
  function sphereSphereCollision(a, b) {
    const shapeA = a.shape;
    const shapeB = b.shape;
    const diff = vec3Sub(a.position, b.position);
    const distSq = vec3LengthSq(diff);
    const minDist = shapeA.radius + shapeB.radius;
    const minDistSq = fpMul(minDist, minDist);
    if (distSq >= minDistSq)
      return null;
    const dist = fpSqrt(distSq);
    const normal = dist > 0 ? vec3Scale(diff, fpDiv(FP_ONE, dist)) : vec3(FP_ONE, 0, 0);
    const penetration = minDist - dist;
    const point = vec3Sub(a.position, vec3Scale(normal, shapeA.radius));
    return { bodyA: a, bodyB: b, normal, points: [{ point, penetration }] };
  }
  function sphereBoxCollision(sphere, box) {
    const sphereShape = sphere.shape;
    const boxShape = box.shape;
    const worldDiff = vec3Sub(sphere.position, box.position);
    const invRotation = quatConjugate(box.rotation);
    const localSphere = quatRotateVec3(invRotation, worldDiff);
    const h = boxShape.halfExtents;
    const closestLocal = {
      x: fpClamp(localSphere.x, -h.x, h.x),
      y: fpClamp(localSphere.y, -h.y, h.y),
      z: fpClamp(localSphere.z, -h.z, h.z)
    };
    const diffLocal = vec3Sub(localSphere, closestLocal);
    const distSq = vec3LengthSq(diffLocal);
    const radiusSq = fpMul(sphereShape.radius, sphereShape.radius);
    if (distSq >= radiusSq)
      return null;
    const dist = fpSqrt(distSq);
    let normalLocal;
    let penetration;
    if (dist > 0) {
      normalLocal = vec3Scale(diffLocal, fpDiv(FP_ONE, dist));
      penetration = sphereShape.radius - dist;
    } else {
      const dx = h.x - fpAbs(localSphere.x);
      const dy = h.y - fpAbs(localSphere.y);
      const dz = h.z - fpAbs(localSphere.z);
      if (dx <= dy && dx <= dz) {
        normalLocal = localSphere.x >= 0 ? vec3(FP_ONE, 0, 0) : vec3(-FP_ONE, 0, 0);
        penetration = dx + sphereShape.radius;
      } else if (dy <= dz) {
        normalLocal = localSphere.y >= 0 ? vec3(0, FP_ONE, 0) : vec3(0, -FP_ONE, 0);
        penetration = dy + sphereShape.radius;
      } else {
        normalLocal = localSphere.z >= 0 ? vec3(0, 0, FP_ONE) : vec3(0, 0, -FP_ONE);
        penetration = dz + sphereShape.radius;
      }
    }
    const worldClosest = vec3Add(box.position, quatRotateVec3(box.rotation, closestLocal));
    const worldNormal = quatRotateVec3(box.rotation, normalLocal);
    return { bodyA: sphere, bodyB: box, normal: worldNormal, points: [{ point: worldClosest, penetration }] };
  }
  function boxBoxCollision(a, b) {
    const shapeA = a.shape;
    const shapeB = b.shape;
    const hA = shapeA.halfExtents;
    const hB = shapeB.halfExtents;
    const axesA = [
      quatRotateVec3(a.rotation, vec3(FP_ONE, 0, 0)),
      quatRotateVec3(a.rotation, vec3(0, FP_ONE, 0)),
      quatRotateVec3(a.rotation, vec3(0, 0, FP_ONE))
    ];
    const axesB = [
      quatRotateVec3(b.rotation, vec3(FP_ONE, 0, 0)),
      quatRotateVec3(b.rotation, vec3(0, FP_ONE, 0)),
      quatRotateVec3(b.rotation, vec3(0, 0, FP_ONE))
    ];
    const extentsA = [hA.x, hA.y, hA.z];
    const extentsB = [hB.x, hB.y, hB.z];
    const d = vec3Sub(b.position, a.position);
    let minPen = 2147483647;
    let bestNormal = vec3(0, FP_ONE, 0);
    function project(axes, extents, axis) {
      return fpAbs(fpMul(vec3Dot(axes[0], axis), extents[0])) + fpAbs(fpMul(vec3Dot(axes[1], axis), extents[1])) + fpAbs(fpMul(vec3Dot(axes[2], axis), extents[2]));
    }
    function testAxis(axis) {
      const lenSq = vec3LengthSq(axis);
      if (lenSq < toFixed(1e-4))
        return true;
      const len = fpSqrt(lenSq);
      const n = vec3Scale(axis, fpDiv(FP_ONE, len));
      const pA = project(axesA, extentsA, n);
      const pB = project(axesB, extentsB, n);
      const dist = fpAbs(vec3Dot(d, n));
      const pen = pA + pB - dist;
      if (pen <= 0)
        return false;
      if (pen < minPen) {
        minPen = pen;
        bestNormal = vec3Dot(d, n) < 0 ? n : vec3Neg(n);
      }
      return true;
    }
    for (let i = 0; i < 3; i++) {
      if (!testAxis(axesA[i]))
        return null;
      if (!testAxis(axesB[i]))
        return null;
    }
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (!testAxis(vec3Cross(axesA[i], axesB[j])))
          return null;
      }
    }
    const contactPoints = [];
    const volumeA = fpMul(fpMul(hA.x, hA.y), hA.z);
    const volumeB = fpMul(fpMul(hB.x, hB.y), hB.z);
    const incidentBody = volumeB <= volumeA ? b : a;
    const incidentHalf = volumeB <= volumeA ? hB : hA;
    const referenceBody = volumeB <= volumeA ? a : b;
    const signs = [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, -1],
      [-1, 1, 1],
      [1, -1, -1],
      [1, -1, 1],
      [1, 1, -1],
      [1, 1, 1]
    ];
    const refFaceNormal = volumeB <= volumeA ? bestNormal : vec3Neg(bestNormal);
    const vertexContacts = [];
    const refAxes = volumeB <= volumeA ? axesA : axesB;
    const refHalf = volumeB <= volumeA ? hA : hB;
    for (const [sx, sy, sz] of signs) {
      const localV = vec3(
        fpMul(incidentHalf.x, toFixed(sx)),
        fpMul(incidentHalf.y, toFixed(sy)),
        fpMul(incidentHalf.z, toFixed(sz))
      );
      const worldV = vec3Add(incidentBody.position, quatRotateVec3(incidentBody.rotation, localV));
      const toVertex = vec3Sub(worldV, referenceBody.position);
      const normalDist = vec3Dot(toVertex, refFaceNormal);
      const refExtent = fpMul(fpAbs(vec3Dot(refAxes[0], refFaceNormal)), refHalf.x) + fpMul(fpAbs(vec3Dot(refAxes[1], refFaceNormal)), refHalf.y) + fpMul(fpAbs(vec3Dot(refAxes[2], refFaceNormal)), refHalf.z);
      const depth = normalDist + refExtent;
      if (depth > 0) {
        vertexContacts.push({ point: worldV, depth });
      }
    }
    vertexContacts.sort((a2, b2) => {
      const depthDiff = b2.depth - a2.depth;
      if (depthDiff !== 0)
        return depthDiff;
      return a2.point.x - b2.point.x || a2.point.y - b2.point.y || a2.point.z - b2.point.z;
    });
    const DEPTH_THRESHOLD = toFixed(0.05);
    const maxDepth = vertexContacts.length > 0 ? vertexContacts[0].depth : 0;
    for (const vc of vertexContacts) {
      if (vc.depth > maxDepth - DEPTH_THRESHOLD) {
        contactPoints.push({ point: vc.point, penetration: vc.depth });
      }
      if (contactPoints.length >= 4)
        break;
    }
    if (contactPoints.length === 0) {
      const midPoint = vec3Scale(vec3Add(a.position, b.position), FP_HALF);
      contactPoints.push({ point: midPoint, penetration: minPen });
    }
    return { bodyA: a, bodyB: b, normal: bestNormal, points: contactPoints };
  }
  function detectCollision(a, b) {
    const typeA = a.shape.type;
    const typeB = b.shape.type;
    if (typeA === 1 /* Sphere */ && typeB === 1 /* Sphere */) {
      return sphereSphereCollision(a, b);
    } else if (typeA === 1 /* Sphere */ && typeB === 0 /* Box */) {
      return sphereBoxCollision(a, b);
    } else if (typeA === 0 /* Box */ && typeB === 1 /* Sphere */) {
      const contact = sphereBoxCollision(b, a);
      if (contact) {
        return {
          bodyA: a,
          bodyB: b,
          normal: vec3Neg(contact.normal),
          points: contact.points
        };
      }
      return null;
    } else {
      return boxBoxCollision(a, b);
    }
  }
  function resolveCollision(contact) {
    const { bodyA, bodyB, normal, points } = contact;
    if (bodyA.invMass === 0 && bodyB.invMass === 0)
      return;
    if (points.length === 0)
      return;
    const relVelForWake = vec3Sub(bodyA.linearVelocity, bodyB.linearVelocity);
    const impactVelocity = fpAbs(vec3Dot(relVelForWake, normal));
    const isRestingContact = impactVelocity < WAKE_VELOCITY_THRESHOLD;
    if (isRestingContact && (bodyA.isSleeping || bodyB.isSleeping)) {
      for (const cp of points) {
        const penetration = cp.penetration;
        if (penetration > SLOP) {
          const pureInvMassSum = bodyA.invMass + bodyB.invMass;
          if (pureInvMassSum > 0) {
            const correction = fpMul(fpDiv(penetration - SLOP, pureInvMassSum), POSITION_CORRECTION);
            const correctionVec = vec3Scale(normal, correction);
            if (bodyA.invMass > 0 && !bodyA.isSleeping) {
              bodyA.position = vec3Add(bodyA.position, vec3Scale(correctionVec, bodyA.invMass));
            }
            if (bodyB.invMass > 0 && !bodyB.isSleeping) {
              bodyB.position = vec3Sub(bodyB.position, vec3Scale(correctionVec, bodyB.invMass));
            }
          }
        }
      }
      return;
    }
    const numContacts = points.length;
    const invNumContacts = fpDiv(FP_ONE, toFixed(numContacts));
    const e = fpMin(bodyA.restitution, bodyB.restitution);
    const frictionCoeff = fpDiv(bodyA.friction + bodyB.friction, toFixed(2));
    for (const cp of points) {
      const point = cp.point;
      const penetration = cp.penetration;
      const rA = vec3Sub(point, bodyA.position);
      const rB = vec3Sub(point, bodyB.position);
      const velA = vec3Add(bodyA.linearVelocity, vec3Cross(bodyA.angularVelocity, rA));
      const velB = vec3Add(bodyB.linearVelocity, vec3Cross(bodyB.angularVelocity, rB));
      const relVel = vec3Sub(velA, velB);
      const velAlongNormal = vec3Dot(relVel, normal);
      if (velAlongNormal < 0) {
        const rACrossN = vec3Cross(rA, normal);
        const rBCrossN = vec3Cross(rB, normal);
        const angularInertiaA = bodyA.lockRotationX && bodyA.lockRotationY && bodyA.lockRotationZ ? 0 : fpMul(vec3Dot(rACrossN, rACrossN), bodyA.invInertia);
        const angularInertiaB = bodyB.lockRotationX && bodyB.lockRotationY && bodyB.lockRotationZ ? 0 : fpMul(vec3Dot(rBCrossN, rBCrossN), bodyB.invInertia);
        const invMassSum = bodyA.invMass + bodyB.invMass + angularInertiaA + angularInertiaB;
        let j = fpMul(-(FP_ONE + e), velAlongNormal);
        j = fpDiv(j, invMassSum);
        j = fpMul(j, invNumContacts);
        const impulse = vec3Scale(normal, j);
        if (bodyA.invMass > 0) {
          applyImpulse(bodyA, impulse, point);
        }
        if (bodyB.invMass > 0) {
          applyImpulse(bodyB, vec3Neg(impulse), point);
        }
        const tangent = vec3Sub(relVel, vec3Scale(normal, velAlongNormal));
        const tangentLenSq = vec3LengthSq(tangent);
        if (tangentLenSq > toFixed(1e-4)) {
          const tangentNorm = vec3Normalize(tangent);
          const rACrossT = vec3Cross(rA, tangentNorm);
          const rBCrossT = vec3Cross(rB, tangentNorm);
          const angularInertiaTA = bodyA.lockRotationX && bodyA.lockRotationY && bodyA.lockRotationZ ? 0 : fpMul(vec3Dot(rACrossT, rACrossT), bodyA.invInertia);
          const angularInertiaTB = bodyB.lockRotationX && bodyB.lockRotationY && bodyB.lockRotationZ ? 0 : fpMul(vec3Dot(rBCrossT, rBCrossT), bodyB.invInertia);
          const invMassSumT = bodyA.invMass + bodyB.invMass + angularInertiaTA + angularInertiaTB;
          const tangentSpeed = fpSqrt(tangentLenSq);
          let jt = fpDiv(tangentSpeed, invMassSumT);
          jt = fpMul(jt, invNumContacts);
          const maxFriction = fpMul(fpAbs(j), frictionCoeff);
          if (jt > maxFriction)
            jt = maxFriction;
          const frictionImpulse = vec3Scale(tangentNorm, -jt);
          if (bodyA.invMass > 0) {
            applyImpulse(bodyA, frictionImpulse, point);
          }
          if (bodyB.invMass > 0) {
            applyImpulse(bodyB, vec3Neg(frictionImpulse), point);
          }
        }
      }
      if (penetration > SLOP) {
        const pureInvMassSum = bodyA.invMass + bodyB.invMass;
        const correction = fpMul(fpDiv(penetration - SLOP, pureInvMassSum), POSITION_CORRECTION);
        const scaledCorrection = fpMul(correction, invNumContacts);
        const correctionVec = vec3Scale(normal, scaledCorrection);
        if (bodyA.invMass > 0) {
          bodyA.position = vec3Add(bodyA.position, vec3Scale(correctionVec, bodyA.invMass));
        }
        if (bodyB.invMass > 0) {
          bodyB.position = vec3Sub(bodyB.position, vec3Scale(correctionVec, bodyB.invMass));
        }
      }
    }
  }

  // src/plugins/physics3d/trigger.ts
  var TriggerState2 = class {
    constructor() {
      this.overlaps = /* @__PURE__ */ new Map();
      this.enterCallbacks = [];
      this.stayCallbacks = [];
      this.exitCallbacks = [];
      this.pendingPairs = [];
    }
    onEnter(cb) {
      this.enterCallbacks.push(cb);
    }
    onStay(cb) {
      this.stayCallbacks.push(cb);
    }
    onExit(cb) {
      this.exitCallbacks.push(cb);
    }
    processOverlaps(currentOverlaps) {
      const currentKeys = /* @__PURE__ */ new Set();
      const sortedOverlaps = [...currentOverlaps].sort((a, b) => {
        return this.makeKey(a.trigger, a.other).localeCompare(this.makeKey(b.trigger, b.other));
      });
      for (const overlap of sortedOverlaps) {
        const key = this.makeKey(overlap.trigger, overlap.other);
        currentKeys.add(key);
        if (this.overlaps.has(key)) {
          for (const cb of this.stayCallbacks)
            cb(overlap);
        } else {
          this.overlaps.set(key, overlap);
          for (const cb of this.enterCallbacks)
            cb(overlap);
        }
      }
      const sortedExistingKeys = [...this.overlaps.keys()].sort();
      for (const key of sortedExistingKeys) {
        if (!currentKeys.has(key)) {
          const overlap = this.overlaps.get(key);
          this.overlaps.delete(key);
          for (const cb of this.exitCallbacks)
            cb(overlap);
        }
      }
    }
    clear() {
      this.overlaps.clear();
    }
    removeBody(body) {
      const keysToRemove = [];
      for (const [key, overlap] of this.overlaps) {
        if (overlap.trigger === body || overlap.other === body) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.sort();
      for (const key of keysToRemove) {
        const overlap = this.overlaps.get(key);
        this.overlaps.delete(key);
        for (const cb of this.exitCallbacks)
          cb(overlap);
      }
    }
    getOverlappingBodies(trigger) {
      const bodies = [];
      for (const overlap of this.overlaps.values()) {
        if (overlap.trigger === trigger) {
          bodies.push(overlap.other);
        }
      }
      return bodies.sort((a, b) => a.label.localeCompare(b.label));
    }
    isBodyInTrigger(trigger, body) {
      return this.overlaps.has(this.makeKey(trigger, body));
    }
    overlapCount() {
      return this.overlaps.size;
    }
    saveState() {
      const pairs = [];
      for (const overlap of this.overlaps.values()) {
        pairs.push([overlap.trigger.label, overlap.other.label]);
      }
      return pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    }
    loadState(pairs) {
      this.overlaps.clear();
      this.pendingPairs = pairs;
    }
    syncWithWorld(bodies) {
      const bodyByLabel = /* @__PURE__ */ new Map();
      for (const body of bodies)
        bodyByLabel.set(body.label, body);
      for (const [triggerLabel, otherLabel] of this.pendingPairs) {
        const trigger = bodyByLabel.get(triggerLabel);
        const other = bodyByLabel.get(otherLabel);
        if (trigger && other) {
          this.overlaps.set(this.makeKey(trigger, other), { trigger, other });
        }
      }
      this.pendingPairs = [];
    }
    makeKey(trigger, other) {
      return `${trigger.label}:${other.label}`;
    }
  };
  function makeTrigger2(body) {
    body.isTrigger = true;
    return body;
  }

  // src/plugins/physics3d/world.ts
  var GRAVITY = { x: 0, y: toFixed(-30), z: 0 };
  var LINEAR_DAMPING2 = toFixed(0.1);
  var ANGULAR_DAMPING2 = toFixed(0.1);
  var SLEEP_THRESHOLD2 = toFixed(0.12);
  var SLEEP_FRAMES_REQUIRED2 = 20;
  var CONTACT_SLEEP_BONUS = 10;
  var COLLISION_ITERATIONS = 8;
  function createWorld(dt = 1 / 60) {
    const world = {
      bodies: [],
      gravity: vec3Clone(GRAVITY),
      dt: toFixed(dt),
      triggers: new TriggerState2(),
      step() {
        return stepWorld(world);
      }
    };
    return world;
  }
  function addBody(world, body) {
    world.bodies.push(body);
  }
  function removeBody(world, body) {
    const index = world.bodies.indexOf(body);
    if (index >= 0) {
      world.bodies.splice(index, 1);
      world.triggers.removeBody(body);
    }
  }
  function isGrounded(world, body, threshold = 0.15) {
    const thresholdFP = toFixed(threshold);
    for (const other of world.bodies) {
      if (other === body)
        continue;
      const contact = detectCollision(body, other);
      if (contact && contact.normal.y > FP_HALF) {
        return true;
      }
      const savedY = body.position.y;
      body.position.y = body.position.y - thresholdFP;
      const contactBelow = detectCollision(body, other);
      body.position.y = savedY;
      if (contactBelow && contactBelow.normal.y > FP_HALF) {
        return true;
      }
    }
    return false;
  }
  function stepWorld(world) {
    const { gravity, dt, triggers } = world;
    const contacts = [];
    const triggerOverlaps = [];
    const bodies = [...world.bodies].sort((a, b) => a.label.localeCompare(b.label));
    const restingContactBodies = /* @__PURE__ */ new Set();
    const sleepingContactBodies = /* @__PURE__ */ new Set();
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        if (a.invMass === 0 && b.invMass === 0)
          continue;
        if (!shouldCollide2(a.filter, b.filter))
          continue;
        const aabbA = computeAABB(a);
        const aabbB = computeAABB(b);
        if (!aabbOverlap(aabbA, aabbB))
          continue;
        const contact = detectCollision(a, b);
        if (contact) {
          if (fpAbs(contact.normal.y) > FP_HALF) {
            restingContactBodies.add(a);
            restingContactBodies.add(b);
            if (a.isSleeping && b.type === 2 /* Dynamic */) {
              const bSpeedSq = vec3LengthSq(b.linearVelocity) + vec3LengthSq(b.angularVelocity);
              if (bSpeedSq < fpMul(SLEEP_THRESHOLD2, SLEEP_THRESHOLD2)) {
                sleepingContactBodies.add(b);
              }
            }
            if (b.isSleeping && a.type === 2 /* Dynamic */) {
              const aSpeedSq = vec3LengthSq(a.linearVelocity) + vec3LengthSq(a.angularVelocity);
              if (aSpeedSq < fpMul(SLEEP_THRESHOLD2, SLEEP_THRESHOLD2)) {
                sleepingContactBodies.add(a);
              }
            }
          }
        }
      }
    }
    for (const body of bodies) {
      if (body.type !== 2 /* Dynamic */)
        continue;
      if (body.isSleeping)
        continue;
      body.linearVelocity = vec3Add(body.linearVelocity, vec3Scale(gravity, dt));
      let linearDamp = FP_ONE - LINEAR_DAMPING2;
      let angularDamp = FP_ONE - ANGULAR_DAMPING2;
      if (restingContactBodies.has(body)) {
        linearDamp = fpMul(linearDamp, toFixed(0.95));
        angularDamp = fpMul(angularDamp, toFixed(0.9));
      }
      body.linearVelocity = vec3Scale(body.linearVelocity, linearDamp);
      body.angularVelocity = vec3Scale(body.angularVelocity, angularDamp);
    }
    for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i];
          const b = bodies[j];
          if (a.invMass === 0 && b.invMass === 0)
            continue;
          if (!shouldCollide2(a.filter, b.filter))
            continue;
          const aabbA = computeAABB(a);
          const aabbB = computeAABB(b);
          if (!aabbOverlap(aabbA, aabbB))
            continue;
          const contact = detectCollision(a, b);
          if (contact) {
            const isTriggerCollision = a.isTrigger || b.isTrigger;
            if (isTriggerCollision) {
              if (iter === 0) {
                if (a.isTrigger) {
                  triggerOverlaps.push({ trigger: a, other: b });
                }
                if (b.isTrigger) {
                  triggerOverlaps.push({ trigger: b, other: a });
                }
              }
            } else {
              if (iter === 0)
                contacts.push(contact);
              resolveCollision(contact);
            }
          }
        }
      }
    }
    triggers.processOverlaps(triggerOverlaps);
    for (const body of bodies) {
      if (body.type === 0 /* Static */)
        continue;
      if (body.isSleeping)
        continue;
      const linearClampThreshold = toFixed(0.05);
      if (fpAbs(body.linearVelocity.x) < linearClampThreshold)
        body.linearVelocity.x = 0;
      if (fpAbs(body.linearVelocity.y) < linearClampThreshold)
        body.linearVelocity.y = 0;
      if (fpAbs(body.linearVelocity.z) < linearClampThreshold)
        body.linearVelocity.z = 0;
      body.position = vec3Add(body.position, vec3Scale(body.linearVelocity, dt));
      if (body.lockRotationX && body.lockRotationY && body.lockRotationZ) {
        continue;
      }
      let angVelX = body.lockRotationX ? 0 : body.angularVelocity.x;
      let angVelY = body.lockRotationY ? 0 : body.angularVelocity.y;
      let angVelZ = body.lockRotationZ ? 0 : body.angularVelocity.z;
      const angularClampThreshold = toFixed(0.01);
      if (fpAbs(angVelX) < angularClampThreshold)
        angVelX = 0;
      if (fpAbs(angVelY) < angularClampThreshold)
        angVelY = 0;
      if (fpAbs(angVelZ) < angularClampThreshold)
        angVelZ = 0;
      body.angularVelocity.x = angVelX;
      body.angularVelocity.y = angVelY;
      body.angularVelocity.z = angVelZ;
      const angVelLengthSq = fpMul(angVelX, angVelX) + fpMul(angVelY, angVelY) + fpMul(angVelZ, angVelZ);
      if (angVelLengthSq > 0) {
        const angSpeed = fpSqrt(angVelLengthSq);
        const angle = fpMul(angSpeed, dt);
        const invSpeed = fpDiv(FP_ONE, angSpeed);
        const axis = {
          x: fpMul(angVelX, invSpeed),
          y: fpMul(angVelY, invSpeed),
          z: fpMul(angVelZ, invSpeed)
        };
        const rotDelta = quatFromAxisAngle(axis, angle);
        body.rotation = quatNormalize(quatMul(rotDelta, body.rotation));
      }
      const speedSq = vec3LengthSq(body.linearVelocity);
      const angSpeedSq = vec3LengthSq(body.angularVelocity);
      const sleepThreshSq = fpMul(SLEEP_THRESHOLD2, SLEEP_THRESHOLD2);
      if (speedSq < sleepThreshSq && angSpeedSq < sleepThreshSq) {
        const sleepIncrement = sleepingContactBodies.has(body) ? 1 + CONTACT_SLEEP_BONUS : 1;
        body.sleepFrames += sleepIncrement;
        if (body.sleepFrames >= SLEEP_FRAMES_REQUIRED2) {
          body.isSleeping = true;
          body.linearVelocity = vec3Zero();
          body.angularVelocity = vec3Zero();
        }
      } else {
        body.sleepFrames = 0;
        body.isSleeping = false;
      }
    }
    return contacts;
  }

  // src/plugins/physics3d/raycast.ts
  function raycast(world, origin, direction, maxDistance) {
    const dir = vec3Normalize(direction);
    let closestHit = null;
    let closestDist = maxDistance;
    for (const body of world.bodies) {
      const hit = raycastBody(body, origin, dir, closestDist);
      if (hit && hit.distance < closestDist) {
        closestDist = hit.distance;
        closestHit = hit;
      }
    }
    return closestHit;
  }
  function raycastBody(body, origin, dir, maxDist) {
    if (body.shape.type === 1 /* Sphere */) {
      return raycastSphere(body, origin, dir, maxDist);
    } else {
      return raycastBox(body, origin, dir, maxDist);
    }
  }
  function raycastSphere(body, origin, dir, maxDist) {
    const shape = body.shape;
    const oc = vec3Sub(origin, body.position);
    const a = vec3Dot(dir, dir);
    const b = fpMul(toFixed(2), vec3Dot(oc, dir));
    const c = vec3Dot(oc, oc) - fpMul(shape.radius, shape.radius);
    const discriminant = fpMul(b, b) - fpMul(fpMul(toFixed(4), a), c);
    if (discriminant < 0)
      return null;
    const sqrtD = fpSqrt(discriminant);
    let t = fpDiv(-b - sqrtD, fpMul(toFixed(2), a));
    if (t < 0) {
      t = fpDiv(-b + sqrtD, fpMul(toFixed(2), a));
      if (t < 0)
        return null;
    }
    if (t > maxDist)
      return null;
    const point = vec3Add(origin, vec3Scale(dir, t));
    const normal = vec3Normalize(vec3Sub(point, body.position));
    return { body, point, normal, distance: t };
  }
  function raycastBox(body, origin, dir, maxDist) {
    const shape = body.shape;
    const h = shape.halfExtents;
    const pos = body.position;
    let tMin = -2147483647;
    let tMax = 2147483647;
    let normalAxis = 0;
    let normalSign = 1;
    {
      const invD = dir.x !== 0 ? fpDiv(FP_ONE, dir.x) : 2147483647;
      let t0 = fpMul(pos.x - h.x - origin.x, invD);
      let t1 = fpMul(pos.x + h.x - origin.x, invD);
      if (invD < 0)
        [t0, t1] = [t1, t0];
      if (t0 > tMin) {
        tMin = t0;
        normalAxis = 0;
        normalSign = invD < 0 ? 1 : -1;
      }
      if (t1 < tMax)
        tMax = t1;
      if (tMax < tMin)
        return null;
    }
    {
      const invD = dir.y !== 0 ? fpDiv(FP_ONE, dir.y) : 2147483647;
      let t0 = fpMul(pos.y - h.y - origin.y, invD);
      let t1 = fpMul(pos.y + h.y - origin.y, invD);
      if (invD < 0)
        [t0, t1] = [t1, t0];
      if (t0 > tMin) {
        tMin = t0;
        normalAxis = 1;
        normalSign = invD < 0 ? 1 : -1;
      }
      if (t1 < tMax)
        tMax = t1;
      if (tMax < tMin)
        return null;
    }
    {
      const invD = dir.z !== 0 ? fpDiv(FP_ONE, dir.z) : 2147483647;
      let t0 = fpMul(pos.z - h.z - origin.z, invD);
      let t1 = fpMul(pos.z + h.z - origin.z, invD);
      if (invD < 0)
        [t0, t1] = [t1, t0];
      if (t0 > tMin) {
        tMin = t0;
        normalAxis = 2;
        normalSign = invD < 0 ? 1 : -1;
      }
      if (t1 < tMax)
        tMax = t1;
      if (tMax < tMin)
        return null;
    }
    if (tMin < 0 || tMin > maxDist)
      return null;
    const point = vec3Add(origin, vec3Scale(dir, tMin));
    const normal = vec3(
      normalAxis === 0 ? toFixed(normalSign) : 0,
      normalAxis === 1 ? toFixed(normalSign) : 0,
      normalAxis === 2 ? toFixed(normalSign) : 0
    );
    return { body, point, normal, distance: tMin };
  }

  // src/plugins/physics3d/state.ts
  function saveWorldState(world) {
    return {
      bodies: world.bodies.map((b) => ({
        id: b.id,
        label: b.label,
        px: b.position.x,
        py: b.position.y,
        pz: b.position.z,
        qx: b.rotation.x,
        qy: b.rotation.y,
        qz: b.rotation.z,
        qw: b.rotation.w,
        vx: b.linearVelocity.x,
        vy: b.linearVelocity.y,
        vz: b.linearVelocity.z,
        avx: b.angularVelocity.x,
        avy: b.angularVelocity.y,
        avz: b.angularVelocity.z,
        isSleeping: b.isSleeping,
        sleepFrames: b.sleepFrames
      }))
    };
  }
  function loadWorldState(world, state) {
    const snapshotLabels = new Set(state.bodies.map((bs) => bs.label));
    for (let i = world.bodies.length - 1; i >= 0; i--) {
      if (!snapshotLabels.has(world.bodies[i].label)) {
        world.bodies.splice(i, 1);
      }
    }
    const bodyMap = new Map(world.bodies.map((b) => [b.label, b]));
    for (const bs of state.bodies) {
      const body = bodyMap.get(bs.label);
      if (!body)
        continue;
      body.position = { x: bs.px, y: bs.py, z: bs.pz };
      body.rotation = { x: bs.qx, y: bs.qy, z: bs.qz, w: bs.qw };
      body.linearVelocity = { x: bs.vx, y: bs.vy, z: bs.vz };
      body.angularVelocity = { x: bs.avx, y: bs.avy, z: bs.avz };
      body.isSleeping = bs.isSleeping;
      body.sleepFrames = bs.sleepFrames;
    }
  }

  // src/sync/rollback.ts
  var DEBUG_ROLLBACK = false;
  function createRollbackManager(localPlayerId, config = {}) {
    const inputDelay = config.inputDelay ?? 2;
    return {
      currentFrame: 0,
      localPlayerId,
      players: /* @__PURE__ */ new Set([localPlayerId]),
      config: {
        inputDelay,
        maxRollbackFrames: config.maxRollbackFrames ?? 8,
        maxPredictionFrames: config.maxPredictionFrames ?? 8,
        snapshotInterval: config.snapshotInterval ?? 1
      },
      inputBuffer: {
        inputs: /* @__PURE__ */ new Map(),
        lastConfirmedFrame: -1,
        // Initialize lastReceivedFrame for local player
        // This prevents confirmedFrame from being stuck at -1
        lastReceivedFrame: /* @__PURE__ */ new Map([[localPlayerId, 0]])
      },
      localInputQueue: [],
      snapshots: /* @__PURE__ */ new Map(),
      // These must be set by the game
      saveState: () => ({}),
      loadState: () => {
      },
      tick: () => {
      },
      computeChecksum: () => 0,
      rollbackCount: 0,
      maxRollbackDepth: 0,
      predictionMisses: 0
    };
  }
  function addPlayer(manager, playerId) {
    manager.players.add(playerId);
    manager.inputBuffer.lastReceivedFrame.set(playerId, -1);
  }
  function addPlayerAtFrame(manager, playerId, joinFrame) {
    manager.players.add(playerId);
    manager.inputBuffer.lastReceivedFrame.set(playerId, joinFrame);
    if (joinFrame - 1 > manager.inputBuffer.lastConfirmedFrame) {
      manager.inputBuffer.lastConfirmedFrame = joinFrame - 1;
    }
  }
  function clearSnapshotsBefore(manager, frame) {
    for (const snapshotFrame of manager.snapshots.keys()) {
      if (snapshotFrame < frame) {
        manager.snapshots.delete(snapshotFrame);
      }
    }
    for (const inputFrame of manager.inputBuffer.inputs.keys()) {
      if (inputFrame < frame) {
        manager.inputBuffer.inputs.delete(inputFrame);
      }
    }
  }
  function removePlayer(manager, playerId) {
    manager.players.delete(playerId);
    manager.inputBuffer.lastReceivedFrame.delete(playerId);
  }
  function addLocalInput(manager, data) {
    const { currentFrame, config, localPlayerId, inputBuffer } = manager;
    const targetFrame = currentFrame + config.inputDelay;
    const input = {
      frame: targetFrame,
      playerId: localPlayerId,
      data,
      predicted: false
    };
    manager.localInputQueue.push(input);
    addInputToBuffer(manager, input);
    const lastReceived = inputBuffer.lastReceivedFrame.get(localPlayerId) ?? -1;
    if (targetFrame > lastReceived) {
      inputBuffer.lastReceivedFrame.set(localPlayerId, targetFrame);
    }
    for (let f = currentFrame; f < targetFrame; f++) {
      const frameInputs = inputBuffer.inputs.get(f);
      const existingInput = frameInputs?.find((i) => i.playerId === localPlayerId);
      if (!existingInput) {
        const prediction = {
          frame: f,
          playerId: localPlayerId,
          data,
          predicted: true
        };
        addInputToBuffer(manager, prediction);
      } else if (existingInput.predicted) {
        existingInput.data = data;
      } else if (f === currentFrame) {
        existingInput.data = data;
      }
    }
  }
  function addRemoteInput(manager, frame, playerId, data) {
    const { config, inputBuffer, currentFrame } = manager;
    const input = {
      frame,
      playerId,
      data,
      predicted: false
    };
    addInputToBuffer(manager, input);
    const predictionStartFrame = Math.max(0, frame - config.inputDelay);
    const predictionEndFrame = frame;
    for (let f = predictionStartFrame; f < predictionEndFrame; f++) {
      const isPastFrame = f <= currentFrame;
      const isFutureButSoon = f > currentFrame && f < currentFrame + config.inputDelay;
      const isTooOld = f < currentFrame - config.maxRollbackFrames;
      if ((isPastFrame || isFutureButSoon) && !isTooOld) {
        const frameInputs = inputBuffer.inputs.get(f);
        const existingConfirmed = frameInputs?.find((i) => i.playerId === playerId && !i.predicted);
        if (existingConfirmed) {
          if (f === currentFrame) {
            existingConfirmed.data = data;
          }
          continue;
        }
        const backfilledInput = {
          frame: f,
          playerId,
          data,
          predicted: false
        };
        addInputToBuffer(manager, backfilledInput);
      }
    }
    const lastReceived = inputBuffer.lastReceivedFrame.get(playerId) ?? -1;
    if (frame > lastReceived) {
      inputBuffer.lastReceivedFrame.set(playerId, frame);
    }
  }
  function addInputToBuffer(manager, input) {
    const { inputBuffer } = manager;
    if (!inputBuffer.inputs.has(input.frame)) {
      inputBuffer.inputs.set(input.frame, []);
    }
    const frameInputs = inputBuffer.inputs.get(input.frame);
    const existingIdx = frameInputs.findIndex((i) => i.playerId === input.playerId);
    if (existingIdx >= 0) {
      const existing = frameInputs[existingIdx];
      if (existing.predicted && !input.predicted) {
        if (inputsDifferSignificantly(existing.data, input.data)) {
          manager.predictionMisses++;
          const pendingRollback = manager.pendingRollbackFrame;
          if (pendingRollback === void 0 || input.frame < pendingRollback) {
            manager.pendingRollbackFrame = input.frame;
          }
          if (DEBUG_ROLLBACK) {
            console.log(`[MISMATCH] frame=${input.frame} player=${input.playerId} predicted=${JSON.stringify(existing.data)} actual=${JSON.stringify(input.data)}`);
          }
        }
      }
      frameInputs[existingIdx] = input;
    } else {
      frameInputs.push(input);
    }
  }
  function inputsDifferSignificantly(a, b) {
    if (!a && !b)
      return false;
    if (!a || !b)
      return true;
    const continuousKeys = /* @__PURE__ */ new Set([
      "yaw",
      "yawFp",
      "pitch",
      "pitchFp",
      "roll",
      "rollFp",
      "shootDirX",
      "shootDirY",
      "shootDirZ",
      "lookX",
      "lookY",
      "rotX",
      "rotY",
      "rotZ",
      "mouseX",
      "mouseY",
      "aimX",
      "aimY",
      "aimZ"
    ]);
    const allKeys = /* @__PURE__ */ new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const key of allKeys) {
      if (continuousKeys.has(key))
        continue;
      if (a[key] !== b[key]) {
        return true;
      }
    }
    return false;
  }
  function getInputsForFrame(manager, frame) {
    const { inputBuffer, players, localPlayerId } = manager;
    const inputs = [];
    const sortedPlayers = Array.from(players).sort();
    for (const playerId of sortedPlayers) {
      const frameInputs = inputBuffer.inputs.get(frame);
      const confirmed = frameInputs?.find((i) => i.playerId === playerId && !i.predicted);
      if (confirmed) {
        inputs.push(confirmed);
        continue;
      }
      const existingPrediction = frameInputs?.find((i) => i.playerId === playerId && i.predicted);
      if (existingPrediction) {
        inputs.push(existingPrediction);
        continue;
      }
      const predicted = predictInput(manager, frame, playerId);
      inputs.push(predicted);
      addInputToBuffer(manager, predicted);
    }
    return inputs;
  }
  function predictInput(manager, frame, playerId) {
    const { inputBuffer } = manager;
    let lastInput = null;
    for (let f = frame - 1; f >= Math.max(0, frame - 60); f--) {
      const frameInputs = inputBuffer.inputs.get(f);
      const input = frameInputs?.find((i) => i.playerId === playerId && !i.predicted);
      if (input) {
        lastInput = input;
        break;
      }
    }
    const predictedData = lastInput ? { ...lastInput.data } : {
      w: false,
      a: false,
      s: false,
      d: false,
      jump: false,
      yawFp: 0
    };
    return {
      frame,
      playerId,
      data: predictedData,
      predicted: true
    };
  }
  function saveSnapshot(manager) {
    const { currentFrame, config, snapshots } = manager;
    if (currentFrame % config.snapshotInterval !== 0)
      return;
    const snapshot = {
      frame: currentFrame,
      state: manager.saveState()
    };
    snapshots.set(currentFrame, snapshot);
    const keepFrom = currentFrame - config.maxRollbackFrames - 10;
    for (const frame of snapshots.keys()) {
      if (frame < keepFrom) {
        snapshots.delete(frame);
      }
    }
  }
  function loadSnapshot(manager, frame) {
    const snapshot = manager.snapshots.get(frame);
    if (!snapshot)
      return false;
    manager.loadState(snapshot.state);
    return true;
  }
  function checkRollback(manager) {
    const { currentFrame, config } = manager;
    const pendingRollback = manager.pendingRollbackFrame;
    if (pendingRollback !== void 0) {
      manager.pendingRollbackFrame = void 0;
      if (currentFrame - pendingRollback <= config.maxRollbackFrames) {
        return pendingRollback;
      } else if (DEBUG_ROLLBACK) {
        console.warn(`[ROLLBACK_MISSED] frame=${pendingRollback} is too old (current=${currentFrame}, max=${config.maxRollbackFrames})`);
      }
    }
    return null;
  }
  function performRollback(manager, toFrame) {
    const { currentFrame } = manager;
    let snapshotFrame = toFrame;
    while (snapshotFrame >= 0 && !manager.snapshots.has(snapshotFrame)) {
      snapshotFrame--;
    }
    if (snapshotFrame < 0) {
      if (DEBUG_ROLLBACK)
        console.warn("[ROLLBACK] No snapshot found for rollback");
      return;
    }
    if (!loadSnapshot(manager, snapshotFrame)) {
      if (DEBUG_ROLLBACK)
        console.warn("[ROLLBACK] Failed to load snapshot");
      return;
    }
    manager.rollbackCount++;
    const rollbackDepth = currentFrame - snapshotFrame;
    if (rollbackDepth > manager.maxRollbackDepth) {
      manager.maxRollbackDepth = rollbackDepth;
    }
    if (DEBUG_ROLLBACK) {
      console.log(`[ROLLBACK] Rolling back from ${currentFrame} to ${snapshotFrame} (${rollbackDepth} frames), available snapshots: ${[...manager.snapshots.keys()].sort((a, b) => a - b).join(",")}`);
    }
    for (let frame = snapshotFrame; frame < currentFrame; frame++) {
      manager.currentFrame = frame;
      saveSnapshot(manager);
      const inputs = getInputsForFrame(manager, frame);
      manager.tick(frame, inputs);
      manager.currentFrame = frame + 1;
    }
  }
  function advanceFrame(manager) {
    let didRollback = false;
    const rollbackTo = checkRollback(manager);
    if (rollbackTo !== null && rollbackTo < manager.currentFrame) {
      performRollback(manager, rollbackTo);
      didRollback = true;
    }
    saveSnapshot(manager);
    const inputs = getInputsForFrame(manager, manager.currentFrame);
    manager.tick(manager.currentFrame, inputs);
    manager.currentFrame++;
    updateConfirmedFrame(manager);
    cleanupInputs(manager);
    return { inputs, didRollback };
  }
  function updateConfirmedFrame(manager) {
    const { inputBuffer, players, currentFrame, config } = manager;
    const startFrame = Math.max(
      inputBuffer.lastConfirmedFrame + 1,
      config.inputDelay
      // First frame that could possibly have inputs
    );
    const sortedPlayers = Array.from(players).sort();
    for (let frame = startFrame; frame < currentFrame; frame++) {
      const frameInputs = inputBuffer.inputs.get(frame);
      if (!frameInputs) {
        break;
      }
      let allConfirmed = true;
      for (const playerId of sortedPlayers) {
        const input = frameInputs.find((i) => i.playerId === playerId && !i.predicted);
        if (!input) {
          allConfirmed = false;
          break;
        }
      }
      if (allConfirmed) {
        inputBuffer.lastConfirmedFrame = frame;
      } else {
        break;
      }
    }
  }
  function cleanupInputs(manager) {
    const { inputBuffer, config, currentFrame } = manager;
    const keepFrom = currentFrame - config.maxRollbackFrames - 10;
    for (const frame of inputBuffer.inputs.keys()) {
      if (frame < keepFrom) {
        inputBuffer.inputs.delete(frame);
      }
    }
  }
  function getInputsToSend(manager) {
    const ready = manager.localInputQueue.filter((i) => i.frame <= manager.currentFrame + manager.config.inputDelay);
    manager.localInputQueue = manager.localInputQueue.filter((i) => i.frame > manager.currentFrame + manager.config.inputDelay);
    return ready;
  }
  function getSyncState(manager) {
    return {
      frame: manager.currentFrame,
      checksum: manager.computeChecksum()
    };
  }
  function getRollbackStats(manager) {
    return {
      currentFrame: manager.currentFrame,
      confirmedFrame: manager.inputBuffer.lastConfirmedFrame,
      rollbackCount: manager.rollbackCount,
      maxRollbackDepth: manager.maxRollbackDepth,
      predictionMisses: manager.predictionMisses,
      snapshotCount: manager.snapshots.size,
      inputBufferSize: manager.inputBuffer.inputs.size
    };
  }
  return __toCommonJS(src_exports);
})();

// Expose common APIs directly on window for cleaner usage
if (typeof window !== 'undefined') {
    // Game creation
    window.createGame = Modu.createGame;

    // Components
    window.Transform2D = Modu.Transform2D;
    window.Body2D = Modu.Body2D;
    window.Player = Modu.Player;
    window.Sprite = Modu.Sprite;

    // Constants
    window.SHAPE_CIRCLE = Modu.SHAPE_CIRCLE;
    window.SHAPE_RECT = Modu.SHAPE_RECT;
    window.SPRITE_IMAGE = Modu.SPRITE_IMAGE;
    window.BODY_DYNAMIC = Modu.BODY_DYNAMIC;
    window.BODY_STATIC = Modu.BODY_STATIC;
    window.BODY_KINEMATIC = Modu.BODY_KINEMATIC;

    // Plugins
    window.Physics2DSystem = Modu.Physics2DSystem;
    window.Simple2DRenderer = Modu.Simple2DRenderer;
    window.InputPlugin = Modu.InputPlugin;

    // Utilities
    window.defineComponent = Modu.defineComponent;
    window.dRandom = Modu.dRandom;
    window.dSqrt = Modu.dSqrt;
    window.toFixed = Modu.toFixed;
    window.toFloat = Modu.toFloat;
    window.fpMul = Modu.fpMul;
    window.fpDiv = Modu.fpDiv;
    window.fpSqrt = Modu.fpSqrt;
    window.fpAbs = Modu.fpAbs;
}
