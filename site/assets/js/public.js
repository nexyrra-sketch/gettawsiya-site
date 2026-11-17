/* Small public helpers: "notify me" form on the Index page, verified-business search. No dependencies on core.js strings. */
(function () {
  "use strict";
  function post(url, body) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw j; return j; }); });
  }
  var lang = document.documentElement.lang === "en" ? "en" : "ar";

  var nf = document.querySelector("[data-notify-form]");
  if (nf) {
    var sect = nf.closest("section"), err = sect.querySelector(".ap-err"), ok = sect.querySelector(".ap-ok"), input = nf.querySelector("input"), btn = nf.querySelector("button");
    nf.addEventListener("submit", function (e) {
      e.preventDefault(); err.hidden = true;
      var v = input.value.trim();
      if (!(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || /^\+?[\d\s()-]{7,20}$/.test(v))) { err.hidden = false; input.focus(); return; }
      btn.disabled = true;
      post("/api/leads", { kind: "notify", contact: v, lang: lang, consent: true, intent: "index" }).then(function () { nf.hidden = true; ok.hidden = false; }, function () { btn.disabled = false; err.hidden = false; });
    });
  }

  var vf = document.getElementById("vfind");
  if (vf) {
    var D = {}; try { D = JSON.parse(document.getElementById("tw-app").textContent); } catch (e) {}
    var res = document.getElementById("vres"), q = document.getElementById("vq");
    vf.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = q.value.trim(); res.textContent = "";
      if (v.length < 2) return;
      fetch("/api/public/verified?q=" + encodeURIComponent(v)).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.items || !j.items.length) { var li = document.createElement("li"); li.textContent = D.none || ""; res.appendChild(li); return; }
        j.items.forEach(function (b) {
          var li = document.createElement("li"), a = document.createElement("a");
          a.href = (D.pre || "/verified/") + b.slug + "/"; a.textContent = (lang === "ar" ? (b.name_ar || b.name_en) : (b.name_en || b.name_ar)) || b.slug;
          li.appendChild(a); li.appendChild(document.createTextNode(" " + [b.category, b.city].filter(Boolean).join(" · "))); res.appendChild(li);
        });
      }, function () {});
    });
  }

  /* home page plan prices follow the live plans (admin can change them) */
  var pp = document.querySelectorAll("[data-plan-price]");
  if (pp.length) fetch("/api/plans", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j || !j.plans) return;
    pp.forEach(function (el) { var p = j.plans.filter(function (x) { return x.key === el.getAttribute("data-plan-price"); })[0]; if (p && p.price > 0) el.textContent = Number(p.price).toLocaleString("en"); });
  }).catch(function () {});
})();
