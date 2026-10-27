(() => {
  // Verhindert, dass Chromes eigener Übersetzer parallel zu uns arbeitet.
  // Läuft bewusst bei document_start, damit die Markierung gesetzt ist,
  // bevor Chrome die Sprache der Seite erkennt und seine Blende anbietet.
  if (window.__wt_google_blocker__) return;
  window.__wt_google_blocker__ = true;

  const HTML = document.documentElement;
  if (!HTML) return;

  // Elemente des "Google Website Translator", den manche Seiten selbst einbetten
  const GOOGLE_WIDGET_SELECTOR = [
    '.goog-te-banner-frame',
    '#goog-gt-tt',
    '.goog-text-highlight',
    '.goog-tooltip',
    '.goog-tooltip-popup',
    '.goog-te-menu-value',
    '#goog-gt-cta',
    '.goog-te-balloon-frame'
  ].join(',');

  // Seite für Chrome als "nicht übersetzen" markieren
  const block = () => {
    try {
      HTML.classList.add('notranslate');
      HTML.setAttribute('translate', 'no');
    } catch (e) {}
    hideGoogleWidgets();
  };

  // Markierung wieder entfernen – dann darf Chrome wieder übersetzen
  const unblock = () => {
    try {
      HTML.classList.remove('notranslate');
      HTML.removeAttribute('translate');
    } catch (e) {}
  };

  const hideGoogleWidgets = () => {
    try {
      document.querySelectorAll(GOOGLE_WIDGET_SELECTOR).forEach((el) => {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
      });
    } catch (e) {}
  };

  // Chrome hinterlässt nach einer automatischen Übersetzung diese Klassen
  const undoChromeTranslation = () => {
    try {
      if (HTML.classList.contains('translated-ltr') || HTML.classList.contains('translated-rtl')) {
        HTML.classList.remove('translated-ltr', 'translated-rtl');
      }
    } catch (e) {}
  };

  const apply = (enabled) => {
    if (enabled) {
      block();
      undoChromeTranslation();
    } else {
      unblock();
    }
  };

  // Aktuellen Zustand des Hauptschalters lesen (promise-basiert, modern)
  let enabled = true;
  try {
    chrome.storage.local.get(['wtConfig']).then((res) => {
      const cfg = res?.wtConfig;
      enabled = !(cfg && cfg.enabled === false);
      apply(enabled);
    }).catch(() => block());
  } catch (e) {
    block();
  }

  // Auf Umschalten des Hauptschalters reagieren
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.wtConfig) return;
      const cfg = changes.wtConfig.newValue || {};
      enabled = cfg.enabled !== false;
      apply(enabled);
    });
  } catch (e) {}

  // Googles Widget wird oft erst nach dem initialen Laden eingefügt –
  // daher einige Male nachfassen, bis die Seite stabil ist.
  const retryDelays = [500, 1500, 3000, 6000, 10000];
  retryDelays.forEach((delay) => {
    setTimeout(() => {
      if (enabled) {
        hideGoogleWidgets();
        undoChromeTranslation();
      }
    }, delay);
  });

  // Chrome kann die Klassen auch später noch setzen – nur Attribute beobachten (günstig)
  try {
    const observer = new MutationObserver(() => {
      if (enabled) undoChromeTranslation();
    });
    observer.observe(HTML, { attributes: true, attributeFilter: ['class'] });
  } catch (e) {}
})();
