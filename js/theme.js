"use strict";
// Loaded in <head> so the page never flashes the wrong colours. Two looks: light (the paper
// notebook) and dark. Before you pick one, the app starts in the phone's own setting; after that
// it keeps your choice. The look is put on <html data-theme="light|dark">.
function themeName() {
  let t = null;
  try { t = localStorage.getItem("theme"); } catch { /* private mode */ }
  return t === "light" || t === "dark" ? t : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme() {
  const t = themeName();
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
}
applyTheme();
