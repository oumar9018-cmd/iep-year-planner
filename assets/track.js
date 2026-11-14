/* Anonymous test counters — no cookies, no personal data, no child data.
   Counts only: page views, planner completions, offer views, offer clicks. */
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
  document.querySelectorAll("form[data-waitlist]").forEach(function (form) {
    var st = form.querySelector("input[name=state]");
    var sv = st ? st.value : "";
    var seen = false;
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && !seen) { seen = true; send("offer_view", sv); io.disconnect(); }
        });
      }, { threshold: 0.4 });
      io.observe(form);
    }
    form.addEventListener("submit", function () { send("offer_click", sv); });
  });
})();
