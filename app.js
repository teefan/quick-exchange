/* Quick Exchange — USD → JPY / THB / KRW / HKD / SGD
 * Live rates: Frankfurter (ECB) with an exchangerate-api.com backup.
 * If both APIs are unreachable, a built-in snapshot is used. */

const CURRENCIES = [
  { code: "JPY", name: "Japanese Yen", flag: "🇯🇵" },
  { code: "THB", name: "Thai Baht", flag: "🇹🇭" },
  { code: "KRW", name: "South Korean Won", flag: "🇰🇷" },
  { code: "HKD", name: "Hong Kong Dollar", flag: "🇭🇰" },
  { code: "SGD", name: "Singapore Dollar", flag: "🇸🇬" },
];

// Used only if every live source fails (e.g. offline).
const FALLBACK = {
  date: "2026-10-02",
  provider: "built-in snapshot",
  rates: { JPY: 157.67, THB: 33.595, KRW: 1348.28, HKD: 7.8471, SGD: 1.2798 },
};

const CODES = CURRENCIES.map((c) => c.code).join(",");
const SOURCES = [
  {
    url: `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${CODES}`,
    provider: "Frankfurter (ECB)",
    parse: (data) => ({ rates: data.rates, date: data.date }),
  },
  {
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
    currencyFmt.set(code, new Intl.NumberFormat(undefined, { style: "currency", currency: code }));
  }
  return currencyFmt.get(code).format(amount);
}

const rateFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
const copyFmt = new Map();
function formatCopy(amount, code) {
  if (!copyFmt.has(code)) {
    const zeroDecimals = code === "JPY" || code === "KRW";
    copyFmt.set(
      code,
      new Intl.NumberFormat(undefined, {
        useGrouping: false,
        minimumFractionDigits: 0,
        maximumFractionDigits: zeroDecimals ? 0 : 2,
      })
    );
  }
  return copyFmt.get(code).format(amount);
}

/* ---------- DOM ---------- */

function buildCards() {
  els.results.innerHTML = CURRENCIES.map(
    ({ code, name, flag }) => `
      <article class="card" data-code="${code}" tabindex="0" role="button"
               aria-label="Converted amount in ${name}, click to copy">
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
      rateEl.textContent = "rate unavailable";
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
    el.textContent = "Loading live rates…";
  } else if (meta.kind === "live") {
    el.textContent = `Live rates · ${meta.provider} · ${meta.date}`;
  } else if (meta.kind === "stale") {
    el.textContent = `⚠ Couldn't refresh — showing ${meta.provider} from ${meta.date}`;
  } else {
    el.textContent = `⚠ Offline — showing ${meta.provider} from ${meta.date}`;
  }

  els.updated.textContent = meta.kind === "live" ? "Rates update on weekday market days." : "";
}

/* ---------- Data loading ---------- */

async function fetchJson(url, timeoutMs = 8000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadRates() {
  const previous = meta;
  meta = { date: null, provider: null, kind: "loading" };
  renderStatus();
  els.refresh.disabled = true;

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
  } else if (rates) {
    meta = { ...previous, kind: "stale" }; // Keep the last known rates on screen.
  } else {
    rates = FALLBACK.rates;
    meta = { date: FALLBACK.date, provider: FALLBACK.provider, kind: "fallback" };
  }

  els.refresh.disabled = false;
  renderStatus();
  render();
}

/* ---------- Events ---------- */

els.input.addEventListener("input", render);

els.refresh.addEventListener("click", loadRates);

els.results.addEventListener("click", async (event) => {
  const card = event.target.closest(".card");
  if (!card || !rates) return;

  const amount = currentAmount();
  if (amount === null) return;

  const text = formatCopy(amount * rates[card.dataset.code], card.dataset.code);
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
  els.install.textContent = "⤓ Add to Home Screen";
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
