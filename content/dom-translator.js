(() => {
  console.log('[Forge WebTRANSLATOR OmniLingo] Content-Script aktiv:', location.href);
  // DOM Translation Engine for WebTranslator PRO
  // Translates entire web pages in-place, preserving DOM structure, attributes, styles, and links.

  const IGNORED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'SVG', 'CANVAS',
    'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'TEMPLATE', 'IFRAME',
    'AUDIO', 'VIDEO', 'OBJECT', 'EMBED', 'HEAD', 'META', 'LINK'
  ]);

  const BLOCK_TAGS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE',
    'TD', 'TH', 'CAPTION', 'FIGCAPTION', 'ARTICLE', 'SECTION',
    'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'MAIN', 'DIV'
  ]);

  // Map BCP-47 base codes -> German language names (reverse of WebTranslator.LANG_CODES)
  const CODE_TO_NAME = {
    de: 'Deutsch', en: 'Englisch', tr: 'Türkisch', bs: 'Bosnisch', hr: 'Kroatisch',
    sr: 'Serbisch', fr: 'Französisch', es: 'Spanisch', it: 'Italienisch', nl: 'Niederländisch',
    pl: 'Polnisch', pt: 'Portugiesisch', uk: 'Ukrainisch', ru: 'Russisch',
    'zh-cn': 'Chinesisch (vereinfacht)', 'zh-tw': 'Chinesisch (traditionell)',
    ja: 'Japanisch', ko: 'Koreanisch', ar: 'Arabisch', el: 'Griechisch', cs: 'Tschechisch',
    sv: 'Schwedisch', da: 'Dänisch', fi: 'Finnisch', no: 'Norwegisch', hu: 'Ungarisch',
    ro: 'Rumänisch', hi: 'Hindi', vi: 'Vietnamesisch', id: 'Indonesisch'
  };

  // Common stop-words for a lightweight, privacy-friendly language guess when <html lang> is missing
  const STOPWORDS = {
    'Englisch': ['the', 'and', 'with', 'you', 'that', 'this', 'have', 'for', 'from', 'about', 'which', 'their', 'would', 'there', 'your', 'not'],
    'Deutsch': ['der', 'die', 'und', 'den', 'von', 'mit', 'das', 'ist', 'für', 'auf', 'sich', 'dem', 'nicht', 'ein', 'eine', 'zu', 'des', 'als', 'auch', 'es'],
    'Französisch': ['le', 'la', 'les', 'des', 'est', 'une', 'dans', 'pour', 'qui', 'sur', 'pas', 'vous', 'nous', 'avec', 'que', 'aux'],
    'Spanisch': ['el', 'la', 'los', 'las', 'de', 'que', 'en', 'un', 'una', 'por', 'con', 'no', 'para', 'es', 'se', 'su', 'más'],
    'Italienisch': ['il', 'lo', 'la', 'gli', 'le', 'di', 'che', 'per', 'un', 'una', 'con', 'non', 'si', 'del', 'della', 'sono'],
    'Niederländisch': ['de', 'het', 'een', 'en', 'van', 'is', 'op', 'te', 'dat', 'die', 'niet', 'met', 'voor', 'zijn', 'aan', 'niet'],
    'Portugiesisch': ['o', 'a', 'os', 'as', 'de', 'que', 'em', 'um', 'uma', 'para', 'com', 'não', 'se', 'do', 'da', 'são'],
    'Türkisch': ['ve', 'bir', 'bu', 'için', 'ile', 'olarak', 'daha', 'çok', 'ama', 'veya', 'gibi'],
    'Polnisch': ['i', 'w', 'na', 'z', 'do', 'nie', 'się', 'że', 'jest', 'jak', 'ale', 'przez', 'jak'],
    'Russisch': ['и', 'в', 'на', 'с', 'не', 'что', 'по', 'для', 'это', 'как', 'но', 'за', 'от'],
    'Schwedisch': ['och', 'att', 'det', 'som', 'en', 'på', 'för', 'med', 'av', 'till', 'den', 'inte']
  };

  class PageTranslator {
    constructor() {
      this.isTranslating = false;
      this.isTranslated = false;
      this.isShowingOriginal = false;
      this.sourceLang = 'Automatisch erkennen';
      this.targetLang = 'Deutsch';
      this.detectedLang = null;
      this.units = []; // Array of { id, node, originalText, translatedText }
      this.totalUnits = 0;
      this.completedUnits = 0;
      this.abortController = null;
      this.toolbarEl = null;
      this.mutationObserver = null;
      this.lastUrl = location.href;
      this.originalMap = new WeakMap(); // Element -> Originaltext (fuer Hover-Tooltip)
      this.tooltipEl = null;
      this.hoverElement = null;
      this.initSpaRouting();
      this.initHoverTooltip();
    }

    // Hover Tooltip – zeigt den Originaltext an, wenn man ueber einen
    // bereits übersetzten Bereich faehrt (wie DeepL / Google Translator Hover).
    initHoverTooltip() {
      document.addEventListener('mouseover', (e) => this.handleHoverOver(e));
      document.addEventListener('mouseout', (e) => this.handleHoverOut(e));
    }

    hideTooltip() {
      if (this.tooltipEl) {
        this.tooltipEl.remove();
        this.tooltipEl = null;
      }
    }

    handleHoverOver(e) {
      if (this.isShowingOriginal) { this.hideTooltip(); return; }
      const host = document.getElementById('webtranslator-pro-host') || document.getElementById('webtranslator-pro-bar-host');
      if (host && (host === e.target || host.contains(e.target))) { this.hideTooltip(); return; }
      if (this.tooltipEl && this.tooltipEl.contains(e.target)) return;

      const element = (e.target && e.target.nodeType === 1) ? e.target : (e.target && e.target.parentElement);
      if (!element || !element.closest) { this.hideTooltip(); return; }
      if (element.closest('#webtranslator-pro-host, #webtranslator-pro-bar-host')) { this.hideTooltip(); return; }

      let node = element;
      let original = null;
      while (node) {
        const found = this.originalMap.get(node);
        if (found) { original = found; break; }
        node = node.parentElement;
      }

      if (!original) { this.hideTooltip(); return; }

      this.hoverElement = element;
      const rect = element.getBoundingClientRect();
      const tooltip = document.createElement('div');
      tooltip.id = 'webtranslator-pro-tooltip';
      tooltip.style.position = 'fixed';
      tooltip.style.zIndex = '2147483647';
      tooltip.style.pointerEvents = 'none';
      tooltip.style.maxWidth = '320px';
      tooltip.style.background = '#202124';
      tooltip.style.color = '#e8eaed';
      tooltip.style.border = '1px solid #5f6368';
      tooltip.style.borderRadius = '8px';
      tooltip.style.padding = '6px 10px';
      tooltip.style.fontSize = '12px';
      tooltip.style.fontFamily = 'arial, "Segoe UI", Roboto, sans-serif';
      tooltip.style.boxShadow = '0 4px 16px rgba(0,0,0,0.35)';
      tooltip.style.lineHeight = '1.35';
      tooltip.style.opacity = '0';
      tooltip.style.transition = 'opacity 0.12s ease-out';
      const text = String(original);
      tooltip.textContent = text.length > 140 ? text.slice(0, 140) + ' …' : text;
      const style = document.createElement('style');
      style.textContent = '#webtranslator-pro-tooltip.wt-tip { opacity: 0; transition: opacity 0.12s ease-out; } #webtranslator-pro-tooltip.wt-tip.visible { opacity: 1; }';
      document.documentElement.appendChild(style);
      tooltip.classList.add('wt-tip');
      document.body.appendChild(tooltip);
      this.tooltipEl = tooltip;

      const top = rect.top - tooltip.offsetHeight - 8;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - tooltip.offsetWidth - 16));
      tooltip.style.top = `${Math.max(8, top)}px`;
      tooltip.style.left = `${left}px`;
      requestAnimationFrame(() => { tooltip.style.opacity = '1'; });
    }

    handleHoverOut(e) {
      const next = e.relatedTarget;
      if (this.tooltipEl && next && (this.tooltipEl === next || this.tooltipEl.contains(next))) return;
      const el = this.hoverElement;
      if (el && next && el.contains(next)) return;
      this.hideTooltip();
    }

    // Single-Page-App (SPA) Router detection for React/Next.js subpages (like featherless.ai)
    initSpaRouting() {
      const handleSubpageChange = () => {
        if (location.href !== this.lastUrl) {
          const oldUrl = this.lastUrl;
          this.lastUrl = location.href;
          console.log('[WebTranslator PRO] Unterseite gewechselt:', oldUrl, '➔', this.lastUrl);

          const sessionTarget = sessionStorage.getItem('wt_session_translated') || (this.isTranslated ? this.targetLang : null);
          if (sessionTarget && !this.isShowingOriginal) {
            // Disconnect old observer temporarily so it doesn't collide with page transition
            if (this.mutationObserver) {
              this.mutationObserver.disconnect();
            }

            // In React/Next.js SPA routing, give DOM 300ms to mount new subpage elements
            setTimeout(() => {
              this.functionTranslatePage(sessionTarget, this.sourceLang);
            }, 300);
          }
        }
      };

      // Wrap history methods
      try {
        const origPush = history.pushState;
        history.pushState = function (...args) {
          origPush.apply(this, args);
          handleSubpageChange();
        };

        const origReplace = history.replaceState;
        history.replaceState = function (...args) {
          origReplace.apply(this, args);
          handleSubpageChange();
        };

        window.addEventListener('popstate', handleSubpageChange);
        window.addEventListener('hashchange', handleSubpageChange);
        // Periodic check as fallback for custom routers
        setInterval(handleSubpageChange, 600);
      } catch (e) {}
    }

    // Determine if an element is translatable (Never skip navigation menus, dropdowns, popovers, or subpages!)
    isVisible(el) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
      if (el.hasAttribute('translate') && el.getAttribute('translate') === 'no') return false;
      if (el.classList && (el.classList.contains('notranslate') || el.classList.contains('no-translate'))) return false;
      if (el.id === 'webtranslator-pro-host' || el.id === 'webtranslator-pro-bar-host') return false;
      if (el.closest('#webtranslator-pro-host, #webtranslator-pro-bar-host')) return false;

      // CRITICAL: Navigation menus, headers, dropdowns, mobile drawers, popovers, tabs & modals must ALWAYS be translated!
      // In modern frameworks (Next.js, Webflow, Radix, Tailwind), dropdown menus, submenus, and accordions
      // often have display: none or opacity: 0 until hovered or clicked. They MUST be translated!
      if (el.closest('nav, header, footer, aside, [role="navigation"], [role="menu"], [role="menubar"], [role="menuitem"], [role="dialog"], [role="tabpanel"], ul, ol, menu, [class*="nav"], [class*="menu"], [class*="dropdown"], [class*="header"], [class*="bar"], [class*="collapse"], [class*="drawer"], [class*="modal"], [class*="tab"]')) {
        return true;
      }

      // Check if element is completely hidden non-nav element
      try {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return false;
        }
      } catch (e) {}

      return true;
    }

    // Find all translatable text nodes on the page (sorted viewport-first for instant on-screen translation!)
    collectTextNodes(root = document.body) {
      if (!root) return [];
      const textNodes = [];
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;

            const tag = parent.tagName.toUpperCase();
            if (IGNORED_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
            if (parent.closest('#webtranslator-pro-host, #webtranslator-pro-bar-host')) return NodeFilter.FILTER_REJECT;
            if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;

            // Check if translatable / visible
            if (!this.isVisible(parent)) return NodeFilter.FILTER_REJECT;

            // If node was already translated into our active target language, skip
            if (node.__wt_translated && node.__wt_targetLang === this.targetLang && node.nodeValue === node.__wt_translated) {
              return NodeFilter.FILTER_SKIP;
            }

            const text = node.__wt_original !== undefined ? node.__wt_original.trim() : (node.nodeValue ? node.nodeValue.trim() : '');
            // Skip empty or text without any letters (e.g. only numbers, symbols, spaces)
            if (!text || text.length < 2) return NodeFilter.FILTER_SKIP;
            if (!/\p{L}/u.test(text)) return NodeFilter.FILTER_SKIP;

            // Skip code-like or base64 strings
            if (text.length > 50 && !text.includes(' ') && !text.includes('\n')) {
              return NodeFilter.FILTER_SKIP;
            }

            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let current;
      while ((current = walker.nextNode())) {
        textNodes.push(current);
      }

      // Prioritize viewport: sort on-screen elements to Batch 1 so visible screen translates in < 1 second!
      const isInViewport = (node) => {
        const el = node.parentElement;
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
      };

      textNodes.sort((a, b) => {
        const va = isInViewport(a);
        const vb = isInViewport(b);
        if (va && !vb) return -1;
        if (!va && vb) return 1;
        return 0;
      });

      return textNodes;
    }

    // Build translation batches
    createBatches(textNodes, maxCharsPerBatch = 3500, maxUnitsPerBatch = 25) {
      const batches = [];
      let currentBatch = [];
      let currentChars = 0;
      let unitIdCounter = this.units.length > 0 ? Math.max(...this.units.map(u => u.id || 0)) + 1 : 1;

      for (const node of textNodes) {
        // If node already exists in this.units, update or reuse
        let unit = this.units.find((u) => u.node === node);
        if (unit && unit.translatedText && node.__wt_translated === unit.translatedText && node.__wt_targetLang === this.targetLang) {
          continue; // Already translated in current target language
        }

        const text = node.__wt_original !== undefined ? node.__wt_original.trim() : node.nodeValue.trim();
        if (!text || text.length < 2) continue;

        node.__wt_original = node.__wt_original || node.nodeValue;

        if (!unit) {
          unit = {
            id: unitIdCounter++,
            node,
            originalText: text,
            translatedText: ''
          };
          this.units.push(unit);
        } else {
          unit.id = unitIdCounter++;
        }

        // Register original text for hover tooltip lookup
        if (unit.node?.parentElement) {
          this.originalMap.set(unit.node.parentElement, text);
        }

        currentBatch.push(unit);
        currentChars += text.length;

        if (currentChars >= maxCharsPerBatch || currentBatch.length >= maxUnitsPerBatch) {
          batches.push(currentBatch);
          currentBatch = [];
          currentChars = 0;
        }
      }

      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }

      return batches;
    }

    // Format prompt for numbered batch translation
    buildBatchPrompt(batchUnits, sourceLang, targetLang) {
      const lines = batchUnits.map((u) => `[${u.id}] ${u.originalText.replace(/\r?\n/g, ' ')}`).join('\n');
      const isAuto = !sourceLang || sourceLang === 'Automatisch erkennen';
      const srcText = isAuto ? 'Erkenne die Ausgangssprache der Webseite automatisch.' : `Ausgangssprache ist: ${sourceLang}.`;

      return `Du bist ein hochentwickelter Webseiten-Übersetzer für Webseiten im Browser.
Aufgabe: Übersetze die folgenden nummerierten Webseiten-Texte präzise in die Zielsprache: ${targetLang}.
${srcText}

Regeln:
1. Behalte die Nummern [1], [2], [3] usw. exakt bei.
2. Gib genau eine Zeile pro Nummer im Format "[Nummer] Übersetzung" aus.
3. Behalte Eigennamen, Markennamen, Zahlen, Währungen und Sonderzeichen bei.
4. Gib AUSSCHLIESSLICH die nummerierte Übersetzungsliste aus, keine Einleitung oder Erklärung.

Eingabe:
${lines}`;
    }

    // Parse translated numbered list from Turbo / Ollama response
    parseBatchResponse(rawText, batchUnits) {
      if (!rawText) return;
      const lines = rawText.split('\n');
      const resultMap = new Map();

      for (const line of lines) {
        const match = line.trim().match(/^\[\s*(\d+)\s*\]\s*:?\s*(.*)$/);
        if (match) {
          const id = parseInt(match[1], 10);
          const translation = match[2].trim();
          if (id && translation) {
            resultMap.set(id, translation);
          }
        }
      }

      // Fallback: If numbers were stripped by the engine but line count matches
      const useLineFallback = resultMap.size < Math.ceil(batchUnits.length / 2) && lines.length === batchUnits.length;

      // Apply translations to nodes
      for (let i = 0; i < batchUnits.length; i++) {
        const unit = batchUnits[i];
        let trans = resultMap.get(unit.id);
        if (!trans && useLineFallback) {
          trans = lines[i]?.replace(/^\[\s*\d+\s*\]\s*:?\s*/, '').trim();
        }

        if (trans) {
          // Clean up formatting artifacts if any
          trans = trans.replace(/^["'„“«»]+|["'„“«»]+$/g, '').trim();

          // Apply Custom Glossary (Wörterbuch-Filter wie bei DeepL)
          if (typeof WebTranslator !== 'undefined' && WebTranslator.applyGlossary && this.glossary?.length) {
            trans = WebTranslator.applyGlossary(trans, this.glossary);
          }

          // Apply Tone Formality (Sie vs Du wie bei DeepL Pro)
          if (typeof WebTranslator !== 'undefined' && WebTranslator.adjustTone && this.activeConfig?.tone) {
            trans = WebTranslator.adjustTone(trans, this.targetLang, this.activeConfig.tone);
          }

          unit.translatedText = trans;
          unit.node.__wt_translated = trans;
          unit.node.__wt_targetLang = this.targetLang;

          // Replace text in-place preserving leading/trailing whitespace
          const origRaw = unit.node.__wt_original;
          const leadingWs = origRaw.match(/^\s*/)?.[0] || '';
          const trailingWs = origRaw.match(/\s*$/)?.[0] || '';
          unit.node.nodeValue = leadingWs + trans + trailingWs;
        }
      }
    }

    // Detect the page's source language (German name) via <html lang> + stop-word heuristic
    detectSourceLanguage() {
      try {
        const htmlLang = (document.documentElement.lang || '').trim().toLowerCase();
        const base = htmlLang.split('-')[0].split('_')[0];
        if (base && CODE_TO_NAME[base]) return CODE_TO_NAME[base];
        if (htmlLang.startsWith('zh')) return htmlLang.includes('tw') || htmlLang.includes('hk') ? 'Chinesisch (traditionell)' : 'Chinesisch (vereinfacht)';
      } catch (e) {}

      try {
        const sample = ((document.body?.innerText || '').slice(0, 5000) || '').toLowerCase();
        const words = sample.match(/[\p{L}]+/gu) || [];
        if (words.length > 25) {
          let best = null;
          let bestScore = 0;
          for (const [name, sw] of Object.entries(STOPWORDS)) {
            const set = new Set(sw);
            let score = 0;
            for (const w of words) if (set.has(w)) score++;
            if (score > bestScore) {
              bestScore = score;
              best = name;
            }
          }
          if (best && bestScore >= 4) return best;
        }
      } catch (e) {}

      return null;
    }

    // Load auto/never translation rules from storage
    async getRules() {
      try {
        const data = await chrome.storage.local.get(['wtAutoDomains', 'wtAutoLanguages', 'wtNeverDomains', 'wtNeverLanguages']);
        return {
          autoDomains: Array.isArray(data.wtAutoDomains) ? data.wtAutoDomains : [],
          autoLangs: Array.isArray(data.wtAutoLanguages) ? data.wtAutoLanguages : [],
          neverDomains: Array.isArray(data.wtNeverDomains) ? data.wtNeverDomains : [],
          neverLangs: Array.isArray(data.wtNeverLanguages) ? data.wtNeverLanguages : []
        };
      } catch {
        return { autoDomains: [], autoLangs: [], neverDomains: [], neverLangs: [] };
      }
    }

    // Start translating the whole page (or SPA subpage)
    async functionTranslatePage(targetLang = 'Deutsch', sourceLang = 'Automatisch erkennen') {
      // Global master switch: block every translation entry point when disabled
      try {
        const cfg = await chrome.storage.local.get(['wtConfig']);
        if (cfg?.wtConfig && cfg.wtConfig.enabled === false) {
          this.removeInPageBar();
          return;
        }
      } catch {}

      if (this.isTranslating) {
        if (this.abortController) {
          this.abortController.abort();
        }
      }

      this.isTranslating = true;
      this.isShowingOriginal = false;
      this.targetLang = targetLang;
      this.sourceLang = sourceLang;
      if (!this.detectedLang) this.detectedLang = this.detectSourceLanguage();
      this.abortController = new AbortController();

      // Persist session translation so any subpage ("Unterseiten") stays automatically translated!
      try {
        sessionStorage.setItem('wt_session_translated', targetLang);
      } catch (e) {}

      this.showInPageBar();
      this.updateBarStatus(`Webseiten-Inhalte werden erfasst …`, 0);

      // Clean up dead nodes from previous SPA views
      this.units = (this.units || []).filter((u) => u.node && document.body.contains(u.node));

      // Collect translatable nodes
      const textNodes = this.collectTextNodes();
      const batches = this.createBatches(textNodes);

      this.totalUnits = this.units.length;
      this.completedUnits = this.units.filter((u) => u.translatedText && u.node?.__wt_targetLang === this.targetLang).length;

      if (batches.length === 0) {
        this.updateBarStatus(`Webseite vollständig auf ${this.targetLang} übersetzt!`, 100, true);
        this.isTranslated = true;
        this.isTranslating = false;
        this.startMutationObserver();
        return;
      }

      this.updateBarStatus(`Übersetze Webseite … ${this.completedUnits} von ${this.totalUnits} Texten`, 10);

      // Get configuration & glossary
      let config = { engine: 'turbo', baseUrl: 'http://127.0.0.1:11434', model: 'phi3:3.8b', tone: 'standard' };
      this.glossary = [];
      try {
        const stored = await chrome.storage.local.get(['wtConfig', 'wtGlossary']);
        if (stored?.wtConfig) config = { ...config, ...stored.wtConfig };
        if (Array.isArray(stored?.wtGlossary)) this.glossary = stored.wtGlossary;
      } catch {}
      this.activeConfig = config;

      const isTurbo = (config.engine || 'turbo') !== 'ollama';
      const engineLabel = isTurbo ? 'Turbo ⚡' : 'Ollama 🔒';
      const CONCURRENCY = isTurbo ? 3 : 1;
      let batchIndex = 0;

      const processBatch = async () => {
        while (batchIndex < batches.length) {
          if (this.abortController?.signal?.aborted) return;

          const currentIdx = batchIndex++;
          const batch = batches[currentIdx];

          let success = false;
          let attempts = 0;

          while (!success && attempts < 2 && !this.abortController?.signal?.aborted) {
            attempts++;
            try {
              const responseText = await this.sendBatchRequest(batch, config);
              this.parseBatchResponse(responseText, batch);
              this.completedUnits += batch.length;
              success = true;

              const pct = Math.min(100, Math.round((this.completedUnits / Math.max(1, this.totalUnits)) * 100));
              this.updateBarStatus(
                `Übersetze (${engineLabel}) … ${this.completedUnits} / ${this.totalUnits} (${pct}%)`,
                pct
              );
            } catch (err) {
              if (attempts >= 2) {
                console.warn(`WebTranslator Batch ${currentIdx + 1} übersprungen:`, err.message);
              } else {
                await new Promise((r) => setTimeout(r, 300));
              }
            }
          }
        }
      };

      try {
        const workers = [];
        for (let i = 0; i < Math.min(CONCURRENCY, batches.length); i++) {
          workers.push(processBatch());
        }
        await Promise.all(workers);

        if (!this.abortController?.signal?.aborted) {
          this.isTranslated = true;
          this.isTranslating = false;
          this.updateBarStatus(`Webseite vollständig auf ${this.targetLang} übersetzt!`, 100, true);
          this.startMutationObserver();

          // Notify background / popup that translation completed
          chrome.runtime.sendMessage({
            type: 'WT_PAGE_TRANSLATION_COMPLETED',
            targetLang: this.targetLang,
            unitsCount: this.totalUnits
          }).catch(() => {});
        }
      } catch (err) {
        this.updateBarStatus(`Fehler: ${err.message}`, 0);
        this.isTranslating = false;
      }
    }

    // Dynamic Mutation Observer for Next.js SPA subpages, opened dropdown menus & lazy loaded content
    startMutationObserver() {
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
      }

      let pendingNodes = [];
      let debounceTimer = null;

      const processPendingNodes = async () => {
        if (!this.isTranslated || this.isShowingOriginal || this.isTranslating) {
          return;
        }

        const nodesToTranslate = [];
        const seen = new Set();

        for (const node of pendingNodes) {
          if (!node || seen.has(node)) continue;
          seen.add(node);

          if (document.body.contains(node)) {
            if (node.__wt_translated && node.__wt_targetLang === this.targetLang && node.nodeValue === node.__wt_translated) {
              continue;
            }
            const text = (node.__wt_original !== undefined ? node.__wt_original : node.nodeValue || '').trim();
            if (text && text.length >= 2 && /\p{L}/u.test(text)) {
              nodesToTranslate.push(node);
            }
          }
        }
        pendingNodes = [];

        if (nodesToTranslate.length === 0) return;

        const batches = this.createBatches(nodesToTranslate);
        for (const batch of batches) {
          try {
            const lines = batch.map((u) => `[${u.id}] ${u.originalText.replace(/\r?\n/g, ' ')}`).join('\n');
            const res = await this.sendTurboBatch(lines);
            this.parseBatchResponse(res, batch);
          } catch (e) {
            console.warn('[WebTranslator PRO] Dynamische Übersetzung Fehler:', e);
          }
        }
      };

      this.mutationObserver = new MutationObserver((mutations) => {
        if (!this.isTranslated || this.isShowingOriginal) return;

        let foundAny = false;
        for (const mut of mutations) {
          for (const added of mut.addedNodes) {
            if (added.nodeType === Node.ELEMENT_NODE) {
              if (
                added.id === 'webtranslator-pro-host' ||
                added.id === 'webtranslator-pro-bar-host' ||
                added.closest?.('#webtranslator-pro-bar-host')
              ) {
                continue;
              }
              const newNodes = this.collectTextNodes(added);
              for (const n of newNodes) {
                if (!n.__wt_translated || n.__wt_targetLang !== this.targetLang) {
                  pendingNodes.push(n);
                  foundAny = true;
                }
              }
            } else if (added.nodeType === Node.TEXT_NODE) {
              const p = added.parentElement;
              if (p && !p.closest('#webtranslator-pro-host, #webtranslator-pro-bar-host')) {
                if (!added.__wt_translated || added.__wt_targetLang !== this.targetLang) {
                  pendingNodes.push(added);
                  foundAny = true;
                }
              }
            }
          }
        }

        if (foundAny) {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(processPendingNodes, 200);
        }
      });

      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    // Send translation batch (Turbo Engine by default for sub-second DeepL-speed!)
    async sendTurboBatch(lines) {
      // 1. Direct fetch (0.3s)
      try {
        const sl = (!this.sourceLang || this.sourceLang === 'Automatisch erkennen') ? 'auto' : (WebTranslator.LANG_CODES?.[this.sourceLang] || 'auto');
        const tl = WebTranslator.LANG_CODES?.[this.targetLang] || 'de';
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(lines)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const content = (data && Array.isArray(data[0])) ? data[0].map(p => p[0] || '').join('') : '';
          if (content) return content;
        }
      } catch (e) {}

      // 2. Background bridge
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'WT_TRANSLATE_BATCH_TURBO',
            text: lines,
            sourceLang: this.sourceLang,
            targetLang: this.targetLang
          },
          (response) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!response?.ok) return reject(new Error(response?.error || 'Turbo API Fehler'));
            resolve(response.content || '');
          }
        );
      });
    }

    async sendBatchRequest(batch, config) {
      const isTurbo = (config.engine || 'turbo') !== 'ollama';
      const lines = batch.map((u) => `[${u.id}] ${u.originalText.replace(/\r?\n/g, ' ')}`).join('\n');

      if (isTurbo) {
        return await this.sendTurboBatch(lines);
      }

      // Local Ollama AI Engine with automatic Turbo fallback on error/timeout!
      try {
        const prompt = this.buildBatchPrompt(batch, this.sourceLang, this.targetLang);
        const cleanBaseUrl = (config.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
        return await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: 'WT_TRANSLATE_BATCH_DIRECT',
              prompt,
              model: config.model || 'phi3:3.8b',
              baseUrl: cleanBaseUrl,
              targetLang: this.targetLang
            },
            (response) => {
              if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
              if (!response?.ok) return reject(new Error(response?.error || 'Fehler beim Übersetzen.'));
              resolve(response.content || '');
            }
          );
        });
      } catch (ollamaErr) {
        console.warn('Ollama fehlgeschlagen, schalte auf Turbo um:', ollamaErr.message);
        return await this.sendTurboBatch(lines);
      }
    }

    // Toggle between Original, Translated and Bilingual instantly (0ms)
    setDisplayMode(mode = 'translated') {
      if (!this.units || this.units.length === 0) return;
      this.displayMode = mode; // 'original', 'translated', 'bilingual'
      this.isShowingOriginal = (mode === 'original');

      for (const unit of this.units) {
        if (!unit.node) continue;
        const orig = unit.node.__wt_original || '';
        const trans = unit.translatedText || '';
        const leadingWs = orig.match(/^\s*/)?.[0] || '';
        const trailingWs = orig.match(/\s*$/)?.[0] || '';

        if (mode === 'original') {
          unit.node.nodeValue = orig;
        } else if (mode === 'bilingual' && trans) {
          unit.node.nodeValue = leadingWs + orig.trim() + '  [' + trans.trim() + ']' + trailingWs;
        } else if (trans) {
          unit.node.nodeValue = leadingWs + trans + trailingWs;
        }
      }

      this.updateBarToggleState();

      chrome.runtime.sendMessage({
        type: 'WT_PAGE_STATE_CHANGED',
        displayMode: this.displayMode,
        isShowingOriginal: this.isShowingOriginal,
        isTranslated: this.isTranslated
      }).catch(() => {});
    }

    toggleOriginalTranslation() {
      this.setDisplayMode(this.isShowingOriginal ? 'translated' : 'original');
    }

    // Restore original and remove bar
    restoreOriginal() {
      if (this.abortController) {
        this.abortController.abort();
      }

      this.hideTooltip();

      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }

      try {
        sessionStorage.removeItem('wt_session_translated');
      } catch (e) {}

      this.isTranslating = false;
      this.isTranslated = false;
      this.isShowingOriginal = false;

      for (const unit of this.units) {
        if (unit.node && unit.node.__wt_original !== undefined) {
          unit.node.nodeValue = unit.node.__wt_original;
        }
      }

      this.removeInPageBar();

      chrome.runtime.sendMessage({
        type: 'WT_PAGE_RESTORED'
      }).catch(() => {});
    }

    // ========================================================
    // GOOGLE-TRANSLATE-STYLE IN-PAGE BUBBLE (clean & minimal)
    // ========================================================
    showInPageBar() {
      if (document.getElementById('webtranslator-pro-bar-host')) {
        // Already exists: expand from minimized pill and re-render current state
        const existing = document.getElementById('webtranslator-pro-bar-host');
        const pill = existing.shadowRoot?.getElementById('gtb-mini');
        const card = existing.shadowRoot?.getElementById('gtb-card');
        if (pill && card) {
          pill.style.display = 'none';
          card.style.display = 'flex';
        }
        this.renderBubble();
        return;
      }

      const host = document.createElement('div');
      host.id = 'webtranslator-pro-bar-host';
      host.style.all = 'initial';
      host.style.position = 'fixed';
      host.style.top = '14px';
      host.style.right = '16px';
      host.style.zIndex = '2147483647';
      host.style.pointerEvents = 'none';

      const shadow = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = `
        * { box-sizing: border-box; font-family: arial, "Segoe UI", Roboto, -apple-system, BlinkMacSystemFont, sans-serif; }

        .gtb-card {
          pointer-events: auto;
          width: 336px;
          max-width: calc(100vw - 20px);
          background: #ffffff;
          color: #202124;
          border-radius: 12px;
          border: 1px solid #dadce0;
          box-shadow: 0 4px 20px rgba(60, 64, 67, 0.28), 0 1px 3px rgba(60, 64, 67, 0.16);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: gtbIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
        }
        @keyframes gtbIn {
          from { transform: translateY(-8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .gtb-stripe {
          height: 3px;
          width: 100%;
          background: linear-gradient(90deg, #4285f4 0%, #1a73e8 35%, #34a853 70%, #4285f4 100%);
        }

        .gtb-head {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 11px 12px 9px 14px;
        }
        .gtb-icon {
          width: 20px;
          height: 20px;
          flex-shrink: 0;
          color: #1a73e8;
        }
        .gtb-icon svg { width: 20px; height: 20px; fill: currentColor; }
        .gtb-title {
          flex: 1;
          font-size: 14px;
          font-weight: 500;
          color: #202124;
          line-height: 1.2;
        }
        .gtb-head-actions { display: flex; align-items: center; gap: 4px; }
        .gtb-icobtn {
          background: transparent;
          border: none;
          color: #5f6368;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          transition: background 0.15s;
        }
        .gtb-icobtn:hover { background: #f1f3f4; color: #202124; }

        .gtb-body { padding: 0 14px 12px; display: flex; flex-direction: column; gap: 11px; }

        .gtb-langrow {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .gtb-select {
          flex: 1;
          min-width: 0;
          appearance: none;
          -webkit-appearance: none;
          background: #ffffff url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='%235f6368'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E") no-repeat right 8px center;
          border: 1px solid #dadce0;
          border-radius: 8px;
          padding: 8px 26px 8px 10px;
          font-size: 13px;
          font-weight: 500;
          color: #202124;
          cursor: pointer;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .gtb-select:hover { border-color: #bdc1c6; }
        .gtb-select:focus { border-color: #1a73e8; box-shadow: 0 0 0 1px #1a73e8; }
        .gtb-swap {
          background: transparent;
          border: none;
          color: #1a73e8;
          width: 30px;
          height: 30px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: background 0.15s, transform 0.2s;
        }
        .gtb-swap:hover { background: #e8f0fe; }
        .gtb-swap:active { transform: rotate(180deg); }
        .gtb-swap svg { width: 18px; height: 18px; fill: currentColor; }

        .gtb-action-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .gtb-primary {
          flex: 1.2;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 9px 12px;
          border-radius: 8px;
          border: none;
          background: #1a73e8;
          color: #ffffff;
          font-size: 13.5px;
          font-weight: 600;
          cursor: pointer;
          min-height: 40px;
          transition: background 0.15s, box-shadow 0.15s;
        }
        .gtb-primary:hover { background: #1765cc; box-shadow: 0 1px 3px rgba(26,115,232,0.4); }
        .gtb-primary:active { background: #185abc; }

        .gtb-secondary {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 9px 10px;
          border-radius: 8px;
          border: 1px solid #dadce0;
          background: #f8f9fa;
          color: #3c4043;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          min-height: 40px;
          transition: background 0.15s, border-color 0.15s;
        }
        .gtb-secondary:hover { background: #e8eaed; border-color: #bdc1c6; color: #202124; }

        /* Quick Switch Box (EIN / AUS) */
        .gtb-switch-box {
          background: #f8f9fa;
          border: 1px solid #e8eaed;
          border-radius: 8px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .gtb-switch-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .gtb-switch-text {
          display: flex;
          flex-direction: column;
          line-height: 1.25;
          text-align: left;
        }
        .gtb-switch-text strong {
          font-size: 12.5px;
          color: #202124;
          font-weight: 600;
        }
        .gtb-switch-text small {
          font-size: 11px;
          color: #5f6368;
        }
        .gtb-toggle-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #dadce0;
          border: 1px solid #bdc1c6;
          border-radius: 999px;
          padding: 3px 8px 3px 4px;
          cursor: pointer;
          font-size: 11px;
          font-weight: 700;
          color: #5f6368;
          transition: all 0.2s ease;
          user-select: none;
        }
        .gtb-toggle-track {
          width: 24px;
          height: 14px;
          background: #bdc1c6;
          border-radius: 999px;
          position: relative;
          transition: background 0.2s;
        }
        .gtb-toggle-thumb {
          width: 10px;
          height: 10px;
          background: #ffffff;
          border-radius: 50%;
          position: absolute;
          top: 2px;
          left: 2px;
          transition: transform 0.2s;
        }
        .gtb-toggle-btn.active {
          background: #e6f4ea;
          border-color: #34a853;
          color: #137333;
        }
        .gtb-toggle-btn.active .gtb-toggle-track {
          background: #34a853;
        }
        .gtb-toggle-btn.active .gtb-toggle-thumb {
          transform: translateX(10px);
        }

        .gtb-toast {
          display: none;
          background: #202124;
          color: #ffffff;
          font-size: 11.5px;
          padding: 6px 10px;
          border-radius: 6px;
          line-height: 1.3;
          animation: gtbIn 0.15s ease-out;
        }

        .gtb-ghost {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 9px 14px;
          border-radius: 8px;
          border: 1px solid #dadce0;
          background: #ffffff;
          color: #1a73e8;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .gtb-ghost:hover { background: #f1f6fd; border-color: #1a73e8; }

        /* Options (Always / Never translate) */
        .gtb-options { display: flex; flex-direction: column; gap: 2px; }
        .gtb-opt {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 6px 4px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12.5px;
          color: #3c4043;
          transition: background 0.12s;
        }
        .gtb-opt:hover { background: #f1f3f4; }
        .gtb-opt input {
          width: 16px;
          height: 16px;
          margin: 0;
          accent-color: #1a73e8;
          cursor: pointer;
          flex-shrink: 0;
        }
        .gtb-optlink {
          background: transparent;
          border: none;
          color: #1a73e8;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          padding: 4px 4px 0;
          text-align: left;
          align-self: flex-start;
        }
        .gtb-optlink:hover { text-decoration: underline; }

        /* Progress */
        .gtb-progress { display: flex; flex-direction: column; gap: 7px; }
        .gtb-progress-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12.5px;
          color: #3c4043;
        }
        .gtb-progress-top .pct { color: #1a73e8; font-weight: 700; }
        .gtb-track {
          width: 100%;
          height: 4px;
          background: #e8eaed;
          border-radius: 999px;
          overflow: hidden;
        }
        .gtb-fill {
          height: 100%;
          width: 0%;
          background: #1a73e8;
          border-radius: 999px;
          transition: width 0.2s ease;
        }
        .gtb-cancel {
          background: transparent;
          border: none;
          color: #5f6368;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          align-self: flex-start;
          padding: 2px 0;
        }
        .gtb-cancel:hover { color: #d93025; text-decoration: underline; }

        .gtb-done-note { font-size: 12px; color: #5f6368; margin: 0; }

        /* Minimized pill */
        .gtb-mini {
          pointer-events: auto;
          display: none;
          align-items: center;
          gap: 6px;
          background: #ffffff;
          border: 1px solid #dadce0;
          border-radius: 999px;
          padding: 6px 8px 6px 12px;
          color: #202124;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 2px 10px rgba(60, 64, 67, 0.25);
          animation: gtbIn 0.2s ease-out;
          user-select: none;
        }
        .gtb-mini:hover { box-shadow: 0 4px 16px rgba(60, 64, 67, 0.32); }
        .gtb-mini .gtb-icon { width: 18px; height: 18px; color: #1a73e8; }
        .gtb-mini .gtb-icon svg { width: 18px; height: 18px; }

        .gtb-mini-close {
          background: transparent;
          border: none;
          color: #5f6368;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 13px;
          line-height: 1;
          padding: 0;
          transition: background 0.15s, color 0.15s;
        }
        .gtb-mini-close:hover { background: #e8eaed; color: #202124; }

        /* Dark mode (respects system) */
        @media (prefers-color-scheme: dark) {
          .gtb-card, .gtb-mini { background: #202124; color: #e8eaed; border-color: #5f6368; }
          .gtb-title { color: #e8eaed; }
          .gtb-icobtn { color: #9aa0a6; }
          .gtb-icobtn:hover { background: #292a2d; color: #e8eaed; }
          .gtb-icon { color: #8ab4f8; }
          .gtb-select {
            background-color: #202124;
            background-image: url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='%239aa0a6'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
            color: #e8eaed; border-color: #5f6368;
          }
          .gtb-select:hover { border-color: #80868b; }
          .gtb-select:focus { border-color: #8ab4f8; box-shadow: 0 0 0 1px #8ab4f8; }
          .gtb-primary { background: #8ab4f8; color: #202124; }
          .gtb-primary:hover { background: #aecbfa; }
          .gtb-secondary { background: #2d2f31; border-color: #5f6368; color: #e8eaed; }
          .gtb-secondary:hover { background: #3c4043; border-color: #80868b; }
          .gtb-ghost { background: #202124; color: #8ab4f8; border-color: #5f6368; }
          .gtb-ghost:hover { background: #292a2d; border-color: #8ab4f8; }
          .gtb-swap { color: #8ab4f8; }
          .gtb-swap:hover { background: #28405c; }
          .gtb-switch-box { background: #2d2f31; border-color: #3c4043; }
          .gtb-switch-text strong { color: #e8eaed; }
          .gtb-switch-text small { color: #9aa0a6; }
          .gtb-toggle-btn { background: #3c4043; border-color: #5f6368; color: #9aa0a6; }
          .gtb-toggle-btn.active { background: #133824; border-color: #34a853; color: #81c995; }
          .gtb-mini-close:hover { background: #3c4043; color: #e8eaed; }
          .gtb-toast { background: #303134; color: #e8eaed; border: 1px solid #5f6368; }
          .gtb-opt { color: #e8eaed; }
          .gtb-opt:hover { background: #292a2d; }
          .gtb-opt input { accent-color: #8ab4f8; }
          .gtb-optlink { color: #8ab4f8; }
          .gtb-progress-top { color: #e8eaed; }
          .gtb-progress-top .pct { color: #8ab4f8; }
          .gtb-track { background: #3c4043; }
          .gtb-fill { background: #8ab4f8; }
          .gtb-cancel { color: #9aa0a6; }
          .gtb-cancel:hover { color: #f28b82; }
          .gtb-done-note { color: #9aa0a6; }
        }
      `;
      shadow.appendChild(style);

      const TRANSLATE_SVG = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`;
      const SWAP_SVG = `<svg viewBox="0 0 24 24"><path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/></svg>`;

      const langOptions = (selected) => (typeof WebTranslator !== 'undefined' ? WebTranslator.LANGUAGES : [])
        .map((l) => `<option value="${l}" ${l === selected ? 'selected' : ''}>${l}</option>`).join('');
      const targetLangOptions = (selected) => (typeof WebTranslator !== 'undefined' ? WebTranslator.LANGUAGES : [])
        .filter((l) => l !== 'Automatisch erkennen')
        .map((l) => `<option value="${l}" ${l === selected ? 'selected' : ''}>${l}</option>`).join('');

      // Minimized pill with 1-click close button
      const mini = document.createElement('div');
      mini.id = 'gtb-mini';
      mini.className = 'gtb-mini';
      mini.title = 'Forge WebTRANSLATOR OmniLingo PRO öffnen';
      mini.innerHTML = `
        <span class="gtb-icon">${TRANSLATE_SVG}</span>
        <span id="gtb-mini-label">Übersetzung</span>
        <button class="gtb-mini-close" id="gtb-mini-close" type="button" title="Banner ganz schließen">✕</button>
      `;
      shadow.appendChild(mini);

      // Main card
      const card = document.createElement('div');
      card.id = 'gtb-card';
      card.className = 'gtb-card';
      card.innerHTML = `
        <div class="gtb-stripe"></div>
        <div class="gtb-head">
          <span class="gtb-icon">${TRANSLATE_SVG}</span>
          <span class="gtb-title" id="gtb-title">Diese Seite übersetzen?</span>
          <div class="gtb-head-actions">
            <button class="gtb-icobtn" id="gtb-min" type="button" title="Minimieren" aria-label="Minimieren">−</button>
            <button class="gtb-icobtn" id="gtb-close" type="button" title="Banner schließen (✕)" aria-label="Schließen">✕</button>
          </div>
        </div>

        <div class="gtb-body">
          <!-- PROMPT -->
          <div id="gtb-prompt" style="display:flex; flex-direction:column; gap:10px;">
            <div class="gtb-langrow">
              <select class="gtb-select" id="gtb-source" title="Ausgangssprache">${langOptions(this.detectedLang || 'Automatisch erkennen')}</select>
              <button class="gtb-swap" id="gtb-swap" type="button" title="Sprachen tauschen">${SWAP_SVG}</button>
              <select class="gtb-select" id="gtb-target" title="Zielsprache">${targetLangOptions(this.targetLang)}</select>
            </div>

            <!-- Große Haupt-Aktions-Buttons: Übersetzen & Nicht übersetzen -->
            <div class="gtb-action-row">
              <button class="gtb-primary" id="gtb-translate" type="button">🌐 Übersetzen</button>
              <button class="gtb-secondary" id="gtb-dismiss" type="button" title="Banner jetzt schließen">✕ Nicht übersetzen</button>
            </div>

            <div class="gtb-toast" id="gtb-toast"></div>

            <!-- Schnellauswahl EIN / AUS (Direkte Kontrolle) -->
            <div class="gtb-switch-box">
              <div class="gtb-switch-row">
                <span class="gtb-switch-text">
                  <strong>Diese Webseite übersetzen</strong>
                  <small id="gtb-site-status-text">Aktiv (Übersetzung erlaubt)</small>
                </span>
                <button class="gtb-toggle-btn active" id="gtb-toggle-site" type="button" aria-pressed="true" title="Für diese Webseite ein- oder ausschalten">
                  <span class="gtb-toggle-track"><span class="gtb-toggle-thumb"></span></span>
                  <span class="gtb-toggle-label">EIN</span>
                </button>
              </div>

              <div class="gtb-switch-row">
                <span class="gtb-switch-text">
                  <strong>Automatisches Banner</strong>
                  <small id="gtb-banner-status-text">Auf fremden Seiten zeigen</small>
                </span>
                <button class="gtb-toggle-btn active" id="gtb-toggle-banner" type="button" aria-pressed="true" title="Automatisches Banner generell ein- oder ausschalten">
                  <span class="gtb-toggle-track"><span class="gtb-toggle-thumb"></span></span>
                  <span class="gtb-toggle-label">EIN</span>
                </button>
              </div>
            </div>

            <button class="gtb-optlink" id="gtb-prompt-opts-toggle" type="button">Weitere Regeln &amp; Optionen anzeigen</button>
            <div class="gtb-options" id="gtb-options" style="display:none;"></div>
          </div>

          <!-- PROGRESS -->
          <div id="gtb-progress" class="gtb-progress" style="display:none;">
            <div class="gtb-progress-top">
              <span id="gtb-progress-label">Übersetze …</span>
              <span class="pct" id="gtb-progress-pct">0%</span>
            </div>
            <div class="gtb-track"><div class="gtb-fill" id="gtb-progress-fill"></div></div>
            <button class="gtb-cancel" id="gtb-cancel" type="button">Abbrechen</button>
          </div>

          <!-- DONE -->
          <div id="gtb-done" style="display:none; flex-direction:column; gap:10px;">
            <div class="gtb-langrow">
              <select class="gtb-select" id="gtb-done-target" title="Zielsprache">${targetLangOptions(this.targetLang)}</select>
            </div>
            <button class="gtb-ghost" id="gtb-showorig" type="button">Original anzeigen</button>
            
            <div class="gtb-switch-box">
              <div class="gtb-switch-row">
                <span class="gtb-switch-text">
                  <strong>Diese Webseite übersetzen</strong>
                  <small id="gtb-done-site-status-text">Aktiv</small>
                </span>
                <button class="gtb-toggle-btn active" id="gtb-done-toggle-site" type="button" aria-pressed="true" title="Für diese Webseite ein- oder ausschalten">
                  <span class="gtb-toggle-track"><span class="gtb-toggle-thumb"></span></span>
                  <span class="gtb-toggle-label">EIN</span>
                </button>
              </div>
            </div>

            <button class="gtb-optlink" id="gtb-opts-toggle" type="button">Optionen</button>
            <div class="gtb-options" id="gtb-options-done" style="display:none;"></div>
          </div>
        </div>
      `;
      shadow.appendChild(card);
      document.documentElement.appendChild(host);

      this.toolbarEl = shadow;

      // ---- Bind events ----
      const srcSel = shadow.getElementById('gtb-source');
      const tgtSel = shadow.getElementById('gtb-target');
      const btnTranslate = shadow.getElementById('gtb-translate');
      const btnDismiss = shadow.getElementById('gtb-dismiss');
      const btnSwap = shadow.getElementById('gtb-swap');
      const toastEl = shadow.getElementById('gtb-toast');

      let toastTimer = null;
      const showToast = (msg) => {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
          toastEl.style.display = 'none';
        }, 3200);
      };

      const dismissHandler = () => {
        sessionStorage.setItem('wt_banner_dismissed', 'true');
        if (this.isTranslating && this.abortController) this.abortController.abort();
        if (this.mutationObserver) {
          this.mutationObserver.disconnect();
          this.mutationObserver = null;
        }
        this.removeInPageBar();
      };

      btnTranslate.onclick = () => {
        const src = srcSel.value;
        const tgt = tgtSel.value;
        if (src === tgt) return;
        this.functionTranslatePage(tgt, src);
      };

      btnDismiss.onclick = dismissHandler;
      shadow.getElementById('gtb-close').onclick = dismissHandler;

      btnSwap.onclick = () => {
        const s = srcSel.value;
        const t = tgtSel.value;
        srcSel.value = (s === 'Automatisch erkennen') ? (this.detectedLang || 'Automatisch erkennen') : t;
        tgtSel.value = (s === 'Automatisch erkennen') ? 'Deutsch' : s;
      };

      // Minimize / expand
      shadow.getElementById('gtb-min').onclick = () => {
        card.style.display = 'none';
        mini.style.display = 'inline-flex';
      };
      mini.onclick = (e) => {
        if (e.target.id === 'gtb-mini-close') return;
        mini.style.display = 'none';
        card.style.display = 'flex';
      };
      shadow.getElementById('gtb-mini-close').onclick = (e) => {
        e.stopPropagation();
        dismissHandler();
      };

      // Toggles EIN / AUS
      const toggleSite = shadow.getElementById('gtb-toggle-site');
      const doneToggleSite = shadow.getElementById('gtb-done-toggle-site');
      const toggleBanner = shadow.getElementById('gtb-toggle-banner');

      const setSiteToggleUI = (isAllowed) => {
        [toggleSite, doneToggleSite].forEach(btn => {
          if (!btn) return;
          btn.classList.toggle('active', isAllowed);
          btn.setAttribute('aria-pressed', isAllowed ? 'true' : 'false');
          const lbl = btn.querySelector('.gtb-toggle-label');
          if (lbl) lbl.textContent = isAllowed ? 'EIN' : 'AUS';
        });
        const sub = shadow.getElementById('gtb-site-status-text');
        if (sub) sub.textContent = isAllowed ? 'Aktiv (Übersetzung erlaubt)' : 'Ausgeschaltet (Nie übersetzen)';
        const doneSub = shadow.getElementById('gtb-done-site-status-text');
        if (doneSub) doneSub.textContent = isAllowed ? 'Aktiv' : 'Ausgeschaltet';
      };

      const setBannerToggleUI = (bannerOn) => {
        if (!toggleBanner) return;
        toggleBanner.classList.toggle('active', bannerOn);
        toggleBanner.setAttribute('aria-pressed', bannerOn ? 'true' : 'false');
        const lbl = toggleBanner.querySelector('.gtb-toggle-label');
        if (lbl) lbl.textContent = bannerOn ? 'EIN' : 'AUS';
        const sub = shadow.getElementById('gtb-banner-status-text');
        if (sub) sub.textContent = bannerOn ? 'Auf fremden Seiten zeigen' : 'Aus (dauerhaft stumm)';
      };

      const handleSiteToggleClick = async () => {
        const rules = await this.getRules();
        const host = location.hostname;
        const isCurrentlyBlocked = rules.neverDomains.includes(host);
        const willAllow = isCurrentlyBlocked; // toggle

        if (willAllow) {
          rules.neverDomains = rules.neverDomains.filter(d => d !== host);
        } else {
          if (!rules.neverDomains.includes(host)) rules.neverDomains.push(host);
          rules.autoDomains = (rules.autoDomains || []).filter(d => d !== host);
        }

        try {
          await chrome.storage.local.set({
            wtNeverDomains: rules.neverDomains,
            wtAutoDomains: rules.autoDomains
          });
        } catch (e) {}

        setSiteToggleUI(willAllow);
        this.renderOptions();

        if (!willAllow) {
          showToast(`Übersetzung für ${host} AUSGESCHALTET. Banner schließt...`);
          setTimeout(() => {
            if (this.isTranslated) this.restoreOriginal();
            this.removeInPageBar();
          }, 900);
        } else {
          showToast(`Übersetzung für ${host} EINGESCHALTET.`);
        }
      };

      if (toggleSite) toggleSite.onclick = handleSiteToggleClick;
      if (doneToggleSite) doneToggleSite.onclick = handleSiteToggleClick;

      if (toggleBanner) {
        toggleBanner.onclick = async () => {
          const data = await chrome.storage.local.get(['wtConfig']);
          const currentBanner = data?.wtConfig?.showFloatingButton !== false;
          const nextBanner = !currentBanner;

          const existing = data?.wtConfig || {};
          existing.showFloatingButton = nextBanner;
          try {
            await chrome.storage.local.set({ wtConfig: existing });
          } catch (e) {}

          setBannerToggleUI(nextBanner);

          if (!nextBanner) {
            showToast('Banner dauerhaft AUSGESCHALTET. Reaktivierbar über das Icon oben rechts.');
            setTimeout(() => {
              this.removeInPageBar();
            }, 1000);
          } else {
            showToast('Automatisches Banner EINGESCHALTET.');
          }
        };
      }

      // Initialize toggle states
      chrome.storage.local.get(['wtNeverDomains', 'wtConfig']).then(data => {
        const never = Array.isArray(data?.wtNeverDomains) ? data.wtNeverDomains : [];
        const isAllowed = !never.includes(location.hostname);
        setSiteToggleUI(isAllowed);

        const bannerOn = data?.wtConfig?.showFloatingButton !== false;
        setBannerToggleUI(bannerOn);
      });

      // Expandable options link in prompt
      const promptOptsToggle = shadow.getElementById('gtb-prompt-opts-toggle');
      if (promptOptsToggle) {
        promptOptsToggle.onclick = () => {
          const box = shadow.getElementById('gtb-options');
          const isHidden = box.style.display === 'none';
          box.style.display = isHidden ? 'flex' : 'none';
          promptOptsToggle.textContent = isHidden ? 'Optionen ausblenden' : 'Weitere Regeln & Optionen anzeigen';
        };
      }

      // Progress cancel
      shadow.getElementById('gtb-cancel').onclick = () => {
        if (this.abortController) this.abortController.abort();
        this.isTranslating = false;
        this.renderBubble();
      };

      // Done-state controls
      const doneTarget = shadow.getElementById('gtb-done-target');
      doneTarget.onchange = () => {
        const t = doneTarget.value;
        if (t !== this.targetLang) this.functionTranslatePage(t, this.sourceLang);
      };

      const btnShowOrig = shadow.getElementById('gtb-showorig');
      btnShowOrig.onclick = () => {
        this.setDisplayMode(this.isShowingOriginal ? 'translated' : 'original');
      };

      shadow.getElementById('gtb-opts-toggle').onclick = () => {
        const box = shadow.getElementById('gtb-options-done');
        const toggle = shadow.getElementById('gtb-opts-toggle');
        const hidden = box.style.display === 'none';
        box.style.display = hidden ? 'flex' : 'none';
        toggle.textContent = hidden ? 'Optionen ausblenden' : 'Optionen';
      };

      // Render current state + options
      this.renderBubble();
      this.renderOptions();
    }

    // Render the always/never option toggles into both option containers
    async renderOptions() {
      const s = this.toolbarEl;
      if (!s) return;
      const detected = this.detectedLang || this.detectSourceLanguage() || 'Englisch';
      const rules = await this.getRules();

      const build = (container) => {
        if (!container) return;
        container.innerHTML = `
          <label class="gtb-opt"><input type="checkbox" data-rule="autoLang" ${rules.autoLangs.includes(detected) ? 'checked' : ''}> Sprache „${detected}“ immer übersetzen</label>
          <label class="gtb-opt"><input type="checkbox" data-rule="neverLang" ${rules.neverLangs.includes(detected) ? 'checked' : ''}> Sprache „${detected}“ nie übersetzen</label>
          <label class="gtb-opt"><input type="checkbox" data-rule="neverSite" ${rules.neverDomains.includes(location.hostname) ? 'checked' : ''}> Diese Website nie übersetzen</label>
        `;
        container.querySelectorAll('input[data-rule]').forEach((cb) => {
          cb.onchange = () => this.handleRuleChange(cb.dataset.rule, cb.checked, detected);
        });
      };

      build(s.getElementById('gtb-options'));
      build(s.getElementById('gtb-options-done'));
    }

    // Persist a changed always/never rule (auto-lang and never-lang are mutually exclusive)
    async handleRuleChange(rule, checked, lang) {
      const rules = await this.getRules();
      const host = location.hostname;

      const toggle = (arr, val) => checked ? (arr.includes(val) ? arr : [...arr, val]) : arr.filter((x) => x !== val);

      if (rule === 'autoLang') {
        rules.autoLangs = toggle(rules.autoLangs, lang);
        if (checked) rules.neverLangs = rules.neverLangs.filter((x) => x !== lang);
      } else if (rule === 'neverLang') {
        rules.neverLangs = toggle(rules.neverLangs, lang);
        if (checked) rules.autoLangs = rules.autoLangs.filter((x) => x !== lang);
      } else if (rule === 'neverSite') {
        rules.neverDomains = toggle(rules.neverDomains, host);
      }

      try {
        await chrome.storage.local.set({
          wtAutoLanguages: rules.autoLangs,
          wtNeverLanguages: rules.neverLangs,
          wtNeverDomains: rules.neverDomains
        });
      } catch (e) {}

      // Refresh both option blocks so mutual exclusivity is reflected
      this.renderOptions();

      // Choosing "never translate" dismisses the bubble (and restores if already translated)
      if (checked && (rule === 'neverSite' || rule === 'neverLang')) {
        if (this.isTranslated) {
          this.restoreOriginal();
        } else {
          this.removeInPageBar();
        }
      }
    }

    // Show the correct bubble section for the current state
    renderBubble() {
      const s = this.toolbarEl;
      if (!s) return;
      const prompt = s.getElementById('gtb-prompt');
      const prog = s.getElementById('gtb-progress');
      const done = s.getElementById('gtb-done');
      const titleEl = s.getElementById('gtb-title');
      const miniLabel = s.getElementById('gtb-mini-label');
      if (!prompt || !prog || !done) return;

      if (this.isTranslating) {
        titleEl.textContent = `Übersetze auf ${this.targetLang} …`;
        if (miniLabel) miniLabel.textContent = `→ ${this.targetLang}`;
        prompt.style.display = 'none';
        done.style.display = 'none';
        prog.style.display = 'flex';
      } else if (this.isTranslated) {
        titleEl.textContent = `Auf ${this.targetLang} übersetzt`;
        if (miniLabel) miniLabel.textContent = this.targetLang;
        prompt.style.display = 'none';
        prog.style.display = 'none';
        done.style.display = 'flex';
        const doneTarget = s.getElementById('gtb-done-target');
        if (doneTarget) doneTarget.value = this.targetLang;
        this.updateBarToggleState();
      } else {
        titleEl.textContent = 'Diese Seite übersetzen?';
        if (miniLabel) miniLabel.textContent = 'Übersetzung';
        prog.style.display = 'none';
        done.style.display = 'none';
        prompt.style.display = 'flex';
        const detected = this.detectedLang || this.detectSourceLanguage();
        if (detected) {
          this.detectedLang = detected;
          const srcSel = s.getElementById('gtb-source');
          if (srcSel && [...srcSel.options].some((o) => o.value === detected)) srcSel.value = detected;
        }
      }
    }

    updateBarStatus(text, pct = 0, isDone = false) {
      // Keep state flags consistent, then re-render the bubble
      if (isDone) {
        this.isTranslated = true;
        this.isTranslating = false;
      }
      this.renderBubble();

      if (!this.toolbarEl) return;
      if (!isDone) {
        const labelEl = this.toolbarEl.getElementById('gtb-progress-label');
        const pctEl = this.toolbarEl.getElementById('gtb-progress-pct');
        const fillEl = this.toolbarEl.getElementById('gtb-progress-fill');
        if (labelEl) labelEl.textContent = text;
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (fillEl) fillEl.style.width = `${pct}%`;
      }
    }

    updateBarToggleState() {
      if (!this.toolbarEl) return;
      const btnShowOrig = this.toolbarEl.getElementById('gtb-showorig');
      if (!btnShowOrig) return;
      btnShowOrig.textContent = this.isShowingOriginal ? 'Übersetzung anzeigen' : 'Original anzeigen';
    }

    removeInPageBar() {
      const host = document.getElementById('webtranslator-pro-bar-host');
      if (host) host.remove();
      this.toolbarEl = null;
    }
  }

  // Global Page Translator Instance
  window.__webTranslatorPageInstance = new PageTranslator();

  // Auto-translate & prompt on page load check
  async function checkAutoTranslate() {
    try {
      const inst = window.__webTranslatorPageInstance;
      const data = await chrome.storage.local.get(['wtAutoDomains', 'wtAutoLanguages', 'wtNeverDomains', 'wtNeverLanguages', 'wtConfig']);
      const domains = Array.isArray(data?.wtAutoDomains) ? data.wtAutoDomains : [];
      const languages = Array.isArray(data?.wtAutoLanguages) ? data.wtAutoLanguages : [];
      const neverDomains = Array.isArray(data?.wtNeverDomains) ? data.wtNeverDomains : [];
      const neverLangs = Array.isArray(data?.wtNeverLanguages) ? data.wtNeverLanguages : [];
      const targetLang = data?.wtConfig?.defaultTarget || 'Deutsch';
      const showBanner = data?.wtConfig?.showFloatingButton !== false;

      // 0. Global master switch: if the translator is disabled, do nothing at all
      if (data?.wtConfig && data.wtConfig.enabled === false) {
        console.log('[WebTranslator PRO] Übersetzer global deaktiviert – keine Aktion');
        return;
      }

      const currentDomain = location.hostname;
      const detected = inst.detectSourceLanguage();
      inst.detectedLang = detected;

      // 1. NEVER rules win over everything (Google behavior)
      if (neverDomains.includes(currentDomain)) {
        console.log('[WebTranslator PRO] Übersetzung für diese Website deaktiviert:', currentDomain);
        return;
      }
      if (detected && neverLangs.includes(detected)) {
        console.log('[WebTranslator PRO] Übersetzung für Sprache deaktiviert:', detected);
        return;
      }

      const shouldTranslateDomain = domains.includes(currentDomain);
      const shouldTranslateLang = detected && languages.includes(detected);

      // 2. Session translation: keep subpages translated in this tab
      const sessionTarget = sessionStorage.getItem('wt_session_translated');

      if (sessionTarget) {
        console.log('[WebTranslator PRO] Unterseite in Session erkannt, übersetze automatisch auf', sessionTarget);
        inst.functionTranslatePage(sessionTarget);
      } else if (shouldTranslateDomain || shouldTranslateLang) {
        console.log('[WebTranslator PRO] Automatische Webseiten-Übersetzung aktiv für', currentDomain);
        inst.functionTranslatePage(targetLang);
      } else {
        // 3. Foreign-language page: offer the Google-style bubble (unless dismissed this session)
        const isDismissed = sessionStorage.getItem('wt_banner_dismissed') === 'true';
        const docLang = (document.documentElement.lang || '').slice(0, 2).toLowerCase();
        let likelyForeign = detected ? detected !== 'Deutsch' : (docLang && !docLang.startsWith('de'));

        if (!likelyForeign && document.body) {
          const sample = (document.body.innerText || '').slice(0, 1200).toLowerCase();
          if (/\b(the|this|that|and|with|for|you|have|from|about|pricing|models|docs|login|sign|api|get started|features)\b/i.test(sample)) {
            likelyForeign = true;
          }
        }

        if (likelyForeign && !isDismissed && showBanner) {
          // Slide in the clean Google-style bubble so the user can translate easily
          setTimeout(() => {
            inst.showInPageBar();
          }, 600);
        } else if (!showBanner) {
          console.log('[WebTranslator PRO] Übersetzungs-Banner ist ausgeschaltet');
        }
      }
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAutoTranslate);
  } else {
    checkAutoTranslate();
  }
})();
