/* Sign in / create account / partner account / forgot and reset password. Mounts into #auth-root. */
(function () {
  "use strict";
  var TW = window.TW, h = TW.h, root = document.getElementById("auth-root");
  if (!root) return;
  var forced = root.getAttribute("data-mode");           // "partner" on the partners page: no tabs
  var qs = new URLSearchParams(location.search), resetToken = qs.get("reset");
  var mode = resetToken ? "reset" : forced || (location.hash === "#client" ? "client" : location.hash === "#partner" ? "partner" : "login");
  var A = function (k, m) { return TW.t("auth." + k, m); };

  function consent() {
    var cb = h("input", { type: "checkbox", id: TW.uid("c"), required: true });
    return { cb: cb, node: h("label", { class: "ap-check" }, cb, h("span", null, A("consent"), " ", h("a", { href: TW.home + "privacy/" }, TW.t("common.privacy")), " · ", h("a", { href: TW.home + "terms/" }, TW.lang === "ar" ? "الشروط" : "Terms"))) };
  }
  function form(onSubmit, fields, label, extra) {
    var err = TW.msg(), btn = h("button", { class: "v4-btn v4-btn-dark v4-btn-block", type: "submit" }, h("span", null, label));
    var f = h("form", { class: "ap-form", novalidate: "" }, fields, err, btn, extra);
    f.addEventListener("submit", function (e) {
      e.preventDefault(); err.hide(); TW.busy(btn, true);
      Promise.resolve().then(function () { return onSubmit(err); }).then(function () { TW.busy(btn, false); }, function (x) { TW.busy(btn, false); err.show(x && x.code ? TW.errText(x) : (x && x.message) || TW.errText()); });
    });
    return f;
  }
  function go(redirect) {
    var qs = new URLSearchParams(location.search), plan = qs.get("plan");
    if (qs.get("next") === "plans" && (redirect || "/dashboard/") === "/dashboard/") { location.href = TW.langPath("/plans/" + (plan && /^[a-z0-9-]{2,30}$/.test(plan) ? "?plan=" + plan : "")); return; }
    location.href = TW.langPath(redirect || "/dashboard/");
  }

  function tabs() {
    if (forced || mode === "reset" || mode === "forgot") return null;
    var items = [["login", A("t_login")], ["client", A("t_client")], ["partner", A("t_partner")]];
    return h("div", { class: "ap-tabs", role: "tablist" }, items.map(function (it) {
      return h("button", { type: "button", role: "tab", "aria-selected": String(mode === it[0]), class: "ap-tab" + (mode === it[0] ? " on" : ""), onclick: function () { mode = it[0]; try { history.replaceState(null, "", "#" + (mode === "login" ? "" : mode)); } catch (e) {} draw(); } }, it[1]);
    }));
  }

  function loginForm() {
    var email = TW.field(A("email"), { type: "email", ac: "email", required: true, dir: "ltr", name: "email" });
    var pw = TW.field(A("password"), { type: "password", ac: "current-password", required: true, name: "password" });
    var forgot = h("p", { class: "ap-fine" }, h("a", { href: "#", onclick: function (e) { e.preventDefault(); mode = "forgot"; draw(); } }, A("forgot")));
    return form(function () {
      return TW.api("POST", "/api/auth/login", { email: email.input.value, password: pw.input.value }).then(function (r) { go(r.redirect); });
    }, [email, pw], A("go_login"), forgot);
  }
  function registerForm(role) {
    var name = TW.field(A("name"), { ac: "name", required: true, name: "name" });
    var email = TW.field(A("email"), { type: "email", ac: "email", required: true, dir: "ltr", name: "email" });
    var phone = TW.field(A("phone"), { type: "tel", ac: "tel", ph: "+971…", dir: "ltr", name: "phone", hint: "(" + TW.t("common.optional") + ")" });
    var pw = TW.field(A("password"), { type: "password", ac: "new-password", required: true, hint: A("pw_hint"), name: "password" });
    var c = consent(), fields = [name, email, phone, pw], extra = {};
    if (role === "client") {
      extra.biz = TW.field(A("business"), { required: true, name: "business" });
      extra.site = TW.field(A("website"), { ph: "yourbusiness.ae", dir: "ltr", required: true, name: "website" });
      extra.cat = TW.field(TW.t("dash.f.category"), { required: true, name: "category", ph: TW.lang === "ar" ? "مثلاً: عيادة أسنان، مقهى" : "e.g. dental clinic, café" });
      extra.area = TW.field(TW.t("dash.f.area"), { name: "area", ph: TW.lang === "ar" ? "مثلاً: القوز" : "e.g. Al Quoz", hint: "(" + TW.t("common.optional") + ")" });
      fields = [name, extra.biz, extra.site, extra.cat, extra.area, email, phone, pw];
    } else {
      extra.company = TW.field(A("company"), { ac: "organization", name: "company", hint: "(" + TW.t("common.optional") + ")" });
      extra.kind = TW.field(A("kind"), { options: TW.t("auth.kinds"), name: "kind" });
      fields = [name, extra.company, extra.kind, email, phone, pw];
    }
    fields.push(c.node);
    return form(function (err) {
      if (!c.cb.checked) throw { code: "consent" };
      var body = { role: role, name: name.input.value, email: email.input.value, phone: phone.input.value, password: pw.input.value, lang: TW.lang, consent: true };
      if (role === "client") { body.business_name = extra.biz.input.value; body.website = extra.site.input.value; body.category = extra.cat.input.value; body.area = extra.area.input.value; }
      else { body.company = extra.company.input.value; body.kind = extra.kind.input.value; }
      return TW.api("POST", "/api/auth/register", body).then(function (r) { go(r.redirect); });
    }, fields, role === "client" ? A("go_client") : A("go_partner"));
  }
  function forgotForm() {
    var email = TW.field(A("email"), { type: "email", ac: "email", required: true, dir: "ltr", name: "email" });
    var ok = TW.msg("ap-ok");
    var f = form(function () {
      return TW.api("POST", "/api/auth/forgot", { email: email.input.value }).then(function () { ok.show(A("forgot_ok")); });
    }, [h("p", null, A("forgot_t")), email], A("forgot_btn"), [ok, h("p", { class: "ap-fine" }, h("a", { href: "#", onclick: function (e) { e.preventDefault(); mode = "login"; draw(); } }, A("back")))]);
    return [h("h2", null, A("forgot_h")), f];
  }
  function resetForm() {
    var pw = TW.field(A("password"), { type: "password", ac: "new-password", required: true, hint: A("pw_hint"), name: "password" });
    var ok = TW.msg("ap-ok");
    var f = form(function () {
      return TW.api("POST", "/api/auth/reset", { token: resetToken, password: pw.input.value }).then(function () { ok.show(A("reset_ok")); setTimeout(function () { location.href = location.pathname; }, 1500); });
    }, [pw], A("reset_btn"), ok);
    return [h("h2", null, A("reset_h")), f];
  }

  function draw() {
    var body = mode === "forgot" ? forgotForm() : mode === "reset" ? resetForm() : mode === "client" ? registerForm("client") : mode === "partner" ? registerForm("partner") : loginForm();
    TW.mount(root, [tabs(), body]);
  }
  // already signed in? offer to continue
  TW.api("GET", "/api/auth/me").then(function (r) {
    if (r.user && mode !== "reset") {
      TW.mount(root, h("div", { class: "ap-stack" }, h("p", null, TW.t("dash.hello", { name: r.user.name })),
        h("a", { class: "v4-btn v4-btn-dark", href: TW.langPath(r.redirect) }, TW.t("common.open")),
        h("button", { class: "v4-btn v4-btn-line", type: "button", onclick: TW.logout }, TW.t("common.logout"))));
    } else draw();
  }, draw);
})();
