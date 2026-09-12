// ============================================================
//  Thème clair / sombre : suit le téléphone (auto), ou choix manuel
//  + les couleurs des journées, définies ICI et nulle part ailleurs
// ============================================================

// Les couleurs des journées, dans l'ordre : Jour 1 prend le soleil, Jour 2 l'azur…
// Ce fichier est le premier chargé par index.html comme par share.html : js/map.js et
// js/common.js lisent cette liste, ils n'en gardent pas de copie. Deux listes qui
// doivent rester d'accord finissent toujours par diverger.
// La mandarine #F97316 est réservée à Valdo : elle n'apparaît pas dans la série (#54).
window.BV_DAY_COLORS = ["#F5B301", "#0D8FE0", "#7CB518", "#3AA0F5", "#9ACD1E", "#E05A8A", "#8B5CF6"];
//                        soleil     azur       vert      sky      vert clair   rose      violet

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
