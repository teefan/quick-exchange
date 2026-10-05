# 💱 Quick Exchange

A tiny single-page app that converts US Dollars into five Asian currencies:

🇯🇵 JPY · 🇹🇭 THB · 🇰🇷 KRW · 🇭🇰 HKD · 🇸🇬 SGD

**[Live demo](https://teefan.github.io/quick-exchange/)**

![Quick Exchange preview](docs/preview.png)

## Features

- Type a USD amount and every currency updates instantly
- Live rates from the [Frankfurter API](https://frankfurter.dev) (European Central Bank data),
  with [exchangerate-api.com](https://www.exchangerate-api.com) as a backup
- Falls back to a built-in rate snapshot when offline
- Click (or tap) any card to copy the converted amount
- Mobile-first responsive layout
- **Installable as an app**: web app manifest + service worker, so it launches
  standalone from the home screen and works offline

## Install as an app

- **Android / desktop Chrome**: open the live demo and click **⤓ Install app**
  (or use the browser's install icon in the address bar).
- **iPhone / iPad Safari**: open the live demo, tap **Share ⎋**, then
  **Add to Home Screen**. The app shows this hint via its install button.

## Run locally

No build step — it's plain HTML/CSS/JS. Any static server works:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

> Service workers require `https` or `localhost`, so use the server above
> rather than opening `index.html` directly from disk.

## Deploy

The app is deployed with GitHub Pages straight from the `main` branch root.

```sh
gh repo create quick-exchange --public --source=. --push
gh api -X POST repos/{owner}/quick-exchange/pages \
  -f "source[branch]=main" -f "source[path]=/"
```

## Structure

| File                    | Purpose                                    |
| ----------------------- | ------------------------------------------ |
| `index.html`            | Markup + PWA metadata                      |
| `styles.css`            | Styling (dark theme, mobile breakpoints)   |
| `app.js`                | Rates, conversion, install prompt          |
| `manifest.webmanifest`  | Web app manifest for installation          |
| `sw.js`                 | Service worker — offline caching           |
| `icons/`                | App icons (SVG source + generated PNGs)    |
| `docs/preview.png`      | README screenshot                          |
