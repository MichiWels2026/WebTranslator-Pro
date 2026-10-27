// Forge WebTRANSLATOR OmniLingo PRO – Background Service Worker (Manifest V3)
// Modernisiert: Kein RAM-State vorrausgesetzt, alles via chrome.storage persistiert,
// Side Panel & Context Menus sauber registriert.

const LANG_MAP = {
  'Deutsch': 'de', 'Englisch': 'en', 'Türkisch': 'tr', 'Bosnisch': 'bs',
  'Kroatisch': 'hr', 'Serbisch': 'sr', 'Französisch': 'fr', 'Spanisch': 'es',
  'Italienisch': 'it', 'Niederländisch': 'nl', 'Polnisch': 'pl', 'Russisch': 'ru',
  'Ukrainisch': 'uk', 'Arabisch': 'ar', 'Chinesisch (vereinfacht)': 'zh-CN',
  'Japanisch': 'ja', 'Koreanisch': 'ko'
};

async function getConfig() {
  const res = await chrome.storage.local.get(['wtConfig']);
  return { ...DEFAULTS, ...(res?.wtConfig || {}) };
}

const DEFAULTS = {
  enabled: true,
  engine: 'turbo',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'phi3:3.8b',
  tone: 'standard',
  showFloatingButton: true,
  theme: 'auto',
  defaultSource: 'Automatisch erkennen',
  defaultTarget: 'Deutsch'
};

// Setup context menus on installation
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: 'wt-translate-page',
      title: 'Diese Webseite auf Deutsch übersetzen',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'wt-toggle-page',
      title: 'Original / Übersetzung umschalten',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'wt-translate-selection',
      title: 'Markierten Text übersetzen',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'wt-never-site',
      title: 'Diese Website nie übersetzen',
      contexts: ['page']
    });

    try {
      chrome.contextMenus.create({
        id: 'wt-open-sidepanel',
        title: 'Im Seitenpanel öffnen',
        contexts: ['page']
      });
    } catch {}
  } catch (err) {
    console.warn('Fehler beim Registrieren der Kontextmenüs:', err);
  }

  syncContextMenuState();
});

// Global master switch: grey out the translation menu items while disabled
async function syncContextMenuState() {
  if (!chrome.contextMenus?.update) return;
  try {
    const cfg = await chrome.storage.local.get(['wtConfig']);
    const enabled = !(cfg?.wtConfig && cfg.wtConfig.enabled === false);
    for (const id of ['wt-translate-page', 'wt-toggle-page', 'wt-translate-selection', 'wt-never-site']) {
      try {
        await chrome.contextMenus.update(id, { enabled });
      } catch {}
    }
  } catch {}
}

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => syncContextMenuState());
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.wtConfig) {
    syncContextMenuState();
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  // Global master switch: nothing may be translated while the translator is off
  if (info.menuItemId !== 'wt-open-sidepanel') {
    try {
      const cfg = await getConfig();
      if (cfg?.enabled === false) {
        console.log('[WebTranslator PRO] Übersetzer global deaktiviert – Kontextmenü blockiert');
        return;
      }
    } catch {}
  }

  if (info.menuItemId === 'wt-translate-page') {
    ensureContentScriptAndSendMessage(tab.id, {
      type: 'WT_START_PAGE_TRANSLATION',
      targetLang: 'Deutsch'
    });
    return;
  }

  if (info.menuItemId === 'wt-toggle-page') {
    ensureContentScriptAndSendMessage(tab.id, {
      type: 'WT_TOGGLE_PAGE_TRANSLATION'
    });
    return;
  }

  if (info.menuItemId === 'wt-open-sidepanel' && chrome.sidePanel) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch {
      try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      } catch (err) {
        console.error('Konnte Seitenpanel nicht öffnen:', err);
      }
    }
    return;
  }

  if (info.menuItemId === 'wt-translate-selection' && info.selectionText) {
    ensureContentScriptAndSendMessage(tab.id, {
      type: 'WT_TRIGGER_INLINE_TRANSLATION',
      text: info.selectionText
    });
  }

  if (info.menuItemId === 'wt-never-site') {
    (async () => {
      try {
        const host = new URL(tab.url).hostname;
        const data = await chrome.storage.local.get(['wtNeverDomains']);
        const domains = Array.isArray(data?.wtNeverDomains) ? data.wtNeverDomains : [];
        if (!domains.includes(host)) {
          domains.push(host);
          await chrome.storage.local.set({ wtNeverDomains: domains });
        }
        // Restore the page to its original if it is currently translated
        ensureContentScriptAndSendMessage(tab.id, { type: 'WT_RESTORE_PAGE_ORIGINAL' });
      } catch (e) {
        console.warn('Konnte Website nicht sperren:', e);
      }
    })();
    return;
  }
});

// Helper to make sure content script is injected
async function ensureContentScriptAndSendMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    try {
      if (chrome.scripting) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [
            'content/block-google-translate.js',
            'content/translator-client.js',
            'content/dom-translator.js',
            'content/page-context.js'
          ]
        });
        return await chrome.tabs.sendMessage(tabId, message);
      }
    } catch (e) {
      console.warn('Injektion fehlgeschlagen:', e);
    }
  }
}

// Runtime message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Turbo Batch Translation (Lightning Fast like DeepL: 300-800ms)
  if (message?.type === 'WT_TRANSLATE_BATCH_TURBO') {
    (async () => {
      try {
        const { text, sourceLang, targetLang } = message;
        const sl = (!sourceLang || sourceLang === 'Automatisch erkennen' || sourceLang === 'auto')
          ? 'auto'
          : (LANG_MAP[sourceLang] || 'auto');
        const tl = LANG_MAP[targetLang] || targetLang || 'de';

        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(url);
        if (!res.ok) {
          return sendResponse({ ok: false, error: `Turbo API Status ${res.status}` });
        }
        const data = await res.json();
        const content = (data && Array.isArray(data[0]))
          ? data[0].map((item) => item[0] || '').join('')
          : '';
        sendResponse({ ok: true, content });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || 'Turbo Übersetzungsfehler' });
      }
    })();
    return true;
  }

  // Local Ollama Batch translation (with fast 12s timeout & automatic Turbo fallback!)
  if (message?.type === 'WT_TRANSLATE_BATCH_DIRECT') {
    (async () => {
      try {
        const { prompt, model, baseUrl, targetLang } = message;
        const cleanBaseUrl = (baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000); // 12s fast timeout

        const res = await fetch(`${cleanBaseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model || 'phi3:3.8b',
            stream: false,
            messages: [{ role: 'user', content: prompt }],
            options: {
              temperature: 0.1,
              num_ctx: 1024
            }
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          const content = data?.message?.content?.trim() || '';
          if (content) return sendResponse({ ok: true, content });
        }
      } catch (err) {
        // Ollama error or timeout on CPU -> Seamless Turbo Fallback!
      }

      // Automatic Turbo Fallback so the user NEVER hangs!
      try {
        const tl = LANG_MAP[message.targetLang] || 'de';
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(message.prompt)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const content = (data && Array.isArray(data[0]))
            ? data[0].map((item) => item[0] || '').join('')
            : '';
          if (content) return sendResponse({ ok: true, content });
        }
      } catch (e) {}

      sendResponse({ ok: false, error: 'Übersetzung fehlgeschlagen' });
    })();
    return true;
  }

  // Update extension badge when page translation succeeds
  if (message?.type === 'WT_PAGE_TRANSLATION_COMPLETED') {
    if (sender?.tab?.id) {
      try {
        chrome.action.setBadgeText({ text: '✓', tabId: sender.tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#16a34a', tabId: sender.tab.id });
      } catch {}
    }
    sendResponse({ ok: true });
    return false;
  }

  // Page restored
  if (message?.type === 'WT_PAGE_RESTORED') {
    if (sender?.tab?.id) {
      try {
        chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
      } catch {}
    }
    sendResponse({ ok: true });
    return false;
  }

  // Sidepanel open request from popup
  if (message?.type === 'WT_OPEN_SIDEPANEL') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab?.id && chrome.sidePanel) {
          await chrome.sidePanel.open({ tabId: tab.id });
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: 'Kein Tab oder SidePanel nicht verfügbar' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  return false;
});
