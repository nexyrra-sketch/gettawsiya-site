/* Tawsiya app helpers: DOM builder, API client, strings. Used by the account, dashboard, score and admin pages. */
(function () {
  "use strict";
  var data = {};
  try { data = JSON.parse(document.getElementById("tw-app").textContent); } catch (e) {}
  var TW = window.TW = { data: data, ui: data.ui || {}, lang: data.lang || "en", home: data.home || "/" };

  /* h("div", {class:"x", onclick:fn, "aria-label":"y"}, child, [children], "text") — text is always a text node, never HTML */
  TW.h = function (tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") el.className = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked" || k === "disabled" || k === "hidden" || k === "required" || k === "selected") { if (v) el[k] = true; }
      else el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  };
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  TW.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  TW.mount = function (el, node) { TW.clear(el); add(el, node); };
  TW.t = function (path, map) {
    var v = path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, TW.ui);
    if (typeof v !== "string") return v == null ? path : v;
    return map ? v.replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : ""; }) : v;
  };
  TW.api = function (method, url, body) {
    return fetch(url, { method: method, headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw { status: r.status, code: j.error || "server" };
          return j;
        });
      }, function () { throw { status: 0, code: "network" }; });
  };
  TW.errText = function (e) { var m = TW.ui.err || {}; return (e && m[e.code]) || m.server || "Error"; };
  TW.date = function (d) {
    try { return new Date(d).toLocaleDateString(TW.lang === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }); } catch (e) { return ""; }
  };
  TW.contactHref = function (text) {
    var wa = String(data.wa || "").replace(/\D/g, "");
    return wa ? "https://wa.me/" + wa + "?text=" + encodeURIComponent(text) : "mailto:" + (data.email || "") + "?subject=Tawsiya&body=" + encodeURIComponent(text);
  };
  var uid = 0; TW.uid = function (p) { return (p || "f") + "-" + (++uid); };

  /* form pieces */
  TW.field = function (label, opts) {
    opts = opts || {}; var id = TW.uid("fld");
    var input = opts.textarea ? TW.h("textarea", { id: id, rows: opts.rows || 3, maxlength: opts.max || 700, placeholder: opts.ph, name: opts.name })
      : opts.options ? TW.h("select", { id: id, name: opts.name }, opts.options.map(function (o) { return TW.h("option", { value: o[0] }, o[1]); }))
      : TW.h("input", { id: id, type: opts.type || "text", name: opts.name, autocomplete: opts.ac, placeholder: opts.ph, maxlength: opts.max || 200, required: !!opts.required, dir: opts.dir, inputmode: opts.inputmode });
    if (opts.value != null) input.value = opts.value;
    var wrap = TW.h("div", { class: "ap-field" }, TW.h("label", { for: id }, label, opts.hint ? TW.h("small", null, " " + opts.hint) : null), input);
    wrap.input = input; return wrap;
  };
  TW.msg = function (cls) { var p = TW.h("p", { class: cls || "ap-err", role: cls === "ap-ok" ? "status" : "alert", hidden: true }); p.show = function (t) { p.textContent = t; p.hidden = false; }; p.hide = function () { p.hidden = true; }; return p; };
  TW.busy = function (btn, on) { btn.disabled = !!on; btn.classList.toggle("is-busy", !!on); };
  TW.copy = function (text, btn, done) {
    var ok = function () { if (btn) { var o = btn.textContent; btn.textContent = done; setTimeout(function () { btn.textContent = o; }, 1500); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, ok); else ok();
  };
  TW.langPath = function (p) { return (TW.lang === "en" && p.indexOf("/admin") !== 0 ? "/en" : "") + p; };
  TW.logout = function () { return TW.api("POST", "/api/auth/logout", {}).then(function () { location.href = TW.home + "signin/"; }); };
})();
