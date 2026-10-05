# 💱 Quick Exchange

A tiny single-page app that converts US Dollars into five Asian currencies:

🇯🇵 JPY · 🇹🇭 THB · 🇰🇷 KRW · 🇭🇰 HKD · 🇸🇬 SGD

**[Live demo](https://teefan.github.io/quick-exchange/)**

## Features

- Type a USD amount and every currency updates instantly
- Live rates from the [Frankfurter API](https://frankfurter.dev) (European Central Bank data),
  with [exchangerate-api.com](https://www.exchangerate-api.com) as a backup
- Falls back to a built-in rate snapshot when offline
- Click any card to copy the converted amount

## Run locally

No build step — it's plain HTML/CSS/JS. Any static server works:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy

The app is deployed with GitHub Pages straight from the `main` branch root.

```sh
gh repo create quick-exchange --public --source=. --push
gh api -X POST repos/{owner}/quick-exchange/pages \
  -f "source[branch]=main" -f "source[path]=/"
```

## Structure

| File         | Purpose            |
| ------------ | ------------------ |
| `index.html` | Markup             |
| `styles.css` | Styling            |
| `app.js`     | Rates + conversion |
