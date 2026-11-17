/* Report pages: live progress while the scan runs, print/save as PDF, copy link, "send me the report". */
(function () {
  "use strict";
  var TW = window.TW, h = TW.h;
  document.querySelectorAll("[data-print]").forEach(function (b) { b.addEventListener("click", function () { window.print(); }); });
  document.querySelectorAll("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var url = b.getAttribute("data-copy"), was = b.textContent;
      var ok = function () { b.textContent = b.getAttribute("data-done") || "✓"; setTimeout(function () { b.textContent = was; }, 1800); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(ok, function () { window.prompt("", url); });
      else window.prompt("", url);
    });
  });
  // open the details of the first high-priority findings so the plan reads well when printed
  window.addEventListener("beforeprint", function () { document.querySelectorAll(".rp-find").forEach(function (d) { d.open = true; }); });

  var live = document.querySelector("[data-live]");
  if (!live) return;
  var token = live.getAttribute("data-live"), L = {};
  try { L = JSON.parse(document.getElementById("rp-i18n").textContent); } catch (e) {}
  var fill = function (s, m) { return String(s || "").replace(/\{(\w+)\}/g, function (_, k) { return m[k] != null ? m[k] : ""; }); };
  var steps = live.querySelectorAll("[data-step]"), bar = live.querySelector(".rp-bar-live"), feed = live.querySelector("[data-feed]"), found = live.querySelector("[data-found]");
  var ORDER = { queued: -1, held: -1, site: 0, pages: 1, profile: 2, ai: 3, report: 4, done: 5 };
  var timer = null, misses = 0, shown = 0;

  function paint(r) {
    var p = r.progress || {}, at = ORDER[r.stage] == null ? 0 : ORDER[r.stage];
    if (r.stage === "site" && p.pages > 0) at = 1;
    steps.forEach(function (li, i) { li.className = i < at ? "is-done" : i === at ? "is-on" : ""; });
    var sub = function (i, t) { var s = steps[i] && steps[i].querySelector("[data-sub]"); if (s) s.textContent = t || ""; };
    if (p.pages) sub(1, fill(L.st_pages, { n: p.pages }));
    if (p.total) sub(3, fill(L.st_ai, { done: p.done || 0, total: p.total }));
    var f = p.found;
    if (f && (f.name || f.category)) {
      var ar = document.documentElement.lang === "ar";
      var bits = [f.name, ar ? (f.category_ar || f.category) : f.category, [ar ? (f.area_ar || f.area) : f.area, ar ? (f.city_ar || f.city) : f.city].filter(Boolean).join(ar ? "، " : ", ")].filter(Boolean);
      TW.mount(found, [h("b", null, L.st_found + ": "), bits.join(" · ")]); found.hidden = false; sub(2, f.name || "");
    }
    var pc = at < 0 ? 2 : at <= 2 ? 6 + at * 8 : at === 3 ? 25 + Math.round(65 * ((p.done || 0) / Math.max(1, p.total || 1))) : at === 4 ? 95 : 100;
    bar.querySelector("i").style.setProperty("--v", pc + "%"); bar.setAttribute("aria-valuenow", String(pc));
    var items = p.feed || [];
    if (items.length && items.length !== shown) {
      shown = items.length;
      TW.mount(feed, items.slice().reverse().map(function (x) {
        var label = x.k === "brand" ? L.brand : x.y ? L.named : L.not;
        return h("li", { class: x.e ? "is-err" : x.y ? "is-yes" : "is-no" }, h("span", { class: "rp-feed-i", "aria-hidden": "true" }, x.e ? "–" : x.y ? "✓" : "✕"),
          h("div", null, h("b", null, x.a + " "), h("span", null, x.e ? "" : label), h("small", { dir: "auto" }, x.q), x.n && x.n.length ? h("small", { class: "rp-feed-n", dir: "auto" }, "→ " + x.n.join(" · ")) : null));
      }));
    }
    if (r.has_contact) { var s = document.querySelector(".rp-send"); if (s) s.hidden = true; }
  }
  function tick() {
    TW.api("GET", "/api/scan/" + encodeURIComponent(token)).then(function (r) {
      misses = 0; paint(r);
      if (r.done) { setTimeout(function () { location.reload(); }, 700); return; }
      if (r.failed) { live.querySelector("[data-failed]").hidden = false; return; }
      timer = setTimeout(tick, r.stage === "ai" ? 2000 : 1500);
    }, function () { if (++misses < 20) timer = setTimeout(tick, 4000); });
  }
  tick();

  var form = document.querySelector("[data-send]");
  if (form) form.addEventListener("submit", function (e) {
    e.preventDefault();
    var inp = form.querySelector("input"), v = inp.value.trim(), err = document.querySelector("[data-senderr]");
    err.hidden = true;
    if (!(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || /^\+?[\d\s()-]{7,20}$/.test(v))) { err.textContent = inp.getAttribute("placeholder"); err.hidden = false; inp.focus(); return; }
    var b = form.querySelector("button"); b.disabled = true;
    TW.api("POST", "/api/scan/" + encodeURIComponent(token) + "/contact", { contact: v }).then(function () { form.hidden = true; document.querySelector("[data-sent]").hidden = false; },
      function () { b.disabled = false; err.textContent = "Error"; err.hidden = false; });
  });
})();
