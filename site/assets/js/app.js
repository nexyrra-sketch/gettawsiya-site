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
    var linkIn = $("#link"), link = linkIn ? (linkIn.value || "").trim() : "";
    if (link) msg += "\n" + (I18N.linkLabel || "Link") + ": " + link;
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
  if (finalForm && !finalForm.hasAttribute("data-url-form")) finalForm.addEventListener("submit", function (e) {
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
  var tabs = $$('.tablist [role="tab"]');
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


  /* ---------- Brand journey: six stages (WAI-ARIA tabs) ---------- */
  var jtabs = $$(".jtab"), jbar = $("[data-jbar]");
  function selectJ(tab, focus) {
    var idx = jtabs.indexOf(tab);
    jtabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
      var pnl = doc.getElementById(t.getAttribute("aria-controls"));
      pnl.hidden = !on;
      if (on) { pnl.classList.remove("enter"); void pnl.offsetWidth; pnl.classList.add("enter"); }
    });
    if (jbar) jbar.style.setProperty("--p", ((idx + 1) / jtabs.length * 100) + "%");
    if (focus) tab.focus();
  }
  jtabs.forEach(function (t, i) {
    t.addEventListener("click", function () { selectJ(t); });
    t.addEventListener("keydown", function (e) {
      var rtl = root.dir === "rtl", k = e.key, n = null;
      if (k === (rtl ? "ArrowLeft" : "ArrowRight") || k === "ArrowDown") n = i + 1;
      if (k === (rtl ? "ArrowRight" : "ArrowLeft") || k === "ArrowUp") n = i - 1;
      if (k === "Home") n = 0;
      if (k === "End") n = jtabs.length - 1;
      if (n === null) return;
      e.preventDefault();
      selectJ(jtabs[(n + jtabs.length) % jtabs.length], true);
    });
  });
  if (jtabs.length) selectJ(jtabs[0]);

  /* ---------- Start a project: three-step wizard -> WhatsApp or email ---------- */
  var wz = $("#wizard");
  if (wz) {
    var W = I18N.wz || {}, step = 1, panes = $$(".wz-pane", wz), inds = $$("[data-wz-ind]", wz);
    var nextBtn = $("[data-wz-next]", wz), backBtn = $("[data-wz-back]", wz), nextLabel = nextBtn.querySelector("span");
    var nextText = nextLabel.textContent;
    function val(n) { var el = wz.elements[n]; return el ? (el.value || "").trim() : ""; }
    function intentEl() { return $('input[name="intent"]:checked', wz); }
    function compose() {
      var L = W.labels || {}, ie = intentEl();
      var rows = [[L.intent, ie ? ie.getAttribute("data-label") : ""], [L.name, val("name")], [L.brand, val("brand")], [L.city, selText(wz.elements.city)],
                  [L.link, val("link")], [L.budget, selText(wz.elements.budget)], [L.time, selText(wz.elements.time)], [L.msg, val("msg")]].filter(function (r) { return r[1]; });
      return rows;
    }
    function go(n) {
      step = n; wz.setAttribute("data-step", n);
      panes.forEach(function (p) { p.classList.toggle("on", +p.getAttribute("data-pane") === n); });
      inds.forEach(function (li) { var k = +li.getAttribute("data-wz-ind"); li.classList.toggle("done", k < n); if (k === n) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current"); });
      backBtn.hidden = n === 1; nextBtn.hidden = n === 3;
      if (n === 3) {
        var rows = compose(), dl = $("[data-wz-review]", wz);
        dl.innerHTML = "";
        rows.forEach(function (r) { var d = doc.createElement("div"), dt = doc.createElement("dt"), dd = doc.createElement("dd"); dt.textContent = r[0]; dd.textContent = r[1]; d.appendChild(dt); d.appendChild(dd); dl.appendChild(d); });
        var text = W.msg + "\n" + rows.map(function (r) { return r[0] + ": " + r[1]; }).join("\n");
        $("[data-wz-wa]", wz).href = contactHref(text);
        $("[data-wz-mail]", wz).href = "mailto:" + (CFG.email || "") + "?subject=" + encodeURIComponent("Tawsiya project") + "&body=" + encodeURIComponent(text);
      }
      var focusEl = $('.wz-pane.on input, .wz-pane.on a', wz);
      if (focusEl && n !== 1) focusEl.focus({ preventScroll: true });
    }
    function logLead() {
      try {
        var p = {}; compose().forEach(function (r) { p[r[0]] = r[1]; });
        var ie = intentEl();
        fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true, credentials: "same-origin",
          body: JSON.stringify({ kind: "project", name: val("name"), site: val("link"), intent: ie ? ie.value : "", payload: p, lang: I18N.lang, consent: true }) }).catch(function () {});
      } catch (e) {}
    }
    var sentOnce = false;
    $$("[data-wz-wa], [data-wz-mail]", wz).forEach(function (a) { a.addEventListener("click", function () { if (!sentOnce) { sentOnce = true; logLead(); } }); });
    wz.addEventListener("submit", function (e) {
      e.preventDefault();
      if (step === 1) { var ok = !!intentEl(); $("#wz-err1").hidden = ok; if (!ok) { $('input[name="intent"]', wz).focus(); return; } go(2); }
      else if (step === 2) { var nm = val("name"), inp = wz.elements.name; inp.setAttribute("aria-invalid", nm ? "false" : "true"); $("#wz-err2").hidden = !!nm; if (!nm) { inp.focus(); return; } go(3); }
    });
    backBtn.addEventListener("click", function () { go(Math.max(1, step - 1)); });
    $$('input[name="intent"]', wz).forEach(function (r) { r.addEventListener("change", function () { $("#wz-err1").hidden = true; }); });
    // buttons elsewhere on the page can pre-select a goal
    $$("[data-intent]").forEach(function (a) {
      a.addEventListener("click", function () {
        var href = a.getAttribute("href") || "";
        if (href.indexOf("#start") === -1) return;
        var r = $('input[name="intent"][value="' + a.getAttribute("data-intent") + '"]', wz);
        if (r) { r.checked = true; $("#wz-err1").hidden = true; }
        go(1);
      });
    });
    go(1);
  }

  /* ---------- Gentle reveal on scroll ---------- */
  /* Every .rv block (static in the HTML or added here) must end up visible:
     fade in on scroll when we can, otherwise show at once. */
  var allRv = function () { return $$(".rv"); };
  var showAll = function () { allRv().forEach(function (el) { el.classList.add("in"); }); };
  if ("IntersectionObserver" in window && !rm()) {
    $$(".v4-head, .st, .wc, .ck, .da-box, .ch-box, .ft, .pf-grid li, .pc, .wk, .pj-fig, .pj-3 > div").forEach(function (el) { el.classList.add("rv"); });
    var ro = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); ro.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    allRv().forEach(function (el) { ro.observe(el); });
    /* jumping to #pricing etc. or printing must never leave a block hidden */
    window.addEventListener("beforeprint", showAll);
    window.addEventListener("hashchange", function () { setTimeout(showAll, 50); });
  } else {
    showAll();
  }

  /* ---------- v4: website check boxes -> the Score page, with the site filled in ---------- */
  $$("[data-url-form]").forEach(function (f) {
    var inp = $("input", f), err = $(".v4-err", f);
    function valid(v) { return /[a-z0-9\u0600-\u06FF-]+\.[a-z\u0600-\u06FF]{2,}/i.test(v) || /^@[\w.]{2,}$/.test(v) || /instagram\.com\//i.test(v); }
    inp.addEventListener("input", function () { err.hidden = true; inp.setAttribute("aria-invalid", "false"); });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = (inp.value || "").trim().replace(/^https?:\/\//i, "");
      if (!valid(v)) { err.hidden = false; inp.setAttribute("aria-invalid", "true"); inp.focus(); return; }
      window.location.href = (I18N.scoreUrl || "/score/") + "?site=" + encodeURIComponent(v) + "#score-card";
    });
  });
  $$("[data-focus-url]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      var target = $("#final-form") || $("#check-form-hero");
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: rm() ? "auto" : "smooth", block: "center" });
      setTimeout(function () { var i = $("input", target); if (i) i.focus({ preventScroll: true }); }, rm() ? 0 : 450);
    });
  });
  if ("serviceWorker" in navigator && location.protocol === "https:" || location.hostname === "localhost") {
    try { navigator.serviceWorker && navigator.serviceWorker.register("/sw.js").catch(function () {}); } catch (e) {}
  }
})();
