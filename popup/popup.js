(() => {
  const $ = (id) => document.getElementById(id);

  let activeTab = null;
  let activeDomain = '';
  let activeLang = 'en';
  let pageStatus = { isTranslating: false, isTranslated: false, isShowingOriginal: false };
  let currentConfig = {};

  // Tab switching
  function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      const active = btn.dataset.tab === tabId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.tab-pane').forEach((pane) => {
      const isActive = pane.id === tabId;
      pane.classList.toggle('active', isActive);
      pane.style.display = isActive ? 'flex' : 'none';
    });

    if (tabId === 'tab-auto') {
      loadAutoDomains();
      loadNeverDomains();
      loadNeverLanguages();
      loadGlossary();
    }
  }

  // Populate language dropdowns
  function populateLanguages() {
    const srcSelect = $('source');
    const tgtSelect = $('target');
    srcSelect.innerHTML = '';
    tgtSelect.innerHTML = '';

    WebTranslator.LANGUAGES.forEach((lang) => {
      const optSrc = document.createElement('option');
      optSrc.value = lang;
      optSrc.textContent = lang;
      srcSelect.appendChild(optSrc);

      if (lang !== 'Automatisch erkennen') {
        const optTgt = document.createElement('option');
        optTgt.value = lang;
        optTgt.textContent = lang;
        tgtSelect.appendChild(optTgt);
      }
    });

    srcSelect.value = 'Automatisch erkennen';
    tgtSelect.value = currentConfig.defaultTarget || 'Deutsch';
  }

  // Send message to active tab safely
  async function sendToActiveTab(msg) {
    if (!activeTab?.id) {
      const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      activeTab = t;
    }
    if (!activeTab?.id) throw new Error('Kein Tab gefunden.');

    try {
      return await chrome.tabs.sendMessage(activeTab.id, msg);
    } catch {
      if (chrome.scripting) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: [
              'content/block-google-translate.js',
              'content/translator-client.js',
              'content/dom-translator.js',
              'content/page-context.js'
            ]
          });
          return await chrome.tabs.sendMessage(activeTab.id, msg);
        } catch {}
      }
      throw new Error('Diese Seite erlaubt keine Erweiterungen (z. B. Chrome-interne Seiten).');
    }
  }

  // Push a message to every tab that has our content script running
  async function broadcastToAllTabs(msg) {
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({});
    } catch {
      return;
    }
    for (const tab of tabs) {
      if (!tab.id || !/^https?:/.test(tab.url || '')) continue;
      try {
        await chrome.tabs.sendMessage(tab.id, msg);
      } catch {}
    }
  }

  // Update Page Card UI
  function updatePageUI() {
    const badge = $('page-badge');
    const giantTitle = $('btn-translate-title');
    const giantSub = $('btn-translate-sub');
    const giantBtn = $('btn-translate-page');
    const transControls = $('translated-controls');
    const toggleLabel = $('btn-toggle-label');

    if (pageStatus.isTranslating) {
      badge.className = 'state-badge working';
      badge.textContent = `Wird übersetzt …`;
      giantBtn.classList.add('working');
      giantTitle.textContent = 'Übersetze Webseite …';
      giantSub.textContent = 'Texte werden im Layout in Echtzeit ersetzt';
      if (transControls) transControls.style.display = 'none';
    } else if (pageStatus.isTranslated) {
      giantBtn.classList.remove('working');
      if (transControls) transControls.style.display = 'grid';

      if (pageStatus.isShowingOriginal) {
        badge.className = 'state-badge original';
        badge.textContent = 'Originalversion';
        if (toggleLabel) toggleLabel.textContent = '🌐 Übersetzung anzeigen';
        giantTitle.textContent = 'Webseite ist übersetzt';
        giantSub.textContent = 'Klicke unten, um zwischen Original und Übersetzung zu wechseln';
      } else {
        badge.className = 'state-badge done';
        badge.textContent = `✓ Auf ${pageStatus.targetLang || 'Deutsch'} übersetzt`;
        if (toggleLabel) toggleLabel.textContent = '👁️ Original anzeigen';
        giantTitle.textContent = 'Webseite erneut übersetzen';
        giantSub.textContent = 'Aktualisiert die Übersetzung mit den gewählten Sprachen';
      }
    } else {
      badge.className = 'state-badge original';
      badge.textContent = 'Original';
      giantBtn.classList.remove('working');
      giantTitle.textContent = 'Webseite jetzt übersetzen';
      giantSub.textContent = 'Übersetzt die gesamte Seite direkt im Browser-Layout';
      if (transControls) transControls.style.display = 'none';
    }
  }

  // Reflect the global enabled/disabled state across the popup UI
  function applyEnabledUI(enabled) {
    const chk = $('chk-master');
    const sub = $('master-sub');
    const giantBtn = $('btn-translate-page');
    const giantTitle = $('btn-translate-title');
    const giantSub = $('btn-translate-sub');
    const hint = $('translator-off-hint');

    if (chk) chk.checked = enabled;
    if (sub) sub.textContent = enabled
      ? 'Aktiv – übersetzt fremdsprachige Seiten automatisch'
      : 'Aus – es wird nichts mehr übersetzt';

    if (giantBtn) giantBtn.disabled = !enabled;
    if (hint) hint.style.display = enabled ? 'none' : 'block';

    if (!enabled) {
      if (giantTitle) giantTitle.textContent = 'Übersetzer ist ausgeschaltet';
      if (giantSub) giantSub.textContent = 'Aktiviere den Schalter oben, um wieder zu übersetzen';
      const transControls = $('translated-controls');
      if (transControls) transControls.style.display = 'none';
      const badge = $('page-badge');
      if (badge) { badge.className = 'state-badge original'; badge.textContent = 'Deaktiviert'; }
    }

    // Dim the controls that have no effect while the translator is off
    document.querySelectorAll('.page-card, .auto-quick-card').forEach((card) => {
      card.classList.toggle('is-off', !enabled);
    });

    // The banner switch & site switch are locked while the whole translator is off
    const bannerCard = document.querySelector('.banner-switch-card');
    if (bannerCard) bannerCard.classList.toggle('is-locked', !enabled);
    const siteCard = document.querySelector('.site-switch-card');
    if (siteCard) siteCard.classList.toggle('is-locked', !enabled);
  }

  // Reflect the banner on/off state in the popup
  function applyBannerUI(show) {
    const chk = $('chk-banner');
    const sub = $('banner-sub');
    if (chk) chk.checked = show;
    if (sub) sub.textContent = show
      ? 'Auf fremdsprachigen Seiten wird der Übersetzen-Dialog automatisch eingeblendet'
      : 'Aus – es wird kein Übersetzen-Dialog auf Webseiten eingeblendet';
  }

  // Reflect the site on/off state in the popup
  function applySiteUI(allowed) {
    const sub = $('site-switch-sub');
    if (sub) {
      sub.textContent = allowed
        ? 'Aktiv – Übersetzung auf dieser Webseite erlaubt'
        : 'Ausgeschaltet – Kein Banner und keine Übersetzung auf dieser Webseite';
    }
  }

  // Load and refresh current page status
  async function loadCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) return;
      activeTab = tab;

      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        const urlObj = new URL(tab.url);
        activeDomain = urlObj.hostname;
        $('page-domain').textContent = activeDomain;
        $('chk-domain-text').textContent = `Auf ${activeDomain} automatisch übersetzen`;
        const titleEl = $('site-switch-title');
        if (titleEl) titleEl.textContent = `Diese Webseite (${activeDomain})`;
        const siteCard = $('site-switch-card');
        if (siteCard) siteCard.style.display = 'block';
      } else {
        activeDomain = '';
        $('page-domain').textContent = 'Sonderseite';
        $('chk-domain-text').textContent = 'Nur auf normalen Webseiten verfügbar';
        $('chk-auto-domain').disabled = true;
        const siteCard = $('site-switch-card');
        if (siteCard) siteCard.style.display = 'none';
      }

      $('page-title').textContent = tab.title || 'Aktuelle Webseite';

      const autoData = await chrome.storage.local.get(['wtAutoDomains', 'wtAutoLanguages', 'wtNeverDomains', 'wtNeverLanguages']);
      const autoDomains = Array.isArray(autoData?.wtAutoDomains) ? autoData.wtAutoDomains : [];
      const neverDomains = Array.isArray(autoData?.wtNeverDomains) ? autoData.wtNeverDomains : [];
      $('chk-auto-domain').checked = autoDomains.includes(activeDomain);
      $('chk-never-domain').checked = neverDomains.includes(activeDomain);

      const isSiteAllowed = !neverDomains.includes(activeDomain);
      const chkSite = $('chk-site');
      if (chkSite) {
        chkSite.checked = isSiteAllowed;
        applySiteUI(isSiteAllowed);
      }

      // Query content script for live status
      try {
        const res = await sendToActiveTab({ type: 'WT_GET_PAGE_STATUS' });
        if (res) {
          pageStatus = res;
          activeLang = res.detectedLang || 'en';
          $('chk-lang-text').textContent = `Alle Webseiten auf '${activeLang}' immer übersetzen`;

          const autoLangs = Array.isArray(autoData?.wtAutoLanguages) ? autoData.wtAutoLanguages : [];
          const neverLangs = Array.isArray(autoData?.wtNeverLanguages) ? autoData.wtNeverLanguages : [];
          $('chk-auto-lang').checked = autoLangs.includes(activeLang);
          $('chk-never-lang').checked = neverLangs.includes(activeLang);
          $('chk-never-lang-text').textContent = `Nie auf Seiten in '${activeLang}' anbieten`;

          updatePageUI();
        }
      } catch {
        // Tab not accessible (e.g. chrome://)
        updatePageUI();
      }
    } catch (e) {
      console.warn('Tab-Abfragefehler:', e);
    }
  }

  // Auto domains list management in Tab 2
  async function loadAutoDomains() {
    const data = await chrome.storage.local.get(['wtAutoDomains']);
    const domains = Array.isArray(data?.wtAutoDomains) ? data.wtAutoDomains : [];
    const container = $('auto-domains-list');
    container.innerHTML = '';

    if (domains.length === 0) {
      container.innerHTML = '<span class="hint-text">Noch keine Domains eingetragen.</span>';
      return;
    }

    domains.forEach((dom) => {
      const badge = document.createElement('span');
      badge.className = 'tag-badge';
      badge.innerHTML = `
        <span>${dom}</span>
        <button class="tag-del" type="button" title="Entfernen" aria-label="Regel ${dom} entfernen">✕</button>
      `;
      badge.querySelector('.tag-del').onclick = async () => {
        const next = domains.filter((d) => d !== dom);
        await chrome.storage.local.set({ wtAutoDomains: next });
        loadAutoDomains();
        if (dom === activeDomain) $('chk-auto-domain').checked = false;
      };
      container.appendChild(badge);
    });
  }

  // Never-translate sites list (Tab 2)
  async function loadNeverDomains() {
    const data = await chrome.storage.local.get(['wtNeverDomains']);
    const domains = Array.isArray(data?.wtNeverDomains) ? data.wtNeverDomains : [];
    const container = $('never-domains-list');
    if (!container) return;
    container.innerHTML = '';

    if (domains.length === 0) {
      container.innerHTML = '<span class="hint-text">Keine Website gesperrt.</span>';
      return;
    }

    domains.forEach((dom) => {
      const badge = document.createElement('span');
      badge.className = 'tag-badge never';
      badge.innerHTML = `
        <span>${dom}</span>
        <button class="tag-del" type="button" title="Entfernen" aria-label="Regel ${dom} entfernen">✕</button>
      `;
      badge.querySelector('.tag-del').onclick = async () => {
        const next = domains.filter((d) => d !== dom);
        await chrome.storage.local.set({ wtNeverDomains: next });
        loadNeverDomains();
        if (dom === activeDomain) {
          $('chk-never-domain').checked = false;
          if ($('chk-site')) {
            $('chk-site').checked = true;
            applySiteUI(true);
          }
        }
      };
      container.appendChild(badge);
    });
  }

  // Never-translate languages list (Tab 2)
  async function loadNeverLanguages() {
    const data = await chrome.storage.local.get(['wtNeverLanguages']);
    const langs = Array.isArray(data?.wtNeverLanguages) ? data.wtNeverLanguages : [];
    const container = $('never-languages-list');
    if (!container) return;
    container.innerHTML = '';

    if (langs.length === 0) {
      container.innerHTML = '<span class="hint-text">Keine Sprache gesperrt.</span>';
      return;
    }

    langs.forEach((lang) => {
      const badge = document.createElement('span');
      badge.className = 'tag-badge never';
      badge.innerHTML = `
        <span>${lang}</span>
        <button class="tag-del" type="button" title="Entfernen" aria-label="Regel ${lang} entfernen">✕</button>
      `;
      badge.querySelector('.tag-del').onclick = async () => {
        const next = langs.filter((l) => l !== lang);
        await chrome.storage.local.set({ wtNeverLanguages: next });
        loadNeverLanguages();
        if (lang === activeLang) $('chk-never-lang').checked = false;
      };
      container.appendChild(badge);
    });
  }

  // Populate the "add never language" dropdown
  function populateNeverLangSelect() {
    const sel = $('input-add-never-lang');
    if (!sel) return;
    sel.innerHTML = '';
    (WebTranslator.LANGUAGES || []).forEach((lang) => {
      if (lang === 'Automatisch erkennen') return;
      const opt = document.createElement('option');
      opt.value = lang;
      opt.textContent = lang;
      sel.appendChild(opt);
    });
  }

  // Glossary list management in Tab 2 (DeepL-Style)
  async function loadGlossary() {
    const data = await chrome.storage.local.get(['wtGlossary']);
    const glossary = Array.isArray(data?.wtGlossary) ? data.wtGlossary : [];
    const container = $('glossary-list');
    if (!container) return;
    container.innerHTML = '';

    if (glossary.length === 0) {
      container.innerHTML = '<span class="hint-text">Noch keine Glossar-Regeln definiert.</span>';
      return;
    }

    glossary.forEach((item, index) => {
      const badge = document.createElement('span');
      badge.className = 'tag-badge';
      badge.innerHTML = `
        <span><strong>${item.from}</strong> ➔ ${item.to}</span>
        <button class="tag-del" type="button" title="Regel löschen" aria-label="Regel ${item.from} löschen">✕</button>
      `;
      badge.querySelector('.tag-del').onclick = async () => {
        const next = glossary.filter((_, i) => i !== index);
        await chrome.storage.local.set({ wtGlossary: next });
        loadGlossary();
      };
      container.appendChild(badge);
    });
  }

  // Check and update engine & Ollama status
  async function updateEngineStatus() {
    const isTurbo = (currentConfig.engine || 'turbo') !== 'ollama';
    const pill = $('ollama-status-pill');
    const textEl = $('engine-status-text');

    if (isTurbo) {
      pill.className = 'status-pill online';
      textEl.textContent = '⚡ Turbo';
      return;
    }

    pill.className = 'status-pill checking';
    textEl.textContent = 'Ollama wird geprüft …';

    const res = await WebTranslator.check(currentConfig.baseUrl);
    if (res.ok) {
      const activeModel = currentConfig.model || 'phi3:3.8b';
      const modelFound = res.models.some((m) => m === activeModel || m.startsWith(`${activeModel}:`));

      if (modelFound) {
        pill.className = 'status-pill online';
        textEl.textContent = `🔒 Verbunden (${activeModel})`;
      } else if (res.models.length > 0) {
        pill.className = 'status-pill online';
        textEl.textContent = `🔒 Online (${res.models[0]})`;
        currentConfig.model = res.models[0];
        WebTranslator.saveConfig({ model: res.models[0] });
      } else {
        pill.className = 'status-pill offline';
        textEl.textContent = 'Kein Modell installiert';
      }

      populateModelSelect(res.models);
    } else {
      pill.className = 'status-pill offline';
      textEl.textContent = 'Ollama offline';
    }
  }

  function populateModelSelect(models) {
    const sel = $('cfg-model');
    sel.innerHTML = '';
    if (!models || models.length === 0) {
      const opt = document.createElement('option');
      opt.value = currentConfig.model || 'qwen3:1.7b';
      opt.textContent = `${currentConfig.model || 'qwen3:1.7b'} (nicht geladen)`;
      sel.appendChild(opt);
      return;
    }

    models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      sel.appendChild(opt);
    });

    if (models.includes(currentConfig.model)) {
      sel.value = currentConfig.model;
    } else {
      sel.value = models[0];
    }
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  // Setup Event Listeners
  function setupEvents() {
    // Navigation Tabs
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Theme Switch
    $('btn-theme').addEventListener('click', async () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : current === 'light' ? 'auto' : 'dark';
      applyTheme(next);
      currentConfig.theme = next;
      await WebTranslator.saveConfig({ theme: next });
    });

    // Sidepanel Button
    $('btn-sidepanel').addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'WT_OPEN_SIDEPANEL' });
        window.close();
      } catch {
        alert('Seitenpanel wird über das Chrome-Menü geöffnet.');
      }
    });

    // Language Swapper
    $('swap').addEventListener('click', () => {
      const s = $('source').value;
      const t = $('target').value;
      $('source').value = t;
      $('target').value = s === 'Automatisch erkennen' ? 'Deutsch' : s;
      updateQuickChips();
    });

    $('source').addEventListener('change', updateQuickChips);
    $('target').addEventListener('change', updateQuickChips);

    // Quick Chips
    document.querySelectorAll('.chip-btn').forEach((chip) => {
      chip.addEventListener('click', () => {
        $('source').value = chip.dataset.source;
        $('target').value = chip.dataset.target;
        updateQuickChips();
      });
    });

    // Master Enable / Disable Switch
    $('chk-master').addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      currentConfig.enabled = enabled;
      await WebTranslator.saveConfig({ enabled });
      applyEnabledUI(enabled);

      // Push to the active tab: restore the original page when switching off
      try {
        await sendToActiveTab({ type: 'WT_SET_ENABLED', enabled });
      } catch {}

      // Switching off must also restore every other tab that is currently translated
      if (!enabled) {
        broadcastToAllTabs({ type: 'WT_RESTORE_PAGE_ORIGINAL' });
      }

      if (enabled) {
        // Re-query the page so labels/state refresh correctly
        loadCurrentPage();
      } else {
        pageStatus.isTranslating = false;
        pageStatus.isTranslated = false;
        pageStatus.isShowingOriginal = false;
      }
    });

    // Banner Show / Hide Switch
    $('chk-banner').addEventListener('change', async (e) => {
      const show = e.target.checked;
      currentConfig.showFloatingButton = show;
      await WebTranslator.saveConfig({ showFloatingButton: show });
      applyBannerUI(show);

      // Hiding the banner removes it from the current page right away
      if (!show) {
        try {
          await sendToActiveTab({ type: 'WT_SET_BANNER', show: false });
        } catch {}
      } else {
        try {
          await sendToActiveTab({ type: 'WT_SET_BANNER', show: true });
        } catch {}
      }
    });

    // Current Website Switch (EIN / AUS)
    const chkSite = $('chk-site');
    if (chkSite) {
      chkSite.addEventListener('change', async (e) => {
        if (!activeDomain) return;
        const isAllowed = e.target.checked;
        applySiteUI(isAllowed);

        const data = await chrome.storage.local.get(['wtNeverDomains', 'wtAutoDomains']);
        let neverDomains = Array.isArray(data?.wtNeverDomains) ? data.wtNeverDomains : [];
        let autoDomains = Array.isArray(data?.wtAutoDomains) ? data.wtAutoDomains : [];

        if (isAllowed) {
          neverDomains = neverDomains.filter((d) => d !== activeDomain);
          if ($('chk-never-domain')) $('chk-never-domain').checked = false;
        } else {
          if (!neverDomains.includes(activeDomain)) neverDomains.push(activeDomain);
          autoDomains = autoDomains.filter((d) => d !== activeDomain);
          if ($('chk-never-domain')) $('chk-never-domain').checked = true;
          if ($('chk-auto-domain')) $('chk-auto-domain').checked = false;

          // Immediately remove banner on active tab
          try {
            await sendToActiveTab({ type: 'WT_SET_DOMAIN_ENABLED', enabled: false });
          } catch {}
        }

        await chrome.storage.local.set({
          wtNeverDomains: neverDomains,
          wtAutoDomains: autoDomains
        });

        loadNeverDomains();
        loadAutoDomains();
      });
    }

    // Main Translate Page Button
    $('btn-translate-page').addEventListener('click', async () => {
      if (currentConfig.enabled === false) return;
      const targetLang = $('target').value;
      const sourceLang = $('source').value;

      pageStatus.isTranslating = true;
      updatePageUI();

      try {
        await sendToActiveTab({
          type: 'WT_START_PAGE_TRANSLATION',
          targetLang,
          sourceLang
        });
        window.close(); // Close popup so user sees translation live on the page!
      } catch (err) {
        alert(`Konnte Seite nicht übersetzen: ${err.message}`);
        pageStatus.isTranslating = false;
        updatePageUI();
      }
    });

    // Toggle View Button (Original ↔ Translation)
    $('btn-toggle-view').addEventListener('click', async () => {
      try {
        const res = await sendToActiveTab({ type: 'WT_TOGGLE_PAGE_TRANSLATION' });
        if (res) {
          pageStatus.isShowingOriginal = res.isShowingOriginal;
          updatePageUI();
        }
      } catch (err) {
        alert(err.message);
      }
    });

    // Restore Original Page Button
    $('btn-restore-page').addEventListener('click', async () => {
      try {
        await sendToActiveTab({ type: 'WT_RESTORE_PAGE_ORIGINAL' });
        pageStatus.isTranslated = false;
        pageStatus.isShowingOriginal = false;
        updatePageUI();
      } catch (err) {
        alert(err.message);
      }
    });

    // Show In-Page Bar Button
    $('btn-show-bar').addEventListener('click', async () => {
      if (currentConfig.enabled === false) return;
      try {
        await sendToActiveTab({ type: 'WT_SHOW_PAGE_BAR' });
        window.close();
      } catch (err) {
        alert(err.message);
      }
    });

    // Checkbox Auto Domain
    $('chk-auto-domain').addEventListener('change', async (e) => {
      if (!activeDomain) return;
      const data = await chrome.storage.local.get(['wtAutoDomains']);
      let domains = Array.isArray(data?.wtAutoDomains) ? data.wtAutoDomains : [];
      if (e.target.checked) {
        if (!domains.includes(activeDomain)) domains.push(activeDomain);
        // "Always" wins over "Never" for this site
        const nd = await chrome.storage.local.get(['wtNeverDomains']);
        let neverDomains = Array.isArray(nd?.wtNeverDomains) ? nd.wtNeverDomains : [];
        if (neverDomains.includes(activeDomain)) {
          neverDomains = neverDomains.filter((d) => d !== activeDomain);
          await chrome.storage.local.set({ wtNeverDomains: neverDomains });
          $('chk-never-domain').checked = false;
        }
      } else {
        domains = domains.filter((d) => d !== activeDomain);
      }
      await chrome.storage.local.set({ wtAutoDomains: domains });
    });

    // Checkbox Auto Language
    $('chk-auto-lang').addEventListener('change', async (e) => {
      if (!activeLang) return;
      const data = await chrome.storage.local.get(['wtAutoLanguages']);
      let langs = Array.isArray(data?.wtAutoLanguages) ? data.wtAutoLanguages : [];
      if (e.target.checked) {
        if (!langs.includes(activeLang)) langs.push(activeLang);
        const nl = await chrome.storage.local.get(['wtNeverLanguages']);
        let neverLangs = Array.isArray(nl?.wtNeverLanguages) ? nl.wtNeverLanguages : [];
        if (neverLangs.includes(activeLang)) {
          neverLangs = neverLangs.filter((l) => l !== activeLang);
          await chrome.storage.local.set({ wtNeverLanguages: neverLangs });
          $('chk-never-lang').checked = false;
        }
      } else {
        langs = langs.filter((l) => l !== activeLang);
      }
      await chrome.storage.local.set({ wtAutoLanguages: langs });
    });

    // Checkbox Never Domain
    $('chk-never-domain').addEventListener('change', async (e) => {
      if (!activeDomain) return;
      const data = await chrome.storage.local.get(['wtNeverDomains']);
      let domains = Array.isArray(data?.wtNeverDomains) ? data.wtNeverDomains : [];
      if (e.target.checked) {
        if (!domains.includes(activeDomain)) domains.push(activeDomain);
        const ad = await chrome.storage.local.get(['wtAutoDomains']);
        let autoDomains = Array.isArray(ad?.wtAutoDomains) ? ad.wtAutoDomains : [];
        if (autoDomains.includes(activeDomain)) {
          autoDomains = autoDomains.filter((d) => d !== activeDomain);
          await chrome.storage.local.set({ wtAutoDomains: autoDomains });
          $('chk-auto-domain').checked = false;
        }
        if ($('chk-site')) {
          $('chk-site').checked = false;
          applySiteUI(false);
        }
        try {
          await sendToActiveTab({ type: 'WT_SET_DOMAIN_ENABLED', enabled: false });
        } catch {}
      } else {
        domains = domains.filter((d) => d !== activeDomain);
        if ($('chk-site')) {
          $('chk-site').checked = true;
          applySiteUI(true);
        }
      }
      await chrome.storage.local.set({ wtNeverDomains: domains });
    });

    // Checkbox Never Language
    $('chk-never-lang').addEventListener('change', async (e) => {
      if (!activeLang) return;
      const data = await chrome.storage.local.get(['wtNeverLanguages']);
      let langs = Array.isArray(data?.wtNeverLanguages) ? data.wtNeverLanguages : [];
      if (e.target.checked) {
        if (!langs.includes(activeLang)) langs.push(activeLang);
        const al = await chrome.storage.local.get(['wtAutoLanguages']);
        let autoLangs = Array.isArray(al?.wtAutoLanguages) ? al.wtAutoLanguages : [];
        if (autoLangs.includes(activeLang)) {
          autoLangs = autoLangs.filter((l) => l !== activeLang);
          await chrome.storage.local.set({ wtAutoLanguages: autoLangs });
          $('chk-auto-lang').checked = false;
        }
      } else {
        langs = langs.filter((l) => l !== activeLang);
      }
      await chrome.storage.local.set({ wtNeverLanguages: langs });
    });

    // Add domain manually in Tab 2
    $('btn-add-domain').addEventListener('click', async () => {
      const val = $('input-add-domain').value.trim().toLowerCase();
      if (!val) return;
      const data = await chrome.storage.local.get(['wtAutoDomains']);
      let domains = Array.isArray(data?.wtAutoDomains) ? data.wtAutoDomains : [];
      if (!domains.includes(val)) {
        domains.push(val);
        await chrome.storage.local.set({ wtAutoDomains: domains });
        $('input-add-domain').value = '';
        loadAutoDomains();
        if (val === activeDomain) $('chk-auto-domain').checked = true;
      }
    });

    // Add never-translate domain in Tab 2
    $('btn-add-never-domain').addEventListener('click', async () => {
      const val = $('input-add-never-domain').value.trim().toLowerCase();
      if (!val) return;
      const data = await chrome.storage.local.get(['wtNeverDomains']);
      let domains = Array.isArray(data?.wtNeverDomains) ? data.wtNeverDomains : [];
      if (!domains.includes(val)) {
        domains.push(val);
        await chrome.storage.local.set({ wtNeverDomains: domains });
        $('input-add-never-domain').value = '';
        loadNeverDomains();
        if (val === activeDomain) $('chk-never-domain').checked = true;
      }
    });

    // Add never-translate language in Tab 2
    $('btn-add-never-lang').addEventListener('click', async () => {
      const val = $('input-add-never-lang').value;
      if (!val) return;
      const data = await chrome.storage.local.get(['wtNeverLanguages']);
      const langs = Array.isArray(data?.wtNeverLanguages) ? data.wtNeverLanguages : [];
      if (!langs.includes(val)) {
        langs.push(val);
        await chrome.storage.local.set({ wtNeverLanguages: langs });
        loadNeverLanguages();
        if (val === activeLang) $('chk-never-lang').checked = true;
      }
    });

    // Ollama URL & Test
    $('btn-test-connection').addEventListener('click', async () => {
      const url = $('cfg-base-url').value.trim();
      $('connection-test-result').textContent = 'Teste Verbindung …';
      $('connection-test-result').style.color = 'var(--text-secondary)';
      const res = await WebTranslator.check(url);
      if (res.ok) {
        $('connection-test-result').textContent = `✓ Verbunden (${res.latency}ms). Gefundene Modelle: ${res.models.length}`;
        $('connection-test-result').style.color = 'var(--success)';
        populateModelSelect(res.models);
      } else {
        $('connection-test-result').textContent = `✗ ${res.error}`;
        $('connection-test-result').style.color = 'var(--danger)';
      }
    });

    // Engine Selector Switch
    const engineSel = $('cfg-engine');
    if (engineSel) {
      engineSel.value = currentConfig.engine || 'turbo';
      engineSel.addEventListener('change', async (e) => {
        currentConfig.engine = e.target.value;
        await WebTranslator.saveConfig({ engine: currentConfig.engine });
        updateEngineStatus();
      });
    }

    // Tone Selector (DeepL-Style Formality)
    const toneSel = $('cfg-tone');
    if (toneSel) {
      toneSel.value = currentConfig.tone || 'standard';
      toneSel.addEventListener('change', async (e) => {
        currentConfig.tone = e.target.value;
        await WebTranslator.saveConfig({ tone: currentConfig.tone });
      });
    }

    // Glossary Adder
    $('btn-add-glossary')?.addEventListener('click', async () => {
      const from = $('input-glossary-from')?.value.trim();
      const to = $('input-glossary-to')?.value.trim();
      if (!from || !to) return;
      const data = await chrome.storage.local.get(['wtGlossary']);
      const glossary = Array.isArray(data?.wtGlossary) ? data.wtGlossary : [];
      glossary.push({ from, to });
      await chrome.storage.local.set({ wtGlossary: glossary });
      if ($('input-glossary-from')) $('input-glossary-from').value = '';
      if ($('input-glossary-to')) $('input-glossary-to').value = '';
      loadGlossary();
    });

    $('cfg-model').addEventListener('change', async (e) => {
      currentConfig.model = e.target.value;
      await WebTranslator.saveConfig({ model: currentConfig.model });
      updateEngineStatus();
    });

    $('btn-refresh-models').addEventListener('click', () => {
      updateEngineStatus();
    });

    // Status pill click -> switch to settings
    $('ollama-status-pill').addEventListener('click', () => {
      switchTab('tab-auto');
    });

    // ========================================================
    // TAB 3: FREIER TEXT & SCHREIBASSISTENT (DEEPL-STIL)
    // ========================================================
    let activeFreeTone = 'standard';

    document.querySelectorAll('[data-free-tone]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-free-tone]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeFreeTone = btn.dataset.freeTone;
        if ($('free-output-text').value && !$('free-output-text').value.startsWith('Übersetze')) {
          $('btn-translate-free').click();
        }
      });
    });

    $('free-input-text')?.addEventListener('input', () => {
      if (typeof WebTranslator !== 'undefined' && WebTranslator.getTextStats) {
        const stats = WebTranslator.getTextStats($('free-input-text').value);
        $('free-input-stats').textContent = `${stats.chars} Zeichen • ${stats.words} Wörter`;
      }
    });

    // Free text tool (Tab 3)
    $('btn-translate-free').addEventListener('click', async () => {
      const text = $('free-input-text').value.trim();
      if (!text) return;
      $('btn-translate-free').disabled = true;
      $('free-output-text').value = 'Übersetze …';
      if ($('free-alts-box')) $('free-alts-box').style.display = 'none';

      try {
        const isTurbo = (currentConfig.engine || 'turbo') !== 'ollama';
        let res = '';
        if (isTurbo) {
          res = await WebTranslator.translateFast(text, $('target').value, $('source').value);
        } else {
          res = await WebTranslator.translate({
            text,
            sourceLang: $('source').value,
            targetLang: $('target').value,
            model: currentConfig.model,
            baseUrl: currentConfig.baseUrl,
            tone: activeFreeTone,
            stream: false
          });
        }

        // Apply Custom Glossary
        const gData = await chrome.storage.local.get(['wtGlossary']);
        if (typeof WebTranslator !== 'undefined' && WebTranslator.applyGlossary) {
          res = WebTranslator.applyGlossary(res, gData?.wtGlossary);
        }

        // Apply Formality Tone (Sie vs Du wie bei DeepL Pro)
        if (typeof WebTranslator !== 'undefined' && WebTranslator.adjustTone) {
          res = WebTranslator.adjustTone(res, $('target').value, activeFreeTone);
        }

        $('free-output-text').value = res;

        // Output stats
        if (typeof WebTranslator !== 'undefined' && WebTranslator.getTextStats) {
          const outStats = WebTranslator.getTextStats(res);
          $('free-output-stats').textContent = `${outStats.chars} Zeichen • ${outStats.words} Wörter`;
        }

        // DeepL-Style Alternatives
        if (typeof WebTranslator !== 'undefined' && WebTranslator.generateAlternatives) {
          const alts = WebTranslator.generateAlternatives(res, $('target').value, activeFreeTone);
          const altsBox = $('free-alts-box');
          const altsList = $('free-alts-list');
          if (alts.length > 0 && altsBox && altsList) {
            altsList.innerHTML = '';
            alts.forEach((alt) => {
              const b = document.createElement('button');
              b.className = 'tool-btn';
              b.style.textAlign = 'left';
              b.style.padding = '6px 8px';
              b.style.borderRadius = '6px';
              b.style.whiteSpace = 'normal';
              b.style.wordBreak = 'break-word';
              b.textContent = alt;
              b.onclick = () => {
                $('free-output-text').value = alt;
                const s = WebTranslator.getTextStats(alt);
                $('free-output-stats').textContent = `${s.chars} Zeichen • ${s.words} Wörter`;
              };
              altsList.appendChild(b);
            });
            altsBox.style.display = 'block';
          } else if (altsBox) {
            altsBox.style.display = 'none';
          }
        }
      } catch (err) {
        $('free-output-text').value = `Fehler: ${err.message}`;
      } finally {
        $('btn-translate-free').disabled = false;
      }
    });

    // Humanize / Menschlicher Umschreiben
    $('btn-free-humanize')?.addEventListener('click', () => {
      const srcText = $('free-output-text').value.trim() || $('free-input-text').value.trim();
      if (!srcText) return;
      let humanized = srcText;
      if (typeof WebTranslator !== 'undefined' && WebTranslator.humanizeText) {
        humanized = WebTranslator.humanizeText(humanized, $('target').value);
      }
      $('free-output-text').value = humanized;
      if (typeof WebTranslator !== 'undefined' && WebTranslator.getTextStats) {
        const s = WebTranslator.getTextStats(humanized);
        $('free-output-stats').textContent = `${s.chars} Zeichen • ${s.words} Wörter (🌿 Menschlich)`;
      }
    });

    // ReWrite / Textverbesserer (DeepL Write Stil)
    $('btn-free-rewrite')?.addEventListener('click', () => {
      const text = $('free-input-text').value.trim();
      if (!text) return;
      let improved = text.replace(/\s+/g, ' ');
      improved = improved.charAt(0).toUpperCase() + improved.slice(1);
      if (!/[.!?]$/.test(improved) && improved.length > 15) improved += '.';
      if (typeof WebTranslator !== 'undefined' && WebTranslator.adjustTone) {
        improved = WebTranslator.adjustTone(improved, 'Deutsch', activeFreeTone);
      }
      $('free-output-text').value = improved;
      if (typeof WebTranslator !== 'undefined' && WebTranslator.getTextStats) {
        const s = WebTranslator.getTextStats(improved);
        $('free-output-stats').textContent = `${s.chars} Zeichen • ${s.words} Wörter (Optimiert)`;
      }
    });

    // Copy free output
    $('btn-free-copy')?.addEventListener('click', async () => {
      const val = $('free-output-text').value;
      if (!val) return;
      await navigator.clipboard.writeText(val);
      $('btn-free-copy').textContent = '✓ Kopiert!';
      setTimeout(() => { $('btn-free-copy').textContent = '📋 Kopieren'; }, 1800);
    });

    // Speak free output
    $('btn-free-speak')?.addEventListener('click', () => {
      const val = $('free-output-text').value;
      if (!val) return;
      WebTranslator.speak(val, $('target').value);
    });

    $('btn-clear-free-text').addEventListener('click', () => {
      $('free-input-text').value = '';
      $('free-output-text').value = '';
      if ($('free-input-stats')) $('free-input-stats').textContent = '0 Zeichen • 0 Wörter';
      if ($('free-output-stats')) $('free-output-stats').textContent = '0 Zeichen • 0 Wörter';
      if ($('free-alts-box')) $('free-alts-box').style.display = 'none';
    });
  }

  function updateQuickChips() {
    const s = $('source').value;
    const t = $('target').value;
    document.querySelectorAll('.chip-btn').forEach((c) => {
      c.classList.toggle('active', c.dataset.source === s && c.dataset.target === t);
    });
  }

  // Initialize
  async function init() {
    currentConfig = await WebTranslator.getConfig();
    applyTheme(currentConfig.theme);

    populateLanguages();
    populateNeverLangSelect();
    setupEvents();
    await loadCurrentPage();
    applyEnabledUI(currentConfig.enabled !== false);
    applyBannerUI(currentConfig.showFloatingButton !== false);
    loadGlossary();

    $('cfg-base-url').value = currentConfig.baseUrl || 'http://127.0.0.1:11434';
    updateEngineStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
