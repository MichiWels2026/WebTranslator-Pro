# Änderungsprotokoll

## 3.1.0 – Hover-Tooltip, Store-Optimierung & Datenschutz

- **Hover-Tooltip (PRO-Feature):** Beim Überfahren eines bereits übersetzten Textbereichs wird jetzt die Original-Vorschau in einer eleganten Bubble angezeigt – DeepL-/Google-Style Hover Preview.
- **Manifest 3.1.0:** Version erhöht, Store-Keywords ergänzt.
- **Datenschutz:** Offizielle Datenschutzerklärung (PRIVACY.md) hinzugefügt – keine personenbezogenen Daten, lokale Speicherung, Übersetzung über Google API bzw. lokale Ollama-Engine.

## 3.0.0 – Komplette Modernisierung (Design, Struktur & Barrierefreiheit)

- **Neue Ordnerstruktur (Manifest V3 Standard):**
  - `background/service-worker.js` – Background Service Worker (neu strukturierter, self-contained).
  - `content/` – Alle Content-Scripts (`block-google-translate.js`, `translator-client.js`, `dom-translator.js`, `page-context.js`).
  - `popup/` – `popup.html`, `popup.css`, `popup.js` (modernes Design-System).
  - `icons/` – App-Icons (16, 32, 48, 128 px).
- **Manifest V3 (Version 3.0.0):**
  - `minimum_chrome_version` auf 114 erhöht (Side Panel API).
  - Berechtigungen bereinigt (`storage`, `activeTab`, `scripting`, `contextMenus`, `sidePanel`, `tabs`).
  - Side-Panel-Pfad (`popup/popup.html`) aktualisiert.
  - `short_name` ergänzt.
- **Modernes Design-System:**
  - Neues zentrales Design-Token-System (Light/Dark) mit sauberen Neutrals, Akzentfarben, Radius und Schatten.
  - System-Schriftarten, moderner Typografie-Scale, Micro-Animations, weiche Übergänge.
  - Dark Mode via manuellem Toggle UND Systempräferenz.
- **Barrierefreiheit (WCAG AAA):**
  - Vollständige Tastaturbedienung mit sichtbarem Fokus-Rahmen (`:focus-visible`).
  - Touch-/Klickflächen mindestens 44 × 44 px.
  - Kontrastverhältnis ≥ 7:1 für Fließtext.
  - `aria-label` / `aria-selected` / `aria-pressed` vollständig gesetzt.
- **Performance & Robustheit:**
  - Promise-basierte State-Abfragen in Content-Scripts modernisiert.
  - Service Worker ohne `importScripts`-Abhängigkeit (self-contained).
  - Content-Script-Injektion via `chrome.scripting` mit aktuellen Pfaden.

## 2.4.1 – Bugfixes & UX

- Ausstehenden Badge-Reset beim Seiten-Restore robuster gestaltet.

## 2.4.0 – Googles Übersetzer wird abgeschaltet

- **Kein Doppel-Übersetzen mehr:** Neues Content-Script `content/block-google-translate.js` läuft bei `document_start` und markiert jede Seite mit `notranslate` / `translate="no"`. Chromes eigener Übersetzer greift dadurch nicht mehr ein – es gibt nur noch eine Übersetzung, unsere.
- **Google-Widgets werden entfernt:** Eingebettete „Google Website Translator"-Elemente (`.goog-te-banner-frame`, `#goog-gt-tt`, …) werden ausgeblendet und die von Chrome gesetzten Klassen `translated-ltr` / `translated-rtl` wieder entfernt.
- **Folgt dem Hauptschalter:** Ist der Übersetzer global aus, wird die Blockierung aufgehoben – Chrome darf dann wieder wie gewohnt übersetzen.

## 2.3.0 – Ganzes Internet & Banner-Schalter

- **Läuft auf jeder Webseite:** `host_permissions` auf `http://*/*` und `https://*/*` erweitert. Die Erweiterung wird jetzt auf dem gesamten Internet injiziert und funktioniert auch auf Seiten, auf denen das Content-Script nachträglich per `chrome.scripting` nachgeladen werden muss.
- **Übersetzungs-Banner ein-/ausschaltbar:** Neuer Schalter „Übersetzungs-Banner" direkt unter dem Hauptschalter im Popup. Bei „Aus" erscheint auf fremdsprachigen Seiten kein Übersetzen-Dialog mehr; ein bereits offenes Banner wird sofort entfernt.
- **Banner-Schalter folgt dem Hauptschalter:** Ist der Übersetzer global ausgeschaltet, wird der Banner-Schalter ausgegraut und ist ohne Wirkung.

## 2.2.0 – Globaler Ein/Aus-Schalter

- **Übersetzer komplett abschaltbar:** Neuer Hauptschalter „Webseiten-Übersetzung" ganz oben im Popup. Bei „Aus" wird nichts mehr übersetzt – keine Auto-Erkennung, keine Blase, keine manuelle Übersetzung, keine Auswahl-Pill.
- **Original wird wiederhergestellt:** Beim Ausschalten wird die aktive Seite sofort auf den Originalzustand zurückgesetzt; auch alle anderen bereits übersetzten Tabs werden wiederhergestellt.
- **Alle Eingänge blockiert:** Kontextmenü-Einträge werden ausgegraut und ignoriert, `functionTranslatePage` und `checkAutoTranslate` brechen bei „Aus" sofort ab.
- **Popup-Deaktivierung:** Großer Übersetzen-Button deaktiviert, Hinweis eingeblendet, Sprach-/Auto-Karten abgedunkelt.

## 2.1.0 – Google-Translate-Erlebnis

- **Komplettes Redesign im Google-Translate-Stil:** In-Page-Blase und Toolbar-Popup von Gold/Neon/Rainbow auf einen cleanen, minimalen Look umgebaut (weisse Karte, Google-Blau `#1a73e8`, Dark-Mode folgt dem System).
- **Google-Translate-Verhalten (1:1):**
  - Automatische Erkennung der Quellsprache (via `<html lang>` + Stopwort-Heuristik) statt hart codiertem Deutsch.
  - „Diese Sprache immer übersetzen" (`wtAutoLanguages`).
  - „Diese Sprache nie übersetzen" (`wtNeverLanguages`, neu).
  - „Diese Website nie übersetzen" (`wtNeverDomains`, neu) – inklusive Rechtsklick-Menü und Popup-Verwaltung.
  - „Original anzeigen"-Toggle direkt in der Blase.
- **In-Page-Blase:** Kompakte Karte oben rechts mit Sprachpaar, „Übersetzen"-Button, Immer/Nie-Optionen, Fortschrittsbalken und Minimieren-Pill. Schliesst sich automatisch, wenn eine „Nie übersetzen"-Regel gesetzt wird.
- **Auswahl-Übersetzung:** Shadow-DOM-Pill/-Karte ebenfalls auf den cleanen Google-Stil (hell/dunkel) umgestellt.

## 2.0.0 – Die große Modernisierung (PRO 2.0)

- **Echtzeit Token-Streaming:** Integration von Streaming über Ollama (`/api/chat` mit `stream: true`). Übersetzungen erscheinen in Echtzeit Wort für Wort statt nach 30-90 Sekunden Wartezeit.
- **In-Page Floating Widget:** Schwebender Schnellübersetzer direkt auf beliebigen Webseiten beim Markieren von Text. Gekapselt im Shadow DOM für vollständige Isolation von Websitestilen.
- **Chrome Side Panel API:** Vollständige Unterstützung für das moderne Chrome Seitenpanel (`chrome.sidePanel`). Ermöglicht dauerhaftes Übersetzen neben Webseiten ohne automatisches Schließen des Popups.
- **Freie Texteingabe & erweiterte Importfunktionen:** Freies Eingabefeld mit Live-Zeichen- und Wortzähler, Schnelleinfügen aus der Zwischenablage sowie intelligenter Webseiteninhalts-Extraktion.
- **Dynamische Modell-Erkennung:** Automatische Abfrage von Ollama (`/api/tags`) und Dropdown-Auswahl aller installierten KI-Modelle mit Verbindungs- und Latenztest.
- **Tonalität & Sprachstil:** Anpassbare Übersetzung in Standard, Formell („Sie"), Informell („Du") oder Kompakt (Zusammenfassung).
- **Lokaler Übersetzungsverlauf:** Speicher für bis zu 50 Übersetzungen mit Live-Suche, Ein-Klick-Übernahme in den Editor, Kopieren und Textdatei-Export.
- **Text-To-Speech (Sprachausgabe):** Audioausgabe zum Vorlesen von Original- und übersetztem Text über die Web Speech API.
- **Erweitertes Farbschema & Design:** Komplett modernisiertes Fluent/Glassmorphism-UI mit Dark Mode, Light Mode und Auto-System-Erkennung.
- **App-Icons & Shortcuts:** Vollständiges Set hochauflösender Icons (16, 32, 48, 128 px) und Tastatur-Shortcuts (`Strg+Enter`, `Escape`, `Alt+Shift+T`).

## 1.4.0 – Popup statt Seitenpanel

- Klick auf das Erweiterungssymbol öffnet jetzt ein kleines Übersetzungs-Popup.
- Sidepanel-Berechtigung und Sidepanel-Dateien entfernt.
- Sprachpaar, Webseiten-/Markierungsübersetzung und Kopieren bleiben die einzigen Funktionen.

## 1.3.0 – Nur Webseitenübersetzung

- Oberfläche auf Sprachpaar, Webseiten-/Markierungsübersetzung und Ergebnis reduziert.
- Stilwahl, Glossar, Verlauf, technische Statuskarte und freie Texteingabe entfernt.
- Übersetzungs-Prompt auf Webseiteninhalte fokussiert.

## 1.2.0 – Sprachbanner

- Neue sichtbare Sprachpaar-Auswahl direkt oben im Seitenpanel.
- Standardpaar Deutsch → Englisch.
- ↔-Schaltfläche für die umgekehrte Übersetzung.
- Schnellwahl für häufige Sprachpaare.

## 1.1.0 – Webseiten-only

- Freie Texteingabe entfernt.
- Übersetzung ist nur noch aus der aktuellen Webseite oder einer Webseitenmarkierung möglich.
- Oberfläche und Hinweise auf Webseitenübersetzung angepasst.
- Freier Textübersetzer für eine spätere separate Erweiterung vorgemerkt.

## 1.0.0

- Neue Chrome-Seitenpanel-Erweiterung.
- Markierten Text und sichtbare Webseiten übersetzen.
- Automatische Ausgangssprache, mehrere Zielsprachen und Stilwahl.
- Glossar für feste Übersetzungen.
- Lokaler Übersetzungsverlauf und Kopierfunktion.
- Kontextmenü „Mit WebTranslator PRO übersetzen".
- Lokale Ollama-Verarbeitung ohne Credits oder API-Key.
