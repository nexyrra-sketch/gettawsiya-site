/* Client dashboard. Everything shown is real data from the account; nothing is sample data. */
(function () {
  "use strict";
  var TW = window.TW, h = TW.h, root = document.getElementById("app-root");
  if (!root) return;
  var D = function (k, m) { return TW.t("dash." + k, m); };
  var C = function (k) { return TW.t("common." + k); };
  var state = null;

  function ring(n) {
    var r = 30, c = 2 * Math.PI * r, ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 76 76"); svg.setAttribute("class", "v4-ring"); svg.setAttribute("aria-hidden", "true");
    [["rt", c + " " + c], ["rv", (c * n / 15).toFixed(1) + " " + c.toFixed(1)]].forEach(function (a) {
      var e = document.createElementNS(ns, "circle"); e.setAttribute("cx", 38); e.setAttribute("cy", 38); e.setAttribute("r", r); e.setAttribute("class", a[0]);
      if (a[0] === "rv") { e.setAttribute("stroke-dasharray", a[1]); e.setAttribute("transform", "rotate(-90 38 38)"); } svg.appendChild(e);
    });
    return svg;
  }
  function bars(items, label) {
    return h("div", { class: "ap-bars", role: "img", "aria-label": label }, items.map(function (it) {
      var col = h("div", { class: "ap-bar" }, h("span", { class: "mono" }, String(it.v)), h("i"), h("small", null, it.l));
      col.querySelector("i").style.setProperty("--v", Math.max(it.pct, 3) + "%");
      return col;
    }));
  }
  function card(title, body, cls) { return h("section", { class: "ap-card " + (cls || "") }, h("h2", null, title), body); }
  function statusChip(s) { return h("span", { class: "ap-chip st-" + s }, D("status." + s)); }

  /* ---- score ---- */
  function scoreCard(b) {
    var reps = state.reports, last = reps[reps.length - 1];
    var msg = TW.msg("ap-ok"), err = TW.msg();
    var openReq = state.requests.some(function (r) { return r.status === "new" || r.status === "working"; });
    var btn = h("button", { class: "v4-btn v4-btn-dark", type: "button", disabled: openReq, onclick: function () {
      err.hide(); TW.busy(btn, true);
      TW.api("POST", "/api/client/score-request", {}).then(function (r) { state.requests.unshift(r.request); msg.show(D("req_ok")); TW.busy(btn, true); drawRequests(); },
        function (e) { TW.busy(btn, false); err.show(e.code === "open_request" ? D("req_open") : TW.errText(e)); });
    } }, D("req_btn"));
    var top = last
      ? h("div", { class: "ap-score-row" }, ring(last.score), h("p", { class: "ap-big" }, h("b", null, String(last.score)), h("span", null, "/15")),
          h("p", null, D("score_of"), h("br"), h("small", null, D("score_date", { date: TW.date(last.checked_on) })), h("br"),
            h("a", { href: TW.langPath("/score/r/" + last.token + "/") }, D("report"))))
      : h("p", null, D("score_none"));
    var trend = reps.length > 1 ? bars(reps.slice(-8).map(function (r) { return { v: r.score, pct: r.score / 15 * 100, l: TW.date(r.checked_on) }; }), D("score_h")) : null;
    return card(D("score_h"), [top, trend, h("div", { class: "ap-actions" }, btn), err, msg, h("div", { id: "req-list" })]);
  }
  function drawRequests() {
    var el = document.getElementById("req-list"); if (!el) return;
    TW.mount(el, state.requests.length ? h("div", null, h("h3", null, D("req_h")), h("ul", { class: "ap-links" }, state.requests.map(function (r) {
      return h("li", null, h("span", { dir: "ltr" }, r.site), " ", h("span", { class: "ap-chip st-" + r.status }, D("st." + r.status)), " ", h("span", { class: "ap-meta" }, TW.date(r.created_at)));
    }))) : null);
  }

  /* ---- weekly AI checks ---- */
  function aiCard() {
    var cs = state.checks;
    if (!cs.length) return card(D("ai_h"), h("p", null, D("ai_none")));
    var last = cs[cs.length - 1];
    return card(D("ai_h"), [
      bars(cs.slice(-12).map(function (c) { return { v: c.answers_named, pct: c.answers_total ? c.answers_named / c.answers_total * 100 : 0, l: TW.date(c.week_of) }; }), D("ai_h")),
      h("p", { class: "ap-lead" }, D("ai_of", { n: last.answers_named, t: last.answers_total }), " · ", D("ai_week", { date: TW.date(last.week_of) })),
      last.note ? h("p", null, last.note) : null, h("p", { class: "ap-fine" }, D("ai_note"))]);
  }

  /* ---- tasks ---- */
  function tasksCard() {
    var open = state.tasks.filter(function (t) { return t.status === "open"; }), done = state.tasks.filter(function (t) { return t.status === "done"; });
    var body = open.length ? h("ul", { class: "ap-tasks" }, open.map(function (t) {
      var b = h("button", { class: "v4-btn v4-btn-line v4-btn-sm", type: "button", onclick: function () {
        TW.busy(b, true); TW.api("POST", "/api/client/tasks/" + t.id + "/done", {}).then(function () { t.status = "done"; render(); }, function () { TW.busy(b, false); });
      } }, D("task_done"));
      return h("li", null, h("div", null, h("b", null, t.title), t.body ? h("p", null, t.body) : null), b);
    })) : h("p", null, D("tasks_none"));
    return card(D("tasks_h"), [body, done.length ? h("details", { class: "ap-done" }, h("summary", null, D("tasks_done") + " (" + done.length + ")"), h("ul", { class: "ap-links" }, done.map(function (t) { return h("li", null, t.title); }))) : null]);
  }

  /* ---- facts form ---- */
  var FIELDS = ["name_en", "name_ar", "category", "category_ar", "city", "area", "website", "instagram", "phone", "whatsapp", "email", "address", "hours", "languages", "services", "price_range", "desc_en", "desc_ar"];
  var LONG = { services: 5, desc_en: 3, desc_ar: 3, hours: 2, address: 2 }, LTR = { website: 1, instagram: 1, phone: 1, whatsapp: 1, email: 1, name_en: 1, desc_en: 1, category: 1 };
  function factsCard(b) {
    var inputs = {}, ok = TW.msg("ap-ok"), err = TW.msg();
    var fields = FIELDS.map(function (k) {
      var f = TW.field(TW.t("dash.f." + k), { textarea: !!LONG[k], rows: LONG[k], max: k === "services" ? 1200 : 700, ph: TW.t("dash.ph." + k) === "dash.ph." + k ? "" : TW.t("dash.ph." + k), value: b[k] || "", dir: LTR[k] ? "ltr" : undefined, name: k });
      inputs[k] = f.input; return f;
    });
    var btn = h("button", { class: "v4-btn v4-btn-dark", type: "submit" }, C("save"));
    var form = h("form", { class: "ap-form ap-form-grid", novalidate: "" }, fields, h("div", { class: "ap-span" }, err, ok, btn));
    form.addEventListener("submit", function (e) {
      e.preventDefault(); err.hide(); ok.hide(); TW.busy(btn, true);
      var body = {}; FIELDS.forEach(function (k) { body[k] = inputs[k].value; });
      TW.api("PUT", "/api/client/business", body).then(function (r) { state.business = r.business; TW.busy(btn, false); ok.show(C("saved")); renderVerified(); },
        function (x) { TW.busy(btn, false); err.show(TW.errText(x)); });
    });
    return card(D("facts_h"), [h("p", null, D("facts_t")), form]);
  }

  /* ---- verified ---- */
  function renderVerified() {
    var el = document.getElementById("ver-card"); if (!el) return;
    var b = state.business, url = location.origin + "/verified/" + b.slug + "/", page = TW.langPath("/verified/" + b.slug + "/");
    var kids = [];
    if (b.status === "verified") {
      var snippet = '<a href="' + url + '"><img src="' + location.origin + "/badge/" + b.slug + '.svg" alt="Verified by Tawsiya" width="240" height="64"></a>';
      var cp = h("button", { class: "v4-btn v4-btn-line v4-btn-sm", type: "button", onclick: function () { TW.copy(snippet, cp, C("copied")); } }, C("copy"));
      kids = [h("p", null, D("ver_live")), b.needs_review ? h("p", { class: "ap-note" }, D("ver_review")) : null, h("p", null, h("a", { class: "v4-btn v4-btn-dark v4-btn-sm", href: page }, D("ver_view"))),
        h("h3", null, D("badge_h")), h("p", null, D("badge_t")), h("img", { src: "/badge/" + b.slug + ".svg", alt: "", width: 240, height: 64 }), h("pre", { class: "ap-code", dir: "ltr" }, snippet), cp];
    } else {
      kids = [h("p", null, b.status === "suspended" ? D("status.suspended") : D("ver_pending")), b.status === "pending" ? h("p", null, h("a", { class: "v4-btn v4-btn-line v4-btn-sm", href: page }, D("ver_preview"))) : null];
    }
    TW.mount(el, [h("h2", null, D("ver_h"), " ", statusChip(b.status)), kids]);
  }

  /* ---- account ---- */
  function accountCard() {
    var cur = TW.field(D("pw_cur"), { type: "password", ac: "current-password", name: "current" }), nw = TW.field(D("pw_new"), { type: "password", ac: "new-password", hint: D("pw_hint"), name: "password" });
    var ok = TW.msg("ap-ok"), err = TW.msg(), btn = h("button", { class: "v4-btn v4-btn-line", type: "submit" }, D("pw_btn"));
    var f = h("form", { class: "ap-form", novalidate: "" }, cur, nw, err, ok, btn);
    f.addEventListener("submit", function (e) {
      e.preventDefault(); err.hide(); ok.hide(); TW.busy(btn, true);
      TW.api("POST", "/api/auth/password", { current: cur.input.value, password: nw.input.value }).then(function () { TW.busy(btn, false); ok.show(D("pw_ok")); cur.input.value = nw.input.value = ""; },
        function (x) { TW.busy(btn, false); err.show(TW.errText(x)); });
    });
    return card(D("acct_h"), [f, h("p", { class: "ap-fine" }, D("support"), " ", h("a", { href: TW.contactHref(C("wa_msg")), rel: "noopener" }, C("wa")))]);
  }


  /* ================= v6: plan, automatic checks, competitors, settings ================= */
  var AP = function (k, m) { return TW.t("app." + k, m); };
  function planCard() {
    var p = state.plan, sub = state.subscription, kids = [];
    var name = TW.lang === "ar" ? p.name_ar : p.name_en;
    if (payNote) kids.push(payNote);
    kids.push(h("p", { class: "ap-lead" }, h("b", null, name), p.price ? " · " + p.price + " AED" : ""));
    var err = TW.msg(), acts = [];
    if (!sub) kids.push(h("p", null, AP("plan_free")));
    else if (sub.source === "manual") kids.push(h("p", { class: "ap-meta" }, AP("manual_plan"), sub.current_period_end ? " " + AP("renews", { date: TW.date(sub.current_period_end) }) : ""));
    else {
      kids.push(sub.status === "grace" ? h("p", { class: "ap-note warn" }, AP("past_due", { date: TW.date(sub.current_period_end) })) : h("p", { class: "ap-meta" }, AP("renews", { date: TW.date(sub.current_period_end) })));
      if (state.billing && p.price) {
        var rb = h("button", { class: "v4-btn " + (sub.renew_soon ? "v4-btn-gold" : "v4-btn-dark") + " v4-btn-sm", type: "button", onclick: function () {
          err.hide(); TW.busy(rb, true);
          TW.api("POST", "/api/billing/checkout", { plan: p.key }).then(function (r) { location.href = r.url; }, function (e) { TW.busy(rb, false); err.show(TW.errText(e)); });
        } }, AP("renew", { price: p.price }));
        acts.push(rb);
      }
      kids.push(h("p", { class: "ap-fine" }, AP("prepaid")));
    }
    acts.push(h("a", { class: "v4-btn " + (sub ? "v4-btn-line" : "v4-btn-gold") + " v4-btn-sm", href: TW.langPath("/plans/") }, sub ? AP("change") : AP("upgrade")));
    kids.push(h("div", { class: "ap-actions" }, acts), err);
    if (state.payments && state.payments.length) kids.push(h("details", null, h("summary", null, AP("pays_h") + " (" + state.payments.length + ")"), h("ul", { class: "ap-links" }, state.payments.map(function (x) {
      return h("li", null, TW.date(x.created_at) + " · " + x.amount + " AED · " + (x.description || ""));
    }))));
    return card(AP("plan_h"), kids, "ap-plancard");
  }
  var payNote = null;
  function confirmPayment() {
    var qs = new URLSearchParams(location.search), pi = qs.get("pi");
    if (qs.get("checkout") !== "success" || !pi) return Promise.resolve();
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    var tries = 0;
    function attempt() {
      return TW.api("POST", "/api/billing/confirm", { pi: pi }).then(function (r) {
        if (r.status === "completed") { payNote = h("p", { class: "ap-ok", role: "status" }, AP("paid_ok")); return true; }
        if (r.status === "failed" || r.status === "canceled") { payNote = h("p", { class: "ap-err", role: "alert" }, AP("pay_failed")); return true; }
        if (++tries < 5) return new Promise(function (res) { setTimeout(res, 2500); }).then(attempt);
        payNote = h("p", { class: "ap-note", role: "status" }, AP("pay_pending")); return true;
      }, function () { payNote = h("p", { class: "ap-note", role: "status" }, AP("pay_pending")); });
    }
    TW.mount(root, h("p", { class: "ap-lead", role: "status" }, AP("confirming")));
    return attempt();
  }

  function runCard() {
    var run = state.run, L = state.limits, kids = [];
    var left = Math.max(0, (L.manual_runs_per_week || 0) - state.manual_used);
    var msg = TW.msg("ap-ok"), err = TW.msg();
    if (state.queued) kids.push(h("p", { class: "ap-note" }, AP("running")), h("div", { class: "ap-progress" }, h("i")));
    if (!run) kids.push(h("p", null, AP("run_none")));
    else {
      kids.push(h("p", { class: "ap-lead" }, h("b", null, AP("run_of", { n: run.answers_named, t: run.answers_total }))), h("p", { class: "ap-meta" }, AP("run_on", { date: TW.date(run.finished_at || run.started_at) })));
      var by = {}; state.answers.forEach(function (a) { if (a.error) return; var e = by[a.assistant] || (by[a.assistant] = { n: 0, t: 0 }); e.t++; if (a.named) e.n++; });
      var keys = Object.keys(by);
      if (keys.length) kids.push(h("h3", null, AP("by_assistant")), bars(keys.map(function (k) { return { v: by[k].n + "/" + by[k].t, pct: by[k].t ? by[k].n / by[k].t * 100 : 0, l: LBL[k] || k }; }), AP("by_assistant")));
      kids.push(h("details", { class: "ap-answers" }, h("summary", null, AP("answers_h") + " (" + state.answers.length + ")"), h("ul", { class: "ap-alist" }, state.answers.map(function (a) {
        return h("li", null, h("div", { class: "ap-ahead" }, h("span", { class: "ap-chip" }, LBL[a.assistant] || a.assistant), " ",
          h("span", { class: "ap-chip " + (a.error ? "st-closed" : a.named ? "st-verified" : "st-suspended") }, a.error ? AP("error") : a.named ? AP("named_yes") : AP("named_no"))),
          h("p", { dir: a.lang === "ar" ? "rtl" : "ltr" }, h("b", null, a.question)),
          a.mentions && a.mentions.length ? h("p", { class: "ap-meta" }, AP("mentions") + ": " + a.mentions.join(TW.lang === "ar" ? "، " : ", ")) : null,
          a.answer ? h("details", null, h("summary", null, AP("show")), h("p", { class: "ap-pre", dir: "auto" }, a.answer)) : null,
          a.sources && a.sources.length ? h("details", null, h("summary", null, AP("sources") + " (" + a.sources.length + ")"), h("ul", { class: "ap-links" }, a.sources.slice(0, 8).map(function (u) {
            var host = u; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (e) {}
            return h("li", null, h("a", { href: /^https?:\/\//.test(u) ? u : "#", rel: "noopener nofollow", target: "_blank", dir: "ltr" }, host));
          }))) : null);
      }))));
    }
    if (L.manual_runs_per_week > 0) {
      var rb = h("button", { class: "v4-btn v4-btn-dark v4-btn-sm", type: "button", disabled: state.queued || left <= 0, onclick: function () {
        err.hide(); TW.busy(rb, true);
        TW.api("POST", "/api/client/run", {}).then(function () { msg.show(AP("run_queued")); state.queued = true; pollSoon(); }, function (e) { TW.busy(rb, false); err.show(TW.errText(e)); });
      } }, AP("run_btn"));
      kids.push(h("div", { class: "ap-actions" }, rb, h("span", { class: "ap-meta" }, AP("run_left", { n: left }))));
    } else kids.push(h("p", { class: "ap-fine" }, AP("run_upgrade"), " ", h("a", { href: TW.langPath("/plans/") }, AP("upgrade"))));
    kids.push(err, msg);
    return card(AP("run_h"), kids);
  }
  var LBL = { openai: "ChatGPT", gemini: "Gemini", anthropic: "Claude", perplexity: "Perplexity" };

  function compCard() {
    var run = state.run; if (!run) return null;
    var list = (run.competitors || []).slice(0, 10), you = { name: AP("you"), count: run.answers_named, me: true };
    var all = [you].concat(list).sort(function (a, b) { return b.count - a.count; });
    var max = Math.max.apply(null, all.map(function (x) { return x.count; }).concat([1]));
    if (!list.length) return card(AP("comp_h"), h("p", null, AP("comp_none")));
    return card(AP("comp_h"), [h("p", { class: "ap-fine" }, AP("comp_t")), h("ul", { class: "ap-hbars" }, all.map(function (c) {
      var li = h("li", { class: c.me ? "is-me" : "" }, h("span", { class: "ap-hn" }, c.name, c.tracked ? h("small", null, " · " + AP("tracked")) : null), h("span", { class: "ap-hb" }, h("i")), h("span", { class: "mono" }, String(c.count)));
      li.querySelector("i").style.setProperty("--v", Math.max(c.count / max * 100, 2) + "%");
      return li;
    }))]);
  }

  function auditCard() {
    var run = state.run; if (!run || !run.audit || !run.audit.checks) return null;
    var chk = run.audit.checks, defs = TW.data.checks || [];
    return card(AP("audit_h"), h("ul", { class: "ap-cks ap-cks-sm" }, defs.map(function (c) {
      var e = chk[c.key] || { status: "manual" }, st = e.status || (e.pass ? "pass" : "fail");
      return h("li", { class: "ap-ck " + (st === "pass" ? "ok" : st === "manual" ? "mn" : "no") }, h("span", { class: "ap-ck-i", "aria-hidden": "true" }, st === "pass" ? "✓" : st === "manual" ? "?" : "!"),
        h("div", null, h("b", null, c.t), h("span", { class: "ap-ck-s" }, AP("st_" + st)), e.note && TW.lang === "en" ? h("p", null, e.note) : null));
    })));
  }

  function settingsCard() {
    var L = state.limits, b = state.business, ok = TW.msg("ap-ok"), err = TW.msg();
    var qs = (state.questions || []).map(function (x) { return { q: x.q, lang: x.lang }; });
    var comps = (b.competitors || []).slice();
    var qbox = h("div"), cbox = h("div");
    function drawQ() {
      TW.mount(qbox, [h("ol", { class: "ap-qlist" }, qs.map(function (x, i) {
        var inp = h("input", { type: "text", value: x.q, maxlength: 200, "aria-label": AP("set_h") + " " + (i + 1), placeholder: AP("q_ph"), dir: x.lang === "ar" ? "rtl" : "ltr", oninput: function () { x.q = inp.value; } });
        var sel = h("select", { "aria-label": AP("lang_en") + " / " + AP("lang_ar"), onchange: function () { x.lang = sel.value; inp.dir = x.lang === "ar" ? "rtl" : "ltr"; } },
          h("option", { value: "ar", selected: x.lang === "ar" }, AP("lang_ar")), h("option", { value: "en", selected: x.lang === "en" }, AP("lang_en")));
        return h("li", null, inp, sel, h("button", { class: "v4-btn v4-btn-line v4-btn-sm", type: "button", onclick: function () { qs.splice(i, 1); drawQ(); } }, AP("remove")));
      })), h("div", { class: "ap-actions" }, h("button", { class: "v4-btn v4-btn-line v4-btn-sm", type: "button", disabled: qs.length >= L.questions, onclick: function () { qs.push({ q: "", lang: TW.lang }); drawQ(); qbox.querySelector("li:last-child input").focus(); } }, AP("q_add")),
        h("span", { class: "ap-meta" }, AP("q_left", { n: qs.length, max: L.questions })))]);
    }
    function drawC() {
      if (!(L.competitors > 0)) { TW.mount(cbox, h("p", { class: "ap-fine" }, AP("c_locked"), " ", h("a", { href: TW.langPath("/plans/") }, AP("upgrade")))); return; }
      TW.mount(cbox, [h("ul", { class: "ap-qlist" }, comps.map(function (c, i) {
        var inp = h("input", { type: "text", value: c, maxlength: 80, placeholder: AP("c_ph"), "aria-label": AP("c_ph") + " " + (i + 1), oninput: function () { comps[i] = inp.value; } });
        return h("li", null, inp, h("button", { class: "v4-btn v4-btn-line v4-btn-sm", type: "button", onclick: function () { comps.splice(i, 1); drawC(); } }, AP("remove")));
      })), h("div", { class: "ap-actions" }, h("button", { class: "v4-btn v4-btn-line v4-btn-sm", type: "button", disabled: comps.length >= L.competitors, onclick: function () { comps.push(""); drawC(); cbox.querySelector("li:last-child input").focus(); } }, AP("c_add")),
        h("span", { class: "ap-meta" }, AP("c_left", { n: comps.length, max: L.competitors })))]);
    }
    drawQ(); drawC();
    var alias = TW.field(AP("alias_l"), { value: b.aliases || "", hint: AP("alias_h"), max: 300, name: "aliases" });
    var btn = h("button", { class: "v4-btn v4-btn-dark", type: "button", onclick: function () {
      err.hide(); ok.hide(); TW.busy(btn, true);
      var body = { questions: qs.filter(function (x) { return x.q.trim().length >= 8; }), aliases: alias.input.value };
      if (L.competitors > 0) body.competitors = comps.map(function (c) { return c.trim(); }).filter(Boolean);
      TW.api("PUT", "/api/client/settings", body).then(function (r) { TW.busy(btn, false); ok.show(AP("saved")); state.business.questions = r.questions; state.business.competitors = r.competitors; state.business.aliases = r.aliases; state.questions = r.questions.length ? r.questions : state.questions; },
        function (e) { TW.busy(btn, false); err.show(TW.errText(e)); });
    } }, C("save"));
    return card(AP("set_h"), [h("p", null, AP("set_t")), qbox, h("h3", null, AP("c_h")), h("p", { class: "ap-fine" }, AP("c_t")), cbox, alias, err, ok, btn]);
  }

  /* v7: the plan Tawsiya is working on, and the before/after numbers */
  function growthCard() {
    var el = h("section", { class: "ap-card tw-growth" }, h("h2", null, AP("g_h")), h("p", { class: "ap-fine" }, "…"));
    TW.api("GET", "/api/client/progress").then(function (g) {
      var kids = [h("h2", null, AP("g_h"))];
      if (!g.latest) {
        var sb = h("button", { class: "v4-btn v4-btn-gold", type: "button", onclick: function () {
          TW.busy(sb, true);
          TW.api("POST", "/api/client/score-request", {}).then(function (r) { location.href = TW.langPath("/report/" + r.request.token + "/"); },
            function (e) { TW.busy(sb, false); if (e.code === "open_request") { sb.hidden = true; } });
        } }, AP("g_start"));
        kids.push(h("p", null, AP("g_none")), sb);
      }
      else {
        var b4 = g.baseline, now = g.latest, d = b4 && b4.id !== now.id ? now.overall - b4.overall : null;
        var t = function (n) { return n >= 70 ? "hi" : n >= 40 ? "mid" : "lo"; };
        kids.push(h("div", { class: "tw-gscore" },
          b4 && b4.id !== now.id ? h("div", { class: "rp-t-" + t(b4.overall) }, h("small", null, AP("g_before")), h("b", null, String(b4.overall))) : null,
          h("div", { class: "rp-t-" + t(now.overall) }, h("small", null, b4 && b4.id !== now.id ? AP("g_now") : AP("g_score")), h("b", null, String(now.overall)), h("small", null, "/100")),
          d != null ? h("span", { class: "rp-delta " + (d > 0 ? "up" : d < 0 ? "down" : "") }, (d > 0 ? "+" : "") + d + " " + AP("g_pts")) : null));
        kids.push(h("div", { class: "ap-actions" }, h("a", { class: "v4-btn v4-btn-dark v4-btn-sm", href: TW.langPath("/report/" + now.token + "/") }, AP("g_report")),
          g.share && b4 && b4.id !== now.id ? h("a", { class: "v4-btn v4-btn-gold v4-btn-sm", href: TW.langPath("/progress/" + g.share + "/") }, AP("g_progress")) : null));
      }
      var groups = [["doing", AP("g_doing")], ["open", AP("g_next")]];
      groups.forEach(function (gr) {
        var list = g.tasks.filter(function (x) { return x.status === gr[0]; });
        if (!list.length) return;
        kids.push(h("h3", null, gr[1]), h("ul", { class: "ap-tasks" }, list.map(function (x) {
          var mine = x.owner === "client", b = null;
          if (mine) b = h("button", { class: "v4-btn v4-btn-line v4-btn-sm", type: "button", onclick: function () { TW.busy(b, true); TW.api("POST", "/api/client/tasks/" + x.id + "/done", {}).then(function () { el.replaceWith(growthCard()); }, function () { TW.busy(b, false); }); } }, AP("g_mark"));
          return h("li", null, h("div", null, h("b", { dir: "auto" }, x.title), mine ? h("span", { class: "ap-chip" }, " " + AP("g_yours")) : null, x.client_note ? h("p", { class: "ap-fine", dir: "auto" }, AP("g_note") + ": " + x.client_note) : null), b);
        })));
      });
      var done = g.tasks.filter(function (x) { return x.status === "done"; });
      if (done.length) kids.push(h("details", { class: "ap-done" }, h("summary", null, AP("g_done") + " (" + done.length + ")"), h("ul", { class: "ap-links" }, done.map(function (x) { return h("li", { dir: "auto" }, "✓ " + x.title); }))));
      TW.mount(el, kids);
    }, function () { TW.mount(el, [h("h2", null, AP("g_h")), h("p", { class: "ap-fine" }, AP("g_none"))]); });
    return el;
  }

  var pollT = null;
  function pollSoon() {
    clearTimeout(pollT);
    pollT = setTimeout(function () {
      TW.api("GET", "/api/client/dashboard").then(function (r) { var was = state.queued; state = r; if (was && !r.queued) render(); else if (r.queued) pollSoon(); }, function () { pollSoon(); });
    }, 8000);
  }

  function render() {
    var b = state.business;
    var head = h("header", { class: "ap-dhead" }, h("div", null, h("p", { class: "v4-kicker" }, D("hello", { name: state.user.name })), h("h1", null, b ? (TW.lang === "ar" ? (b.name_ar || b.name_en) : (b.name_en || b.name_ar)) : D("h1")), b ? statusChip(b.status) : null),
      h("button", { class: "v4-btn v4-btn-line v4-btn-sm", type: "button", onclick: TW.logout }, C("logout")));
    if (!b) { TW.mount(root, [head, h("p", { class: "ap-note" }, D("no_biz")), accountCard()]); return; }
    var ver = h("section", { class: "ap-card", id: "ver-card" });
    TW.mount(root, [head, h("div", { class: "ap-dgrid" },
      h("div", { class: "ap-col" }, growthCard(), runCard(), compCard(), aiCard()),
      h("div", { class: "ap-col" }, planCard(), ver, settingsCard(), auditCard(), factsCard(b), accountCard()))]);
    renderVerified();
    if (state.queued) pollSoon();
  }

  confirmPayment().then(function () { return Promise.all([TW.api("GET", "/api/client/dashboard"), TW.api("GET", "/api/billing").catch(function () { return {}; })]); }).then(function (rr) { state = rr[0]; state.payments = rr[1].payments || []; render(); }, function (e) {
    if (e.status === 401 || e.status === 403) { location.href = TW.home + "signin/"; return; }
    TW.mount(root, h("p", { class: "ap-err" }, TW.errText(e)));
  });
})();
