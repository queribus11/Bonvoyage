// ============================================================
//  Thème clair / sombre : suit le téléphone (auto), ou choix manuel
// ============================================================
(function () {
  const KEY = "bv_theme";
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : { matches: false, addEventListener() {} };
  function pref() { try { return localStorage.getItem(KEY) || "auto"; } catch { return "auto"; } }
  function isDark() { const p = pref(); return p === "dark" || (p === "auto" && mq.matches); }
  function apply() {
    document.documentElement.classList.toggle("is-dark", isDark());
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = isDark() ? "#1B2430" : "#123F66";
    document.dispatchEvent(new CustomEvent("themechange", { detail: { dark: isDark() } }));
  }
  function set(p) { try { localStorage.setItem(KEY, p); } catch { } apply(); }
  function cycle() { const order = ["auto", "light", "dark"]; const n = order[(order.indexOf(pref()) + 1) % 3]; set(n); return n; }
  mq.addEventListener && mq.addEventListener("change", apply);
  apply();
  window.THEME = { pref, isDark, set, cycle, apply };
})();
