/* Home page: plan prices follow the live plans, so a price changed in the admin panel shows here too. */
(function () {
  "use strict";
  var pp = document.querySelectorAll("[data-plan-price]");
  if (!pp.length || !window.fetch) return;
  fetch("/api/plans", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j || !j.plans) return;
    Array.prototype.forEach.call(pp, function (el) {
      var p = j.plans.filter(function (x) { return x.key === el.getAttribute("data-plan-price"); })[0];
      if (p && p.price > 0) el.textContent = Number(p.price).toLocaleString("en");
    });
  }).catch(function () {});
})();

/* Sector tabs: click or arrow keys switch the example; it also rotates slowly until the visitor picks one. */
(function () {
  "use strict";
  var box = document.querySelector("[data-sx]");
  if (!box) return;
  var tabs = Array.prototype.slice.call(box.querySelectorAll(".sx-tab")), panels = Array.prototype.slice.call(box.querySelectorAll(".sx-panel"));
  var cur = 0, timer = null, still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function show(i, focus) {
    cur = (i + tabs.length) % tabs.length;
    tabs.forEach(function (t, k) { var on = k === cur; t.classList.toggle("on", on); t.setAttribute("aria-selected", on ? "true" : "false"); t.tabIndex = on ? 0 : -1; });
    panels.forEach(function (p, k) { p.classList.toggle("on", k === cur); });
    if (focus) tabs[cur].focus();
  }
  function stop() { clearInterval(timer); timer = null; box.classList.add("held"); }
  tabs.forEach(function (t, k) {
    t.addEventListener("click", function () { stop(); show(k); });
    t.addEventListener("keydown", function (e) {
      var rtl = document.documentElement.dir === "rtl", next = rtl ? "ArrowLeft" : "ArrowRight", prev = rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === next || e.key === "ArrowDown") { e.preventDefault(); stop(); show(cur + 1, true); }
      else if (e.key === prev || e.key === "ArrowUp") { e.preventDefault(); stop(); show(cur - 1, true); }
      else if (e.key === "Home") { e.preventDefault(); stop(); show(0, true); }
      else if (e.key === "End") { e.preventDefault(); stop(); show(tabs.length - 1, true); }
    });
  });
  box.addEventListener("pointerenter", stop, { once: true });
  box.addEventListener("focusin", stop, { once: true });
  if (still || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (e.isIntersecting && !timer && !box.classList.contains("held")) timer = setInterval(function () { show(cur + 1); }, 6500);
      else if (!e.isIntersecting && timer) { clearInterval(timer); timer = null; }
    });
  }, { threshold: 0.4 }).observe(box);
})();
