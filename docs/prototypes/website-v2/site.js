/* ROICIANS TECH website prototype v2 — shared behaviour (non-production).
   No data is read or sent anywhere. */
(function () {
  "use strict";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Header shadow once the page scrolls */
  var header = document.querySelector(".site-header");
  function onScroll() { if (header) header.classList.toggle("scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  /* Mobile menu */
  var menuBtn = document.getElementById("menu-btn");
  var panel = document.getElementById("mobile-panel");
  if (menuBtn && panel) {
    menuBtn.addEventListener("click", function () {
      var open = panel.hidden;
      panel.hidden = !open;
      menuBtn.setAttribute("aria-expanded", String(open));
    });
    panel.addEventListener("click", function (e) {
      if (e.target.closest("a")) { panel.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); }
    });
  }

  /* Log in menu */
  var loginBtn = document.getElementById("login-btn");
  var loginMenu = document.getElementById("login-menu");
  if (loginBtn && loginMenu) {
    loginBtn.addEventListener("click", function () {
      var open = loginMenu.hidden;
      loginMenu.hidden = !open;
      loginBtn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", function (e) {
      if (!loginMenu.hidden && !e.target.closest(".login")) { loginMenu.hidden = true; loginBtn.setAttribute("aria-expanded", "false"); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !loginMenu.hidden) { loginMenu.hidden = true; loginBtn.setAttribute("aria-expanded", "false"); loginBtn.focus(); }
    });
  }

  /* Prototype-only actions: explain instead of pretending */
  var toast = document.createElement("div");
  toast.className = "toast"; toast.setAttribute("role", "status"); toast.setAttribute("aria-live", "polite"); toast.hidden = true;
  document.body.appendChild(toast);
  var toastTimer;
  function showToast(msg) {
    toast.textContent = msg; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.hidden = true; }, 4200);
  }
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-proto]");
    if (!el) return;
    e.preventDefault();
    showToast(el.getAttribute("data-proto"));
  });

  /* Hero slider: arrows, indicators, keyboard, swipe. No autoplay. */
  var slider = document.querySelector("[data-slider]");
  if (slider) {
    var slides = Array.prototype.slice.call(slider.querySelectorAll(".slide"));
    var dots = Array.prototype.slice.call(slider.querySelectorAll(".dot"));
    var prev = slider.querySelector("[data-prev]");
    var next = slider.querySelector("[data-next]");
    var counter = slider.querySelector(".counter");
    var live = slider.querySelector("[data-live]");
    var current = 0;
    function go(i, announce) {
      current = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) {
        var on = k === current;
        s.classList.toggle("is-active", on);
        s.setAttribute("aria-hidden", String(!on));
        s.querySelectorAll("a, button").forEach(function (f) { f.tabIndex = on ? 0 : -1; });
      });
      dots.forEach(function (d, k) { d.setAttribute("aria-current", String(k === current)); });
      if (counter) counter.textContent = String(current + 1).padStart(2, "0") + " / " + String(slides.length).padStart(2, "0");
      if (announce && live) live.textContent = "Slide " + (current + 1) + " of " + slides.length + ": " + slides[current].getAttribute("aria-label");
    }
    if (prev) prev.addEventListener("click", function () { go(current - 1, true); });
    if (next) next.addEventListener("click", function () { go(current + 1, true); });
    dots.forEach(function (d, k) { d.addEventListener("click", function () { go(k, true); }); });
    slider.addEventListener("keydown", function (e) {
      if (e.target.closest("input, textarea")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(current + 1, true); }
      if (e.key === "ArrowLeft") { e.preventDefault(); go(current - 1, true); }
    });
    var startX = null, startY = null;
    slider.addEventListener("touchstart", function (e) { startX = e.touches[0].clientX; startY = e.touches[0].clientY; }, { passive: true });
    slider.addEventListener("touchend", function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX, dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) go(current + (dx < 0 ? 1 : -1), true);
      startX = null;
    }, { passive: true });
    go(0, false);
  }

  /* Featured Programs carousel: native scroll-snap + arrow buttons */
  document.querySelectorAll("[data-carousel]").forEach(function (car) {
    var track = car.querySelector(".track");
    var prevB = car.querySelector("[data-car-prev]");
    var nextB = car.querySelector("[data-car-next]");
    function step() { var first = track.firstElementChild; return first ? first.getBoundingClientRect().width + 24 : 300; }
    function update() {
      var max = track.scrollWidth - track.clientWidth - 2;
      if (prevB) prevB.disabled = track.scrollLeft <= 2;
      if (nextB) nextB.disabled = track.scrollLeft >= max;
    }
    if (prevB) prevB.addEventListener("click", function () { track.scrollBy({ left: -step(), behavior: reduceMotion ? "auto" : "smooth" }); });
    if (nextB) nextB.addEventListener("click", function () { track.scrollBy({ left: step(), behavior: reduceMotion ? "auto" : "smooth" }); });
    track.addEventListener("scroll", function () { window.requestAnimationFrame(update); }, { passive: true });
    window.addEventListener("resize", update);
    update();
  });

  /* Programs page: group filter */
  var filters = Array.prototype.slice.call(document.querySelectorAll("[data-filter]"));
  if (filters.length) {
    var groups = Array.prototype.slice.call(document.querySelectorAll("[data-group]"));
    function apply(f) {
      filters.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-filter") === f)); });
      groups.forEach(function (g) { g.hidden = !(f === "all" || g.getAttribute("data-group") === f); });
      var status = document.getElementById("filter-status");
      if (status) {
        var n = 0; groups.forEach(function (g) { if (!g.hidden) n += g.querySelectorAll(".pcard").length; });
        status.textContent = "Showing " + n + " programs";
      }
    }
    filters.forEach(function (b) { b.addEventListener("click", function () { apply(b.getAttribute("data-filter")); }); });
    function fromHash() {
      var h = (location.hash || "").replace("#", "");
      apply(h === "career" || h === "specialist" ? h : "all");
    }
    window.addEventListener("hashchange", fromHash);
    fromHash();
  }

  /* Final enquiry CTA: never simulates a submission */
  var enquire = document.getElementById("enquire-btn");
  var enquireNote = document.getElementById("enquire-note");
  if (enquire && enquireNote) {
    enquire.addEventListener("click", function (e) {
      e.preventDefault();
      enquireNote.hidden = false;
      enquireNote.focus();
    });
  }
})();
