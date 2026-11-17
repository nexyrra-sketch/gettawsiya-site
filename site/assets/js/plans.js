/* Plans page: choose / renew a plan -> Ziina hosted payment page. Plans are prepaid; nothing renews automatically. */
(function () {
  "use strict";
  var TW = window.TW, err = document.getElementById("plans-err");
  var P = function (k) { return TW.t("plans_ui." + k); };
  function show(t) { err.textContent = t; err.hidden = false; err.scrollIntoView({ block: "nearest" }); }
  function choose(btn, key) {
    err.hidden = true; TW.busy(btn, true); var label = btn.textContent; btn.textContent = P("redirecting");
    TW.api("POST", "/api/billing/checkout", { plan: key }).then(function (r) {
      if (r.url) location.href = r.url; else location.href = TW.langPath(r.redirect || "/dashboard/");
    }, function (e) {
      TW.busy(btn, false); btn.textContent = label;
      if (e.status === 401 || e.status === 403) { location.href = TW.langPath("/signin/?next=plans&plan=" + encodeURIComponent(key) + "#client"); return; }
      show(TW.errText(e));
      if (e.code === "billing_off") { var a = TW.h("a", { class: "v4-btn v4-btn-dark v4-btn-sm", href: TW.contactHref("Tawsiya: " + key), rel: "noopener" }, "WhatsApp"); err.appendChild(document.createTextNode(" ")); err.appendChild(a); }
    });
  }
  var btns = document.querySelectorAll("[data-plan]");
  Array.prototype.forEach.call(btns, function (b) { b.addEventListener("click", function () { choose(b, b.getAttribute("data-plan")); }); });
  // mark the current plan for signed-in clients
  TW.api("GET", "/api/auth/me").then(function (m) { return m.user && m.user.role === "client" ? TW.api("GET", "/api/billing") : null; }).then(function (r) {
    if (!r) return;
    var cur = r.subscription ? r.subscription.plan_key : "free";
    var card = document.querySelector('.ap-plan[data-key="' + cur + '"]');
    if (card) {
      card.insertBefore(TW.h("p", { class: "ap-chip st-verified" }, P("current")), card.firstChild);
      var b = card.querySelector("[data-plan]");
      if (b && r.subscription && r.subscription.source !== "manual") b.textContent = TW.t("plans_ui.renew", { plan: TW.lang === "ar" ? r.plan.name_ar : r.plan.name_en });
      else if (b) b.disabled = true;
      var fl = card.querySelector("a.v4-btn"); if (fl && cur === "free") fl.remove();
    }
    if (r.subscription) Array.prototype.forEach.call(document.querySelectorAll("[data-plan]"), function (bt) {
      var k = bt.getAttribute("data-plan"); if (k === cur) return;
      TW.api("GET", "/api/billing/quote?plan=" + encodeURIComponent(k)).then(function (qt) { if (qt.credit > 0) bt.parentNode.insertBefore(TW.h("p", { class: "ap-fine" }, TW.t("plans_ui.credit", { credit: qt.credit })), bt.nextSibling); }, function () {});
    });
  }, function () {});
  var want = new URLSearchParams(location.search).get("plan");
  if (want) { var b = document.querySelector('[data-plan="' + want.replace(/[^a-z0-9-]/g, "") + '"]'); if (b) choose(b, want); }
})();
