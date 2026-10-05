/* Quick Exchange — convert between USD and VND / JPY / THB / KRW / HKD / SGD.
 * Type an amount in any of the seven currencies; the other six update instantly.
 * Live rates: exchangerate-api.com with a Frankfurter (ECB) backup.
 * If both APIs are unreachable, a built-in snapshot is used. */

const CURRENCIES = [
  { code: "USD", name: "Đô la Mỹ", flag: "🇺🇸", symbol: "$" },
  { code: "VND", name: "Đồng Việt Nam", flag: "🇻🇳", symbol: "₫" },
  { code: "JPY", name: "Yên Nhật", flag: "🇯🇵", symbol: "¥" },
  { code: "THB", name: "Baht Thái", flag: "🇹🇭", symbol: "฿" },
  { code: "KRW", name: "Won Hàn Quốc", flag: "🇰🇷", symbol: "₩" },
  { code: "HKD", name: "Đô la Hồng Kông", flag: "🇭🇰", symbol: "HK$" },
  { code: "SGD", name: "Đô la Singapore", flag: "🇸🇬", symbol: "S$" },
];

// Used only if every live source fails (e.g. offline). Rates are quoted per USD.
const FALLBACK = {
  date: "2026-10-05",
  provider: "tỷ giá lưu sẵn",
  rates: { VND: 25949, JPY: 157.73, THB: 33.566, KRW: 1344.61, HKD: 7.848, SGD: 1.2794 },
};

const LOCALE = "vi-VN"; // UI language — also drives number/date formatting.
const SOURCES = [
  {
    // Primary source: the only one of the two that publishes VND.
    url: "https://open.er-api.com/v6/latest/USD",
    provider: "exchangerate-api.com",
    parse: (data) => {
      if (data.result !== "success") throw new Error(data["error-type"] || "API error");
      const rates = {};
      for (const { code } of CURRENCIES) {
        if (code !== "USD") rates[code] = data.rates[code]; // USD is the base.
      }
      return {
        rates,
        date: new Date(data.time_last_update_utc).toISOString().slice(0, 10),
      };
    },
  },
  {
    // Backup: ECB reference rates (no VND; USD is the base).
    url: `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${CURRENCIES.filter(
      (c) => c.code !== "VND" && c.code !== "USD"
    )
      .map((c) => c.code)
      .join(",")}`,
    provider: "Frankfurter (ECB)",
    parse: (data) => ({ rates: data.rates, date: data.date }),
  },
];

const els = {
  input: document.getElementById("amount"),
  from: document.getElementById("from"),
  fromDisplay: document.getElementById("from-display"),
  fromName: document.getElementById("from-name"),
  symbol: document.getElementById("symbol"),
  results: document.getElementById("results"),
  status: document.getElementById("status"),
  refresh: document.getElementById("refresh"),
  update: document.getElementById("update"),
  updated: document.getElementById("updated"),
  install: document.getElementById("install"),
  iosHint: document.getElementById("ios-hint"),
};

let rates = null;
let meta = { date: null, provider: null, kind: "loading" };

/* ---------- Formatting ---------- */

// Whole numbers for amounts ≥ 1 (what people normally convert); smaller values
// keep just enough decimals to stay meaningful instead of rounding to zero.
function fractionDigits(value) {
  const abs = Math.abs(value);
  if (abs >= 1 || abs === 0) return 0;
  return Math.min(8, Math.max(2, 3 - Math.floor(Math.log10(abs))));
}

const currencyFmt = new Map();
function formatCurrency(amount, code) {
  const digits = fractionDigits(amount);
  const key = `${code}:${digits}`;
  if (!currencyFmt.has(key)) {
    currencyFmt.set(
      key,
      new Intl.NumberFormat(LOCALE, {
        style: "currency",
        currency: code,
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
      })
    );
  }
  return currencyFmt.get(key).format(amount);
}

const rateFmt = new Map();
function formatRate(rate) {
  const digits = rate >= 1 ? 2 : fractionDigits(rate);
  if (!rateFmt.has(digits)) {
    rateFmt.set(digits, new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }));
  }
  return rateFmt.get(digits).format(rate);
}

const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });
function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number); // Parse as local date, not UTC.
  return dateFmt.format(new Date(y, m - 1, d));
}

// Clipboard gets a plain number (no grouping): whole numbers for values ≥ 1,
// otherwise the same precision the card shows so small values don't copy as 0.
function formatCopy(amount) {
  if (Math.abs(amount) >= 1) return String(Math.round(amount));
  return String(Number(amount.toFixed(fractionDigits(amount))));
}

/* ---------- DOM ---------- */

const FROM_KEY = "quick-exchange:from";

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // Storage unavailable (e.g. private mode).
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage unavailable — just don't persist. */
  }
}

function currencyOf(code) {
  return CURRENCIES.find((c) => c.code === code);
}

// Mirror the chosen input currency: symbol, compact select pill, full name.
function renderFrom() {
  const { code, flag, name, symbol } = currencyOf(els.from.value);
  els.symbol.textContent = symbol;
  els.fromDisplay.textContent = `${flag} ${code}`;
  els.fromName.textContent = name;
}

function buildCurrencySelect() {
  els.from.innerHTML = CURRENCIES.map(
    ({ code, flag, name }) => `<option value="${code}">${flag} ${code} — ${name}</option>`
  ).join("");

  const saved = storageGet(FROM_KEY);
  els.from.value = currencyOf(saved) ? saved : "USD";
  renderFrom();
}

function buildCards() {
  const from = els.from.value;
  els.results.innerHTML = CURRENCIES.filter((c) => c.code !== from).map(
    ({ code, name, flag }) => `
      <article class="card" data-code="${code}" tabindex="0" role="button"
               aria-label="Số tiền quy đổi sang ${name}, bấm để sao chép">
        <div class="card-head">
          <span aria-hidden="true">${flag}</span>
          <span class="code">${code}</span>
        </div>
        <div class="card-name">${name}</div>
        <div class="card-value" data-role="value">—</div>
        <div class="card-rate" data-role="rate">1 ${from} = …</div>
      </article>`
  ).join("");
}

function currentAmount() {
  const raw = els.input.value.trim();
  if (raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

// All rates are quoted per USD, so cross rates are just a division.
function rateFor(code) {
  return code === "USD" ? 1 : rates?.[code];
}

function crossRate(from, to) {
  const fromRate = rateFor(from);
  const toRate = rateFor(to);
  if (!fromRate || !toRate) return null;
  return toRate / fromRate;
}

function convert(amount, from, to) {
  const cross = crossRate(from, to);
  return cross === null ? null : amount * cross;
}

function render() {
  const amount = currentAmount();
  const from = els.from.value;

  for (const card of els.results.children) {
    const code = card.dataset.code;
    const cross = crossRate(from, code);
    const valueEl = card.querySelector('[data-role="value"]');
    const rateEl = card.querySelector('[data-role="rate"]');

    if (cross === null) {
      valueEl.textContent = "—";
      rateEl.textContent = "Không có tỷ giá";
    } else {
      rateEl.textContent = `1 ${from} = ${formatRate(cross)} ${code}`;
      valueEl.textContent = amount === null ? "—" : formatCurrency(amount * cross, code);
    }
  }
}

function renderStatus() {
  const el = els.status;
  el.dataset.kind = meta.kind;

  if (meta.kind === "loading") {
    el.textContent = "Đang tải tỷ giá…";
  } else if (meta.kind === "live") {
    el.textContent = `Tỷ giá trực tiếp · ${meta.provider} · ${formatDate(meta.date)}`;
  } else if (meta.kind === "stale") {
    el.textContent = `⚠ Không làm mới được — đang hiển thị ${meta.provider} ngày ${formatDate(meta.date)}`;
  } else {
    el.textContent = `⚠ Ngoại tuyến — đang dùng tỷ giá lưu sẵn ngày ${formatDate(meta.date)}`;
  }

  els.updated.textContent = meta.kind === "live" ? "Tỷ giá cập nhật vào các ngày giao dịch trong tuần." : "";
}

// Repaint the status, the amount cards and the refresh cooldown together.
function renderAll() {
  renderStatus();
  render();
  syncCooldown();
}

/* ---------- Data loading ---------- */

const CACHE_KEY = "quick-exchange:rates";
const RATE_TTL_MS = 30 * 60 * 1000; // Reuse stored rates for 30 minutes.
const MIN_INTERVAL_MS = 60 * 1000; // Never call the APIs more than once a minute.
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // Ignore stored rates older than a day.

function readStore() {
  try {
    return JSON.parse(storageGet(CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeStore(patch) {
  storageSet(CACHE_KEY, JSON.stringify({ ...readStore(), ...patch }));
}

async function fetchJson(url, timeoutMs = 8000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function useStoredRates(store, kind) {
  if (store.rates && Date.now() - store.fetchedAt < MAX_AGE_MS) {
    rates = store.rates;
    meta = { date: store.date, provider: store.provider, kind };
  } else {
    rates = FALLBACK.rates;
    meta = { date: FALLBACK.date, provider: FALLBACK.provider, kind: "fallback" };
  }
}

async function loadRates({ force = false } = {}) {
  const now = Date.now();
  const store = readStore();

  // Fresh cache: skip the network entirely.
  if (!force && store.rates && now - store.fetchedAt < RATE_TTL_MS) {
    useStoredRates(store, "live");
    renderAll();
    return;
  }

  // Throttle: at most one API attempt per minute, across page reloads too.
  if (now - (store.lastAttemptAt || 0) < MIN_INTERVAL_MS) {
    useStoredRates(store, "live");
    renderAll();
    return;
  }

  meta = { date: null, provider: null, kind: "loading" };
  renderStatus();
  els.refresh.disabled = true;
  writeStore({ lastAttemptAt: now });

  let live = null;
  for (const source of SOURCES) {
    try {
      const { rates: r, date } = source.parse(await fetchJson(source.url));
      live = { rates: r, date, provider: source.provider };
      break;
    } catch (err) {
      console.warn(`Rate source failed: ${source.provider}`, err);
    }
  }

  if (live) {
    rates = live.rates;
    meta = { date: live.date, provider: live.provider, kind: "live" };
    writeStore({
      rates: live.rates,
      date: live.date,
      provider: live.provider,
      fetchedAt: Date.now(),
    });
  } else {
    useStoredRates(store, "stale"); // Keep the last known rates on screen.
  }

  renderAll();
}

/* ---------- Refresh cooldown UI ---------- */

let cooldownTimer = null;

function syncCooldown() {
  const until = (readStore().lastAttemptAt || 0) + MIN_INTERVAL_MS;

  clearInterval(cooldownTimer);
  cooldownTimer = null;

  if (Date.now() >= until) {
    els.refresh.disabled = false;
    renderStatus();
    return;
  }

  els.refresh.disabled = true;
  const tick = () => {
    const secondsLeft = Math.ceil((until - Date.now()) / 1000);
    if (secondsLeft > 0) {
      els.updated.textContent = `Vui lòng chờ ${secondsLeft} giây trước khi làm mới.`;
    } else {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      els.refresh.disabled = false;
      renderStatus();
    }
  };
  tick();
  cooldownTimer = setInterval(tick, 1000);
}

/* ---------- Events ---------- */

els.input.addEventListener("input", render);

els.from.addEventListener("change", () => {
  storageSet(FROM_KEY, els.from.value);
  renderFrom();
  buildCards();
  render();
});

els.refresh.addEventListener("click", () => loadRates({ force: true }));

els.update.addEventListener("click", updateApp);

els.results.addEventListener("click", async (event) => {
  const card = event.target.closest(".card");
  if (!card) return;

  const amount = currentAmount();
  if (amount === null) return;

  const converted = convert(amount, els.from.value, card.dataset.code);
  if (converted === null) return;

  const text = formatCopy(converted);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return; // Clipboard unavailable (e.g. insecure context) — ignore.
  }

  card.classList.add("copied");
  setTimeout(() => card.classList.remove("copied"), 700);
});

els.results.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (!event.target.closest(".card")) return;
  event.preventDefault();
  event.target.closest(".card").click();
});

/* ---------- PWA: service worker + install ---------- */

async function clearAppCaches() {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((key) => key.startsWith("quick-exchange")).map((key) => caches.delete(key))
  );
}

// Force the freshest deployed build: check for a new service worker, drop the
// cached shell, then reload from the network. Installed apps can otherwise sit
// on a cached version for a long time, since they rarely trigger a navigation.
async function updateApp() {
  els.update.disabled = true;
  els.update.textContent = "Đang kiểm tra…";

  try {
    const registration = navigator.serviceWorker
      ? await navigator.serviceWorker.getRegistration()
      : null;
    if (registration) await registration.update();
    if (!navigator.onLine) throw new Error("offline");

    els.update.textContent = "Đang tải bản mới…";
    await clearAppCaches();
    location.reload();
  } catch (err) {
    console.warn("Update check failed", err);
    els.update.textContent = "Lỗi — thử lại";
    els.update.disabled = false;
  }
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .catch((err) => console.warn("Service worker registration failed", err));
  });
}

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

let installPrompt = null;

if (isIOS && !isStandalone) {
  els.install.hidden = false;
  els.install.textContent = "⤓ Thêm vào Màn hình chính";
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  els.install.hidden = false;
});

els.install.addEventListener("click", async () => {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    els.install.hidden = true;
  } else {
    // iOS Safari has no install prompt API — show manual instructions.
    els.iosHint.hidden = !els.iosHint.hidden;
  }
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  els.install.hidden = true;
  els.iosHint.hidden = true;
});

/* ---------- Init ---------- */

buildCurrencySelect();
buildCards();
renderStatus();
loadRates();
