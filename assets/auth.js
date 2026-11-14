/* IEP Year Planner — auth (Supabase Auth via REST, no SDK, no build step).
 *
 * Hard-won lessons baked in (from a previous product on this same project):
 *  1. Supabase REST auth responses carry the tokens at the TOP LEVEL
 *     (access_token / refresh_token / user) — NOT nested in data.session.
 *  2. The session is persisted in localStorage and RE-VERIFIED after
 *     sign-in: a session that does not survive a page reload is a failed
 *     sign-in, even when the first response looked fine.
 *  3. Only the session lives in localStorage. All real data is in
 *     Supabase, so a refresh or a new device shows the same records.
 *
 * Page contract (auth pages built by the design team):
 *  - <form id="auth-form"> with an email input and a password input.
 *    Optional: data-mode="signup" | "login" (default: inferred from the
 *    page filename — signup.html → signup, anything else → login).
 *    Optional: data-redirect="<url>" for where to go after sign-in
 *    (default: app/dashboard.html relative to the site root).
 *  - <button id="google-btn"> starts the Google OAuth flow.
 *  - Status text goes to #auth-status if present, otherwise a status
 *    element is created inside the form.
 * App pages (app/*.html) call IEPAuth.requireAuth() before doing work.
 */
(function () {
  "use strict";

  var SUPABASE_URL = "https://lyzghuyifnlfswtyjnmz.supabase.co";
  var ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5emdodXlpZm5sZnN3dHlqbm16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1Nzg1NTAsImV4cCI6MjExMDE1NDU1MH0.NMLYRfojD5DRL6O_T9eeddhXvDTSvusk28DIUlv1OXA";
  var STORE_KEY = "iep.session.v1";

  // ---------- session storage ------------------------------------------
  function saveSession(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function loadSession() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearSession() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  // Build a session object from a Supabase auth response.
  // Tokens live at the TOP LEVEL of the response body.
  function sessionFromResponse(body) {
    if (!body || !body.access_token || !body.user) return null;
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token || "",
      expires_at: body.expires_at
        ? body.expires_at * 1000
        : Date.now() + (body.expires_in || 3600) * 1000,
      user: { id: body.user.id, email: body.user.email || "" }
    };
  }

  // ---------- OAuth return (Google) ------------------------------------
  // Supabase redirects back with tokens in the URL fragment:
  //   #access_token=...&refresh_token=...&expires_in=...
  // Capture them, persist, fetch the user, then strip the fragment.
  function captureOAuthReturn() {
    if (!window.location.hash || window.location.hash.indexOf("access_token=") === -1) {
      return Promise.resolve(false);
    }
    var params = new URLSearchParams(window.location.hash.slice(1));
    var accessToken = params.get("access_token");
    if (!accessToken) return Promise.resolve(false);
    var partial = {
      access_token: accessToken,
      refresh_token: params.get("refresh_token") || "",
      expires_at: Date.now() + (parseInt(params.get("expires_in") || "3600", 10) * 1000),
      user: null
    };
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { "apikey": ANON_KEY, "Authorization": "Bearer " + accessToken }
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (u) {
        if (u && u.id) {
          partial.user = { id: u.id, email: u.email || "" };
          saveSession(partial);
          return true;
        }
        return false;
      }).catch(function () { return false; });
  }
  // Resolves once any OAuth return has been captured and persisted.
  // requireAuth() waits for this so a Google sign-in landing on an app
  // page is never mistaken for "not signed in" mid-capture.
  var oauthReady = captureOAuthReturn();

  // ---------- low-level auth call ---------------------------------------
  function authCall(path, payload) {
    return fetch(SUPABASE_URL + path, {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) {
          var msg = body.msg || body.message || body.error_description || body.error || "Something went wrong. Please try again.";
          throw new Error(msg);
        }
        return body;
      });
    });
  }

  function signUp(email, password) {
    return authCall("/auth/v1/signup", { email: email, password: password }).then(function (body) {
      var s = sessionFromResponse(body);
      if (s) { saveSession(s); return { session: s, needsConfirmation: false }; }
      // No token in the response = the project is asking for email
      // confirmation before the first sign-in.
      return { session: null, needsConfirmation: true };
    });
  }

  function signIn(email, password) {
    return authCall("/auth/v1/token?grant_type=password", { email: email, password: password })
      .then(function (body) {
        var s = sessionFromResponse(body);
        if (!s) throw new Error("Sign-in did not return a session. Please try again.");
        saveSession(s);
        return s;
      });
  }

  function refreshSession(session) {
    if (!session || !session.refresh_token) return Promise.resolve(null);
    return authCall("/auth/v1/token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then(function (body) {
        var s = sessionFromResponse(body);
        if (s) saveSession(s);
        return s;
      })
      .catch(function () { return null; });
  }

  // Current session, refreshed if it expires within 60 seconds.
  // Returns null when there is no usable session.
  function ensureSession() {
    var s = loadSession();
    if (!s || !s.access_token || !s.user) return Promise.resolve(null);
    if (s.expires_at && s.expires_at - Date.now() > 60000) return Promise.resolve(s);
    return refreshSession(s).then(function (fresh) {
      if (!fresh) clearSession();
      return fresh;
    });
  }

  function signOut() {
    var s = loadSession();
    clearSession();
    if (!s || !s.access_token) return Promise.resolve();
    return fetch(SUPABASE_URL + "/auth/v1/logout", {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Authorization": "Bearer " + s.access_token }
    }).catch(function () {});
  }

  // ---------- redirects --------------------------------------------------
  function inAppDir() { return /\/app\//.test(window.location.pathname); }
  function appUrl() {
    // From a site-root page: app/dashboard.html. From inside app/: dashboard.html.
    return inAppDir() ? "dashboard.html" : "app/dashboard.html";
  }
  function loginUrl() {
    return inAppDir() ? "../login.html" : "login.html";
  }
  // Guard for app pages: resolves with the session, or redirects to login.
  function requireAuth() {
    return oauthReady.then(function () { return ensureSession(); }).then(function (s) {
      if (!s) { window.location.href = loginUrl(); throw new Error("not-signed-in"); }
      return s;
    });
  }

  // ---------- Google OAuth ----------------------------------------------
  function startGoogle(redirectTo) {
    var dest = redirectTo || new URL(appUrl(), window.location.href).href;
    var url = SUPABASE_URL + "/auth/v1/authorize?provider=google&redirect_to=" +
      encodeURIComponent(dest);
    window.location.href = url;
  }

  // ---------- auth page wiring -------------------------------------------
  function statusEl(form) {
    var el = document.getElementById("auth-status") ||
      (form && form.querySelector(".form-status"));
    if (!el && form) {
      el = document.createElement("p");
      el.className = "form-status";
      el.setAttribute("role", "status");
      form.appendChild(el);
    }
    return el;
  }

  function wireAuthForm() {
    var form = document.getElementById("auth-form");
    var googleBtn = document.getElementById("google-btn");
    if (!form && !googleBtn) return;

    // If this page load IS a Google OAuth return, bounce into the app
    // once the session has been captured and persisted.
    oauthReady.then(function (captured) {
      if (!captured) return;
      var redirect = form && form.getAttribute("data-redirect");
      window.location.href = redirect
        ? new URL(redirect, window.location.href).href
        : appUrl();
    });

    if (googleBtn) {
      googleBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        var redirect = (form && form.getAttribute("data-redirect")) || null;
        startGoogle(redirect ? new URL(redirect, window.location.href).href : null);
      });
    }
    if (!form) return;

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var emailInput = form.querySelector('input[type="email"]') || form.querySelector('input[name="email"]');
      var passInput = form.querySelector('input[type="password"]') || form.querySelector('input[name="password"]');
      var status = statusEl(form);
      if (!emailInput || !passInput) {
        if (status) status.textContent = "This form is missing its email or password field.";
        return;
      }
      var email = emailInput.value.trim();
      var password = passInput.value;
      var mode = form.getAttribute("data-mode") ||
        (/signup/.test(window.location.pathname) ? "signup" : "login");
      var submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (status) status.textContent = mode === "signup" ? "Creating your account…" : "Signing you in…";
      if (submitBtn) submitBtn.disabled = true;

      var done = function () { if (submitBtn) submitBtn.disabled = false; };
      var fail = function (err) {
        done();
        if (status) status.textContent = err.message || "Something went wrong. Please try again.";
      };

      if (mode === "signup") {
        signUp(email, password).then(function (res) {
          done();
          if (res.needsConfirmation) {
            if (status) status.textContent = "Account created. Please check your email and tap the confirmation link, then sign in.";
            return;
          }
          verifyThenGo(status, fail);
        }).catch(fail);
      } else {
        signIn(email, password).then(function () {
          done();
          verifyThenGo(status, fail);
        }).catch(fail);
      }
    });
  }

  // RELOAD-VERIFY (lesson 2): re-read the persisted session from storage
  // and confirm it is still there and usable before sending the user in.
  function verifyThenGo(status, fail) {
    var s = loadSession();
    if (!s || !s.access_token || !s.user || !s.user.id) {
      if (status) status.textContent = "Sign-in did not stick. Please try again.";
      return;
    }
    fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { "apikey": ANON_KEY, "Authorization": "Bearer " + s.access_token }
    }).then(function (r) {
      if (!r.ok) throw new Error("Session check failed");
      var redirect = null;
      var form = document.getElementById("auth-form");
      if (form && form.getAttribute("data-redirect")) {
        redirect = new URL(form.getAttribute("data-redirect"), window.location.href).href;
      }
      window.location.href = redirect || appUrl();
    }).catch(function () {
      if (status) status.textContent = "We could not verify your session. Please try signing in again.";
      if (fail) fail(new Error("verify-failed"));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireAuthForm);
  } else {
    wireAuthForm();
  }

  window.IEPAuth = {
    SUPABASE_URL: SUPABASE_URL,
    ANON_KEY: ANON_KEY,
    ready: oauthReady,
    getSession: loadSession,
    ensureSession: ensureSession,
    requireAuth: requireAuth,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    startGoogle: startGoogle,
    loginUrl: loginUrl,
    appUrl: appUrl
  };
})();
