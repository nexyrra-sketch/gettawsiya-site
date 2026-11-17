/* Tawsiya admin, v9: "Today" home (how the business is doing, what to do next, launch checklist)
   and live counters in the sidebar. */
(function () {
  "use strict";
  var TW = window.TW, h = TW.h, A = window.TWA;
  if (!A) return;
  var api = A.api, btn = A.btn, sec = A.sec, fmt = A.fmt, E = A.E;
  var body = function () { return document.querySelector(".ap-admin-body"); };
  var ORIGIN = location.origin;
  var cache = null, cacheAt = 0;

  A.TABS.unshift(["today", "Today"]);

  function aed(n) { return "AED " + Math.round(Number(n) || 0).toLocaleString("en"); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function reportUrl(token, lang) { return ORIGIN + (lang === "en" ? "/en" : "") + "/report/" + token + "/"; }
  function phoneOf(c) { var d = String(c || "").replace(/[^\d]/g, ""); if (/^0\d{8,9}$/.test(d)) d = "971" + d.slice(1); return /@/.test(c || "") || d.length < 9 ? "" : d; }
  function wa(contact, text) { return "https://wa.me/" + phoneOf(contact) + "?text=" + encodeURIComponent(text); }
  function mail(to, subject, text) { return "mailto:" + encodeURIComponent(to || "") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(text); }
  function link(label, href, cls) { return h("a", { class: "v4-btn v4-btn-sm " + (cls || "v4-btn-line"), href: href, target: "_blank", rel: "noopener" }, label); }
  function goTab(t) { return function (e) { if (e) e.preventDefault(); A.setTab(t); window.scrollTo(0, 0); }; }
  function ago(d) {
    var s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  }
  function inDays(d) { var n = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000); return n <= 0 ? "today" : n === 1 ? "tomorrow" : "in " + n + " days"; }
  function hello() {
    var hr = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Dubai" }));
    return hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  }
  function change(p) {
    if (p == null) return null;
    return h("small", { class: "adm-delta " + (p > 0 ? "up" : p < 0 ? "down" : "") }, (p > 0 ? "▲ " : p < 0 ? "▼ " : "") + Math.abs(p) + "% vs last week");
  }
  function kpi(label, value, sub, tab, extra) {
    return h("a", { class: "adm-kpi", href: "#" + tab, onclick: goTab(tab) }, h("span", { class: "adm-kpi-l" }, label), h("b", null, value), sub ? h("small", null, sub) : null, extra || null);
  }
  function score(n) {
    if (n == null) return h("span", { class: "ap-meta" }, "no score yet");
    return h("span", { class: "tw-score rp-t-" + (n >= 70 ? "hi" : n >= 40 ? "mid" : "lo") }, h("b", null, String(n)));
  }

  /* the sidebar counters, refreshed at most once a minute */
  function load(force) {
    if (!force && cache && Date.now() - cacheAt < 60000) return Promise.resolve(cache);
    return api("GET", "/today").then(function (d) { cache = d; cacheAt = Date.now(); badges(d); return d; });
  }
  function badges(d) {
    var n = { scans: 0, clients: 0, billing: 0, auto: 0, users: 0, partners: 0, businesses: 0, today: 0 };
    (d.todo || []).forEach(function (t) {
      var k = t.tab; if (n[k] != null) n[k] += t.n;
    });
    n.today = (d.todo || []).reduce(function (a, t) { return a + t.n; }, 0);
    Object.keys(n).forEach(function (k) {
      document.querySelectorAll('[data-count="' + k + '"]').forEach(function (el) {
        el.textContent = n[k] ? String(n[k]) : ""; el.classList.toggle("on", !!n[k]);
        el.setAttribute("aria-label", n[k] ? n[k] + " to do" : "");
      });
    });
  }
  A.onNav = function () { if (cache) badges(cache); load(false).catch(function () {}); };

  /* ------------------------------------------------------------ Today */
  A.VIEWS.today = function () {
    return load(true).then(function (d) {
      var k = d.kpi;
      var today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dubai" });

      /* quick scan */
      var site = h("input", { type: "text", name: "site", placeholder: "Paste a business website, e.g. clinic.ae", dir: "ltr", "aria-label": "Website to scan", autocomplete: "off" });
      var lang = h("select", { "aria-label": "Report language" }, h("option", { value: "ar" }, "Arabic report"), h("option", { value: "en" }, "English report"));
      var qout = h("p", { class: "ap-fine", role: "status" });
      var qf = h("form", { class: "adm-quick", novalidate: true }, site, lang, h("button", { class: "v4-btn v4-btn-gold v4-btn-sm", type: "submit" }, "Scan"));
      qf.addEventListener("submit", function (e) {
        e.preventDefault();
        var v = site.value.trim(); if (!v) { qout.textContent = "Paste a website first."; site.focus(); return; }
        qout.textContent = "Starting…";
        api("POST", "/scans", { site: v, lang: lang.value }).then(function (x) {
          TW.clear(qout); qout.appendChild(document.createTextNode("Scanning now (1 to 3 minutes). "));
          qout.appendChild(link("Watch it live", reportUrl(x.token, lang.value), "v4-btn-dark")); qout.appendChild(document.createTextNode(" "));
          qout.appendChild(h("a", { href: "#scans", onclick: goTab("scans") }, "All scans"));
          site.value = "";
        }, function (er) { qout.textContent = er && er.code === "site" ? "That does not look like a website address." : E(er); });
      });

      var hero = h("section", { class: "adm-hero" },
        h("div", null, h("p", { class: "adm-date" }, today), h("h2", null, hello() + ", Hassan"),
          h("p", { class: "adm-lead" }, d.todo.length ? plural(d.todo.reduce(function (a, t) { return a + t.n; }, 0), "thing needs you today.", "things need you today.") : "Nothing urgent. A good day to scan new businesses and post.")),
        h("div", { class: "adm-quickwrap" }, h("p", { class: "adm-glabel" }, "Scan a business"), qf, qout));

      var kpis = h("div", { class: "adm-kpis" },
        kpi("Money this month", aed(k.money_month), plural(k.payments_month, "payment", "payments"), "money"),
        kpi("Monthly plans", aed(k.mrr), plural(k.clients, "paying client", "paying clients"), "billing"),
        kpi("Visitors, 7 days", String(k.visitors_7d), null, "traffic", change(k.visitors_change)),
        kpi("Free reports, 7 days", String(k.reports_7d), null, "scans", change(k.reports_change)),
        kpi("Open leads", String(k.open_leads), "left a contact, not a client yet", "scans"));

      /* what to do next */
      var ICON = { money: "$", do: "→", fix: "!" };
      var todo = sec("Do next", d.todo.length ? h("ul", { class: "adm-todo" }, d.todo.map(function (t) {
        return h("li", { class: "lv-" + t.level }, h("span", { class: "adm-todo-n", "aria-hidden": "true" }, ICON[t.level] || "→"),
          h("div", null, h("b", null, t.n + " " + t.text), t.hint ? h("p", { class: "ap-fine" }, t.hint) : null),
          h("a", { class: "v4-btn v4-btn-sm v4-btn-line", href: "#" + t.tab, onclick: goTab(t.tab), "aria-label": "Open: " + t.text }, "Open"));
      })) : h("div", { class: "adm-clear" }, h("b", null, "All clear."), h("p", { class: "ap-fine" }, "No leads waiting, no failed scans, no payments to chase. Scan five businesses you would like as clients and send them their report.")));

      /* people to message */
      var people = [];
      d.abandoned.forEach(function (c) {
        var txt = "Hi " + (c.name || "") + ", this is Hassan from Tawsiya. I saw you started the " + c.plan_key + " plan but the payment did not go through. Can I help with anything?";
        people.push(h("li", { class: "adm-person" }, h("div", null, h("b", null, c.name || c.email), h("small", { class: "ap-meta" }, "opened the " + c.plan_key + " payment (" + aed(c.amount_fils / 100) + ") " + ago(c.created_at) + ", not paid")),
          h("div", { class: "tw-acts" }, c.phone ? link("WhatsApp", wa(c.phone, txt), "v4-btn-dark") : null, link("Email", mail(c.email, "Your Tawsiya plan", txt)))));
      });
      d.expiring.forEach(function (s) {
        var txt = "Hi " + (s.name || "") + ", Hassan from Tawsiya. Your " + s.plan_key + " plan ends " + inDays(s.current_period_end) + ". Want to continue for another month? I can send the payment link.";
        people.push(h("li", { class: "adm-person" }, h("div", null, h("b", null, s.business || s.name || s.email), h("small", { class: "ap-meta" }, s.plan_key + " plan ends " + inDays(s.current_period_end))),
          h("div", { class: "tw-acts" }, s.phone ? link("WhatsApp", wa(s.phone, txt), "v4-btn-dark") : null, link("Email", mail(s.email, "Your Tawsiya plan", txt)))));
      });
      d.followups.forEach(function (x) {
        var url = reportUrl(x.token, x.lang), name = x.business_name || x.site;
        var txt = x.lang === "en"
          ? "Hi, this is Hassan from Tawsiya. We checked what AI assistants say about " + name + ". " + (x.overall == null ? "Your report is ready" : "Your score is " + x.overall + "/100") + ": " + url
          : "مرحباً، معك حسان من توصية. فحصنا ماذا تقول مساعدات الذكاء الاصطناعي عن " + name + ". " + (x.overall == null ? "تقريركم جاهز" : "درجتكم " + x.overall + "/100") + ": " + url;
        var mark = x.lead_status === "new" ? btn("Mark messaged", function () { return api("PUT", "/scans/" + x.id, { lead_status: "contacted" }).then(function () { return A.VIEWS.today(); }); }) : h("span", { class: "ap-chip st-" + x.lead_status }, x.lead_status);
        people.push(h("li", { class: "adm-person" }, h("div", { class: "adm-person-l" }, score(x.overall), h("div", null, h("b", { dir: "auto" }, name), h("small", { class: "ap-meta" }, h("span", { dir: "ltr" }, x.contact), " · " + ago(x.created_at)))),
          h("div", { class: "tw-acts" }, /@/.test(x.contact) ? link("Email", mail(x.contact, "Your Tawsiya report", txt), "v4-btn-dark") : link("WhatsApp", wa(x.contact, txt), "v4-btn-dark"), link("Report", url), mark)));
      });
      var msgs = sec("People to message", people.length ? [h("ul", { class: "adm-people" }, people), h("p", { class: "ap-fine" }, h("a", { href: "#scans", onclick: goTab("scans") }, "See all scans and leads →"))]
        : h("p", { class: "ap-fine" }, "When someone gets a free report and leaves a WhatsApp number or email, they show here with a ready-made message."));

      /* launch checklist */
      var must = d.setup.filter(function (s) { return !s.optional; }), done = must.filter(function (s) { return s.done; }).length;
      var check = sec("Launch checklist", [
        h("div", { class: "adm-prog" }, h("div", { class: "adm-prog-t" }, h("b", null, done + " of " + must.length), h("span", null, done === must.length ? " ready to take money" : " done")),
          h("div", { class: "ap-meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(must.length), "aria-valuenow": String(done) }, h("i", { style: "--v:" + Math.round(done / must.length * 100) + "%" }))),
        h("ul", { class: "adm-check" }, d.setup.map(function (s) {
          return h("li", { class: s.done ? "ok" : "no" }, h("span", { class: "adm-ci", "aria-hidden": "true" }, s.done ? "✓" : ""),
            h("div", null, h("b", null, s.label, s.optional && !s.done ? h("small", { class: "ap-meta" }, " optional") : null), !s.done && s.hint ? h("p", { class: "ap-fine" }, s.hint) : null),
            !s.done ? h("a", { href: "#" + s.tab, onclick: goTab(s.tab), class: "adm-go", "aria-label": "Go: " + s.label }, "Go") : null);
        }))]);

      var pays = sec("Latest payments", d.recent_payments.length ? h("ul", { class: "adm-pays" }, d.recent_payments.map(function (p) {
        return h("li", null, h("div", null, h("b", null, p.name || p.email || "Customer"), h("small", { class: "ap-meta" }, (p.plan_key || p.description || "") + " · " + fmt(p.created_at))), h("b", { class: "adm-amt" }, aed(p.amount_fils / 100)));
      })) : h("p", { class: "ap-fine" }, "No payments yet. Your first one will show here, and you also get an email."));

      TW.mount(body(), h("div", { class: "adm-today" }, hero, kpis,
        h("div", { class: "adm-cols" }, h("div", { class: "adm-col" }, todo, msgs), h("div", { class: "adm-col" }, check, pays))));
    });
  };
})();
