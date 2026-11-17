/* Tawsiya admin, control room (v7): scan any business, follow up leads, turn them into clients,
   run each client's action plan and share before/after progress reports. */
(function () {
  "use strict";
  var TW = window.TW, h = TW.h, A = window.TWA;
  if (!A) return;
  var api = A.api, btn = A.btn, table = A.table, chip = A.chip, sec = A.sec, fmt = A.fmt, E = A.E, F = A.F;
  var body = function () { return document.querySelector(".ap-admin-body"); };
  var ORIGIN = location.origin;
  var LEAD = [["new", "New"], ["contacted", "Contacted"], ["talking", "Talking"], ["won", "Won"], ["lost", "Lost"]];
  var poll = null;

  A.TABS.splice(1, 0, ["scans", "Scans"], ["clients", "Clients"], ["money", "Money"]);
  A.TABS.forEach(function (t) { if (t[0] === "requests") t[1] = "Score requests (old)"; });

  function scoreBadge(n, g) {
    if (n == null) return h("span", { class: "ap-meta" }, "–");
    var t = n >= 70 ? "hi" : n >= 40 ? "mid" : "lo";
    return h("span", { class: "tw-score rp-t-" + t }, h("b", null, String(n)), g ? h("small", null, g) : null);
  }
  function reportUrl(token, lang) { return ORIGIN + (lang === "en" ? "/en" : "") + "/report/" + token + "/"; }
  function waLink(contact, text) {
    var d = String(contact || "").replace(/[^\d]/g, "");
    if (/^0\d{8,9}$/.test(d)) d = "971" + d.slice(1);
    return "https://wa.me/" + (d.length >= 9 && !/@/.test(contact || "") ? d : "") + "?text=" + encodeURIComponent(text);
  }
  function msgFor(x, url) {
    var name = x.business_name || x.site;
    return x.lang === "en"
      ? "Hi, this is Hassan from Tawsiya. We checked how AI assistants (ChatGPT, Gemini, Claude, Perplexity) see " + name + ". Your score is " + (x.overall == null ? "ready" : x.overall + "/100") + ". Full report: " + url
      : "مرحباً، معك حسان من توصية. فحصنا كيف ترى مساعدات الذكاء الاصطناعي (ChatGPT وGemini وClaude وPerplexity) نشاط " + name + ". درجتكم " + (x.overall == null ? "جاهزة" : x.overall + "/100") + ". التقرير الكامل: " + url;
  }
  function copy(text, b) { if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { var w = b.textContent; b.textContent = "Copied"; setTimeout(function () { b.textContent = w; }, 1500); }); else window.prompt("", text); }
  function link(label, href, cls) { return h("a", { class: "v4-btn v4-btn-sm " + (cls || "v4-btn-line"), href: href, target: "_blank", rel: "noopener" }, label); }
  function stop() { clearTimeout(poll); poll = null; }

  /* ------------------------------------------------------------ Money */
  function aed(n) { return "AED " + (Math.round(n * 100) / 100).toLocaleString("en", { maximumFractionDigits: n % 1 && Math.abs(n) < 100 ? 2 : 0 }); }
  function stat(label, value, hint, cls) { return h("div", { class: "ap-stat" + (cls ? " " + cls : "") }, h("span", { class: "ap-meta" }, label), h("b", null, value), hint ? h("small", { class: "ap-meta" }, hint) : null); }
  A.VIEWS.money = function () {
    stop();
    return api("GET", "/money").then(function (m) {
      var s = m.settings, out = h("p", { class: "ap-fine", role: "status" });
      var fFree = F("Free reports per day", { name: "free_per_day", type: "number", value: String(m.free_per_day) }),
        fBud = F("Monthly AI budget (AED, 0 = no limit)", { name: "ai_budget_aed", type: "number", value: String(m.budget) }),
        fFix = F("Fixed monthly costs (AED): hosting, domain, tools", { name: "fixed_costs_aed", type: "number", value: String(m.fixed) });
      var mf = m.models.map(function (x) { return [x, F(x.label + " model" + (x.on ? "" : " (not connected)"), { name: "model_" + x.key, value: s["model_" + x.key] || "", ph: x.chosen, dir: "ltr" })]; });
      var val = function (f) { var i = f.querySelector("input,select"); return i ? i.value.trim() : ""; };
      var save = btn("Save settings", function () {
        var b = { free_per_day: val(fFree), ai_budget_aed: val(fBud), fixed_costs_aed: val(fFix) };
        mf.forEach(function (x) { b["model_" + x[0].key] = val(x[1]); });
        return api("PUT", "/settings", b).then(function () { return A.VIEWS.money(); });
      }, "v4-btn-dark");
      TW.mount(body(), h("div", { class: "tw-ws" },
        sec("This month", [
          m.paused ? h("p", { class: "ap-err" }, "The monthly AI budget is reached, so new free reports are paused. Paid clients and your own scans still run. Raise the budget below to resume.") : null,
          h("div", { class: "ap-stats" }, stat("Money in", aed(m.revenue), "paid through Ziina"), stat("Ziina fees", "− " + aed(m.fees), "2.9% + AED 1, estimate"),
            stat("AI cost", "− " + aed(m.ai), m.budget ? "budget " + aed(m.budget) : "no budget set"), stat("Fixed costs", "− " + aed(m.fixed), "hosting, domain"),
            stat("Left for you", aed(m.left), "before your own time", m.left >= 0 ? "tw-pos" : "tw-neg"), stat("Monthly plans", aed(m.mrr), "active clients × price")),
          h("p", { class: "ap-fine" }, "AI cost is an estimate from the usage each assistant reports. Your real bill is on each provider's usage page; check it there once a month.")]),
        sec("What each plan leaves you", [
          table([["Plan", function (u) { return h("b", null, u.name); }], ["Price", function (u) { return u.price ? aed(u.price) + " / " + u.interval : "Free"; }],
            ["AI cost per scan", function (u) { return aed(u.scan); }], ["AI cost per month", function (u) { return u.price ? aed(u.ai) + " (up to " + aed(u.ai_max) + ")" : aed(u.scan) + " per report"; }],
            ["Ziina fee", function (u) { return u.price ? aed(u.fee) : "–"; }], ["Left per client", function (u) { return u.price ? h("b", { class: u.left > 0 ? "up" : "down" }, aed(u.left)) : h("span", { class: "ap-meta" }, "a cost, capped by the budget"); }],
            ["Clients", function (u) { return String(u.clients); }]], m.unit),
          h("p", { class: "ap-fine" }, (m.measured ? "Based on your real scans so far: about " + aed(m.per_answer_aed) + " per AI answer. " : "No real scans yet, so this uses a planning figure of " + aed(m.per_answer_aed) + " per AI answer. ") +
            (m.assistants_on ? m.assistants_on + " assistant(s) connected. " : "No assistant connected yet; figures assume all four. ") +
            m.breakeven.map(function (b) { return b.clients + " " + b.name + " client" + (b.clients > 1 ? "s cover" : " covers") + " the fixed costs"; }).join("; ") + ". Change prices in the Plans tab.")]),
        sec("AI spend this month", [
          m.by_ai.length ? table([["Assistant", function (a) { return h("b", null, a.assistant); }], ["Model", function (a) { return h("span", { dir: "ltr" }, a.model || "–"); }], ["Answers", function (a) { return String(a.n); }],
            ["Web search", function (a) { return a.searched ? "on" : h("span", { class: "down" }, "off (free tier)"); }], ["Cost", function (a) { return aed(a.aed); }]], m.by_ai) : h("p", { class: "ap-fine" }, "No scans this month yet."),
          m.kinds.length ? h("p", { class: "ap-fine" }, m.kinds.map(function (k) { return k.n + " " + ({ score: "report", weekly: "weekly", manual: "on-demand" }[k.kind] || k.kind) + " scan" + (k.n > 1 ? "s" : "") + " (" + aed(k.aed) + ")"; }).join(" · ")) : null]),
        sec("Cost controls", [h("div", { class: "tw-form3" }, fFree, fBud, fFix),
          h("h3", null, "AI models"), h("p", { class: "ap-fine" }, "Leave empty to use the default. If a model is retired, Tawsiya tries the next one by itself: " + m.models.map(function (x) { return x.label + " is using " + x.in_use; }).join(", ") + "."),
          h("div", { class: "tw-form3" }, mf.map(function (x) { return x[1]; })), h("div", { class: "ap-row" }, save), out])));
    });
  };

  /* ------------------------------------------------------------ Scans */
  var filter = "all";
  A.VIEWS.scans = function () {
    stop();
    return api("GET", "/scans").then(function (r) {
      var site = F("Website", { name: "site", required: true, ph: "business.ae", dir: "ltr" }), nm = F("Business name (optional)", { name: "name" }),
        cat = F("What they do (optional)", { name: "category", ph: "dental clinic" }), area = F("Area (optional)", { name: "area", ph: "JLT, Dubai" }),
        ct = F("Their WhatsApp or email (optional)", { name: "contact", dir: "ltr" }), lang = F("Report language", { name: "lang", options: [["ar", "Arabic"], ["en", "English"]] });
      var out = h("p", { class: "ap-fine", role: "status" });
      var form = h("form", { class: "ap-form tw-scanform", novalidate: true }, h("div", { class: "ap-grid-3" }, site, nm, cat, area, ct, lang),
        h("button", { class: "v4-btn v4-btn-gold", type: "submit" }, "Scan now"), out);
      form.addEventListener("submit", function (e) {
        e.preventDefault(); out.textContent = "Starting…";
        api("POST", "/scans", { site: site.input.value, name: nm.input.value, category: cat.input.value, area: area.input.value, contact: ct.input.value, lang: lang.input.value }).then(function (x) {
          TW.clear(out); out.appendChild(document.createTextNode("Scanning. ")); out.appendChild(link("Watch it live", reportUrl(x.token, lang.input.value), "v4-btn-dark"));
          form.reset(); setTimeout(A.VIEWS.scans, 1200);
        }, function (er) { out.textContent = E(er); });
      });
      var items = r.items.filter(function (x) { return filter === "all" || (filter === "prospects" ? !x.business_id && x.lead_status !== "lost" : filter === "won" ? !!x.business_id : x.lead_status === filter); });
      var tabs = h("div", { class: "tw-filters" }, [["all", "All"], ["prospects", "Open prospects"], ["won", "Clients"], ["lost", "Lost"]].map(function (f) {
        return h("button", { type: "button", class: "ap-tab" + (filter === f[0] ? " on" : ""), onclick: function () { filter = f[0]; A.VIEWS.scans(); } }, f[1]);
      }));
      var running = r.items.some(function (x) { return x.run_status === "running" || (x.status !== "done" && !x.run_id); });
      TW.mount(body(), [
        sec("Scan any business", [h("p", { class: "ap-fine" }, "Paste a website and get the full report in 1 to 3 minutes. Admin scans skip the daily free limit. Use it on prospects before you call them."), form]),
        sec("All scans and leads", [tabs, table([
          ["When", function (x) { return fmt(x.created_at); }],
          ["Business", function (x) { return h("div", null, h("b", { dir: "auto" }, x.business_name || x.name || "–"), h("br"), h("span", { dir: "ltr", class: "ap-meta" }, x.site), x.category ? h("span", { class: "ap-meta" }, " · " + x.category) : null); }],
          ["Score", function (x) { return x.run_status === "running" ? chip("running " + (x.stage || "")) : x.run_status === "failed" ? chip("failed") : scoreBadge(x.overall, x.grade); }],
          ["AI named", function (x) { return x.answers_total ? x.answers_named + " / " + x.answers_total : "–"; }],
          ["From", function (x) { return (x.source || "") + (x.ref_code ? " · ref " + x.ref_code : ""); }],
          ["Contact", function (x) { return h("span", { dir: "ltr" }, x.contact || "–"); }],
          ["Lead", function (x) {
            var s = h("select", { "aria-label": "Lead status" }, LEAD.map(function (l) { return h("option", { value: l[0], selected: x.lead_status === l[0] }, l[1]); }));
            s.addEventListener("change", function () { api("PUT", "/scans/" + x.id, { lead_status: s.value }); });
            return x.business_id ? chip("client") : s;
          }],
          ["", function (x) {
            var url = reportUrl(x.token, x.lang), cb = h("button", { type: "button", class: "v4-btn v4-btn-sm v4-btn-line" }, "Copy link");
            cb.addEventListener("click", function () { copy(url, cb); });
            return h("div", { class: "tw-acts" }, link("Report", url, "v4-btn-dark"), cb, link("WhatsApp", waLink(x.contact, msgFor(x, url))),
              x.business_id ? btn("Workspace", function () { return openClient(x.business_id); }) : btn("Make client", function () { return makeClient(x); }),
              btn("Re-run", function () { var c = window.prompt("Re-run the scan. Correct what they do (optional), e.g. dental clinic:", x.category || ""); if (c === null) return; return api("POST", "/scans/" + x.id + "/rerun", { category: c.trim() || undefined }).then(A.VIEWS.scans); }));
          }]], items)])]);
      if (running && A.getTab() === "scans") poll = setTimeout(A.VIEWS.scans, 6000);
    });
  };
  function makeClient(x) {
    var em = window.prompt("Owner's account email (optional: leave empty if they have no account yet).", "");
    if (em === null) return Promise.resolve();
    return api("POST", "/scans/" + x.id + "/client", { owner_email: em.trim() }).then(function (r) { A.setTab("clients"); return openClient(r.business_id); }, function (e) { window.alert(E(e)); });
  }

  /* ------------------------------------------------------------ Clients */
  A.VIEWS.clients = function () {
    stop();
    return api("GET", "/clients").then(function (r) {
      TW.mount(body(), sec("Clients", [h("p", { class: "ap-fine" }, "Every business you work for. Before is the first scan (or the one you choose); Now is the latest."),
        table([["Business", function (b) { return h("div", null, h("b", { dir: "auto" }, b.name_en || b.name_ar || b.slug), h("br"), h("span", { class: "ap-meta", dir: "ltr" }, b.website || "")); }],
          ["Owner", function (b) { return h("span", { dir: "ltr" }, b.owner_email || "–"); }], ["Plan", function (b) { return b.plan ? chip(b.plan) : h("span", { class: "ap-meta" }, "free"); }],
          ["Before → now", function (b) { var d = b.before != null && b.now != null ? b.now - b.before : null; return h("span", { class: "tw-ba" }, scoreBadge(b.before), " → ", scoreBadge(b.now), d ? h("b", { class: d > 0 ? "up" : "down" }, " " + (d > 0 ? "+" : "") + d) : null); }],
          ["Plan items", function (b) { return b.open_tasks + " open · " + b.done_tasks + " done"; }], ["Last scan", function (b) { return b.last_run_at ? fmt(b.last_run_at) : "–"; }],
          ["", function (b) { return btn("Open", function () { return openClient(b.id); }, "v4-btn-dark"); }]], r.items)]));
    });
  };

  function openClient(id) {
    stop();
    return api("GET", "/clients/" + id).then(function (d) {
      var b = d.business, name = b.name_en || b.name_ar || b.slug, latest = d.latest;
      var msg = h("p", { class: "ap-fine", role: "status" });
      var reload = function () { return openClient(id); };
      // header + actions
      var shareRow = h("div", { class: "tw-acts" });
      function shareUi(token) {
        TW.clear(shareRow);
        if (!token) { shareRow.appendChild(btn("Create progress link", function () { return api("POST", "/clients/" + id + "/share", {}).then(function (x) { shareUi(x.token); }); })); return; }
        var url = ORIGIN + "/progress/" + token + "/", urlEn = ORIGIN + "/en/progress/" + token + "/", cb = h("button", { type: "button", class: "v4-btn v4-btn-sm v4-btn-line" }, "Copy link");
        cb.addEventListener("click", function () { copy(url, cb); });
        [link("Before / after (AR)", url, "v4-btn-dark"), link("EN", urlEn), cb,
          link("WhatsApp it", waLink(b.whatsapp || b.phone || b.owner_phone, "مرحباً، هذا تقرير التقدم لنشاطكم من توصية (قبل وبعد): " + url + "\nHere is your Tawsiya progress report (before and after): " + urlEn)),
          btn("New link", function () { if (!window.confirm("Old link will stop working. Continue?")) return; return api("POST", "/clients/" + id + "/share", { rotate: true }).then(function (x) { shareUi(x.token); }); })].forEach(function (n) { shareRow.appendChild(n); });
      }
      shareUi(b.share_token);
      var head = h("section", { class: "ap-card tw-ws-head" },
        h("p", null, btn("← Clients", function () { A.setTab("clients"); })),
        h("h2", { dir: "auto" }, name), h("p", { class: "ap-meta" }, h("span", { dir: "ltr" }, b.website || ""), " · ", b.owner_email ? h("span", { dir: "ltr" }, b.owner_email) : "no account linked", " · plan: ", d.sub && d.sub.status === "active" ? d.sub.plan_key + (d.sub.current_period_end ? " until " + A.iso(d.sub.current_period_end) : "") : "free"),
        h("div", { class: "tw-acts" }, btn("Run a new scan now", function () { return api("POST", "/businesses/" + id + "/run", {}).then(function () { msg.textContent = "Scan queued. It appears below in 1 to 3 minutes."; setTimeout(reload, 8000); }); }, "v4-btn-gold"),
          latest ? link("Latest report", reportUrl(latest.token, "ar")) : null, latest ? link("EN", reportUrl(latest.token, "en")) : null,
          btn("Rebuild action plan from latest scan", function () { return api("POST", "/clients/" + id + "/sync", {}).then(reload, function (e) { msg.textContent = E(e); }); })),
        h("h3", null, "Before / after report"), shareRow, msg);

      // score history
      var runs = d.runs.filter(function (r) { return r.status === "done" && r.overall != null; });
      var maxH = 100;
      var hist = sec("Score history", runs.length ? [h("div", { class: "tw-hist", role: "img", "aria-label": "Score history" }, runs.slice().reverse().map(function (r) {
        var base = r.id === b.baseline_run_id;
        return h("div", { class: "tw-hcol" + (base ? " is-base" : "") }, h("b", null, String(r.overall)), h("i", { style: "--v:" + (r.overall / maxH * 100) + "%" }), h("small", null, A.iso(r.at).slice(5)), base ? h("small", { class: "tw-basetag" }, "before") : null);
      })), table([["When", function (r) { return fmt(r.at); }], ["Kind", function (r) { return r.kind; }], ["Score", function (r) { return scoreBadge(r.overall, r.grade); }],
        ["AI named", function (r) { return r.total ? r.named + " / " + r.total : "–"; }], ["Known", function (r) { return r.brandTotal ? r.known + " / " + r.brandTotal : "–"; }], ["Issues", function (r) { return String(r.findings); }],
        ["", function (r) { return h("div", { class: "tw-acts" }, link("Report", reportUrl(r.token, "ar")), r.id === b.baseline_run_id ? chip("before") : btn("Use as before", function () { return api("PUT", "/clients/" + id, { baseline_run_id: r.id }).then(reload); }), btn("Answers", function () { return A.openRun(r.id); })); }]], runs)]
        : [h("p", { class: "ap-fine" }, "No finished scan yet. Press Run a new scan now.")].concat(d.runs.filter(function (r) { return r.status !== "done"; }).map(function (r) { return h("p", null, chip(r.status + " " + (r.stage || "")), " ", r.error || ""); })));

      // action plan board
      var cols = [["open", "To do"], ["doing", "Doing"], ["done", "Done"]];
      function move(t, to) { return api("PUT", "/tasks/" + t.id, { status: to }).then(reload); }
      function card(t) {
        var idx = cols.findIndex(function (c) { return c[0] === t.status; });
        var note = h("textarea", { rows: 2, placeholder: "Note the client will see (optional)", "aria-label": "Note to client" }, t.client_note || "");
        var vis = h("input", { type: "checkbox", checked: t.visible }); vis.addEventListener("change", function () { api("PUT", "/tasks/" + t.id, { visible: vis.checked }); });
        var own = h("select", { "aria-label": "Who does it" }, [["tawsiya", "Tawsiya does it"], ["client", "Client does it"]].map(function (o) { return h("option", { value: o[0], selected: t.owner === o[0] }, o[1]); }));
        own.addEventListener("change", function () { api("PUT", "/tasks/" + t.id, { owner: own.value }); });
        var tag = h("span", { class: "tw-own " + t.owner }, t.owner === "client" ? "Client" : "Tawsiya");
        return h("article", { class: "tw-task p" + t.priority },
          h("div", { class: "tw-row tw-thead" }, h("b", { dir: "auto" }, t.title), tag, t.visible ? null : h("span", { class: "ap-meta" }, "hidden")),
          t.client_note ? h("p", { class: "ap-fine", dir: "auto" }, "Note: " + t.client_note) : null,
          h("div", { class: "tw-acts" }, idx > 0 ? btn("←", function () { return move(t, cols[idx - 1][0]); }) : null,
            idx < 2 ? btn(idx === 1 ? "Done ✓" : "Start →", function () { return move(t, cols[idx + 1][0]); }, idx === 1 ? "v4-btn-dark" : "") : null),
          h("details", { class: "tw-edit" }, h("summary", null, "Edit"), t.body ? h("p", { dir: "auto", class: "ap-pre ap-fine" }, t.body) : null,
            own, h("label", { class: "tw-vis" }, vis, " client sees it"), note,
            h("div", { class: "tw-acts" }, btn("Save note", function () { return api("PUT", "/tasks/" + t.id, { client_note: note.value }).then(reload); }),
              btn("Delete", function () { if (window.confirm("Delete this item?")) return api("DELETE", "/tasks/" + t.id).then(reload); }))));
      }
      var nt = F("New item", { name: "title", ph: "e.g. Rewrite services page in Arabic" }), np = F("Priority", { name: "priority", options: [["1", "High"], ["2", "Medium"], ["3", "Low"]] });
      var add = h("form", { class: "ap-form ap-inline tw-add" }, nt, np, h("button", { class: "v4-btn v4-btn-dark v4-btn-sm", type: "submit" }, "Add"));
      add.addEventListener("submit", function (e) { e.preventDefault(); if (!nt.input.value.trim()) return; api("POST", "/clients/" + id + "/tasks", { title: nt.input.value, priority: np.input.value }).then(reload); });
      var board = sec("Action plan", [h("p", { class: "ap-fine" }, "Created from the scan's findings and closed automatically when a later scan shows the fix. Items the client can see appear in their dashboard and in the progress report."),
        h("div", { class: "tw-board" }, cols.map(function (c) { var list = d.tasks.filter(function (t) { return t.status === c[0]; }); var cut = c[0] === "done" ? 4 : 40; return h("div", { class: "tw-bcol" }, h("h3", null, c[1] + " ", h("span", { class: "rp-count" }, String(list.length))), list.slice(0, cut).map(card), list.length > cut ? h("details", { class: "tw-more" }, h("summary", null, "Show " + (list.length - cut) + " more"), list.slice(cut).map(card)) : null); })), add]);

      // intelligence from latest scan
      var intel = latest ? sec("From the latest scan", h("div", { class: "ap-grid-3" },
        h("div", null, h("h3", null, "Top issues"), h("ol", { class: "rp-klist" }, latest.findings.slice(0, 8).map(function (f) { return h("li", null, (d.F[f.key] || {}).en || f.key, " ", h("span", { class: "ap-meta" }, f.severity)); }))),
        h("div", null, h("h3", null, "Names AI recommends"), h("ol", { class: "rp-klist" }, latest.rivals.map(function (x) { return h("li", { dir: "auto" }, x.name + " (" + x.count + ")"); }))),
        h("div", null, h("h3", null, "Sources AI cites"), h("ol", { class: "rp-klist" }, latest.sources.map(function (x) { return h("li", { dir: "ltr" }, x.domain + " (" + x.count + ")"); }))))) : null;

      var notes = h("textarea", { rows: 4, "aria-label": "Private notes" }, b.admin_notes || "");
      var notesSec = sec("Private notes (only you see these)", [notes, btn("Save notes", function () { return api("PUT", "/clients/" + id, { admin_notes: notes.value }); })]);
      TW.mount(body(), [head, board, hist, intel, notesSec]);
      if (d.runs.some(function (r) { return r.status === "running"; })) poll = setTimeout(function () { if (A.getTab() === "clients") reload(); }, 8000);
    });
  }
  A.openClient = openClient;
})();
