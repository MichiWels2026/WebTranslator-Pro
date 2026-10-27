(() => {
  if (window.__webtranslator_pro_injected__) return;
  window.__webtranslator_pro_injected__ = true;

  const clean = (val) => String(val || '').replace(/\s+/g, ' ').trim();

  // Global master switch – cached so selection handling stays synchronous
  let globalEnabled = true;
  try {
    chrome.storage.local.get(['wtConfig'], (res) => {
      if (chrome.runtime?.lastError) return;
      if (res?.wtConfig && res.wtConfig.enabled === false) globalEnabled = false;
    });
  } catch {}

  function getSelectionText() {
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed) {
      return String(sel).trim().slice(0, 15000);
    }
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|url|tel)$/i.test(el.type)))) {
      const s = el.selectionStart;
      const e = el.selectionEnd;
      if (typeof s === 'number' && typeof e === 'number' && e > s) {
        return el.value.slice(s, e).trim().slice(0, 15000);
      }
    }
    return '';
  }

  function getPageStatus() {
    const inst = window.__webTranslatorPageInstance;
    return {
      isTranslating: inst?.isTranslating || false,
      isTranslated: inst?.isTranslated || false,
      isShowingOriginal: inst?.isShowingOriginal || false,
      completedUnits: inst?.completedUnits || 0,
      totalUnits: inst?.totalUnits || 0,
      targetLang: inst?.targetLang || 'Deutsch',
      detectedLang: inst?.detectedLang || inst?.detectSourceLanguage?.() || document.documentElement.lang || navigator.language || 'en'
    };
  }

  // ========================================================
  // INLINE TEXT SELECTION TRANSLATOR (PRO FEATURE)
  // ========================================================
  class SelectionTranslator {
    constructor() {
      this.hostEl = null;
      this.shadow = null;
      this.pillEl = null;
      this.cardEl = null;
      this.currentText = '';
      this.currentTranslation = '';
      this.currentTargetLang = 'Deutsch';
      this.currentTone = 'standard'; // 'standard', 'formal' (Sie), 'informal' (Du)
      this.inputTarget = null; // { el, start, end } if selected in input/textarea
      this.savedRange = null;
      this.init();
    }

    init() {
      // Create Shadow DOM host
      this.hostEl = document.createElement('div');
      this.hostEl.id = 'webtranslator-selection-host';
      this.hostEl.style.position = 'absolute';
      this.hostEl.style.top = '0';
      this.hostEl.style.left = '0';
      this.hostEl.style.zIndex = '2147483647';
      this.hostEl.style.pointerEvents = 'none';

      this.shadow = this.hostEl.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        * { font-family: arial, "Segoe UI", Roboto, -apple-system, BlinkMacSystemFont, sans-serif; }
        .wt-sel-pill {
          pointer-events: auto;
          position: fixed;
          z-index: 2147483647;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #ffffff;
          color: #1a73e8;
          font-size: 12px;
          font-weight: 700;
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid #dadce0;
          box-shadow: 0 2px 10px rgba(60, 64, 67, 0.28);
          cursor: pointer;
          user-select: none;
          animation: wtFadeIn 0.15s ease-out;
          transition: transform 0.1s, box-shadow 0.15s, background 0.15s;
        }
        .wt-sel-pill:hover {
          transform: translateY(-1px) scale(1.04);
          background: #f1f6fd;
          box-shadow: 0 4px 16px rgba(60, 64, 67, 0.32);
        }
        .wt-sel-pill .gold-bolt { color: #1a73e8; font-size: 13px; }

        .wt-sel-card {
          pointer-events: auto;
          position: fixed;
          z-index: 2147483647;
          width: 350px;
          max-width: calc(100vw - 32px);
          background: #ffffff;
          border: 1px solid #dadce0;
          border-radius: 12px;
          box-shadow: 0 8px 28px rgba(60, 64, 67, 0.3);
          color: #202124;
          overflow: hidden;
          animation: wtFadeIn 0.15s ease-out;
          user-select: text;
        }
        .wt-sel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 9px 12px;
          background: #ffffff;
          border-bottom: 1px solid #e8eaed;
          gap: 8px;
        }
        .wt-sel-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-weight: 700;
          color: #1a73e8;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .wt-sel-header-right { display: flex; align-items: center; gap: 6px; }
        .wt-sel-select {
          background: #ffffff;
          color: #202124;
          border: 1px solid #dadce0;
          border-radius: 6px;
          padding: 3px 6px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          outline: none;
        }
        .wt-sel-select:focus { border-color: #1a73e8; }
        .wt-sel-close {
          background: transparent;
          border: none;
          color: #5f6368;
          font-size: 14px;
          cursor: pointer;
          padding: 2px 5px;
          border-radius: 4px;
          line-height: 1;
        }
        .wt-sel-close:hover { color: #202124; background: #f1f3f4; }

        /* Tone & Style Bar */
        .wt-tone-row {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 10px;
          background: #f8f9fa;
          border-bottom: 1px solid #e8eaed;
          overflow-x: auto;
        }
        .wt-tone-btn {
          background: transparent;
          border: 1px solid #dadce0;
          color: #5f6368;
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 10.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .wt-tone-btn:hover { color: #1a73e8; border-color: #1a73e8; }
        .wt-tone-btn.active {
          background: #1a73e8;
          border-color: #1a73e8;
          color: #ffffff;
        }
        .wt-tone-btn.human { border-color: #1e8e3e; color: #137333; }
        .wt-tone-btn.human:hover, .wt-tone-btn.human.active {
          background: #1e8e3e;
          border-color: #1e8e3e;
          color: #ffffff;
        }
        .wt-tone-btn.rewrite { border-color: #1a73e8; color: #1a73e8; margin-left: auto; }
        .wt-tone-btn.rewrite:hover, .wt-tone-btn.rewrite.active {
          background: #e8f0fe;
        }

        .wt-sel-body {
          padding: 10px 12px;
          max-height: 240px;
          overflow-y: auto;
          font-size: 13px;
          line-height: 1.45;
        }
        .wt-sel-orig {
          font-size: 11px;
          color: #5f6368;
          margin-bottom: 6px;
          padding-bottom: 6px;
          border-bottom: 1px dashed #e8eaed;
          word-break: break-word;
        }
        .wt-sel-trans { color: #202124; font-weight: 500; word-break: break-word; }
        .wt-sel-loading {
          color: #1a73e8;
          font-size: 12px;
          font-style: italic;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        /* Alternatives Section */
        .wt-sel-alts { margin-top: 10px; padding-top: 8px; border-top: 1px solid #e8eaed; }
        .wt-alts-label {
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          color: #1a73e8;
          margin-bottom: 5px;
          letter-spacing: 0.03em;
        }
        .wt-alts-list { display: flex; flex-direction: column; gap: 4px; }
        .wt-alt-chip {
          background: #f8f9fa;
          border: 1px solid #e8eaed;
          border-radius: 6px;
          padding: 4px 8px;
          color: #3c4043;
          font-size: 11.5px;
          cursor: pointer;
          text-align: left;
          transition: all 0.15s;
          word-break: break-word;
        }
        .wt-alt-chip:hover { background: #e8f0fe; color: #1a73e8; border-color: #1a73e8; }

        .wt-sel-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 7px 10px;
          background: #f8f9fa;
          border-top: 1px solid #e8eaed;
        }
        .wt-sel-stats { font-size: 10.5px; color: #5f6368; }
        .wt-sel-actions { display: flex; align-items: center; gap: 5px; }
        .wt-sel-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: #ffffff;
          color: #1a73e8;
          border: 1px solid #dadce0;
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        .wt-sel-btn:hover { background: #e8f0fe; border-color: #1a73e8; }
        .wt-sel-btn.success { background: #1e8e3e; border-color: #1e8e3e; color: #ffffff; }
        @keyframes wtFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }

        /* Dark mode (respects system) */
        @media (prefers-color-scheme: dark) {
          .wt-sel-pill { background: #202124; color: #8ab4f8; border-color: #5f6368; }
          .wt-sel-pill:hover { background: #292a2d; }
          .wt-sel-pill .gold-bolt { color: #8ab4f8; }
          .wt-sel-card { background: #202124; color: #e8eaed; border-color: #5f6368; }
          .wt-sel-header { background: #202124; border-bottom-color: #3c4043; }
          .wt-sel-badge { color: #8ab4f8; }
          .wt-sel-select { background: #202124; color: #e8eaed; border-color: #5f6368; }
          .wt-sel-select:focus { border-color: #8ab4f8; }
          .wt-sel-close { color: #9aa0a6; }
          .wt-sel-close:hover { color: #e8eaed; background: #292a2d; }
          .wt-tone-row { background: #202124; border-bottom-color: #3c4043; }
          .wt-tone-btn { border-color: #5f6368; color: #9aa0a6; }
          .wt-tone-btn:hover { color: #8ab4f8; border-color: #8ab4f8; }
          .wt-tone-btn.active { background: #8ab4f8; border-color: #8ab4f8; color: #202124; }
          .wt-tone-btn.human { border-color: #81c995; color: #81c995; }
          .wt-tone-btn.human:hover, .wt-tone-btn.human.active { background: #81c995; border-color: #81c995; color: #202124; }
          .wt-tone-btn.rewrite { border-color: #8ab4f8; color: #8ab4f8; }
          .wt-tone-btn.rewrite:hover { background: #28405c; }
          .wt-sel-orig { color: #9aa0a6; border-bottom-color: #3c4043; }
          .wt-sel-trans { color: #e8eaed; }
          .wt-sel-loading { color: #8ab4f8; }
          .wt-sel-alts { border-top-color: #3c4043; }
          .wt-alts-label { color: #8ab4f8; }
          .wt-alt-chip { background: #292a2d; border-color: #3c4043; color: #e8eaed; }
          .wt-alt-chip:hover { background: #28405c; color: #8ab4f8; border-color: #8ab4f8; }
          .wt-sel-footer { background: #202124; border-top-color: #3c4043; }
          .wt-sel-stats { color: #9aa0a6; }
          .wt-sel-btn { background: #202124; color: #8ab4f8; border-color: #5f6368; }
          .wt-sel-btn:hover { background: #28405c; border-color: #8ab4f8; }
          .wt-sel-btn.success { background: #81c995; border-color: #81c995; color: #202124; }
        }
      `;
      this.shadow.appendChild(style);
      document.documentElement.appendChild(this.hostEl);

      // Listen for text selection
      document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
      document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          this.checkSelection();
        }
      });

      // Dismiss on click outside
      document.addEventListener('mousedown', (e) => {
        if (this.hostEl && (e.target === this.hostEl || this.hostEl.contains(e.target))) return;
        if (e.composedPath && e.composedPath().includes(this.hostEl)) return;
        this.hidePill();
        if (this.cardEl && !this.cardEl.contains(e.target)) {
          this.hideCard();
        }
      });

      // Dismiss on Escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.hidePill();
          this.hideCard();
        }
      });
    }

    handleMouseUp(e) {
      // Don't trigger if clicking inside our own card or toolbar
      if (e.target?.closest?.('#webtranslator-selection-host, #webtranslator-pro-bar-host, #webtranslator-pro-host')) {
        return;
      }
      setTimeout(() => this.checkSelection(), 30);
    }

    checkSelection() {
      // Global master switch: no pill, no card while the translator is off
      if (!globalEnabled) {
        this.hidePill();
        this.hideCard();
        return;
      }

      const text = getSelectionText();
      if (!text || text.length < 2 || !/\p{L}/u.test(text)) {
        this.hidePill();
        return;
      }

      this.currentText = text;

      // Check if inside editable input/textarea
      const el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|url|tel)$/i.test(el.type)))) {
        const s = el.selectionStart;
        const e = el.selectionEnd;
        if (typeof s === 'number' && typeof e === 'number' && e > s) {
          this.inputTarget = { el, start: s, end: e };
          const rect = el.getBoundingClientRect();
          this.showPill(rect);
          return;
        }
      } else {
        this.inputTarget = null;
      }

      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        this.savedRange = range.cloneRange();
        const rect = range.getBoundingClientRect();
        if (rect && (rect.width > 0 || rect.height > 0)) {
          this.showPill(rect);
        }
      }
    }

    showPill(rect) {
      this.hidePill();
      if (this.cardEl) return; // Don't show pill if card is already open

      const pill = document.createElement('div');
      pill.className = 'wt-sel-pill';
      pill.innerHTML = `<span class="gold-bolt">⚡</span> Übersetzen`;

      // Position pill near bottom-right of selection
      let left = Math.min(rect.right + 6, window.innerWidth - 130);
      let top = rect.bottom + 8;
      if (top > window.innerHeight - 45) {
        top = Math.max(10, rect.top - 38);
      }
      if (left < 10) left = 10;

      pill.style.left = `${left}px`;
      pill.style.top = `${top}px`;

      pill.onclick = (e) => {
        e.stopPropagation();
        this.hidePill();
        this.showCard(rect, this.currentText);
      };

      this.pillEl = pill;
      this.shadow.appendChild(pill);
    }

    hidePill() {
      if (this.pillEl) {
        this.pillEl.remove();
        this.pillEl = null;
      }
    }

    hideCard() {
      if (this.cardEl) {
        this.cardEl.remove();
        this.cardEl = null;
      }
    }

    async showCard(rect, text) {
      this.hideCard();
      this.hidePill();

      const card = document.createElement('div');
      card.className = 'wt-sel-card';

      // Load preferred target language & tone
      try {
        const stored = await chrome.storage.local.get(['wtConfig']);
        if (stored?.wtConfig?.defaultTarget) {
          this.currentTargetLang = stored.wtConfig.defaultTarget;
        }
        if (stored?.wtConfig?.tone) {
          this.currentTone = stored.wtConfig.tone;
        }
      } catch {}

      // Calculate position
      let left = Math.min(rect.left, window.innerWidth - 365);
      if (left < 10) left = 10;
      let top = rect.bottom + 10;
      if (top > window.innerHeight - 280) {
        top = Math.max(10, rect.top - 260);
      }

      card.style.left = `${left}px`;
      card.style.top = `${top}px`;

      const origSnippet = text.length > 90 ? text.slice(0, 90) + '…' : text;

      card.innerHTML = `
        <div class="wt-sel-header">
          <div class="wt-sel-badge">🌐 Übersetzung</div>
          <div class="wt-sel-header-right">
            <select class="wt-sel-select" id="wt-sel-target-lang">
              <option value="Deutsch" ${this.currentTargetLang === 'Deutsch' ? 'selected' : ''}>Deutsch</option>
              <option value="Türkisch" ${this.currentTargetLang === 'Türkisch' ? 'selected' : ''}>Türkisch</option>
              <option value="Bosnisch" ${this.currentTargetLang === 'Bosnisch' ? 'selected' : ''}>Bosnisch</option>
              <option value="Kroatisch" ${this.currentTargetLang === 'Kroatisch' ? 'selected' : ''}>Kroatisch</option>
              <option value="Serbisch" ${this.currentTargetLang === 'Serbisch' ? 'selected' : ''}>Serbisch</option>
              <option value="Englisch" ${this.currentTargetLang === 'Englisch' ? 'selected' : ''}>Englisch</option>
              <option value="Französisch" ${this.currentTargetLang === 'Französisch' ? 'selected' : ''}>Französisch</option>
              <option value="Spanisch" ${this.currentTargetLang === 'Spanisch' ? 'selected' : ''}>Spanisch</option>
              <option value="Italienisch" ${this.currentTargetLang === 'Italienisch' ? 'selected' : ''}>Italienisch</option>
              <option value="Niederländisch" ${this.currentTargetLang === 'Niederländisch' ? 'selected' : ''}>Niederländisch</option>
              <option value="Polnisch" ${this.currentTargetLang === 'Polnisch' ? 'selected' : ''}>Polnisch</option>
              <option value="Russisch" ${this.currentTargetLang === 'Russisch' ? 'selected' : ''}>Russisch</option>
              <option value="Ukrainisch" ${this.currentTargetLang === 'Ukrainisch' ? 'selected' : ''}>Ukrainisch</option>
              <option value="Arabisch" ${this.currentTargetLang === 'Arabisch' ? 'selected' : ''}>Arabisch</option>
            </select>
            <button class="wt-sel-close" id="wt-sel-btn-close" type="button" title="Schließen">✕</button>
          </div>
        </div>

        <!-- DeepL-Style Tonalität (Sie vs Du) & ReWrite Bar -->
        <div class="wt-tone-row">
          <button class="wt-tone-btn ${this.currentTone === 'standard' ? 'active' : ''}" data-tone="standard" type="button">⚡ Auto</button>
          <button class="wt-tone-btn human ${this.currentTone === 'human' ? 'active' : ''}" data-tone="human" type="button" title="Menschlicher Sprachfluss wie von einem Muttersprachler">🌿 Menschlich</button>
          <button class="wt-tone-btn ${this.currentTone === 'formal' ? 'active' : ''}" data-tone="formal" type="button" title="Formeller Business-Stil (Sie)">👔 Sie</button>
          <button class="wt-tone-btn ${this.currentTone === 'informal' ? 'active' : ''}" data-tone="informal" type="button" title="Lockerer Umgangston (Du)">🤝 Du</button>
          <button class="wt-tone-btn rewrite" id="wt-sel-btn-humanize" type="button" title="Text menschlicher & natürlicher umschreiben">🌿 Umschreiben</button>
        </div>

        <div class="wt-sel-body">
          <div class="wt-sel-orig">${origSnippet.replace(/</g, '&lt;')}</div>
          <div class="wt-sel-trans" id="wt-sel-trans-content">
            <div class="wt-sel-loading">⚡ Übersetze in ${this.currentTargetLang} …</div>
          </div>
          <!-- DeepL Alternatives section -->
          <div class="wt-sel-alts" id="wt-sel-alts" style="display: none;">
            <div class="wt-alts-label">Alternative Formulierungen:</div>
            <div class="wt-alts-list" id="wt-sel-alts-list"></div>
          </div>
        </div>

        <div class="wt-sel-footer">
          <span class="wt-sel-stats" id="wt-sel-stats">0 Zeichen • 0 Wörter</span>
          <div class="wt-sel-actions">
            ${this.inputTarget ? '<button class="wt-sel-btn" id="wt-sel-btn-replace" type="button">✏️ Ersetzen</button>' : ''}
            <button class="wt-sel-btn" id="wt-sel-btn-copy" type="button">📋 Kopieren</button>
            <button class="wt-sel-btn" id="wt-sel-btn-speak" type="button">🔊 Vorlesen</button>
          </div>
        </div>
      `;

      this.shadow.appendChild(card);
      this.cardEl = card;

      // Event handlers
      const btnClose = card.querySelector('#wt-sel-btn-close');
      btnClose.onclick = () => this.hideCard();

      const langSelect = card.querySelector('#wt-sel-target-lang');
      langSelect.onchange = () => {
        this.currentTargetLang = langSelect.value;
        this.executeSnippetTranslation(text);
      };

      // Tone switcher buttons (Sie vs Du vs Standard)
      card.querySelectorAll('.wt-tone-btn[data-tone]').forEach((btn) => {
        btn.onclick = () => {
          card.querySelectorAll('.wt-tone-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          this.currentTone = btn.dataset.tone;
          this.executeSnippetTranslation(text);
        };
      });

      // Humanize button
      const btnHumanize = card.querySelector('#wt-sel-btn-humanize');
      if (btnHumanize) {
        btnHumanize.onclick = () => {
          this.executeSnippetHumanize();
        };
      }

      const btnCopy = card.querySelector('#wt-sel-btn-copy');
      btnCopy.onclick = async () => {
        if (!this.currentTranslation) return;
        try {
          await navigator.clipboard.writeText(this.currentTranslation);
          btnCopy.textContent = '✓ Kopiert!';
          btnCopy.classList.add('success');
          setTimeout(() => {
            btnCopy.textContent = '📋 Kopieren';
            btnCopy.classList.remove('success');
          }, 1800);
        } catch {}
      };

      const btnSpeak = card.querySelector('#wt-sel-btn-speak');
      btnSpeak.onclick = () => {
        if (!this.currentTranslation) return;
        if (typeof WebTranslator !== 'undefined' && WebTranslator.speak) {
          WebTranslator.speak(this.currentTranslation, this.currentTargetLang);
        } else if ('speechSynthesis' in window) {
          const u = new SpeechSynthesisUtterance(this.currentTranslation);
          window.speechSynthesis.speak(u);
        }
      };

      const btnReplace = card.querySelector('#wt-sel-btn-replace');
      if (btnReplace && this.inputTarget) {
        btnReplace.onclick = () => {
          if (!this.currentTranslation || !this.inputTarget?.el) return;
          const { el, start, end } = this.inputTarget;
          el.focus();
          el.setRangeText(this.currentTranslation, start, end, 'end');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          this.hideCard();
        };
      }

      // Execute translation immediately
      this.executeSnippetTranslation(text);
    }

    async executeSnippetTranslation(text) {
      const transEl = this.cardEl?.querySelector('#wt-sel-trans-content');
      const statsEl = this.cardEl?.querySelector('#wt-sel-stats');
      const altsBox = this.cardEl?.querySelector('#wt-sel-alts');
      const altsList = this.cardEl?.querySelector('#wt-sel-alts-list');

      if (transEl) {
        transEl.innerHTML = `<div class="wt-sel-loading">⚡ Übersetze in ${this.currentTargetLang} …</div>`;
      }
      if (altsBox) altsBox.style.display = 'none';

      try {
        let trans = await this.translateText(text, this.currentTargetLang);

        // Apply Custom Glossary (Wörterbuch-Regeln)
        try {
          const gData = await chrome.storage.local.get(['wtGlossary']);
          if (typeof WebTranslator !== 'undefined' && WebTranslator.applyGlossary) {
            trans = WebTranslator.applyGlossary(trans, gData?.wtGlossary);
          }
        } catch {}

        // Apply Tone (Sie vs Du formality like DeepL Pro)
        if (typeof WebTranslator !== 'undefined' && WebTranslator.adjustTone) {
          trans = WebTranslator.adjustTone(trans, this.currentTargetLang, this.currentTone);
        }

        this.currentTranslation = trans;

        if (transEl && this.cardEl) {
          transEl.innerHTML = trans.replace(/</g, '&lt;').replace(/\n/g, '<br>');
        }

        // Update Text Statistics
        if (statsEl && typeof WebTranslator !== 'undefined' && WebTranslator.getTextStats) {
          const stats = WebTranslator.getTextStats(trans);
          statsEl.textContent = `${stats.chars} Zeichen • ${stats.words} Wörter`;
        }

        // Generate DeepL-Style Alternatives
        if (altsBox && altsList && typeof WebTranslator !== 'undefined' && WebTranslator.generateAlternatives) {
          const alts = WebTranslator.generateAlternatives(trans, this.currentTargetLang, this.currentTone);
          if (alts.length > 0) {
            altsList.innerHTML = '';
            alts.forEach((alt) => {
              const chip = document.createElement('div');
              chip.className = 'wt-alt-chip';
              chip.textContent = alt;
              chip.onclick = () => {
                this.currentTranslation = alt;
                if (transEl) transEl.innerHTML = alt.replace(/</g, '&lt;').replace(/\n/g, '<br>');
                if (statsEl) {
                  const s = WebTranslator.getTextStats(alt);
                  statsEl.textContent = `${s.chars} Zeichen • ${s.words} Wörter`;
                }
              };
              altsList.appendChild(chip);
            });
            altsBox.style.display = 'block';
          } else {
            altsBox.style.display = 'none';
          }
        }
      } catch (err) {
        if (transEl && this.cardEl) {
          transEl.innerHTML = `<span style="color: #ef4444;">Fehler: ${err.message}</span>`;
        }
      }
    }

    async executeSnippetRewrite(text) {
      const transEl = this.cardEl?.querySelector('#wt-sel-trans-content');
      const statsEl = this.cardEl?.querySelector('#wt-sel-stats');
      const altsBox = this.cardEl?.querySelector('#wt-sel-alts');

      if (transEl) {
        transEl.innerHTML = `<div class="wt-sel-loading">✨ Verbessere Stil & Grammatik …</div>`;
      }
      if (altsBox) altsBox.style.display = 'none';

      try {
        let improved = text.trim();
        improved = improved.replace(/\s+/g, ' ');
        if (improved.length > 0) {
          improved = improved.charAt(0).toUpperCase() + improved.slice(1);
        }
        if (!/[.!?]$/.test(improved) && improved.length > 15) {
          improved += '.';
        }

        if (typeof WebTranslator !== 'undefined' && WebTranslator.adjustTone) {
          improved = WebTranslator.adjustTone(improved, 'Deutsch', this.currentTone);
        }

        this.currentTranslation = improved;
        if (transEl) transEl.innerHTML = improved.replace(/</g, '&lt;');
        if (statsEl && typeof WebTranslator !== 'undefined' && WebTranslator.getTextStats) {
          const stats = WebTranslator.getTextStats(improved);
          statsEl.textContent = `${stats.chars} Zeichen • ${stats.words} Wörter (Optimiert)`;
        }
      } catch (err) {
        if (transEl) transEl.innerHTML = `<span style="color: #ef4444;">Fehler: ${err.message}</span>`;
      }
    }

    async executeSnippetHumanize() {
      const transEl = this.cardEl?.querySelector('#wt-sel-trans-content');
      const statsEl = this.cardEl?.querySelector('#wt-sel-stats');
      const altsBox = this.cardEl?.querySelector('#wt-sel-alts');

      const textToHumanize = this.currentTranslation || this.currentText;
      if (!textToHumanize) return;

      if (transEl) {
        transEl.innerHTML = `<div class="wt-sel-loading">🌿 Formuliere menschlich & natürlich um …</div>`;
      }
      if (altsBox) altsBox.style.display = 'none';

      try {
        let humanized = textToHumanize;
        if (typeof WebTranslator !== 'undefined' && WebTranslator.humanizeText) {
          humanized = WebTranslator.humanizeText(humanized, this.currentTargetLang);
        }

        this.currentTranslation = humanized;
        if (transEl) transEl.innerHTML = humanized.replace(/</g, '&lt;').replace(/\n/g, '<br>');
        if (statsEl && typeof WebTranslator !== 'undefined' && WebTranslator.getTextStats) {
          const stats = WebTranslator.getTextStats(humanized);
          statsEl.textContent = `${stats.chars} Zeichen • ${stats.words} Wörter (🌿 Menschlich)`;
        }
      } catch (err) {
        if (transEl) transEl.innerHTML = `<span style="color: #ef4444;">Fehler: ${err.message}</span>`;
      }
    }

    async translateText(text, targetLang) {
      const tl = WebTranslator?.LANG_CODES?.[targetLang] || 'de';

      // 1. Direct fetch (0.2s)
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data[0])) {
            const out = data[0].map((p) => p[0] || '').join('');
            if (out) return out;
          }
        }
      } catch (e) {}

      // 2. Background bridge
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'WT_TRANSLATE_BATCH_TURBO',
            text,
            sourceLang: 'auto',
            targetLang
          },
          (response) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!response?.ok) return reject(new Error(response?.error || 'Turbo API Fehler'));
            resolve(response.content || '');
          }
        );
      });
    }

    showForCurrentSelection(explicitText) {
      const text = explicitText || getSelectionText();
      if (!text) return;
      this.currentText = text;

      let rect = {
        left: window.innerWidth / 2 - 160,
        right: window.innerWidth / 2 + 160,
        top: window.innerHeight / 2 - 100,
        bottom: window.innerHeight / 2
      };

      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r && (r.width > 0 || r.height > 0)) {
          rect = r;
        }
      }

      this.showCard(rect, text);
    }
  }

  // Instantiate Selection Translator
  const selectionTranslator = new SelectionTranslator();

  // Listen for messages from background / popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Page Status query
    if (message?.type === 'WT_GET_PAGE_STATUS') {
      sendResponse(getPageStatus());
      return false;
    }

    // Context Menu: Translate selected text
    if (message?.type === 'WT_TRIGGER_INLINE_TRANSLATION') {
      if (!globalEnabled) {
        sendResponse({ ok: false, error: 'Übersetzer ist deaktiviert' });
        return false;
      }
      selectionTranslator.showForCurrentSelection(message.text);
      sendResponse({ ok: true });
      return false;
    }

    // Start in-place page translation
    if (message?.type === 'WT_START_PAGE_TRANSLATION') {
      const inst = window.__webTranslatorPageInstance;
      if (inst) {
        inst.functionTranslatePage(message.targetLang || 'Deutsch', message.sourceLang);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'DOM Translator nicht geladen' });
      }
      return false;
    }

    // Toggle between Original and Translation
    if (message?.type === 'WT_TOGGLE_PAGE_TRANSLATION') {
      const inst = window.__webTranslatorPageInstance;
      if (inst) {
        inst.toggleOriginalTranslation();
        sendResponse({ ok: true, isShowingOriginal: inst.isShowingOriginal });
      } else {
        sendResponse({ ok: false });
      }
      return false;
    }

    // Restore Original Page
    if (message?.type === 'WT_RESTORE_PAGE_ORIGINAL') {
      const inst = window.__webTranslatorPageInstance;
      if (inst) {
        inst.restoreOriginal();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
      return false;
    }

    // Global master switch: enable / disable the translator on this page
    if (message?.type === 'WT_SET_ENABLED') {
      globalEnabled = message.enabled !== false;
      const inst = window.__webTranslatorPageInstance;
      if (message.enabled === false) {
        // Completely off: restore the original page and remove every overlay
        if (inst) {
          try { inst.restoreOriginal(); } catch {}
          try { inst.removeInPageBar(); } catch {}
        }
        try { selectionTranslator.hideCard?.(); } catch {}
      } else if (inst) {
        // Back on: refresh the bubble state for the current page
        try { inst.checkAutoTranslate(); } catch {}
      }
      sendResponse({ ok: true });
      return false;
    }

    // Banner on / off: hiding it removes the bubble from the current page
    if (message?.type === 'WT_SET_BANNER') {
      const inst = window.__webTranslatorPageInstance;
      if (inst) {
        if (message.show === false) {
          try { inst.removeInPageBar(); } catch {}
        } else if (message.show === true) {
          try { inst.showInPageBar(); } catch {}
        }
      }
      sendResponse({ ok: true });
      return false;
    }

    // Domain enabled / disabled toggle on current tab
    if (message?.type === 'WT_SET_DOMAIN_ENABLED') {
      const inst = window.__webTranslatorPageInstance;
      if (inst) {
        if (message.enabled === false) {
          try {
            if (inst.isTranslated) inst.restoreOriginal();
            inst.removeInPageBar();
          } catch {}
        }
      }
      sendResponse({ ok: true });
      return false;
    }

    // Show floating bar explicitly
    if (message?.type === 'WT_SHOW_PAGE_BAR') {
      const inst = window.__webTranslatorPageInstance;
      if (inst) {
        inst.showInPageBar();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
      return false;
    }

    // Selection Text Query
    if (message?.type === 'WT_GET_SELECTION') {
      sendResponse({
        text: getSelectionText(),
        title: clean(document.title),
        url: location.href
      });
      return false;
    }

    return false;
  });
})();
