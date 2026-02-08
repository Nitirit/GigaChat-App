// =====================================================================
// GigaChat – Chat Page Logic
// Manages friends list, conversations, WebSocket messaging, and modals.
// =====================================================================

(function () {
  "use strict";

  // ── State ───────────────────────────────────────────────────────────

  let currentUser = null; // { user_id, username }
  let currentProfile = null; // full profile from /profile/me
  let friends = []; // array of FriendInfo objects
  let activeConversationId = null; // UUID of the open conversation
  let activeFriendId = null; // UUID of the friend we're chatting with
  let wsConnection = null; // current WebSocket wrapper
  let messages = []; // messages in the current conversation

  // Avatar color palette (matches CSS variables)
  const AVATAR_COLORS = [
    "#2A8A8A", // teal-dark
    "#6B2D5B", // plum
    "#1E6B8A", // blue
    "#2D3561", // navy
    "#4FA89B", // teal
    "#8A3D76", // plum-light
  ];

  const MAX_MESSAGE_LENGTH = 500;

  // ── DOM references ──────────────────────────────────────────────────

  // Workspace header
  const workspaceName = document.getElementById("workspace-name");
  const workspaceAvatar = document.getElementById("workspace-avatar-letter");

  // Sidebar
  const friendListEl = document.getElementById("friend-list");
  const searchInput = document.getElementById("sidebar-search");

  // Chat area
  const chatEmptyState = document.getElementById("chat-empty-state");
  const chatActiveArea = document.getElementById("chat-active-area");
  const chatHeaderTitle = document.getElementById("chat-header-title");
  const chatHeaderMeta = document.getElementById("chat-header-meta");
  const messagesArea = document.getElementById("messages-area");
  const connectionStatus = document.getElementById("connection-status");

  // Composer
  const composerTextarea = document.getElementById("composer-textarea");
  const composerCharCount = document.getElementById("composer-char-count");
  const btnSend = document.getElementById("btn-send");

  // Modals
  const addFriendModal = document.getElementById("add-friend-modal");
  const settingsModal = document.getElementById("settings-modal");
  const profileModal = document.getElementById("profile-modal");

  // Toast
  const toastContainer = document.getElementById("toast-container");

  // ── Initialization ──────────────────────────────────────────────────

  init();

  async function init() {
    // 1. Check if user is logged in
    const storedUser = localStorage.getItem("gigachat_user");
    if (storedUser) {
      try {
        currentUser = JSON.parse(storedUser);
      } catch {
        currentUser = null;
      }
    }

    // Verify session is still valid with the backend
    try {
      const meData = await GigaAPI.Auth.me();
      if (!currentUser || currentUser.user_id !== meData.user_id) {
        currentUser = { user_id: meData.user_id, username: "User" };
      }
    } catch {
      // Session invalid – redirect to login
      window.location.href = "index.html";
      return;
    }

    // 2. Load full profile
    try {
      currentProfile = await GigaAPI.Profile.getMyProfile();
      currentUser.username = currentProfile.username;
      // Update localStorage
      localStorage.setItem("gigachat_user", JSON.stringify(currentUser));
    } catch {
      // If profile fetch fails, we can still proceed with basic info
    }

    // 3. Update workspace header
    updateWorkspaceHeader();

    // 4. Load friends list
    await loadFriends();

    // 5. Bind event listeners
    bindEvents();
  }

  // ── Workspace header ────────────────────────────────────────────────

  function updateWorkspaceHeader() {
    if (!currentUser) return;
    const name =
      (currentProfile && currentProfile.display_name) ||
      currentUser.username ||
      "User";

    if (workspaceName) workspaceName.textContent = name;
    if (workspaceAvatar)
      workspaceAvatar.textContent = name.charAt(0).toUpperCase();
  }

  // ── Friends ─────────────────────────────────────────────────────────

  async function loadFriends() {
    try {
      const data = await GigaAPI.Friends.list();
      friends = data.friends || [];
    } catch {
      friends = [];
    }
    renderFriendList();
  }

  function renderFriendList(filter = "") {
    if (!friendListEl) return;

    const filtered = filter
      ? friends.filter(
          (f) =>
            (f.username || "").toLowerCase().includes(filter.toLowerCase()) ||
            (f.display_name || "").toLowerCase().includes(filter.toLowerCase()),
        )
      : friends;

    if (filtered.length === 0) {
      friendListEl.innerHTML = `
        <div class="friend-list-empty">
          <div class="empty-icon">\u{1F465}</div>
          <span>${
            filter
              ? "No friends match your search."
              : "No friends yet. Click <b>+ Add Friend</b> to get started!"
          }</span>
        </div>
      `;
      return;
    }

    friendListEl.innerHTML = filtered
      .map((f) => {
        const displayName = f.display_name || f.username || "?";
        const initial = displayName.charAt(0).toUpperCase();
        const color = getAvatarColor(f.friend_id || f.username);
        const isActive = f.friend_id === activeFriendId;

        return `
          <div class="friend-item ${isActive ? "active" : ""}"
               data-friend-id="${f.friend_id}"
               data-username="${escapeHtml(f.username || "")}"
               data-display-name="${escapeHtml(displayName)}">
            <div class="friend-avatar" style="background:${color}">
              ${initial}
            </div>
            <div class="friend-info">
              <div class="friend-name">${escapeHtml(displayName)}</div>
            </div>
          </div>
        `;
      })
      .join("");

    // Bind click handlers
    friendListEl.querySelectorAll(".friend-item").forEach((el) => {
      el.addEventListener("click", () => {
        const friendId = el.dataset.friendId;
        const displayName = el.dataset.displayName;
        openConversation(friendId, displayName);

        // Close mobile sidebar
        document.querySelector(".sidebar")?.classList.remove("open");
        document
          .querySelector(".sidebar-backdrop")
          ?.classList.remove("visible");
      });
    });
  }

  // ── Conversation ────────────────────────────────────────────────────

  async function openConversation(friendId, friendDisplayName) {
    // Highlight friend in sidebar
    activeFriendId = friendId;
    friendListEl.querySelectorAll(".friend-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.friendId === friendId);
    });

    // Close any existing WebSocket
    if (wsConnection) {
      wsConnection.close();
      wsConnection = null;
    }

    // Show the active chat area, hide empty state
    if (chatEmptyState) chatEmptyState.style.display = "none";
    if (chatActiveArea) chatActiveArea.style.display = "flex";

    // Update header
    if (chatHeaderTitle) {
      chatHeaderTitle.innerHTML = `
        <h2>${escapeHtml(friendDisplayName)}</h2>
        <div class="chat-header-tags">
          <span class="chat-tag">direct message</span>
        </div>
      `;
    }
    if (chatHeaderMeta) {
      chatHeaderMeta.textContent = "1-on-1 conversation";
    }

    // Clear messages
    messages = [];
    renderMessages();

    // Show loading
    if (messagesArea) {
      messagesArea.innerHTML = '<div class="loading-spinner"></div>';
    }

    try {
      // Start or get existing conversation
      console.log("[DEBUG] Starting conversation with friendId:", friendId);
      const convData = await GigaAPI.Conversations.start(friendId);
      console.log("[DEBUG] Conversation response:", convData);
      activeConversationId = convData.conversation_id;
      console.log("[DEBUG] activeConversationId:", activeConversationId);

      if (!activeConversationId) {
        throw new Error("Server did not return a conversation_id");
      }

      // Load history
      console.log(
        "[DEBUG] Loading messages for conversation:",
        activeConversationId,
      );
      const historyData =
        await GigaAPI.Conversations.messages(activeConversationId);
      console.log("[DEBUG] Messages response:", historyData);
      messages = historyData.messages || [];
      renderMessages();
      scrollToBottom();

      // Connect WebSocket
      connectWebSocket(activeConversationId);
    } catch (err) {
      showToast("Failed to open conversation: " + err.message, "error");
      if (messagesArea) {
        messagesArea.innerHTML = `
          <div class="chat-empty-state">
            <div class="empty-icon">\u26A0\uFE0F</div>
            <h3>Could not load conversation</h3>
            <p>${escapeHtml(err.message)}</p>
          </div>
        `;
      }
    }
  }

  // ── WebSocket ───────────────────────────────────────────────────────

  function connectWebSocket(conversationId) {
    if (wsConnection) {
      wsConnection.close();
    }

    updateConnectionStatus("reconnecting");

    wsConnection = GigaAPI.ChatSocket.connect(conversationId, {
      onOpen() {
        updateConnectionStatus("connected");
      },

      onMessage(data) {
        // data = { sender_id, content, created_at }
        if (!data || !data.content) return;

        messages.push({
          id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
          conversation_id: conversationId,
          sender_id: data.sender_id,
          content: data.content,
          created_at: data.created_at || new Date().toISOString(),
        });

        renderMessages();
        scrollToBottom();
      },

      onClose() {
        updateConnectionStatus("disconnected");
      },

      onError() {
        updateConnectionStatus("disconnected");
      },
    });
  }

  function updateConnectionStatus(status) {
    if (!connectionStatus) return;

    connectionStatus.className = "connection-status";

    if (status === "connected") {
      connectionStatus.style.display = "none";
    } else if (status === "disconnected") {
      connectionStatus.classList.add("disconnected");
      connectionStatus.innerHTML = `
        <span class="status-dot-indicator"></span>
        Disconnected. Messages may not be delivered.
      `;
    } else if (status === "reconnecting") {
      connectionStatus.classList.add("reconnecting");
      connectionStatus.innerHTML = `
        <span class="status-dot-indicator"></span>
        Connecting\u2026
      `;
    }
  }

  // ── Messages rendering ──────────────────────────────────────────────

  function renderMessages() {
    if (!messagesArea) return;

    if (messages.length === 0) {
      messagesArea.innerHTML = `
        <div class="message-system">
          <span class="system-text">This is the beginning of your conversation. Say hi! \u{1F44B}</span>
        </div>
      `;
      return;
    }

    let html = "";

    messages.forEach((msg, index) => {
      const isSelf = msg.sender_id === currentUser.user_id;
      const senderName = isSelf ? "You" : getFriendName(msg.sender_id);
      const initial = senderName.charAt(0).toUpperCase();
      const color = isSelf
        ? AVATAR_COLORS[3] // navy for self
        : getAvatarColor(msg.sender_id);
      const time = formatTime(msg.created_at);
      const side = isSelf ? "self" : "other";

      // Show date separator if needed
      if (
        index === 0 ||
        isDifferentDay(messages[index - 1].created_at, msg.created_at)
      ) {
        const dateStr = formatDate(msg.created_at);
        html += `<div class="date-separator"><span>${dateStr}</span></div>`;
      }

      html += `
        <div class="message ${side}">
          <div class="message-avatar" style="background:${color}">${initial}</div>
          <div class="message-body">
            <div class="message-header">
              <span class="message-sender">${escapeHtml(senderName)}</span>
              <span class="message-time">${time}</span>
            </div>
            <div class="message-bubble">${escapeHtml(msg.content)}</div>
          </div>
        </div>
      `;
    });

    messagesArea.innerHTML = html;
  }

  function scrollToBottom() {
    if (!messagesArea) return;
    requestAnimationFrame(() => {
      messagesArea.scrollTop = messagesArea.scrollHeight;
    });
  }

  function getFriendName(senderId) {
    const friend = friends.find((f) => f.friend_id === senderId);
    if (friend) return friend.display_name || friend.username || "User";
    return "User";
  }

  // ── Composer ────────────────────────────────────────────────────────

  function sendMessage() {
    if (!composerTextarea || !wsConnection) return;

    const content = composerTextarea.value.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) return;

    wsConnection.send(content);

    // Clear the textarea
    composerTextarea.value = "";
    updateCharCount();
    autoResizeTextarea();
    composerTextarea.focus();
  }

  function updateCharCount() {
    if (!composerTextarea || !composerCharCount) return;

    const len = composerTextarea.value.length;
    composerCharCount.textContent = `${len}/${MAX_MESSAGE_LENGTH}`;

    composerCharCount.classList.remove("near-limit", "at-limit");
    if (len >= MAX_MESSAGE_LENGTH) {
      composerCharCount.classList.add("at-limit");
    } else if (len >= MAX_MESSAGE_LENGTH * 0.85) {
      composerCharCount.classList.add("near-limit");
    }

    // Enable/disable send button
    if (btnSend) {
      btnSend.disabled =
        !composerTextarea.value.trim() || !activeConversationId;
    }
  }

  function autoResizeTextarea() {
    if (!composerTextarea) return;
    composerTextarea.style.height = "auto";
    composerTextarea.style.height =
      Math.min(composerTextarea.scrollHeight, 120) + "px";
  }

  // ── Event binding ───────────────────────────────────────────────────

  function bindEvents() {
    // --- Composer ---
    if (composerTextarea) {
      composerTextarea.addEventListener("input", () => {
        updateCharCount();
        autoResizeTextarea();
      });

      composerTextarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });

      // Enforce max length
      composerTextarea.addEventListener("beforeinput", (e) => {
        if (
          e.data &&
          composerTextarea.value.length + e.data.length > MAX_MESSAGE_LENGTH
        ) {
          e.preventDefault();
        }
      });
    }

    if (btnSend) {
      btnSend.addEventListener("click", sendMessage);
    }

    // --- Sidebar search ---
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        renderFriendList(searchInput.value);
      });
    }

    // --- Add Friend button ---
    const btnAddFriend = document.getElementById("btn-add-friend");
    if (btnAddFriend) {
      btnAddFriend.addEventListener("click", () => openModal(addFriendModal));
    }

    const btnAddFriendSection = document.getElementById(
      "btn-add-friend-section",
    );
    if (btnAddFriendSection) {
      btnAddFriendSection.addEventListener("click", () =>
        openModal(addFriendModal),
      );
    }

    // --- Settings button ---
    const btnSettings = document.getElementById("btn-settings");
    if (btnSettings) {
      btnSettings.addEventListener("click", () => openSettingsModal());
    }

    // --- Modal close buttons ---
    document.querySelectorAll(".modal-close").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modal = btn.closest(".modal-overlay");
        if (modal) closeModal(modal);
      });
    });

    // Close modal on overlay click
    document.querySelectorAll(".modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal(overlay);
      });
    });

    // --- Add Friend form ---
    const addFriendForm = document.getElementById("add-friend-form");
    if (addFriendForm) {
      addFriendForm.addEventListener("submit", handleAddFriend);
    }

    // --- Settings form (profile edit) ---
    const settingsForm = document.getElementById("settings-form");
    if (settingsForm) {
      settingsForm.addEventListener("submit", handleEditProfile);
    }

    // --- Logout ---
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) {
      btnLogout.addEventListener("click", handleLogout);
    }

    // --- View My Profile ---
    const btnViewProfile = document.getElementById("btn-view-profile");
    if (btnViewProfile) {
      btnViewProfile.addEventListener("click", () => {
        closeModal(settingsModal);
        openProfileModal();
      });
    }

    // --- Workspace header click -> open profile ---
    const wsHeader = document.querySelector(".workspace-header");
    if (wsHeader) {
      wsHeader.style.cursor = "pointer";
      wsHeader.addEventListener("click", openProfileModal);
    }

    // --- Mobile sidebar toggle ---
    const btnMobileMenu = document.getElementById("btn-mobile-menu");
    const sidebar = document.querySelector(".sidebar");
    const backdrop = document.querySelector(".sidebar-backdrop");

    if (btnMobileMenu && sidebar) {
      btnMobileMenu.addEventListener("click", () => {
        sidebar.classList.toggle("open");
        backdrop?.classList.toggle("visible");
      });
    }

    if (backdrop) {
      backdrop.addEventListener("click", () => {
        sidebar?.classList.remove("open");
        backdrop.classList.remove("visible");
      });
    }

    // --- Copy profile ID ---
    document.addEventListener("click", (e) => {
      if (e.target.closest(".copy-btn")) {
        const idText = e.target
          .closest(".profile-id")
          ?.querySelector(".id-text")?.textContent;
        if (idText) {
          navigator.clipboard
            .writeText(idText.trim())
            .then(() => {
              showToast("User ID copied to clipboard!", "success");
            })
            .catch(() => {
              showToast("Failed to copy.", "error");
            });
        }
      }
    });

    // Initial char count
    updateCharCount();
  }

  // ── Add Friend handler ──────────────────────────────────────────────

  async function handleAddFriend(e) {
    e.preventDefault();

    const input = document.getElementById("add-friend-id");
    const msgEl = document.getElementById("add-friend-message");
    const submitBtn = e.target.querySelector('button[type="submit"]');

    if (!input) return;

    const friendId = input.value.trim();

    if (!friendId) {
      showModalMessage(msgEl, "Please enter a User ID.", "error");
      return;
    }

    // Basic UUID format check
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(friendId)) {
      showModalMessage(
        msgEl,
        "Invalid User ID format. It should be a UUID like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "error",
      );
      return;
    }

    if (friendId === currentUser.user_id) {
      showModalMessage(msgEl, "You cannot add yourself as a friend!", "error");
      return;
    }

    if (submitBtn) submitBtn.disabled = true;

    try {
      const result = await GigaAPI.Friends.add(friendId);
      const status = result.status || "done";

      if (status === "accepted") {
        showModalMessage(
          msgEl,
          "Friend request accepted! You are now friends.",
          "success",
        );
      } else if (status === "pending") {
        showModalMessage(
          msgEl,
          "Friend request sent! Waiting for them to accept.",
          "success",
        );
      } else {
        showModalMessage(msgEl, "Friend added!", "success");
      }

      input.value = "";

      // Refresh friends list
      await loadFriends();
    } catch (err) {
      showModalMessage(msgEl, err.message || "Failed to add friend.", "error");
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  // ── Settings / Edit Profile ─────────────────────────────────────────

  async function openSettingsModal() {
    // Pre-fill with current profile data
    const displayNameInput = document.getElementById("settings-display-name");
    const bioInput = document.getElementById("settings-bio");
    const avatarInput = document.getElementById("settings-avatar-url");

    if (currentProfile) {
      if (displayNameInput)
        displayNameInput.value = currentProfile.display_name || "";
      if (bioInput) bioInput.value = currentProfile.bio || "";
      if (avatarInput) avatarInput.value = currentProfile.avatar_url || "";
    }

    openModal(settingsModal);
  }

  async function handleEditProfile(e) {
    e.preventDefault();

    const displayNameInput = document.getElementById("settings-display-name");
    const bioInput = document.getElementById("settings-bio");
    const avatarInput = document.getElementById("settings-avatar-url");
    const submitBtn = e.target.querySelector('button[type="submit"]');

    const fields = {};
    if (displayNameInput && displayNameInput.value.trim()) {
      fields.display_name = displayNameInput.value.trim();
    }
    if (bioInput) {
      fields.bio = bioInput.value.trim();
    }
    if (avatarInput && avatarInput.value.trim()) {
      fields.avatar_url = avatarInput.value.trim();
    }

    if (Object.keys(fields).length === 0) {
      showToast("No changes to save.", "info");
      return;
    }

    if (submitBtn) submitBtn.disabled = true;

    try {
      const updated = await GigaAPI.Profile.updateProfile(
        currentUser.user_id,
        fields,
      );
      currentProfile = updated;
      updateWorkspaceHeader();
      showToast("Profile updated!", "success");
      closeModal(settingsModal);
    } catch (err) {
      showToast("Failed to update profile: " + err.message, "error");
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  // ── Profile modal ───────────────────────────────────────────────────

  function openProfileModal() {
    if (!profileModal || !currentProfile) return;

    const name =
      currentProfile.display_name || currentProfile.username || "User";
    const initial = name.charAt(0).toUpperCase();

    const bodyEl = profileModal.querySelector(".modal-body");
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div class="profile-header">
          <div class="profile-avatar-large">${initial}</div>
          <div class="profile-details">
            <div class="profile-display-name">${escapeHtml(name)}</div>
            <div class="profile-username">@${escapeHtml(
              currentProfile.username,
            )}</div>
          </div>
        </div>

        <div class="input-group">
          <label>User ID</label>
          <div class="profile-id">
            <span class="id-text">${currentProfile.id}</span>
            <button type="button" class="copy-btn" title="Copy ID">\u{1F4CB}</button>
          </div>
        </div>

        ${
          currentProfile.bio
            ? `<div class="input-group">
                 <label>Bio</label>
                 <div class="profile-bio">${escapeHtml(currentProfile.bio)}</div>
               </div>`
            : ""
        }

        ${
          currentProfile.created_at
            ? `<div class="input-group">
                 <label>Member since</label>
                 <div class="profile-bio">${formatDate(
                   currentProfile.created_at,
                 )}</div>
               </div>`
            : ""
        }
      `;
    }

    openModal(profileModal);
  }

  // ── Logout ──────────────────────────────────────────────────────────

  async function handleLogout() {
    try {
      await GigaAPI.Auth.logout();
    } catch {
      // Ignore errors — we're logging out anyway
    }
    localStorage.removeItem("gigachat_user");
    window.location.href = "index.html";
  }

  // ── Modal helpers ───────────────────────────────────────────────────

  function openModal(modalOverlay) {
    if (modalOverlay) modalOverlay.classList.add("visible");
  }

  function closeModal(modalOverlay) {
    if (modalOverlay) modalOverlay.classList.remove("visible");
  }

  function showModalMessage(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = `auth-message visible ${type}`;
    el.style.display = "block";
  }

  // ── Toast notifications ─────────────────────────────────────────────

  function showToast(message, type = "info") {
    if (!toastContainer) {
      console.log(`[Toast] ${type}: ${message}`);
      return;
    }

    const icons = {
      success: "\u2705",
      error: "\u274C",
      info: "\u{2139}\uFE0F",
    };

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-close">\u00D7</button>
    `;

    // Close button
    toast.querySelector(".toast-close").addEventListener("click", () => {
      removeToast(toast);
    });

    toastContainer.appendChild(toast);

    // Auto-dismiss after 4 seconds
    setTimeout(() => removeToast(toast), 4000);
  }

  function removeToast(toast) {
    if (!toast || !toast.parentElement) return;
    toast.classList.add("fade-out");
    setTimeout(() => {
      toast.remove();
    }, 300);
  }

  // ── Utility functions ───────────────────────────────────────────────

  function getAvatarColor(id) {
    if (!id) return AVATAR_COLORS[0];
    // Simple hash from the id string to pick a color
    let hash = 0;
    const str = String(id);
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTime(isoString) {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return "";
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function formatDate(isoString) {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return "";

      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (date.toDateString() === today.toDateString()) return "Today";
      if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

      return date.toLocaleDateString([], {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return "";
    }
  }

  function isDifferentDay(iso1, iso2) {
    if (!iso1 || !iso2) return false;
    try {
      const d1 = new Date(iso1);
      const d2 = new Date(iso2);
      return d1.toDateString() !== d2.toDateString();
    } catch {
      return false;
    }
  }
})();
