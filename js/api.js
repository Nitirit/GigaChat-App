// =====================================================================
// GigaChat – API Client
// All communication with the Rust backend goes through this module.
// =====================================================================

// ---------------------------------------------------------------------------
// .env loader – reads frontend/.env and parses KEY=VALUE pairs
// ---------------------------------------------------------------------------

let API_BASE = "";

/**
 * Fetch the .env file from the same directory as index.html,
 * parse KEY=VALUE lines, and return them as an object.
 */
async function loadEnv() {
  try {
    const res = await fetch("/.env");
    if (!res.ok) return {};
    const text = await res.text();
    const env = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      // Strip surrounding quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  } catch {
    console.warn("[env] Could not load .env file – using defaults");
    return {};
  }
}

/**
 * Initialize the API client by loading config from .env
 * Must be awaited before any API call is made.
 */
async function initAPI() {
  const env = await loadEnv();
  // Read BACKEND_URL from .env (no trailing slash)
  if (env.BACKEND_URL) {
    API_BASE = env.BACKEND_URL.replace(/\/+$/, "");
  }
  // Update the exported reference
  window.GigaAPI.API_BASE = API_BASE;
  console.log("[api] API_BASE =", API_BASE || "(same origin)");
}

// ---------------------------------------------------------------------------
// Core request helper
// ---------------------------------------------------------------------------

/**
 * Wrapper around fetch that:
 *  - Prepends the API base URL
 *  - Sets JSON content-type for POST/PUT
 *  - Includes credentials (cookies) on every request
 *  - Parses the JSON response
 *  - Throws a descriptive error on non-2xx responses
 */
async function request(method, path, body = null) {
  const url = `${API_BASE}${path}`;

  // When API_BASE is set (cross-origin), we need "include" so the
  // browser sends cookies to the other domain. When empty (same
  // origin), "include" also works fine.
  const opts = {
    method,
    headers: {},
    credentials: "include",
  };

  if (body !== null && (method === "POST" || method === "PUT")) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, opts);
  } catch (networkErr) {
    throw new Error("Network error – is the backend running?");
  }

  // Try to parse the response body as JSON regardless of status
  let data = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const message =
      (data && data.error) || `Request failed with status ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

// ── Auth ───────────────────────────────────────────────────────────────

const Auth = {
  /**
   * Register a new account.
   * @param {string} username
   * @param {string} password
   * @param {string} [displayName]
   * @returns {Promise<{user_id: string, username: string}>}
   */
  register(username, password, displayName) {
    const body = { username, password };
    if (displayName) body.display_name = displayName;
    return request("POST", "/register", body);
  },

  /**
   * Log in with username and password.
   * The server sets an HttpOnly session cookie automatically.
   * @returns {Promise<{user_id: string, username: string}>}
   */
  login(username, password) {
    return request("POST", "/login", { username, password });
  },

  /**
   * Log out (clears the session cookie on the server).
   */
  logout() {
    return request("POST", "/logout");
  },

  /**
   * Check if the current session is still valid.
   * @returns {Promise<{user_id: string}>}
   */
  me() {
    return request("GET", "/me");
  },
};

// ── Profile ────────────────────────────────────────────────────────────

const Profile = {
  /**
   * Get the full profile of the currently logged-in user.
   * @returns {Promise<Object>}
   */
  getMyProfile() {
    return request("GET", "/profile/me");
  },

  /**
   * Get the public profile of any user by their UUID.
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  getProfile(userId) {
    return request("GET", `/profile/${userId}`);
  },

  /**
   * Update the current user's profile.
   * Only the provided fields will be changed.
   * @param {string} userId
   * @param {{display_name?: string, avatar_url?: string, bio?: string}} fields
   * @returns {Promise<Object>} The updated profile
   */
  updateProfile(userId, fields) {
    return request("PUT", `/profile/${userId}`, fields);
  },
};

// ── Friends ────────────────────────────────────────────────────────────

const Friends = {
  /**
   * Get all accepted friends (with their profile info).
   * @returns {Promise<{friends: Array}>}
   */
  list() {
    return request("GET", "/friends");
  },

  /**
   * Send a friend request (or accept an existing pending one).
   * @param {string} friendId - UUID of the other user
   * @returns {Promise<{status: string}>}
   */
  add(friendId) {
    return request("POST", "/friends", { friend_id: friendId });
  },

  /**
   * Get pending friend requests.
   * @returns {Promise<{pending: Array}>}
   */
  pending() {
    return request("GET", "/friends/pending");
  },
};

// ── Conversations ──────────────────────────────────────────────────────

const Conversations = {
  /**
   * List all conversation IDs the current user is part of.
   * @returns {Promise<{conversations: string[]}>}
   */
  list() {
    return request("GET", "/conversations");
  },

  /**
   * Start (or retrieve an existing) 1-on-1 conversation with a friend.
   * @param {string} friendId
   * @returns {Promise<{conversation_id: string}>}
   */
  start(friendId) {
    return request("POST", "/conversations", { friend_id: friendId });
  },

  /**
   * Get the message history for a conversation.
   * Messages are returned in chronological order.
   * @param {string} conversationId
   * @returns {Promise<{messages: Array}>}
   */
  messages(conversationId) {
    return request("GET", `/conversations/${conversationId}/messages`);
  },
};

// ── WebSocket ──────────────────────────────────────────────────────────

/**
 * Open a WebSocket connection to a conversation.
 *
 * When API_BASE is set (cross-origin deploy), the WebSocket connects
 * to the backend host from .env. Otherwise it uses the current page host.
 *
 * Usage:
 *   const ws = ChatSocket.connect(conversationId, {
 *     onMessage(data)    { ... },  // { sender_id, content, created_at }
 *     onOpen()           { ... },
 *     onClose()          { ... },
 *     onError(err)       { ... },
 *   });
 *
 *   ws.send("Hello!");   // send a chat message
 *   ws.close();          // disconnect
 *
 * @returns {{ send: Function, close: Function, socket: WebSocket }}
 */
const ChatSocket = {
  connect(conversationId, callbacks = {}) {
    let wsProtocol;
    let wsHost;

    if (API_BASE) {
      // Cross-origin: derive ws host from the backend URL in .env
      const backendUrl = new URL(API_BASE);
      wsProtocol = backendUrl.protocol === "https:" ? "wss:" : "ws:";
      wsHost = backendUrl.host;
    } else {
      // Same-origin: connect to the current page's host
      wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      wsHost = window.location.host;
    }

    const wsUrl = `${wsProtocol}//${wsHost}/ws/${conversationId}`;
    const socket = new WebSocket(wsUrl);

    socket.addEventListener("open", () => {
      console.log(`[WS] Connected to conversation ${conversationId}`);
      if (callbacks.onOpen) callbacks.onOpen();
    });

    socket.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (callbacks.onMessage) callbacks.onMessage(data);
      } catch {
        // If the server sends a non-JSON string, wrap it
        if (callbacks.onMessage) {
          callbacks.onMessage({
            content: event.data,
            sender_id: null,
            created_at: null,
          });
        }
      }
    });

    socket.addEventListener("close", (event) => {
      console.log(`[WS] Disconnected (code=${event.code})`);
      if (callbacks.onClose) callbacks.onClose(event);
    });

    socket.addEventListener("error", (event) => {
      console.error("[WS] Error:", event);
      if (callbacks.onError) callbacks.onError(event);
    });

    return {
      /** Send a chat message */
      send(content) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ content }));
        } else {
          console.warn("[WS] Cannot send – socket is not open");
        }
      },

      /** Close the connection */
      close() {
        socket.close();
      },

      /** The raw WebSocket instance (for advanced use) */
      socket,
    };
  },
};

// ── Export as a single namespace ────────────────────────────────────────

window.GigaAPI = {
  Auth,
  Profile,
  Friends,
  Conversations,
  ChatSocket,
  initAPI,
  API_BASE,
};
