// =====================================================================
// GigaChat – Auth Page Logic (Login & Register)
// =====================================================================

(function () {
  "use strict";

  // ── DOM references ──────────────────────────────────────────────────

  const tabBtns = document.querySelectorAll(".auth-tab");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const loginMsg = document.getElementById("login-message");
  const registerMsg = document.getElementById("register-message");

  // Login fields
  const loginUsername = document.getElementById("login-username");
  const loginPassword = document.getElementById("login-password");
  const loginSubmit = document.getElementById("login-submit");

  // Register fields
  const regUsername = document.getElementById("reg-username");
  const regDisplayName = document.getElementById("reg-display-name");
  const regPassword = document.getElementById("reg-password");
  const regConfirm = document.getElementById("reg-confirm");
  const regSubmit = document.getElementById("reg-submit");

  // Password strength elements
  const strengthBars = document.querySelectorAll(
    ".password-strength .bar"
  );
  const strengthLabel = document.querySelector(".password-strength-label");

  // Password visibility toggles
  const passwordToggles = document.querySelectorAll(".password-toggle");

  // ── On load: check if already logged in ─────────────────────────────

  checkExistingSession();

  async function checkExistingSession() {
    try {
      const data = await GigaAPI.Auth.me();
      if (data && data.user_id) {
        // Already logged in – redirect to chat
        window.location.href = "chat.html";
      }
    } catch {
      // Not logged in – stay on the auth page (expected)
    }
  }

  // ── Tab switching ───────────────────────────────────────────────────

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab; // "login" or "register"

      // Toggle active tab button
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Toggle active form
      if (target === "login") {
        loginForm.classList.add("active");
        registerForm.classList.remove("active");
      } else {
        registerForm.classList.add("active");
        loginForm.classList.remove("active");
      }

      // Clear messages
      hideMessage(loginMsg);
      hideMessage(registerMsg);
    });
  });

  // ── Password visibility toggle ──────────────────────────────────────

  passwordToggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const input = toggle.parentElement.querySelector("input");
      if (!input) return;

      if (input.type === "password") {
        input.type = "text";
        toggle.textContent = "\u{1F648}"; // see-no-evil monkey
        toggle.setAttribute("aria-label", "Hide password");
      } else {
        input.type = "password";
        toggle.textContent = "\u{1F441}"; // eye
        toggle.setAttribute("aria-label", "Show password");
      }
    });
  });

  // ── Password strength indicator ─────────────────────────────────────

  if (regPassword) {
    regPassword.addEventListener("input", () => {
      updatePasswordStrength(regPassword.value);
    });
  }

  function updatePasswordStrength(password) {
    // Reset all bars
    strengthBars.forEach((bar) => {
      bar.className = "bar";
    });

    if (!strengthLabel) return;

    if (password.length === 0) {
      strengthLabel.textContent = "";
      return;
    }

    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    // Map score (0-5) to strength level
    let level, label;
    if (score <= 1) {
      level = "weak";
      label = "Weak";
    } else if (score <= 3) {
      level = "medium";
      label = "Fair";
    } else {
      level = "strong";
      label = "Strong";
    }

    // Fill bars based on level
    const fillCount = level === "weak" ? 1 : level === "medium" ? 2 : 3;
    for (let i = 0; i < fillCount && i < strengthBars.length; i++) {
      strengthBars[i].classList.add(level);
    }

    strengthLabel.textContent = label;
  }

  // ── Login form submission ───────────────────────────────────────────

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideMessage(loginMsg);

      const username = loginUsername.value.trim();
      const password = loginPassword.value;

      // Client-side validation
      if (!username) {
        showMessage(loginMsg, "Please enter your username.", "error");
        loginUsername.focus();
        return;
      }
      if (!password) {
        showMessage(loginMsg, "Please enter your password.", "error");
        loginPassword.focus();
        return;
      }

      // Disable submit and show spinner
      setLoading(loginSubmit, true);

      try {
        const data = await GigaAPI.Auth.login(username, password);

        // Persist the user info in localStorage for the chat page
        localStorage.setItem(
          "gigachat_user",
          JSON.stringify({
            user_id: data.user_id,
            username: data.username,
          })
        );

        showMessage(loginMsg, "Login successful! Redirecting...", "success");

        // Short delay so the user sees the success message
        setTimeout(() => {
          window.location.href = "chat.html";
        }, 500);
      } catch (err) {
        const msg =
          err.status === 401
            ? "Invalid username or password."
            : err.message || "Login failed. Please try again.";
        showMessage(loginMsg, msg, "error");
      } finally {
        setLoading(loginSubmit, false);
      }
    });
  }

  // ── Register form submission ────────────────────────────────────────

  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideMessage(registerMsg);

      const username = regUsername.value.trim();
      const displayName = regDisplayName ? regDisplayName.value.trim() : "";
      const password = regPassword.value;
      const confirm = regConfirm.value;

      // Client-side validation
      if (!username) {
        showMessage(registerMsg, "Please choose a username.", "error");
        regUsername.focus();
        return;
      }
      if (username.length < 3) {
        showMessage(
          registerMsg,
          "Username must be at least 3 characters.",
          "error"
        );
        regUsername.focus();
        return;
      }
      if (/[^a-zA-Z0-9_.-]/.test(username)) {
        showMessage(
          registerMsg,
          "Username can only contain letters, numbers, dots, hyphens, and underscores.",
          "error"
        );
        regUsername.focus();
        return;
      }
      if (!password) {
        showMessage(registerMsg, "Please choose a password.", "error");
        regPassword.focus();
        return;
      }
      if (password.length < 6) {
        showMessage(
          registerMsg,
          "Password must be at least 6 characters.",
          "error"
        );
        regPassword.focus();
        return;
      }
      if (password !== confirm) {
        showMessage(registerMsg, "Passwords do not match.", "error");
        regConfirm.focus();
        regConfirm.classList.add("input-error");
        return;
      } else {
        regConfirm.classList.remove("input-error");
      }

      // Disable submit and show spinner
      setLoading(regSubmit, true);

      try {
        const data = await GigaAPI.Auth.register(
          username,
          password,
          displayName || undefined
        );

        // Persist the user info in localStorage for the chat page
        localStorage.setItem(
          "gigachat_user",
          JSON.stringify({
            user_id: data.user_id,
            username: data.username,
          })
        );

        showMessage(
          registerMsg,
          "Account created! Redirecting...",
          "success"
        );

        setTimeout(() => {
          window.location.href = "chat.html";
        }, 500);
      } catch (err) {
        const msg = err.message || "Registration failed. Please try again.";
        showMessage(registerMsg, msg, "error");
      } finally {
        setLoading(regSubmit, false);
      }
    });
  }

  // ── Clear error styling on input focus ──────────────────────────────

  document.querySelectorAll(".auth-card input").forEach((input) => {
    input.addEventListener("focus", () => {
      input.classList.remove("input-error");
    });
  });

  // If the confirm password field loses focus, re-check match
  if (regConfirm && regPassword) {
    regConfirm.addEventListener("blur", () => {
      if (regConfirm.value && regConfirm.value !== regPassword.value) {
        regConfirm.classList.add("input-error");
      } else {
        regConfirm.classList.remove("input-error");
      }
    });
  }

  // ── Helper: show / hide feedback message ────────────────────────────

  function showMessage(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = `auth-message visible ${type}`;
  }

  function hideMessage(el) {
    if (!el) return;
    el.textContent = "";
    el.className = "auth-message";
  }

  // ── Helper: toggle loading state on a submit button ─────────────────

  function setLoading(btn, isLoading) {
    if (!btn) return;

    if (isLoading) {
      btn.disabled = true;
      btn._originalText = btn.innerHTML;
      btn.innerHTML =
        '<span class="spinner"></span> Please wait\u2026';
    } else {
      btn.disabled = false;
      if (btn._originalText) {
        btn.innerHTML = btn._originalText;
      }
    }
  }

  // ── Allow Enter key to switch between fields ────────────────────────

  // In the login form, pressing Enter on the username field focuses password
  if (loginUsername) {
    loginUsername.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        loginPassword.focus();
      }
    });
  }

  // In the register form, Enter moves through fields sequentially
  const regFields = [regUsername, regDisplayName, regPassword, regConfirm].filter(Boolean);
  regFields.forEach((field, index) => {
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (index < regFields.length - 1) {
          regFields[index + 1].focus();
        } else {
          // Last field – submit the form
          registerForm.dispatchEvent(new Event("submit", { cancelable: true }));
        }
      }
    });
  });
})();
