# DarkExtension

A zero-build-step Chrome Manifest V3 universal dark mode extension featuring curated stylesheets for websites without native dark mode (including **Amazon**, **eBay**, and 15+ major sites), an adaptive DOM dynamic engine, smart native dark mode detection, customizable theme presets, scheduling, and per-site CSS overrides.

## Key Features

- **Curated Site Themes (17 Stylesheets)**: Hand-crafted, preset-aware CSS themes for major platforms lacking native dark mode — with deep coverage for **Amazon** (all regional domains + `smile.amazon.*`) and **eBay** (all regional domains), plus **Walmart**, **Target**, **Etsy**, **Best Buy**, **AliExpress**, **Newegg**, **Wikipedia & Wikimedia**, **Google Docs/Calendar/Scholar/Forms**, **Craigslist**, **Indeed**, **Zillow**, **Goodreads**, **Hacker News**, **Canvas LMS**, and popular web platforms (**Quora**, **PayPal**, **IMDb**, **Fandom**, **Booking.com**, **Airbnb**).
- **Adaptive Universal Dynamic Engine**: Automatically darkens any website by inspecting computed backgrounds and text contrast in `requestAnimationFrame`-batched passes while preserving images, videos, SVG icons, and saturated brand elements. Supports open Shadow DOM and SPA route changes.
- **Smart Native Dark Mode Detection**: Inspects `<meta name="color-scheme">` and computed page surface luminance before activating so sites that are already dark (GitHub, YouTube, Discord, etc.) stay untouched unless you explicitly choose **Force Dark Mode**.
- **Zero-FOUC Early Shield**: Synchronously prevents white flashes on navigation when dark mode was active on the origin.
- **5 Built-in Theme Presets**:
  - **Midnight** — Deep charcoal slate (`#121418`) with crisp neutral contrast
  - **OLED Pure Black** — True `#000000` black for OLED displays
  - **Warm Sepia** — Low-blue-light espresso (`#181512`) for late-night reading
  - **Slate Blue** — Modern cool navy (`#0f172a`) with cyan highlights
  - **Nord** — Arctic bluish-grey palette (`#242933`)
- **Live Fine-Tuning & Image Dimming**: Adjust **Brightness**, **Contrast**, **Warmth/Sepia**, **Grayscale**, and **Image Brightness** globally or per-site in real time.
- **Scheduling & Automation**: Choose **Manual (Always On)**, **Follow System Theme** (`prefers-color-scheme`), or **Time Schedule** (including overnight windows such as `20:00` to `07:00`).
- **Per-Site Rules & Custom CSS**: Override modes (`Auto`, `Dynamic`, `Filter`, `Off`), toggle specific curated themes, write custom CSS per domain, and import/export JSON backups.
- **Zero Build Step & Strict MV3**: Pure vanilla ES modules/scripts, `async`/`await`, `chrome.alarms`, `chrome.scripting`, `chrome.storage.sync`/`local`, and zero external npm dependencies.

## Installation (Chrome / Edge / Brave)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/IAndrexI/darkextension.git
   ```
2. Open `chrome://extensions` in your Chromium browser.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the `darkextension` folder.
5. Pin **DarkExtension** to your toolbar for instant access!

To build a distributable archive (`dist/darkextension.zip`):

```bash
npm run package
```

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+D` | Toggle dark mode on the current site |
| `Alt+Shift+G` | Toggle DarkExtension globally |

You can customize shortcuts anytime at `chrome://extensions/shortcuts`.

## Theme Presets

| Preset | Background | Elevated | Text | Link | Accent |
| --- | --- | --- | --- | --- | --- |
| **Midnight** | `#121418` | `#1a1d24` | `#e6e9ef` | `#7ab3ff` | `#6c8cff` |
| **OLED** | `#000000` | `#0c0c0e` | `#f0f0f5` | `#66b2ff` | `#5c9eff` |
| **Warm** | `#181512` | `#221e19` | `#ebe3d5` | `#e0a96d` | `#d99b52` |
| **Slate** | `#0f172a` | `#1e293b` | `#f1f5f9` | `#38bdf8` | `#60a5fa` |
| **Nord** | `#242933` | `#2e3440` | `#eceff4` | `#88c0d0` | `#81a1c1` |

## Project Structure

```text
darkextension/
├── manifest.json                  # Manifest V3 extension configuration
├── package.json                   # Node test, icon generator, and zip scripts
├── icons/                         # Vector SVG & generated PNGs (16, 32, 48, 128)
├── scripts/
│   ├── generate-icons.mjs         # Pure Node PNG icon renderer (node:zlib)
│   └── package-zip.mjs            # Pure Node release packager -> dist/darkextension.zip
├── src/
│   ├── shared/                    # Shared constants, site matcher, colors, schedule, storage
│   ├── background/                # MV3 service worker (messages, badges, menus, alarms)
│   ├── content/                   # Early shield, native detector, dynamic engine, orchestrator
│   ├── themes/
│   │   ├── base/                  # CSS variables, universal dynamic & filter stylesheets
│   │   └── sites/                 # registry.json + 17 curated site CSS themes
│   ├── popup/                     # Toolbar popup control center
│   └── options/                   # Full settings dashboard (rules, themes, custom CSS, backup)
└── tests/                         # Automated Node built-in test suite (node --test)
```

## Development & Testing

Requires **Node.js 18+** (uses only Node built-in modules, zero `npm install` needed).

```bash
# Regenerate icons (icons/icon.svg + 16/32/48/128 PNGs)
npm run icons

# Run unit, MV3 manifest, CSS/HTML compliance, and integration tests
npm test

# Package extension zip to dist/darkextension.zip
npm run package
```

## License

MIT — see [LICENSE](LICENSE).
