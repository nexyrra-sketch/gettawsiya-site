/* Tawsiya admin panel (English). Talks to /api/admin/*; the server checks the admin role on every call. */
(function () {
  "use strict";
  var TW = window.TW, h = TW.h, root = document.getElementById("app-root");
  if (!root) return;
  var ASSISTANTS = ["ChatGPT", "Gemini", "Claude", "Perplexity", "Google AI"];
  var tab = (location.hash || "#overview").slice(1), CHECKS = [];
  var api = function (m, u, b) { return TW.api(m, "/api/admin" + u, b); };
  var E = function (e) { return (e && e.code ? e.code.replace(/_/g, " ") : "error") + (e && e.status ? " (" + e.status + ")" : ""); };
  var iso = function (d) { return d ? String(d).slice(0, 10) : ""; };
  var fmt = function (d) { return d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" }) : ""; };
  var btn = function (label, fn, cls) { var b = h("button", { type: "button", class: "v4-btn v4-btn-sm " + (cls || "v4-btn-line") }, label); b.addEventListener("click", function () { TW.busy(b, true); Promise.resolve(fn(b)).then(function () { TW.busy(b, false); }, function () { TW.busy(b, false); }); }); return b; };
  function note(kind) { var p = TW.msg(kind === "ok" ? "ap-ok" : "ap-err"); return p; }
  function table(cols, rows) {
    if (!rows.length) return h("p", { class: "ap-fine" }, "Nothing here yet.");
    return h("div", { class: "ap-tw" }, h("table", { class: "ap-table" }, h("thead", null, h("tr", null, cols.map(function (c) { return h("th", { scope: "col" }, c[0]); }))),
      h("tbody", null, rows.map(function (r) { return h("tr", null, cols.map(function (c) { return h("td", null, c[1](r)); })); }))));
  }
  function chip(s) { return h("span", { class: "ap-chip st-" + s }, s); }
  function sec(title, kids) { return h("section", { class: "ap-card" }, h("h2", null, title), kids); }
  function lines(v) { return String(v || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean); }
  function csv(v) { return String(v || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean); }
  function F(label, o) { return TW.field(label, o); }

  /* ----------------------------------------------------------- shell */
  var TABS = [["overview", "Overview"], ["requests", "Score requests"], ["businesses", "Businesses"], ["users", "Users"], ["partners", "Partners"], ["leads", "Leads"], ["index", "Index"], ["billing", "Billing"], ["auto", "Automation"]];
  var body = h("div", { class: "ap-admin-body" });
  function shell() {
    TW.mount(root, [h("header", { class: "ap-dhead" }, h("div", null, h("p", { class: "v4-kicker" }, "Admin"), h("h1", null, "Tawsiya admin")), h("button", { class: "v4-btn v4-btn-line v4-btn-sm", type: "button", onclick: TW.logout }, "Sign out")),
      h("nav", { class: "ap-tabs", "aria-label": "Admin" }, TABS.map(function (t) { return h("a", { href: "#" + t[0], class: "ap-tab" + (tab === t[0] ? " on" : ""), "aria-current": tab === t[0] ? "page" : null, onclick: function () { tab = t[0]; setTimeout(go, 0); } }, t[1]); })), body]);
  }
  function go() { shell(); TW.mount(body, h("p", { class: "ap-fine" }, "Loading…")); (VIEWS[tab] || VIEWS.overview)().catch(function (e) { if (e.status === 401 || e.status === 403) { location.href = "/en/signin/"; return; } TW.mount(body, h("p", { class: "ap-err" }, E(e))); }); }
  window.addEventListener("hashchange", function () { var t = (location.hash || "#overview").slice(1); if (t !== tab && VIEWS[t]) { tab = t; go(); } });

  /* ----------------------------------------------------------- overview */
  var VIEWS = {};
  VIEWS.overview = function () {
    return api("GET", "/overview").then(function (o) {
      CHECKS = o.checks;
      var stat = function (n, l, t) { return h("a", { class: "ap-stat", href: "#" + t, onclick: function () { tab = t; setTimeout(go, 0); } }, h("b", null, String(n)), h("span", null, l)); };
      TW.mount(body, [h("div", { class: "ap-stats" }, stat(o.requests_new, "New score requests", "requests"), stat(o.requests_working, "In progress", "requests"), stat(o.businesses_pending, "Businesses to verify", "businesses"),
        stat(o.needs_review, "Facts changed, re-check", "businesses"), stat(o.resets_open, "Password reset requests", "users"), stat(o.leads_new, "New leads", "leads"), stat(o.partners_pending, "Partners to approve", "partners"), stat(o.verified, "Verified businesses", "businesses"), stat(o.users, "Users", "users"),
        stat(o.subscribers, "Paying subscribers", "billing"), stat(o.runs_week, "Automatic checks (7 days)", "auto"), stat(o.jobs_failed, "Failed jobs", "auto"))]);
    });
  };

  /* ----------------------------------------------------------- requests */
  VIEWS.requests = function () {
    return api("GET", "/requests").then(function (r) {
      TW.mount(body, sec("Score requests", table([["#", function (x) { return String(x.id); }], ["Received", function (x) { return fmt(x.created_at); }], ["Site", function (x) { return h("span", { dir: "ltr" }, x.site); }],
        ["Contact", function (x) { return [x.name, " ", h("span", { dir: "ltr" }, x.contact || "")]; }], ["Source", function (x) { return (x.source || "") + (x.ref_code ? " · ref " + x.ref_code : ""); }],
        ["Status", function (x) { return chip(x.status); }], ["Report", function (x) { return x.report_id ? (x.published ? "published · " + x.score + "/15" : "draft") : "–"; }],
        ["", function (x) { return btn("Open", function () { return openRequest(x.id); }, "v4-btn-dark"); }]], r.items)));
    });
  };
  function openRequest(id) {
    return Promise.all([api("GET", "/requests/" + id), api("GET", "/businesses"), CHECKS.length ? Promise.resolve() : api("GET", "/overview").then(function (o) { CHECKS = o.checks; })]).then(function (res) {
      var rq = res[0].request, rep = res[0].report, bizs = res[1].items;
      var msgOk = note("ok"), msgErr = note();
      var bsel = F("Linked business", { options: [["", "– none –"]].concat(bizs.map(function (b) { return [String(b.id), (b.name_en || b.name_ar || b.slug) + " · " + b.website]; })), name: "business" });
      bsel.input.value = String((rep && rep.business_id) || rq.business_id || "");
      var bname = F("Business name shown on the report", { value: (rep && rep.business_name) || "", name: "bname" });
      var day = F("Checked on", { type: "date", value: rep ? iso(rep.checked_on) : new Date().toISOString().slice(0, 10), name: "day" });
      var existing = (rep && rep.checks) || {}, chk = {};
      var checkRows = CHECKS.map(function (c) {
        var cb = h("input", { type: "checkbox", checked: !!(existing[c.key] && existing[c.key].pass) }), nt = h("input", { type: "text", maxlength: 300, placeholder: "note (optional)", value: (existing[c.key] && existing[c.key].note) || "" });
        chk[c.key] = { cb: cb, nt: nt };
        return h("li", { class: "ap-ckrow" }, h("label", null, cb, " ", c.en), nt);
      });
      var total = F("AI answers read (total)", { type: "number", value: rep ? rep.answers_total : 0, name: "total" }), named = F("…of which named the business", { type: "number", value: rep ? rep.answers_named : 0, name: "named" });
      var assSet = (rep && rep.assistants) || [], ass = ASSISTANTS.map(function (a) { return { n: a, cb: h("input", { type: "checkbox", checked: assSet.indexOf(a) > -1 }) }; });
      var qs = (rep && rep.questions) || [], qwrap = h("div", { class: "ap-qs" });
      function qrow(q) {
        var t = h("input", { type: "text", maxlength: 240, placeholder: "Question", value: q.q || "" }), n = h("input", { type: "text", maxlength: 300, placeholder: "Named businesses, comma separated", value: (q.named || []).join(", ") }), y = h("input", { type: "checkbox", checked: !!q.you });
        var row = h("div", { class: "ap-qrow" }, t, n, h("label", null, y, " you were named"), btn("Remove", function () { row.remove(); })); row.get = function () { return { q: t.value, named: csv(n.value), you: y.checked }; }; return row;
      }
      qs.forEach(function (q) { qwrap.appendChild(qrow(q)); }); if (!qs.length) qwrap.appendChild(qrow({}));
      var sen = F("Summary (English)", { textarea: true, rows: 4, max: 3000, value: (rep && rep.summary_en) || "", name: "sen" }), sar = F("Summary (Arabic)", { textarea: true, rows: 4, max: 3000, value: (rep && rep.summary_ar) || "", name: "sar" });
      var pub = h("input", { type: "checkbox", checked: !!(rep && rep.published) });
      var links = h("div", { class: "ap-actions" });
      function showLinks(token) {
        var ar = location.origin + "/score/r/" + token + "/", en = location.origin + "/en/score/r/" + token + "/";
        var text = "Hello " + (rq.name || "") + ", your Tawsiya Score report is ready: " + en + "\nمرحباً " + (rq.name || "") + "، تقرير درجة توصية جاهز: " + ar;
        TW.mount(links, [h("a", { href: en, target: "_blank", rel: "noopener" }, "Open EN"), h("a", { href: ar, target: "_blank", rel: "noopener" }, "Open AR"), btn("Copy message", function (b) { TW.copy(text, b, "Copied"); })]);
      }
      if (rep) showLinks(rep.token);
      var statusSel = F("Status", { options: [["new", "new"], ["working", "working"], ["done", "done"], ["closed", "closed"]], name: "status" }); statusSel.input.value = rq.status;
      var save = btn("Save report", function () {
        msgErr.hide(); msgOk.hide();
        var checks = {}; CHECKS.forEach(function (c) { checks[c.key] = { pass: chk[c.key].cb.checked, note: chk[c.key].nt.value }; });
        return api("POST", "/requests/" + id + "/report", { business_id: bsel.input.value || null, business_name: bname.input.value, checked_on: day.input.value, checks: checks, answers_total: total.input.value, answers_named: named.input.value,
          assistants: ass.filter(function (a) { return a.cb.checked; }).map(function (a) { return a.n; }), questions: Array.prototype.map.call(qwrap.children, function (r) { return r.get(); }), summary_en: sen.input.value, summary_ar: sar.input.value, published: pub.checked })
          .then(function (r) { msgOk.show(pub.checked ? "Saved and published." : "Saved as draft."); showLinks(r.report.token); }, function (e) { msgErr.show(E(e)); });
      }, "v4-btn-dark");
      TW.mount(body, [h("p", null, btn("← All requests", function () { tab = "requests"; go(); })),
        sec("Request #" + rq.id, [h("p", null, h("b", null, "Site: "), h("span", { dir: "ltr" }, rq.site), " · ", h("b", null, "Contact: "), (rq.name || "") + " ", h("span", { dir: "ltr" }, rq.contact || ""), " · ", rq.ref_code ? "ref " + rq.ref_code : "no referrer", " · ", fmt(rq.created_at)),
          h("div", { class: "ap-actions" }, btn("Run automatic check", function () { return api("POST", "/requests/" + id + "/auto", {}).then(function () { msgOk.show("Queued. Refresh in a minute or two."); }, function (e) { msgErr.show(E(e)); }); }),
            rq.run_id ? btn("View run #" + rq.run_id, function () { return openRun(rq.run_id); }) : null),
          h("div", { class: "ap-inline" }, statusSel, btn("Update status", function () { return api("PUT", "/requests/" + id, { status: statusSel.input.value, business_id: bsel.input.value || null }).then(function () { msgOk.show("Status updated."); }, function (e) { msgErr.show(E(e)); }); }))]),
        sec("Report", [h("div", { class: "ap-form ap-form-grid" }, bsel, bname, day), h("h3", null, "The 15 checks"), h("ul", { class: "ap-ckrows" }, checkRows),
          h("h3", null, "What AI said"), h("div", { class: "ap-form ap-form-grid" }, total, named), h("p", null, "Assistants checked: ", ass.map(function (a) { return h("label", { class: "ap-inl" }, a.cb, " " + a.n + " "); })),
          h("h3", null, "Questions asked"), qwrap, btn("Add question", function () { qwrap.appendChild(qrow({})); }), h("div", { class: "ap-form ap-form-grid" }, sen, sar),
          h("label", { class: "ap-check" }, pub, h("span", null, "Published (visible to anyone with the private link)")), msgErr, msgOk, h("div", { class: "ap-actions" }, save), links])]);
    });
  }

  /* ----------------------------------------------------------- businesses */
  var BFIELDS = [["name_en", "Name (English)"], ["name_ar", "Name (Arabic)"], ["slug", "Page slug"], ["owner_email", "Owner account email"], ["website", "Website"], ["instagram", "Instagram"], ["phone", "Phone"], ["whatsapp", "WhatsApp"], ["email", "Public email"], ["category", "Category"], ["city", "City"], ["area", "Area"], ["address", "Address"], ["hours", "Opening hours"], ["languages", "Languages"], ["price_range", "Prices"], ["services", "Services (one per line)"], ["desc_en", "Description (English)"], ["desc_ar", "Description (Arabic)"]];
  var LONGF = { services: 1, desc_en: 1, desc_ar: 1, hours: 1, address: 1 };
  VIEWS.businesses = function () {
    return api("GET", "/businesses").then(function (r) {
      TW.mount(body, [h("p", null, btn("+ New business", function () { return openBusiness(null); }, "v4-btn-dark")), sec("Businesses", table([["Name", function (b) { return b.name_en || b.name_ar || b.slug; }], ["Website", function (b) { return h("span", { dir: "ltr" }, b.website || ""); }],
        ["Owner", function (b) { return b.owner_email || "–"; }], ["Status", function (b) { return [chip(b.status), b.needs_review ? " " : null, b.needs_review ? chip("re-check") : null]; }], ["", function (b) { return btn("Open", function () { return openBusiness(b.id); }, "v4-btn-dark"); }]], r.items))]);
    });
  };
  function openBusiness(id) {
    var req = id ? api("GET", "/businesses/" + id) : Promise.resolve({ business: {}, checks: [], tasks: [], reports: [] });
    return req.then(function (d) {
      var b = d.business, inputs = {}, ok = note("ok"), err = note();
      var fields = BFIELDS.map(function (f) { var fld = F(f[1], { textarea: !!LONGF[f[0]], rows: 3, max: 1200, value: b[f[0]] || "", dir: ["website", "instagram", "phone", "whatsapp", "email", "slug", "owner_email", "name_en", "desc_en"].indexOf(f[0]) > -1 ? "ltr" : undefined, name: f[0] }); inputs[f[0]] = fld.input; return fld; });
      var save = btn(id ? "Save facts" : "Create business", function () {
        err.hide(); ok.hide(); var o = {}; BFIELDS.forEach(function (f) { if (id || f[0] !== "slug") o[f[0]] = inputs[f[0]].value; });
        return (id ? api("PUT", "/businesses/" + id, o) : api("POST", "/businesses", o)).then(function (r) { ok.show("Saved."); if (!id) openBusiness(r.business.id); }, function (e) { err.show(E(e)); });
      }, "v4-btn-dark");
      var kids = [h("p", null, btn("← All businesses", function () { tab = "businesses"; go(); })), sec(id ? "Facts: " + (b.name_en || b.name_ar) : "New business", [h("div", { class: "ap-form ap-form-grid" }, fields), err, ok, h("div", { class: "ap-actions" }, save)])];
      if (id) {
        var vnote = F("Note (internal)", { value: b.verified_note || "", name: "vnote" }), vok = note("ok"), verr = note();
        var act = function (a, label, cls) { return btn(label, function () { vok.hide(); verr.hide(); return api("POST", "/businesses/" + id + "/verify", { action: a, note: vnote.input.value }).then(function () { vok.show("Done."); openBusiness(id); }, function (e) { verr.show(e.code === "incomplete" ? "Needs website, a name, a contact and an area or address first." : E(e)); }); }, cls); };
        kids.push(sec("Verification", [h("p", null, "Status: ", chip(b.status), b.needs_review ? [" ", chip("facts changed, re-check")] : null, b.verified_at ? " · verified " + fmt(b.verified_at) : "", " · ", h("a", { href: "/verified/" + b.slug + "/", target: "_blank", rel: "noopener" }, "view page")),
          h("p", { class: "ap-fine" }, "Before verifying: confirm the person controls the website or phone, and compare the facts with the website, Google profile and socials."), vnote,
          h("div", { class: "ap-actions" }, act("verify", "Verify & publish", "v4-btn-dark"), act("reviewed", "Mark re-checked"), act("pending", "Unpublish (pending)"), act("suspend", "Suspend")), verr, vok]));
        // automation + plan
        var pok = note("ok"), perr = note();
        var psel = F("Plan (paid another way, e.g. bank transfer)", { options: [["free", "Free"], ["track", "Track"], ["grow", "Grow"]], name: "plan" }), puntil = F("Until (optional)", { type: "date", name: "until" });
        kids.push(sec("Automatic checks and plan", [h("div", { class: "ap-actions" }, btn("Run a check now", function () { perr.hide(); return api("POST", "/businesses/" + id + "/run", {}).then(function () { pok.show("Queued. Results show on the client dashboard in a few minutes."); }, function (e) { perr.show(E(e)); }); }, "v4-btn-dark")),
          h("div", { class: "ap-form ap-form-grid" }, psel, puntil), btn("Set plan", function () { perr.hide(); return api("PUT", "/businesses/" + id + "/plan", { plan: psel.input.value, until: puntil.input.value }).then(function () { pok.show("Plan set."); }, function (e) { perr.show(E(e)); }); }),
          h("p", { class: "ap-fine" }, "Ziina payments are applied automatically. Use this only for clients who pay you another way."), perr, pok]));
        // weekly checks
        var wk = F("Week of", { type: "date", value: new Date().toISOString().slice(0, 10), name: "week" }), wt = F("Answers read", { type: "number", value: 50, name: "wt" }), wn = F("Named the business", { type: "number", value: 0, name: "wn" }), wnote = F("Note", { name: "wnote" });
        var wass = ASSISTANTS.map(function (a) { return { n: a, cb: h("input", { type: "checkbox", checked: true }) }; }), wok = note("ok"), werr = note();
        kids.push(sec("Weekly AI checks (shown on the client dashboard)", [table([["Week", function (c) { return iso(c.week_of); }], ["Named", function (c) { return c.answers_named + " / " + c.answers_total; }], ["Assistants", function (c) { return (c.assistants || []).join(", "); }], ["Note", function (c) { return c.note || ""; }],
          ["", function (c) { return btn("Delete", function () { return api("DELETE", "/checks/" + c.id).then(function () { openBusiness(id); }); }); }]], d.checks),
          h("div", { class: "ap-form ap-form-grid" }, wk, wt, wn, wnote), h("p", null, "Assistants: ", wass.map(function (a) { return h("label", { class: "ap-inl" }, a.cb, " " + a.n + " "); })), werr, wok,
          btn("Save weekly check", function () { werr.hide(); return api("POST", "/businesses/" + id + "/checks", { week_of: wk.input.value, answers_total: wt.input.value, answers_named: wn.input.value, note: wnote.input.value, assistants: wass.filter(function (a) { return a.cb.checked; }).map(function (a) { return a.n; }) }).then(function () { openBusiness(id); }, function (e) { werr.show(E(e)); }); }, "v4-btn-dark")]));
        // tasks
        var tt = F("Task for the client", { name: "tt", max: 160 }), tb = F("Details", { name: "tb", max: 600 }), terr = note();
        kids.push(sec("“Needs you” tasks", [table([["Task", function (t) { return t.title; }], ["Status", function (t) { return chip(t.status); }], ["", function (t) { return btn("Delete", function () { return api("DELETE", "/tasks/" + t.id).then(function () { openBusiness(id); }); }); }]], d.tasks),
          h("div", { class: "ap-form ap-form-grid" }, tt, tb), terr, btn("Add task", function () { return api("POST", "/businesses/" + id + "/tasks", { title: tt.input.value, body: tb.input.value }).then(function () { openBusiness(id); }, function (e) { terr.show(E(e)); }); }, "v4-btn-dark")]));
        kids.push(sec("Score reports", table([["Date", function (r) { return iso(r.checked_on); }], ["Score", function (r) { return r.score + "/15"; }], ["Published", function (r) { return r.published ? "yes" : "draft"; }], ["", function (r) { return btn("Open request", function () { return openRequest(r.request_id); }); }]], d.reports)));
      }
      TW.mount(body, kids);
    });
  }

  /* ----------------------------------------------------------- users */
  VIEWS.users = function () {
    return Promise.all([api("GET", "/users"), api("GET", "/resets")]).then(function (res) {
      var out = h("div", { class: "ap-linkout" });
      function link(u) { return api("POST", "/users/" + u + "/reset-link", {}).then(function (r) { var msg = "Hello, here is your one-time Tawsiya password link (valid " + r.expires_hours + " hours): " + r.url; TW.mount(out, sec("One-time reset link", [h("p", { class: "ap-linkbox", dir: "ltr" }, r.url), btn("Copy message", function (b) { TW.copy(msg, b, "Copied"); }), h("a", { class: "v4-btn v4-btn-line v4-btn-sm", href: "https://wa.me/?text=" + encodeURIComponent(msg), target: "_blank", rel: "noopener" }, "Send via WhatsApp")])); }); }
      var resets = res[1].items.filter(function (r) { return !r.handled; });
      TW.mount(body, [out, resets.length ? sec("Password reset requests", table([["Email", function (r) { return r.email; }], ["Requested", function (r) { return fmt(r.created_at); }], ["Phone", function (r) { return r.phone || "–"; }],
        ["", function (r) { return [r.user_id ? btn("Create link", function () { return link(r.user_id); }, "v4-btn-dark") : "no account", " ", btn("Mark handled", function () { return api("POST", "/resets/" + r.id + "/handled", {}).then(go); })]; }]], resets)) : null,
        sec("Users", table([["Name", function (u) { return u.name; }], ["Email", function (u) { return h("span", { dir: "ltr" }, u.email); }], ["Role", function (u) { return u.role; }], ["Businesses", function (u) { return u.businesses || ""; }], ["Joined", function (u) { return fmt(u.created_at); }], ["Last login", function (u) { return fmt(u.last_login); }],
          ["", function (u) { return [btn("Reset link", function () { return link(u.id); }), " ", btn(u.disabled ? "Enable" : "Disable", function () { return api("PUT", "/users/" + u.id, { disabled: !u.disabled }).then(go, function () {}); })]; }]], res[0].items))]);
    });
  };

  /* ----------------------------------------------------------- partners */
  VIEWS.partners = function () {
    return api("GET", "/partners").then(function (r) {
      TW.mount(body, sec("Partners", table([["Partner", function (p) { return [p.name, h("br"), h("small", { dir: "ltr" }, p.email), p.company ? h("br") : null, p.company ? h("small", null, p.company) : null]; }], ["Link", function (p) { return h("span", { dir: "ltr" }, "/r/" + p.code); }], ["Visits", function (p) { return String(p.clicks); }], ["Score requests", function (p) { return String(p.requests); }],
        ["Leads (won)", function (p) { return p.leads + " (" + p.won + ")"; }], ["Sign-ups", function (p) { return String(p.signups); }], ["Status", function (p) { return chip(p.status); }],
        ["", function (p) { return [btn("Approve", function () { return api("PUT", "/partners/" + p.user_id, { status: "approved" }).then(go); }, "v4-btn-dark"), " ", btn("Pause", function () { return api("PUT", "/partners/" + p.user_id, { status: "paused" }).then(go); })]; }]], r.items)));
    });
  };

  /* ----------------------------------------------------------- leads */
  VIEWS.leads = function () {
    return api("GET", "/leads").then(function (r) {
      TW.mount(body, sec("Leads (project wizard and Index notifications)", table([["Date", function (l) { return fmt(l.created_at); }], ["Kind", function (l) { return l.kind + (l.intent ? " · " + l.intent : ""); }], ["Who", function (l) { return [l.name || "", " ", h("span", { dir: "ltr" }, l.contact || "")]; }], ["Site", function (l) { return h("span", { dir: "ltr" }, l.site || ""); }],
        ["Details", function (l) { return Object.keys(l.payload || {}).map(function (k) { return k + ": " + l.payload[k]; }).join(" · "); }], ["Ref", function (l) { return l.ref_code || ""; }],
        ["Status", function (l) { var s = h("select", { "aria-label": "Status" }, ["new", "contacted", "won", "lost"].map(function (x) { return h("option", { value: x, selected: x === l.status }, x); })); s.addEventListener("change", function () { api("PUT", "/leads/" + l.id, { status: s.value }); }); return s; }]], r.items)));
    });
  };

  /* ----------------------------------------------------------- AI Index */
  VIEWS.index = function () {
    return api("GET", "/index").then(function (r) {
      TW.mount(body, [h("p", null, btn("+ New edition", function () { return openEdition(null); }, "v4-btn-dark")), sec("Editions", table([["Title", function (e) { return e.title_en; }], ["Sector", function (e) { return e.sector || ""; }], ["Period", function (e) { return e.period || ""; }], ["Answers", function (e) { return String(e.answers_total); }], ["Status", function (e) { return chip(e.published ? "published" : "draft"); }],
        ["", function (e) { return [btn("Edit", function () { return openEdition(e.id); }, "v4-btn-dark"), " ", e.published ? h("a", { href: "/en/ai-index/" + e.slug + "/", target: "_blank", rel: "noopener" }, "view") : null]; }]], r.items))]);
    });
  };
  function openEdition(id) {
    var req = id ? api("GET", "/index/" + id) : Promise.resolve({ edition: { assistants: ASSISTANTS, prompts: [] }, rows: [] });
    return req.then(function (d) {
      var e = d.edition, ok = note("ok"), err = note();
      var f = {
        title_en: F("Title (English)", { value: e.title_en || "", name: "t1" }), title_ar: F("Title (Arabic)", { value: e.title_ar || "", name: "t2" }), slug: F("Slug", { value: e.slug || "", dir: "ltr", name: "slug" }),
        sector: F("Sector", { value: e.sector || "", name: "sector" }), period: F("Period", { value: e.period || "", ph: "e.g. November 2026", name: "period" }), total: F("Total AI answers read", { type: "number", value: e.answers_total || 0, name: "total" }),
        assistants: F("Assistants (comma separated)", { value: (e.assistants || []).join(", "), name: "ass" }), prompts: F("The exact questions asked (one per line)", { textarea: true, rows: 6, value: (e.prompts || []).join("\n"), name: "prompts" }),
        rows: F("Rows: business | times named | note (one per line, in rank order)", { textarea: true, rows: 10, max: 5000, value: (d.rows || []).map(function (r) { return r.name + " | " + r.named_count + (r.note ? " | " + r.note : ""); }).join("\n"), name: "rows" }),
        nen: F("Notes (English)", { textarea: true, rows: 3, max: 2000, value: e.notes_en || "", name: "nen" }), nar: F("Notes (Arabic)", { textarea: true, rows: 3, max: 2000, value: e.notes_ar || "", name: "nar" })
      };
      var pub = h("input", { type: "checkbox", checked: !!e.published });
      var save = btn("Save edition", function () {
        err.hide(); ok.hide();
        var rows = lines(f.rows.input.value).map(function (l, i) { var p = l.split("|").map(function (x) { return x.trim(); }); return { rank: i + 1, name: p[0], named_count: p[1], note: p[2] || "" }; });
        var o = { title_en: f.title_en.input.value, title_ar: f.title_ar.input.value, slug: f.slug.input.value, sector: f.sector.input.value, period: f.period.input.value, answers_total: f.total.input.value, assistants: csv(f.assistants.input.value), prompts: lines(f.prompts.input.value), rows: rows, notes_en: f.nen.input.value, notes_ar: f.nar.input.value, published: pub.checked };
        return (id ? api("PUT", "/index/" + id, o) : api("POST", "/index", o)).then(function (r) { ok.show("Saved."); if (!id) openEdition(r.id); }, function (x) { err.show(x.code === "rows" ? "A row has more mentions than total answers." : E(x)); });
      }, "v4-btn-dark");
      TW.mount(body, [h("p", null, btn("← All editions", function () { tab = "index"; go(); })), sec(id ? "Edit edition" : "New edition", [h("p", { class: "ap-fine" }, "Only publish an edition built from answers you read yourself. Mark any Tawsiya client in the note column (for example “Tawsiya client”)."),
        h("div", { class: "ap-form ap-form-grid" }, f.title_en, f.title_ar, f.slug, f.sector, f.period, f.total, f.assistants), f.prompts, f.rows, h("div", { class: "ap-form ap-form-grid" }, f.nen, f.nar),
        h("label", { class: "ap-check" }, pub, h("span", null, "Published")), err, ok, h("div", { class: "ap-actions" }, save, id ? btn("Delete", function () { if (!confirm("Delete this edition?")) return; return api("DELETE", "/index/" + id).then(function () { tab = "index"; go(); }); }) : null)])]);
    });
  }


  /* ----------------------------------------------------------- billing */
  var money = function (f) { return (f / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " AED"; };
  VIEWS.billing = function () {
    return Promise.all([api("GET", "/plans"), api("GET", "/subscriptions"), api("GET", "/payments"), api("GET", "/checkouts")]).then(function (res) {
      var plans = res[0].items, subs = res[1], pays = res[2].items, cos = res[3].items;
      TW.mount(body, [h("div", { class: "ap-stats" }, h("div", { class: "ap-stat" }, h("b", null, money(subs.mrr * 100)), h("span", null, "Monthly value of active paid plans")), h("div", { class: "ap-stat" }, h("b", null, money(subs.month * 100)), h("span", null, "Paid this month")),
          h("div", { class: "ap-stat" }, h("b", null, String(subs.items.filter(function (s) { return s.status === "active" || s.status === "trialing"; }).length)), h("span", null, "Active subscriptions"))),
        sec("Plans (what customers see on /plans/)", [table([["Key", function (p) { return p.key; }], ["Name", function (p) { return p.name_en + " · " + p.name_ar; }], ["Price", function (p) { return p.price_fils ? money(p.price_fils) + " / " + p.interval : "Free"; }],
          ["Limits", function (p) { var l = p.limits || {}; return (l.questions || 0) + " questions · " + (l.weekly ? "weekly" : "no weekly") + " · " + (l.competitors || 0) + " competitors · " + (l.manual_runs_per_week || 0) + " extra runs/wk"; }],
          ["Active", function (p) { return p.active ? "yes" : "no"; }], ["", function (p) { return btn("Edit", function () { editPlan(p); }, "v4-btn-dark"); }]], plans),
          btn("+ New plan", function () { editPlan(null); })]),
        sec("Subscriptions", table([["Customer", function (x) { return [x.name, " ", h("span", { dir: "ltr" }, x.email)]; }], ["Plan", function (x) { return x.plan_key; }], ["Status", function (x) { return chip(x.status); }],
          ["Paid until", function (x) { return x.current_period_end ? iso(x.current_period_end) : "no end"; }], ["Source", function (x) { return x.source; }]], subs.items)),
        sec("Checkouts (Ziina payment pages opened)", table([["When", function (x) { return fmt(x.created_at); }], ["Customer", function (x) { return x.email; }], ["Plan", function (x) { return x.plan_key + " · " + x.kind + (x.test ? " · TEST" : ""); }],
          ["Amount", function (x) { return money(x.amount_fils); }], ["Status", function (x) { return chip(x.status); }],
          ["", function (x) { return x.status === "pending" && x.intent_id ? btn("Check with Ziina", function () { return api("POST", "/payments/check/" + encodeURIComponent(x.intent_id), {}).then(go); }) : ""; }]], cos.slice(0, 50))),
        sec("Payments", table([["Date", function (x) { return fmt(x.created_at); }], ["Customer", function (x) { return x.email || "–"; }], ["Amount", function (x) { return money(x.amount_fils); }], ["What", function (x) { return x.description || x.plan_key || ""; }],
          ["Status", function (x) { return chip(x.status); }], ["Ziina ID", function (x) { return h("code", { dir: "ltr" }, x.provider_ref); }]], pays))]);
    });
  };
  function editPlan(p) {
    p = p || { key: "", name_en: "", name_ar: "", price_fils: 0, interval: "month", features_en: [], features_ar: [], limits: { questions: 12, weekly: true, competitors: 3, manual_runs_per_week: 1 }, active: true, sort: 9 };
    var L = p.limits || {}, ok = note("ok"), err = note();
    var f = { key: F("Key (letters, no spaces)", { value: p.key, name: "key", dir: "ltr" }), name_en: F("Name (English)", { value: p.name_en, name: "ne" }), name_ar: F("Name (Arabic)", { value: p.name_ar, name: "na" }),
      blurb_en: F("Short line (English)", { value: p.blurb_en || "", name: "be" }), blurb_ar: F("Short line (Arabic)", { value: p.blurb_ar || "", name: "ba" }),
      price: F("Price in AED (0 = free)", { type: "number", value: p.price_fils / 100, name: "price" }), interval: F("Billing", { options: [["month", "Monthly"], ["year", "Yearly"], ["once", "One-time (service)"]], name: "int" }),
      features_en: F("Features (English, one per line)", { textarea: true, rows: 6, value: (p.features_en || []).join("\n"), name: "fe", max: 2000 }), features_ar: F("Features (Arabic, one per line)", { textarea: true, rows: 6, value: (p.features_ar || []).join("\n"), name: "fa", max: 2000 }),
      q: F("Questions per check", { type: "number", value: L.questions || 4, name: "lq" }), c: F("Competitors tracked", { type: "number", value: L.competitors || 0, name: "lc" }), m: F("Extra on-demand checks per week", { type: "number", value: L.manual_runs_per_week || 0, name: "lm" }),
      sort: F("Order", { type: "number", value: p.sort || 0, name: "sort" }) };
    f.interval.input.value = p.interval;
    var wk = h("input", { type: "checkbox", checked: !!L.weekly }), act = h("input", { type: "checkbox", checked: p.active !== false }), feat = h("input", { type: "checkbox", checked: !!p.featured });
    if (p.key) f.key.input.disabled = true;
    TW.mount(body, [h("p", null, btn("← Billing", function () { tab = "billing"; go(); })), sec(p.key ? "Edit plan: " + p.key : "New plan", [h("div", { class: "ap-form ap-form-grid" }, Object.keys(f).map(function (k) { return f[k]; })),
      h("p", null, h("label", { class: "ap-inl" }, wk, " Weekly automatic checks "), h("label", { class: "ap-inl" }, act, " Shown on the plans page "), h("label", { class: "ap-inl" }, feat, " Highlight as most chosen")),
      h("p", { class: "ap-fine" }, "Price changes apply to the next payment (new plans and renewals)."), err, ok,
      btn("Save plan", function () { err.hide(); return api("PUT", "/plans/" + encodeURIComponent(f.key.input.value.trim().toLowerCase()), { name_en: f.name_en.input.value, name_ar: f.name_ar.input.value, blurb_en: f.blurb_en.input.value, blurb_ar: f.blurb_ar.input.value,
        price: f.price.input.value, interval: f.interval.input.value, features_en: lines(f.features_en.input.value), features_ar: lines(f.features_ar.input.value), active: act.checked, featured: feat.checked, sort: f.sort.input.value,
        limits: { questions: Number(f.q.input.value), weekly: wk.checked, competitors: Number(f.c.input.value), manual_runs_per_week: Number(f.m.input.value) } }).then(function () { ok.show("Saved."); }, function (e) { err.show(E(e)); }); }, "v4-btn-dark")])]);
  }

  /* ----------------------------------------------------------- automation */
  VIEWS.auto = function () {
    return Promise.all([api("GET", "/integrations"), api("GET", "/runs"), api("GET", "/jobs"), api("GET", "/emails")]).then(function (res) {
      var st = res[0], out = h("div");
      var row = function (name, label, on, extra) {
        var o = h("span", { class: "ap-meta" });
        return h("li", null, h("b", null, label), " ", chip(on ? "connected" : "not connected"), extra ? " " + extra : "", " ",
          on ? btn("Test", function () { return api("POST", "/integrations/test", { name: name }).then(function (r) { o.textContent = (r.ok ? "OK: " : "Failed: ") + (r.sample || ""); }, function (e) { o.textContent = E(e); }); }) : null, " ", o);
      };
      TW.mount(body, [sec("Connections", [h("ul", { class: "ap-intlist" }, [row("ziina", "Ziina payments", st.ziina, st.ziina_mode ? "(" + st.ziina_mode + " mode" + (st.ziina_webhook ? "" : ", no webhook secret") + ")" : ""),
          row("email", "Email (Resend)", st.email, "from " + st.mail_from), h("li", null, h("b", null, "Google Places"), " ", chip(st.places ? "connected" : "not connected"))]
          .concat(st.assistants.map(function (a) { return row(a.key, a.label, a.on, "model " + a.model); }))),
        h("p", { class: "ap-fine" }, "Ziina webhook URL: ", h("code", { dir: "ltr" }, st.webhook_url), " ", st.ziina ? btn("Register webhook with Ziina", function () { return api("POST", "/ziina/webhook", {}).then(function (r) { out.textContent = (r.ok ? "OK: " : "Failed: ") + r.sample; }); }) : null),
        h("p", { class: "ap-fine" }, "Worker: " + (st.worker ? "on" : "off") + " · auto-publish free Scores: " + (st.auto_publish ? "on" : "off") + " · free Scores today: " + st.free_scores_today + " of " + st.free_per_day + " · jobs: " + st.jobs.map(function (j) { return j.status + " " + j.n; }).join(", ")),
        btn("Run scheduler now", function () { return api("POST", "/scheduler/run", {}).then(function (r) { out.textContent = r.enqueued + " weekly checks queued."; }); }), out]),
        sec("Recent checks", table([["#", function (r) { return String(r.id); }], ["When", function (r) { return fmt(r.started_at); }], ["Kind", function (r) { return r.kind; }], ["Business", function (r) { return [r.business_name || "", " ", h("span", { dir: "ltr", class: "ap-meta" }, r.site || "")]; }],
          ["Named", function (r) { return r.answers_named + " / " + r.answers_total; }], ["Status", function (r) { return [chip(r.status), r.error ? " " + r.error : ""]; }], ["", function (r) { return btn("Open", function () { return openRun(r.id); }, "v4-btn-dark"); }]], res[1].items)),
        sec("Jobs", table([["#", function (j) { return String(j.id); }], ["Kind", function (j) { return j.kind + " " + JSON.stringify(j.payload); }], ["Status", function (j) { return chip(j.status); }], ["Tries", function (j) { return String(j.attempts); }],
          ["Result", function (j) { return j.last_error || ""; }], ["", function (j) { return j.status === "failed" ? btn("Retry", function () { return api("POST", "/jobs/" + j.id + "/retry", {}).then(go); }) : ""; }]], res[2].items.slice(0, 60))),
        sec("Emails", table([["When", function (m) { return fmt(m.created_at); }], ["To", function (m) { return h("span", { dir: "ltr" }, m.to_addr); }], ["Kind", function (m) { return m.kind; }], ["Status", function (m) { return [chip(m.status), m.error ? " " + m.error : ""]; }]], res[3].items.slice(0, 60)))]);
    });
  };
  function openRun(id) {
    return api("GET", "/runs/" + id).then(function (d) {
      var r = d.run, ch = (r.audit && r.audit.checks) || {};
      TW.mount(body, [h("p", null, btn("← Automation", function () { tab = "auto"; go(); })),
        sec("Check #" + r.id + " · " + (r.business_name || r.site), [h("p", null, r.kind + " · " + fmt(r.started_at) + " · named in " + r.answers_named + " of " + r.answers_total + " answers · " + (r.assistants || []).join(", ")),
          r.error ? h("p", { class: "ap-err" }, r.error) : null, r.audit && r.audit.error ? h("p", { class: "ap-err" }, "Site: " + r.audit.error) : null,
          h("h3", null, "Website checks"), table([["Check", function (k) { return k; }], ["Result", function (k) { return chip(ch[k].status); }], ["Note", function (k) { return ch[k].note; }]], Object.keys(ch)),
          h("h3", null, "Competitors"), h("p", null, (r.competitors || []).map(function (c) { return c.name + " (" + c.count + ")"; }).join(", ") || "–"),
          h("h3", null, "Answers"), table([["Assistant", function (a) { return a.assistant; }], ["Question", function (a) { return a.question; }], ["Named", function (a) { return a.error ? chip("error") : chip(a.named ? "yes" : "no"); }],
            ["Answer", function (a) { return a.error ? a.error : h("details", null, h("summary", null, (a.answer || "").slice(0, 80) + "…"), h("p", { class: "ap-pre", dir: "auto" }, a.answer || ""), h("p", { class: "ap-meta", dir: "ltr" }, (a.sources || []).join("\n"))); }]], d.answers)])]);
    });
  }

  window.TWA = { api: api, btn: btn, table: table, chip: chip, sec: sec, fmt: fmt, iso: iso, E: E, F: F, note: note, VIEWS: VIEWS, TABS: TABS, openRun: openRun,
    setTab: function (t) { tab = t; if (location.hash !== "#" + t) history.replaceState(null, "", "#" + t); go(); }, getTab: function () { return tab; } };
  document.addEventListener("DOMContentLoaded", go);
})();
