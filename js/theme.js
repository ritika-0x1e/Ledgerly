"use strict";
// Loaded in <head> so the page never flashes the wrong colours. Theme: system (follows the phone),
// light (the paper notebook) or dark. The chosen look is put on <html data-theme="light|dark">.
function applyTheme() {
  let t = null;
  try { t = localStorage.getItem("theme"); } catch { /* private mode */ }
  const dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
