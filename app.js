/* Quick Exchange — USD → VND / JPY / THB / KRW / HKD / SGD
 * Live rates: exchangerate-api.com with a Frankfurter (ECB) backup.
 * If both APIs are unreachable, a built-in snapshot is used. */

const CURRENCIES = [
  { code: "VND", name: "Đồng Việt Nam", flag: "🇻🇳" },
  { code: "JPY", name: "Yên Nhật", flag: "🇯🇵" },
  { code: "THB", name: "Baht Thái", flag: "🇹🇭" },
  { code: "KRW", name: "Won Hàn Quốc", flag: "🇰🇷" },
  { code: "HKD", name: "Đô la Hồng Kông", flag: "🇭🇰" },
  { code: "SGD", name: "Đô la Singapore", flag: "🇸🇬" },
];

// Used only if every live source fails (e.g. offline).
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
      for (const { code } of CURRENCIES) rates[code] = data.rates[code];
      return {
        rates,
        date: new Date(data.time_last_update_utc).toISOString().slice(0, 10),
      };
    },
  },
  {
    // Backup: ECB reference rates (VND is not published by the ECB).
    url: `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${CURRENCIES.filter(
      (c) => c.code !== "VND"
    )
      .map((c) => c.code)
      .join(",")}`,
    provider: "Frankfurter (ECB)",
    parse: (data) => ({ rates: data.rates, date: data.date }),
  },
];

const els = {
  input: document.getElementById("usd"),
  results: document.getElementById("results"),
  status: document.getElementById("status"),
  refresh: document.getElementById("refresh"),
  updated: document.getElementById("updated"),
  install: document.getElementById("install"),
  iosHint: document.getElementById("ios-hint"),
};

let rates = null;
let meta = { date: null, provider: null, kind: "loading" };

/* ---------- Formatting ---------- */

const currencyFmt = new Map();
function formatCurrency(amount, code) {
  if (!currencyFmt.has(code)) {
    currencyFmt.set(
      code,
      new Intl.NumberFormat(LOCALE, {
        style: "currency",
        currency: code,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    );
  }
  return currencyFmt.get(code).format(Math.round(amount));
}

const rateFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });

const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });
function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number); // Parse as local date, not UTC.
  return dateFmt.format(new Date(y, m - 1, d));
}

// Clipboard gets a plain whole number (no grouping, no decimals).
function formatCopy(amount) {
  return String(Math.round(amount));
}

/* ---------- DOM ---------- */

function buildCards() {
  els.results.innerHTML = CURRENCIES.map(
    ({ code, name, flag }) => `
      <article class="card" data-code="${code}" tabindex="0" role="button"
               aria-label="Số tiền quy đổi sang ${name}, bấm để sao chép">
        <div class="card-head">
          <span aria-hidden="true">${flag}</span>
          <span class="name">${name}</span>
          <span class="code">${code}</span>
        </div>
        <div class="card-value" data-role="value">—</div>
        <div class="card-rate" data-role="rate">1 USD = …</div>
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

function render() {
  const amount = currentAmount();

  for (const card of els.results.children) {
    const code = card.dataset.code;
    const rate = rates?.[code];
    const valueEl = card.querySelector('[data-role="value"]');
    const rateEl = card.querySelector('[data-role="rate"]');

    if (!rate) {
      valueEl.textContent = "—";
      rateEl.textContent = "Không có tỷ giá";
    } else if (amount === null) {
      valueEl.textContent = "—";
      rateEl.textContent = `1 USD = ${rateFmt.format(rate)} ${code}`;
    } else {
      valueEl.textContent = formatCurrency(amount * rate, code);
      rateEl.textContent = `1 USD = ${rateFmt.format(rate)} ${code}`;
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

/* ---------- Data loading ---------- */

const CACHE_KEY = "quick-exchange:rates";
const RATE_TTL_MS = 30 * 60 * 1000; // Reuse stored rates for 30 minutes.
const MIN_INTERVAL_MS = 60 * 1000; // Never call the APIs more than once a minute.
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // Ignore stored rates older than a day.

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeStore(patch) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...readStore(), ...patch }));
  } catch {
    /* Storage unavailable (private mode) — throttling just won't persist. */
  }
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
    rates = store.rates;
    meta = { date: store.date, provider: store.provider, kind: "live" };
    renderStatus();
    render();
    syncCooldown();
    return;
  }

  // Throttle: at most one API attempt per minute, across page reloads too.
  if (now - (store.lastAttemptAt || 0) < MIN_INTERVAL_MS) {
    useStoredRates(store, "live");
    renderStatus();
    render();
    syncCooldown();
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

  renderStatus();
  render();
  syncCooldown();
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

els.refresh.addEventListener("click", () => loadRates({ force: true }));

els.results.addEventListener("click", async (event) => {
  const card = event.target.closest(".card");
  if (!card || !rates) return;

  const amount = currentAmount();
  if (amount === null) return;

  const text = formatCopy(amount * rates[card.dataset.code]);
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

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
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

buildCards();
renderStatus();
loadRates();
