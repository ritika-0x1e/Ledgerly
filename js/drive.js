"use strict";

// Google Drive backup: one text file per month ("Oct 2026.txt", in the notebook format, so it can
// be imported back) in a Drive folder called "Ledgerly".
//
// Sign-in goes through your Cloudflare Worker (worker/), which keeps Google's long-lived token so
// you sign in once. The Worker hands this phone a "device key"; with it the app asks the Worker for
// a 1-hour Drive token whenever it backs up. Your expenses go straight from the phone to Drive;
// they never pass through the Worker. The app can only see the files it made (drive.file).
//
// When: on opening the app (if the last backup is over a day old), on leaving the app, and from
// the menu. Only months changed since their last upload are sent, older months included.

const drive = (() => {
  const FOLDER = "Ledgerly";
  const K = { key: "driveKey", folder: "driveFolder", files: "driveFiles", synced: "driveSynced", last: "driveLast", error: "driveError" };
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage full */ } };
  const worker = () => String((typeof CONFIG !== "undefined" && CONFIG.workerUrl) || "").replace(/\/+$/, "");
  let token = null, tokenUntil = 0, running = null;

  const configured = () => !!worker();
  const connected = () => configured() && !!get(K.key);

  function connect() {
    location.href = `${worker()}/auth/start`;
  }
  // After signing in the Worker sends you back with "#drive=<device key>" (or "#drive-error=...").
  function takeKeyFromUrl() {
    const h = new URLSearchParams(location.hash.slice(1));
    const key = h.get("drive"), err = h.get("drive-error");
    if (!key && !err) return null;
    history.replaceState(null, "", location.pathname + location.search);
    if (err) return `Google Drive was not connected (${err.slice(0, 60)})`;
    if (!/^[0-9a-f]{64}$/.test(key)) return "Google Drive was not connected";
    set(K.key, key);
    set(K.error, null);
    setTimeout(() => backup({ manual: true }), 500);
    return "Google Drive connected";
  }
  async function disconnect() {
    const key = get(K.key);
    for (const k of Object.values(K)) set(k, null);
    token = null;
    if (key) await fetch(`${worker()}/disconnect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) }).catch(() => {});
  }

  async function accessToken() {
    if (token && Date.now() < tokenUntil) return token;
    const res = await fetch(`${worker()}/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: get(K.key) }) });
    if (res.status === 401) { set(K.key, null); throw new Error("Google Drive needs you to connect again (menu)"); }
    if (!res.ok) throw new Error("Could not reach the sign-in server");
    const j = await res.json();
    token = j.access_token;
    tokenUntil = Date.now() + (Math.max(60, j.expires_in || 3600) - 60) * 1000;
    return token;
  }
  async function gapi(method, url, body, headers) {
    const res = await fetch(url, { method, body, headers: { Authorization: `Bearer ${await accessToken()}`, ...headers } });
    if (res.status === 401) { token = null; }
    if (!res.ok) { const e = new Error(`Drive said ${res.status}`); e.status = res.status; throw e; }
    return res.status === 204 ? null : res.json();
  }

  async function folderId() {
    const saved = get(K.folder);
    if (saved) return saved;
    const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const found = await gapi("GET", `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`);
    const id = found.files && found.files[0] ? found.files[0].id
      : (await gapi("POST", "https://www.googleapis.com/drive/v3/files?fields=id", JSON.stringify({ name: FOLDER, mimeType: "application/vnd.google-apps.folder" }), { "Content-Type": "application/json" })).id;
    set(K.folder, id);
    return id;
  }
  // The month's file already in the folder (made from another browser or phone, or before a
  // reconnect), so it is updated instead of a second copy being made.
  async function findFile(name, parent) {
    const q = encodeURIComponent(`name='${name.replace(/['\\]/g, "\\$&")}' and '${parent}' in parents and trashed=false`);
    const found = await gapi("GET", `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&orderBy=createdTime&spaces=drive`);
    return found.files && found.files[0] ? found.files[0].id : null;
  }
  async function upload(name, text, fileId, parent) {
    if (!fileId) fileId = await findFile(name, parent);
    if (fileId) {
      try {
        await gapi("PATCH", `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id`, text, { "Content-Type": "text/plain; charset=utf-8" });
        return fileId;
      } catch (e) { if (e.status !== 404) throw e; }   // deleted in Drive: make it again
    }
    const boundary = "nb" + Math.random().toString(36).slice(2);
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent], mimeType: "text/plain" })}\r\n`
      + `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
    return (await gapi("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", body, { "Content-Type": `multipart/related; boundary=${boundary}` })).id;
  }

  // quiet: no toasts unless something went wrong; daily: only if the last backup is over a day old.
  function backup(opts = {}) {
    if (!connected()) return Promise.resolve();
    if (opts.daily && Date.now() - Number(get(K.last) || 0) < 864e5) return Promise.resolve();
    if (running) return running;
    running = (async () => {
      const months = (await store.all()).filter((m) => !isEmptyMonth(m));
      const files = readJson(K.files) || {}, synced = readJson(K.synced) || {};
      const todo = months.filter((m) => !synced[m.ym] || synced[m.ym] < m.updatedAt);
      if (todo.length) {
        const comps = computeAll(months, TAGS);
        const parent = await folderId();
        for (const m of todo) {
          files[m.ym] = await upload(`${monthTitle(m.ym)}.txt`, monthToText(m, TAGS, comps.get(m.ym)), files[m.ym], parent);
          synced[m.ym] = m.updatedAt;
          writeJson(K.files, files);                 // saved after each month, so a cut-off run resumes
          writeJson(K.synced, synced);
        }
      }
      set(K.last, String(Date.now()));
      set(K.error, null);
      // Automatic backups say so too when they uploaded something and the app is on screen.
      if (opts.manual || (todo.length && !document.hidden)) toast(todo.length ? `Backed up ${todo.length} month${todo.length === 1 ? "" : "s"} to Drive` : "Drive is up to date");
    })().catch((err) => {
      if (err.status === 404) set(K.folder, null);    // folder gone: make it again next time
      set(K.error, err.message);
      if (!opts.quiet || opts.manual) toast(`Drive backup failed: ${err.message}`);
    }).finally(() => { running = null; });
    return running;
  }

  function note() {
    if (!configured()) return "Drive backup is not set up";
    if (!connected()) return get(K.error) || "Not backed up to Drive";
    const last = Number(get(K.last) || 0);
    const err = get(K.error);
    if (err) return `Drive: ${err}`;
    if (!last) return "Drive: not backed up yet";
    const mins = Math.floor((Date.now() - last) / 60000);
    const ago = mins < 2 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.floor(mins / 60)} h ago` : `${Math.floor(mins / 1440)} days ago`;
    return `Drive: backed up ${ago}`;
  }

  return { configured, connected, connect, disconnect, takeKeyFromUrl, backup, note };
})();
