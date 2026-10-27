# Forge WebTRANSLATOR OmniLingo PRO 3.2.0

Echter, automatischer lokaler KI-Webseitenübersetzer für Google Chrome powered by Ollama – übersetzt komplette Webseiten direkt im Browser-Layout (In-Place DOM-Übersetzung wie Google Translator, aber privat, lokal und mit moderner KI-Qualität).

---

## 🚀 Modernisierung (v3.1.0)

Die Extension wurde auf das moderne **Manifest V3** Layout und ein neues **Design-System** gebracht:

- **Neue Ordnerstruktur:**
  ```
  Extension/
  ├── manifest.json
  ├── background/
  │   └── service-worker.js
  ├── content/
  │   ├── block-google-translate.js
  │   ├── translator-client.js
  │   ├── dom-translator.js
  │   └── page-context.js
  ├── popup/
  │   ├── popup.html
  │   ├── popup.css
  │   └── popup.js
  └── icons/
      ├── icon16.png
      ├── icon32.png
      ├── icon48.png
      └── icon128.png
  ```
- **Manifest V3:** `minimum_chrome_version` 114, bereinigte Berechtigungen, Side Panel via `chrome.sidePanel`, Content-Scripts via `chrome.scripting` injizierbar.
- **Design:** Modernes Design-Token-System, System-Schriftarten, Radius, Schatten, Micro-Animations, Dark Mode (Toggle + System), WCAG AAA (Fokus, Kontrast ≥ 7:1, 44×44px Touch-Targets, ARIA).

---

## 🔥 Wie Google Translator – nur um einiges besser!

1. 🌐 **Direkte In-Place DOM-Übersetzung:**
   - Überschreibt die Textknoten der aktuellen Webseite direkt im HTML-Baum.
   - Alle Überschriften, Absätze, Buttons, Links, Tabellen und Listen werden übersetzt, während **Layout, CSS-Stile, Klickbarkeit und Formatierung 100% erhalten bleiben**.
2. 🔄 **Sofortiges Umschalten (0ms Latenz):**
   - Ein Klick auf **„Original anzeigen"** stellt die Originalseite in Millisekunden wieder her.
   - Ein weiterer Klick schaltet sofort wieder auf die übersetzte Fassung zurück.
3. 💬 **Interaktiver Hover-Tooltip:**
   - Fahre mit der Maus über einen übersetzten Absatz auf der Webseite, um den englischen Originaltext in einem eleganten Tooltip einzusehen.
4. 📌 **In-Page Google-Translate Leiste:**
   - Am oberen Bildschirmrand der Webseite erscheint eine moderne Übersetzungsleiste mit Fortschrittsbalken, Sprachwechsler und Schalter für „Immer für diese Domain".
5. ⚡ **Vollautomatische Übersetzung (Automatisierung):**
   - Schalter: **„Diese Domain ('github.com') immer automatisch übersetzen"**.
   - Schalter: **„Alle Webseiten auf dieser Sprache ('Englisch') immer automatisch übersetzen"**.
   - Sobald du eine entsprechende Webseite besuchst, wird sie ohne Klick sofort übersetzt!
6. 🔒 **100% Privat & Kostenlos (Ollama):**
   - Keine Daten an Google, Microsoft oder Cloud-Dienste.
   - Keine API-Keys, keine Abonnements, kein Guthaben.

---

## Voraussetzungen

1. **Ollama** installieren und starten: [ollama.com](https://ollama.com)
2. Ein Übersetzungsmodell herunterladen (z. B. im Terminal):
   ```bash
   ollama run qwen3:1.7b
   ```
3. **Browser-Freigabe (CORS) einmalig im Terminal setzen:**
   - **Windows:**
     ```cmd
     setx OLLAMA_ORIGINS "chrome-extension://*"
     ```
   - **macOS / Linux:**
     ```bash
     OLLAMA_ORIGINS="chrome-extension://*" ollama serve
     ```
4. Ollama neu starten.

---

## Installation in Chrome

1. In Chrome `chrome://extensions/` öffnen.
2. Oben rechts **Entwicklermodus** aktivieren.
3. Auf **Entpackte Erweiterung laden** klicken und diesen Ordner auswählen.
4. WebTranslator PRO ist sofort einsatzbereit!

---

## Bedienung

1. Surfe auf eine beliebige ausländische Webseite (z. B. englischsprachige Nachrichten, GitHub, Wikipedia).
2. Klicke auf das **WebTranslator PRO** Symbol in der Chrome-Leiste.
3. Klicke auf den großen Button: **„Webseite jetzt übersetzen"**.
4. Die Webseite verwandelt sich live in Deutsch!
5. Nutze oben die Leiste oder das Popup, um jederzeit zwischen **Original** und **Übersetzung** zu wechseln.

---

## 🔐 Datenschutz

Die offizielle Datenschutzerklärung (Privacy Policy) des Forge WebTRANSLATOR OmniLingo PRO liegt im Repository unter [`PRIVACY.md`](PRIVACY.md) und wird vor einer Chrome-Webstore-Einreichung angegeben.

- **Keine** personenbezogenen Daten / Tracking / Cookies
- **Lokale Speicherung** aller Einstellungen (`chrome.storage`)
- Übersetzung über **Google Translate API** bzw. **lokale Ollama-Engine** – keine Cloud-Speicherung

## 📸 Screenshots & Webstore-Einreichung

- Screenshots für den Chrome Web Store müssen **1280 × 800 px** (PNG/JPG) betragen.
- Geplante Screenshots:
  - `screenshots/01-popup-main.png` – Popup mit Webseiten-Übersetzungsansicht
  - `screenshots/02-inpage-bar.png` – In-Page-Übersetzungsleiste auf einer Webseite
  - `screenshots/03-settings.png` – Automatisierungs- & Engine-Einstellungen
  - `screenshots/04-freetext.png` – Freier Text & Text-Humanizer

---

## Lizenz

MIT License.
