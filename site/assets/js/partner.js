/* Partner dashboard: referral link, visits, referrals, terms. */
(function () {
  "use strict";
  var TW = window.TW, h = TW.h, root = document.getElementById("app-root");
  if (!root) return;
  var P = function (k, m) { return TW.t("pdash." + k, m); };
  function card(title, body) { return h("section", { class: "ap-card" }, h("h2", null, title), body); }

  function render(r) {
    var p = r.partner, ref = r.referrals;
    var cp = h("button", { class: "v4-btn v4-btn-line v4-btn-sm", type: "button", onclick: function () { TW.copy(r.link, cp, TW.t("common.copied")); } }, TW.t("common.copy"));
    var wa = h("a", { class: "v4-btn v4-btn-line v4-btn-sm", rel: "noopener", href: "https://wa.me/?text=" + encodeURIComponent(r.link) }, "WhatsApp");
    var stat = function (n, l) { return h("div", { class: "ap-stat" }, h("b", null, String(n)), h("span", null, l)); };
    var table = ref.length ? h("div", { class: "ap-tw" }, h("table", { class: "ap-table" },
      h("thead", null, h("tr", null, [P("col_type"), P("col_what"), P("col_status"), P("col_date")].map(function (x) { return h("th", { scope: "col" }, x); }))),
      h("tbody", null, ref.map(function (x) { return h("tr", null, h("td", null, P("kind." + x.kind)), h("td", { dir: "ltr" }, x.label || "–"), h("td", null, P("st." + x.status)), h("td", null, TW.date(x.created_at))); }))))
      : h("p", null, P("refs_none"));
    var pct = r.commission_pct, terms = r.commission_approved ? P("terms_ok", { pct: pct }) : P("terms_prop", { pct: pct });
    var company = TW.field(P("company"), { value: p.company || "", name: "company" }), phone = TW.field(P("phone"), { type: "tel", dir: "ltr", name: "phone", value: r.phone || "" });
    var ok = TW.msg("ap-ok"), btn = h("button", { class: "v4-btn v4-btn-line", type: "submit" }, TW.t("common.save"));
    var f = h("form", { class: "ap-form", novalidate: "" }, company, phone, ok, btn);
    f.addEventListener("submit", function (e) { e.preventDefault(); TW.busy(btn, true); TW.api("PUT", "/api/partner/profile", { company: company.input.value, phone: phone.input.value, kind: p.kind }).then(function () { TW.busy(btn, false); ok.show(TW.t("common.saved")); }, function () { TW.busy(btn, false); }); });
    TW.mount(root, [
      h("header", { class: "ap-dhead" }, h("div", null, h("p", { class: "v4-kicker" }, P("status." + p.status)), h("h1", null, P("h1"))), h("button", { class: "v4-btn v4-btn-line v4-btn-sm", type: "button", onclick: TW.logout }, TW.t("common.logout"))),
      p.status === "pending" ? h("p", { class: "ap-note" }, P("pending_t")) : null,
      h("div", { class: "ap-dgrid" },
        h("div", { class: "ap-col" },
          card(P("link_h"), [h("p", null, P("link_t")), h("p", { class: "ap-linkbox", dir: "ltr" }, r.link), h("div", { class: "ap-actions" }, cp, wa)]),
          card(P("refs_h"), [h("div", { class: "ap-stats" }, stat(r.clicks, P("stat_clicks")), stat(ref.length, P("stat_refs")), stat(r.won, P("stat_won"))), table])),
        h("div", { class: "ap-col" }, card(P("terms_h"), [h("p", null, terms), h("p", { class: "ap-fine" }, P("rules"))]), card(P("profile_h"), f)))]);
  }
  TW.api("GET", "/api/partner/dashboard").then(render, function (e) {
    if (e.status === 401 || e.status === 403) { location.href = TW.home + "signin/"; return; }
    TW.mount(root, h("p", { class: "ap-err" }, TW.errText(e)));
  });
})();
