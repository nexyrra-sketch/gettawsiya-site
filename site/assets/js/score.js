/* Tawsiya Score page: request form, then a private tracking link that shows when the report is ready. */
(function () {
  "use strict";
  var TW = window.TW, h = TW.h;
  var form = document.getElementById("score-form"), out = document.getElementById("score-result"), card = document.getElementById("score-card");
  if (!form) return;
  var S = function (k, m) { return TW.t("score." + k, m); };
  var biz = document.getElementById("sc-biz"), cat = document.getElementById("sc-cat"), area = document.getElementById("sc-area"), poll = null;
  var site = document.getElementById("sc-site"), nm = document.getElementById("sc-name"), ct = document.getElementById("sc-contact"), cb = document.getElementById("sc-consent"), err = document.getElementById("sc-err");
  var btn = form.querySelector("button[type=submit]");
  var qsp = new URLSearchParams(location.search), token = qsp.get("t");
  if (qsp.get("site") && !token) { site.value = qsp.get("site").slice(0, 200); }

  function fail(code) { err.textContent = TW.t("err." + code) === "err." + code ? TW.errText({ code: "server" }) : TW.t("err." + code); err.hidden = false; }
  function trackUrl(t) { return location.origin + location.pathname + "?t=" + t; }

  function showStatus(t, id) {
    TW.api("GET", "/api/score-requests/" + encodeURIComponent(t)).then(function (r) {
      form.hidden = true; out.hidden = false;
      var waiting = !r.report && (r.status === "new" || r.status === "working");
      var kids = [h("h3", null, waiting && r.auto ? S("auto_h") : S("status_h")), h("p", { class: "ap-lead" }, waiting && r.auto ? S("auto_t") : S("st." + r.status)),
        waiting && r.auto ? h("div", { class: "ap-progress", role: "progressbar", "aria-label": S("auto_h") }, h("i")) : null,
        h("p", { class: "ap-meta", dir: "ltr" }, r.site + " · " + TW.date(r.created_at))];
      if (r.report) kids.push(h("p", null, h("a", { class: "v4-btn v4-btn-gold", href: TW.langPath("/score/r/" + r.report + "/") }, S("open_report"))));
      TW.mount(out, kids);
      clearTimeout(poll);
      if (r.report && id) { location.href = TW.langPath("/score/r/" + r.report + "/"); return; }
      if (waiting && r.auto) poll = setTimeout(function () { showStatus(t, true); }, 5000);
    }, function () { form.hidden = false; out.hidden = true; fail("server"); err.textContent = S("bad_token"); });
  }
  function showDone(r, siteVal) {
    if (r.auto) { try { history.replaceState(null, "", "?t=" + r.token); } catch (e) {} showStatus(r.token, true); card.scrollIntoView({ block: "nearest" }); return; }
    form.hidden = true; out.hidden = false;
    var url = trackUrl(r.token), cp = h("button", { class: "v4-btn v4-btn-line v4-btn-sm", type: "button", onclick: function () { TW.copy(url, cp, TW.t("common.copied")); } }, S("copy_link"));
    TW.mount(out, [h("h3", null, S("ok_h")), h("p", null, S("manual_t")), h("p", { class: "ap-linkbox", dir: "ltr" }, url),
      h("div", { class: "ap-actions" }, cp, h("a", { class: "v4-btn v4-btn-dark v4-btn-sm", rel: "noopener", href: TW.contactHref(S("wa_msg", { site: siteVal, id: r.id })) }, S("wa_btn")))]);
    try { history.replaceState(null, "", "?t=" + r.token); } catch (e) {}
    card.scrollIntoView({ block: "nearest" });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault(); err.hidden = true;
    var s = site.value.trim();
    if (!/[a-z0-9؀-ۿ-]+\.[a-z؀-ۿ]{2,}/i.test(s) && !/^@[\w.]{2,}$/.test(s)) { fail("site"); site.focus(); return; }
    var c = ct.value.trim();
    if (c && !(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c) || /^\+?[\d\s()-]{7,20}$/.test(c))) { fail("contact"); ct.focus(); return; }
    if (!cb.checked) { fail("consent"); cb.focus(); return; }
    TW.busy(btn, true);
    TW.api("POST", "/api/score-requests", { site: s, name: nm.value.trim(), contact: c, biz_name: biz.value.trim(), category: cat.value.trim(), area: area.value.trim(), lang: TW.lang, consent: true, source: "score-page" })
      .then(function (r) { if (r.auto) { location.href = TW.langPath("/report/" + r.token + "/"); return; } TW.busy(btn, false); showDone(r, s); },
        function (x) { TW.busy(btn, false); err.textContent = TW.errText(x); err.hidden = false; if (x.code === "site") fail("site"); if (x.code === "contact") fail("contact"); });
  });
  // signed-in clients: prefill
  TW.api("GET", "/api/auth/me").then(function (r) { if (r.user && r.user.role === "client") { if (!nm.value) nm.value = r.user.name; if (!ct.value) ct.value = r.user.email; } }, function () {});
  if (token) { location.replace(TW.langPath("/report/" + token + "/")); } else if (site.value) setTimeout(function () { ct.focus({ preventScroll: true }); }, 300);
})();
