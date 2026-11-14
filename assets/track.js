/* Anonymous test counters — no cookies, no personal data, no child data.
   Counts only: page views, planner completions, pricing views, pricing clicks.
   v2: offer_view fires when the pricing section enters view; offer_click fires
   on pricing / signup buttons. Event names kept from v1 for continuity. */
(function () {
  "use strict";
  var ENDPOINT = "https://lyzghuyifnlfswtyjnmz.supabase.co/rest/v1/iep_events";
  var KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5emdodXlpZm5sZnN3dHlqbm16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1Nzg1NTAsImV4cCI6MjExMDE1NDU1MH0.NMLYRfojD5DRL6O_T9eeddhXvDTSvusk28DIUlv1OXA";
  function send(type, state) {
    try {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": KEY, "Authorization": "Bearer " + KEY, "Prefer": "return=minimal" },
        body: JSON.stringify({ type: type, page: window.location.pathname, state: state || "" }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }
  window.iepTrack = send;
  send("view", "");

  function stateOf(el) {
    var host = el && el.closest ? el.closest("[data-state]") : null;
    return host ? host.getAttribute("data-state") : "";
  }

  var pricing = document.querySelector("#pricing");
  if (pricing) {
    var seen = false;
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && !seen) { seen = true; send("offer_view", stateOf(pricing)); io.disconnect(); }
        });
      }, { threshold: 0.25 });
      io.observe(pricing);
    }
    pricing.addEventListener("click", function (ev) {
      var a = ev.target.closest ? ev.target.closest("a[href*='signup.html'], .plan-btn") : null;
      if (a) send("offer_click", stateOf(pricing));
    });
  }
})();
