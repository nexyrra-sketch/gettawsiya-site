/* Tawsiya — site interactions. Vanilla JS, no dependencies.
   All content is already in the HTML; this file only adds behaviour. Everything degrades
   gracefully without JS (tabs show the first panel, forms anchor to #check). */
(function () {
  "use strict";
  var doc = document, root = doc.documentElement;
  root.classList.add("js");

  var I18N = {};
  try { I18N = JSON.parse(doc.getElementById("tw-i18n").textContent); } catch (e) {}
  var CFG = window.TAWSIYA_CONFIG || {};
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  function rm() { return reduce.matches; }
  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, rm() ? 0 : ms); }); }
  function fill(str, map) { return str.replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : ""; }); }

  /* ---------- Contact links: one place decides WhatsApp vs email ---------- */
  function contactHref(text) {
    var wa = (CFG.whatsapp || "").replace(/\D/g, "");
    if (wa) return "https://wa.me/" + wa + "?text=" + encodeURIComponent(text);
    return "mailto:" + (CFG.email || "") + "?subject=Tawsiya&body=" + encodeURIComponent(text);
  }
  $$("[data-contact]").forEach(function (a) { a.href = contactHref(a.getAttribute("data-contact")); });
  if (CFG.prices) $$("[data-price]").forEach(function (el) {
    var v = CFG.prices[el.getAttribute("data-price")];
    if (v != null) el.textContent = Number(v).toLocaleString("en-US");
  });

  /* ---------- Header: border on scroll ---------- */
  var header = $("[data-header]");
  function onScroll() { if (header) header.classList.toggle("scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  /* ---------- Theme ---------- */
  $$("[data-theme-toggle]").forEach(function (b) {
    b.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("tw-theme", next); } catch (e) {}
    });
  });

  /* ---------- Mobile menu ---------- */
  var menuBtn = $("[data-menu]"), mnav = $("#mnav");
  function setMenu(open) {
    if (!menuBtn || !mnav) return;
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", menuBtn.getAttribute(open ? "data-label-close" : "data-label-open"));
    mnav.hidden = !open;
  }
  if (menuBtn) {
    menuBtn.addEventListener("click", function () { setMenu(menuBtn.getAttribute("aria-expanded") !== "true"); });
    $$("a", mnav).forEach(function (a) { a.addEventListener("click", function () { setMenu(false); }); });
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && !mnav.hidden) { setMenu(false); menuBtn.focus(); } });
    window.addEventListener("resize", function () { if (window.innerWidth > 980) setMenu(false); });
  }

  /* ---------- Count-up (explains a score arriving, not decoration) ---------- */
  function countUp(el) {
    var to = parseInt(el.getAttribute("data-countup"), 10) || 0;
    if (rm()) { el.textContent = to; return; }
    var t0 = null, dur = 1100;
    function step(t) {
      if (!t0) t0 = t;
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * e);
      if (p < 1) requestAnimationFrame(step);
    }
    el.textContent = "0"; requestAnimationFrame(step);
  }

  /* ---------- Hero chat: before / after ---------- */
  var chat = $("[data-chat]"), chatTouched = false;
  function setChat(state) {
    if (!chat) return;
    chat.setAttribute("data-state", state);
    $$("[data-chat-set]", chat).forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-chat-set") === state)); });
    $$("[data-view]", chat).forEach(function (v) { v.hidden = v.getAttribute("data-view") !== state; });
  }
  if (chat) {
    $$("[data-chat-set]", chat).forEach(function (b) {
      b.addEventListener("click", function () { chatTouched = true; setChat(b.getAttribute("data-chat-set")); });
    });
    // Show the "after" state once, a moment after the card is seen, so the idea lands without a click.
    if ("IntersectionObserver" in window && !rm()) {
      var co = new IntersectionObserver(function (es) {
        if (es[0].isIntersecting) { co.disconnect(); setTimeout(function () { if (!chatTouched) setChat("after"); }, 2600); }
      }, { threshold: 0.6 });
      co.observe(chat);
    }
  }

  /* ---------- Free check (DEMO: sample data, no AI engine is queried) ---------- */
  var consoleEl = $("[data-console]");
  var form = $("#check-form"), nameIn = $("#biz"), catIn = $("#cat"), cityIn = $("#city"), err = $("#biz-err");
  var runId = 0;

  function pane(name) {
    $$("[data-pane]", consoleEl).forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== name; });
    consoleEl.setAttribute("data-state", name);
  }
  function selText(sel) { return sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : ""; }

  function runScan(bizName) {
    if (!consoleEl) return;
    var id = ++runId;
    var cat = catIn ? catIn.value : "clinic";
    var cityLabel = selText(cityIn) || "";
    var qs = (I18N.questions && I18N.questions[cat]) || [];
    var log = $("[data-scan-log]", consoleEl);
    var name = bizName || I18N.defaultName;

    $$(".q", consoleEl).forEach(function (q) { q.className = "q"; });
    $$("[data-ecount]", consoleEl).forEach(function (c) { c.textContent = "0/4"; });
    $$(".erow", consoleEl).forEach(function (r) { r.classList.remove("active"); });
    log.innerHTML = "";
    pane("scan");
    consoleEl.scrollIntoView({ behavior: rm() ? "auto" : "smooth", block: "start" });

    var chain = wait(450);
    I18N.engines.forEach(function (eng, i) {
      var row = $('[data-engine="' + i + '"]', consoleEl), count = 0;
      chain = chain.then(function () { if (id !== runId) throw 0; row.classList.add("active"); });
      qs.forEach(function (q, j) {
        chain = chain.then(function () {
          if (id !== runId) throw 0;
          var dot = $('[data-q="' + i + "-" + j + '"]', consoleEl);
          dot.classList.add("asking");
          addLog(I18N.asking + " " + eng + ": “" + fill(q, { city: cityLabel }) + "”");
          return wait(170);
        }).then(function () {
          if (id !== runId) throw 0;
          var hit = I18N.hits[i][j] === 1, dot = $('[data-q="' + i + "-" + j + '"]', consoleEl);
          dot.classList.remove("asking"); dot.classList.add(hit ? "hit" : "miss");
          if (hit) count++;
          $('[data-ecount="' + i + '"]', consoleEl).textContent = count + "/4";
          addLog((I18N.lang === "ar" ? "← " : "→ ") + eng + " " + (hit ? I18N.named : I18N.notNamed), hit);
          return wait(70);
        });
      });
      chain = chain.then(function () { row.classList.remove("active"); });
    });
    chain.then(function () { return wait(500); }).then(function () {
      if (id !== runId) return;
      showResult(name, cat, cityLabel);
    }).catch(function () { /* superseded by a newer run */ });

    function addLog(text, hit) {
      var li = doc.createElement("li"); li.textContent = text; if (hit) li.className = "hit";
      log.appendChild(li);
      while (log.children.length > 14) log.removeChild(log.firstChild);
    }
  }

  function showResult(name, cat, city) {
    pane("result");
    $$("[data-bizname]", consoleEl).forEach(function (s) { s.textContent = name; });
    var catLabel = (I18N.cats && I18N.cats[cat]) || cat;
    var msg = fill(I18N.msg, { name: name, cat: catLabel, city: city });
    var wa = $("[data-check-contact]", consoleEl), mail = $("[data-check-mail]", consoleEl);
    if (wa) wa.href = contactHref(msg);
    if (mail) mail.href = "mailto:" + (CFG.email || "") + "?subject=Tawsiya%20AI%20Check&body=" + encodeURIComponent(msg);
    var res = $('[data-pane="result"]', consoleEl);
    $$("[data-countup]", res).forEach(countUp);
    res.focus({ preventScroll: true });
  }

  function validName(input) {
    var v = (input.value || "").trim();
    input.setAttribute("aria-invalid", v ? "false" : "true");
    return v;
  }
  if (form) form.addEventListener("submit", function (e) {
    e.preventDefault();
    var v = validName(nameIn);
    if (err) err.hidden = !!v;
    if (!v) { nameIn.focus(); return; }
    runScan(v);
  });
  if (nameIn) nameIn.addEventListener("input", function () { if (nameIn.value.trim() && err) { err.hidden = true; nameIn.setAttribute("aria-invalid", "false"); } });
  var finalForm = $("#final-form");
  if (finalForm) finalForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var inp = $("#biz2", finalForm), v = (inp.value || "").trim();
    if (!v) { inp.focus(); inp.setAttribute("aria-invalid", "true"); return; }
    if (nameIn) nameIn.value = v;
    runScan(v);
  });
  $$("[data-run-demo]").forEach(function (b) {
    b.addEventListener("click", function () { runScan(nameIn && nameIn.value.trim() ? nameIn.value.trim() : ""); });
  });

  /* ---------- How it works: active stage follows scroll ---------- */
  var stages = $$("[data-stage]"), rail = $$("[data-rail]");
  function activate(n) {
    stages.forEach(function (s) { s.classList.toggle("is-active", +s.getAttribute("data-stage") === n); });
    rail.forEach(function (a) {
      var k = +a.getAttribute("data-rail");
      if (k === n) a.setAttribute("aria-current", "step"); else a.removeAttribute("aria-current");
      a.classList.toggle("done", k < n);
    });
  }
  if (stages.length && "IntersectionObserver" in window) {
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) activate(+e.target.getAttribute("data-stage")); });
    }, { rootMargin: "-45% 0px -45% 0px" });
    stages.forEach(function (s) { so.observe(s); });
    activate(1);
  }

  /* ---------- App preview tabs (WAI-ARIA tabs pattern) ---------- */
  var tabs = $$('[role="tab"]');
  var seen = {};
  function selectTab(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      doc.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tab.focus();
    if (tab.scrollIntoView && window.innerWidth <= 980) tab.scrollIntoView({ block: "nearest", inline: "nearest", behavior: rm() ? "auto" : "smooth" });
    var id = tab.id;
    if (!seen[id]) {
      seen[id] = true;
      var panel = doc.getElementById(tab.getAttribute("aria-controls"));
      $$("[data-countup]", panel).forEach(countUp);
      if (id === "tab-wa") playWA();
      if (id === "tab-sim") runSim();
    }
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { selectTab(t); });
    t.addEventListener("keydown", function (e) {
      var rtl = root.dir === "rtl", vertical = window.innerWidth > 980, k = e.key, n = null;
      if (k === "ArrowDown" || (!vertical && k === (rtl ? "ArrowLeft" : "ArrowRight"))) n = i + 1;
      if (k === "ArrowUp" || (!vertical && k === (rtl ? "ArrowRight" : "ArrowLeft"))) n = i - 1;
      if (k === "Home") n = 0;
      if (k === "End") n = tabs.length - 1;
      if (n === null) return;
      e.preventDefault();
      selectTab(tabs[(n + tabs.length) % tabs.length], true);
    });
  });
  // count up the overview score when the app first scrolls into view
  var app = $("[data-app]");
  if (app && "IntersectionObserver" in window) {
    var ao = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { ao.disconnect(); seen["tab-overview"] = true; $$("#panel-overview [data-countup]").forEach(countUp); }
    }, { threshold: 0.3 });
    ao.observe(app);
  }

  /* Fix list */
  var fixBoxes = $$("[data-fix]");
  function updateFixes() {
    var done = fixBoxes.filter(function (b) { return b.checked; }).length;
    var out = $("[data-fix-done]"); if (out) out.textContent = done;
    $$("[data-fix-cell]").forEach(function (c, i) { c.classList.toggle("on", i < done); });
  }
  fixBoxes.forEach(function (b) { b.addEventListener("change", updateFixes); });

  /* Brand Brain tone */
  $$("[data-tone]").forEach(function (r) {
    r.addEventListener("change", function () {
      $$("[data-tone-view]").forEach(function (v) { v.hidden = v.getAttribute("data-tone-view") !== r.value; });
    });
  });

  /* Market simulator (replays sample results; it is not a live model) */
  var simBtn = $("[data-sim-run]");
  function runSim() {
    var bars = $$("[data-sim-bar]");
    if (!bars.length) return;
    var label = simBtn ? $("span", simBtn) : null;
    if (simBtn) { simBtn.disabled = true; if (label) label.textContent = simBtn.getAttribute("data-running"); }
    bars.forEach(function (b) { b.style.transition = "none"; b.style.inlineSize = "0%"; });
    void doc.body.offsetWidth;
    bars.forEach(function (b, i) {
      b.style.transition = "";
      setTimeout(function () { b.style.inlineSize = ""; }, rm() ? 0 : 60 + (i % 3) * 120 + Math.floor(i / 3) * 90);
    });
    setTimeout(function () { if (simBtn) { simBtn.disabled = false; if (label) label.textContent = simBtn.getAttribute("data-label"); } }, rm() ? 0 : 1600);
  }
  if (simBtn) simBtn.addEventListener("click", runSim);

  /* WhatsApp demo */
  var waPlaying = 0;
  function playWA() {
    var msgs = $$("[data-wa-msg]"), booking = $("[data-wa-booking]");
    if (!msgs.length) return;
    var id = ++waPlaying;
    if (rm()) { msgs.forEach(function (m) { m.classList.remove("pending"); }); if (booking) booking.classList.remove("pending"); return; }
    msgs.forEach(function (m) { m.classList.add("pending"); });
    if (booking) booking.classList.add("pending");
    msgs.reduce(function (p, m, i) {
      return p.then(function () { return wait(i === 0 ? 300 : 650 + Math.min(900, m.textContent.length * 9)); })
        .then(function () { if (id === waPlaying) m.classList.remove("pending"); if (i === 5 && booking && id === waPlaying) booking.classList.remove("pending"); });
    }, Promise.resolve());
  }
  var waBtn = $("[data-wa-play]");
  if (waBtn) waBtn.addEventListener("click", playWA);

})();
