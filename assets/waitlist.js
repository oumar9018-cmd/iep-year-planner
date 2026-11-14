/* ================================================================
   WAITLIST FORM — LAUNCH WIRING POINT
   ----------------------------------------------------------------
   The parent (main agent) connects the form backend here at launch:
   replace WAITLIST_ENDPOINT below with the live endpoint URL.
   Until then it points at a placeholder, and the form:
     - validates the email locally,
     - does NOT send anything anywhere,
     - tells the visitor plainly that sign-ups are not open yet.
   It must never show a fake "you are on the list" success.
   Payload at launch (keep it this small): { email, state, page, ts }
   — never add fields about the child.
   ================================================================ */
var WAITLIST_ENDPOINT = "https://lyzghuyifnlfswtyjnmz.supabase.co/rest/v1/iep_waitlist";
var WAITLIST_APIKEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5emdodXlpZm5sZnN3dHlqbm16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1Nzg1NTAsImV4cCI6MjExMDE1NDU1MH0.NMLYRfojD5DRL6O_T9eeddhXvDTSvusk28DIUlv1OXA";

(function () {
  "use strict";
  document.querySelectorAll("form[data-waitlist]").forEach(function (form) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var status = form.querySelector(".form-status");
      var email = form.querySelector("input[name=email]").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        status.textContent = "That email address doesn't look complete — please check it and try again.";
        return;
      }
      if (WAITLIST_ENDPOINT === "WAITLIST_ENDPOINT_NOT_CONNECTED") {
        status.textContent = "Sign-ups are not open yet — this page is a preview of the test site. No information has been sent or stored.";
        return;
      }
      var stateEl = form.querySelector("input[name=state]");
      var payload = {
        email: email,
        state: stateEl ? stateEl.value : "",
        page: window.location.pathname,
        ts: new Date().toISOString()
      };
      fetch(WAITLIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": WAITLIST_APIKEY, "Authorization": "Bearer " + WAITLIST_APIKEY, "Prefer": "return=minimal" },
        body: JSON.stringify(payload)
      }).then(function (r) {
        status.textContent = r.ok
          ? "You are on the founding waitlist. We will email you once — at launch, or to tell you if we don't launch."
          : "Something went wrong at our end. Please try again in a little while.";
      }).catch(function () {
        status.textContent = "Something went wrong at our end. Please try again in a little while.";
      });
    });
  });
})();
