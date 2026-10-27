(() => {
  const DEFAULT_CONFIG = {
    enabled: true, // master switch: false = translator completely disabled
    engine: 'turbo', // 'turbo' (sub-second fast) or 'ollama' (local)
    baseUrl: 'http://127.0.0.1:11434',
    model: 'phi3:3.8b',
    tone: 'standard',
    stream: true,
    showFloatingButton: true,
    theme: 'auto',
    defaultSource: 'Automatisch erkennen',
    defaultTarget: 'Deutsch'
  };

  const LANG_CODES = {
    'Deutsch': 'de',
    'Englisch': 'en',
    'Türkisch': 'tr',
    'Bosnisch': 'bs',
    'Kroatisch': 'hr',
    'Serbisch': 'sr',
    'Französisch': 'fr',
    'Spanisch': 'es',
    'Italienisch': 'it',
    'Niederländisch': 'nl',
    'Polnisch': 'pl',
    'Portugiesisch': 'pt',
    'Ukrainisch': 'uk',
    'Russisch': 'ru',
    'Chinesisch (vereinfacht)': 'zh-CN',
    'Chinesisch (traditionell)': 'zh-TW',
    'Japanisch': 'ja',
    'Koreanisch': 'ko',
    'Arabisch': 'ar',
    'Griechisch': 'el',
    'Tschechisch': 'cs',
    'Schwedisch': 'sv',
    'Dänisch': 'da',
    'Finnisch': 'fi',
    'Norwegisch': 'no',
    'Ungarisch': 'hu',
    'Rumänisch': 'ro',
    'Hindi': 'hi',
    'Vietnamesisch': 'vi',
    'Indonesisch': 'id'
  };

  const LANGUAGES = [
    'Automatisch erkennen',
    'Deutsch',
    'Englisch',
    'Türkisch',
    'Bosnisch',
    'Kroatisch',
    'Serbisch',
    'Französisch',
    'Spanisch',
    'Italienisch',
    'Niederländisch',
    'Polnisch',
    'Portugiesisch',
    'Ukrainisch',
    'Russisch',
    'Chinesisch (vereinfacht)',
    'Chinesisch (traditionell)',
    'Japanisch',
    'Koreanisch',
    'Arabisch',
    'Griechisch',
    'Tschechisch',
    'Schwedisch',
    'Dänisch',
    'Finnisch',
    'Norwegisch',
    'Ungarisch',
    'Rumänisch',
    'Hindi',
    'Vietnamesisch',
    'Indonesisch'
  ];

  const TONES = {
    standard: 'Übersetze präzise, flüssig und mit natürlicher Satzstruktur.',
    human: 'Schreibe den Text vollkommen menschlich, lebendig, warm und flüssig wie ein echter Muttersprachler. Vermeide steife Büro-Floskeln und künstliches Roboter-Deutsch.',
    formal: 'Nutze eine formelle, professionelle Sprache mit Höflichkeitsanrede (Sie) im Deutschen bzw. Business-Stil.',
    informal: 'Nutze eine lockere, moderne Umgangssprache (Du im Deutschen).',
    concise: 'Fasse den Inhalt übersetzt in prägnanten, kompakten Sätzen zusammen.'
  };

  async function getConfig() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const res = await chrome.storage.local.get(['wtConfig']);
        return { ...DEFAULT_CONFIG, ...(res?.wtConfig || {}) };
      }
    } catch (e) {}
    return DEFAULT_CONFIG;
  }

  async function saveConfig(updates) {
    const current = await getConfig();
    const merged = { ...current, ...updates };
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ wtConfig: merged });
      }
    } catch (e) {}
    return merged;
  }

  async function check(customBaseUrl) {
    const config = await getConfig();
    const baseUrl = (customBaseUrl || config.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        return { ok: false, error: `Ollama antwortete mit HTTP ${response.status}.`, models: [] };
      }

      const data = await response.json();
      const latency = Date.now() - startTime;
      const models = Array.isArray(data?.models)
        ? data.models.map((m) => m?.name).filter(Boolean)
        : [];

      return {
        ok: true,
        latency,
        baseUrl,
        models,
        hasModel: models.length > 0
      };
    } catch (err) {
      return {
        ok: false,
        error: err.name === 'AbortError'
          ? 'Zeitüberschreitung bei Verbindung zu Ollama (Timeout nach 6s).'
          : (err.message || 'Ollama ist nicht erreichbar. Läuft Ollama?'),
        models: []
      };
    }
  }

  function splitIntoChunks(text, maxChars = 3200) {
    const str = String(text || '').trim();
    if (!str) return [];
    if (str.length <= maxChars) return [str];

    const paragraphs = str.split(/\n{2,}/);
    const chunks = [];
    let current = '';

    for (const p of paragraphs) {
      if (p.length > maxChars) {
        // If single paragraph is too large, split by sentences
        const sentences = p.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [p];
        for (const s of sentences) {
          if ((current + '\n' + s).length > maxChars && current) {
            chunks.push(current.trim());
            current = s;
          } else {
            current = current ? `${current} ${s}` : s;
          }
        }
      } else {
        if ((current + '\n\n' + p).length > maxChars && current) {
          chunks.push(current.trim());
          current = p;
        } else {
          current = current ? `${current}\n\n${p}` : p;
        }
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks.length ? chunks : [str];
  }

  function buildPrompt(sourceLang, targetLang, tone) {
    const toneInstruction = TONES[tone] || TONES.standard;
    const isAuto = !sourceLang || sourceLang === 'Automatisch erkennen';
    const sourceInstruction = isAuto ? 'Erkenne die Ausgangssprache automatisch.' : `Ausgangssprache ist: ${sourceLang}.`;

    return `Du bist ein professioneller Web- und Dokumentenübersetzer.
Aufgabe: Übersetze den folgenden Text in die Zielsprache: ${targetLang}.
${sourceInstruction}
Stil-Vorgabe: ${toneInstruction}

Wichtige Regeln:
1. Gib AUSSCHLIESSLICH die fertige Übersetzung aus.
2. Füge KEINE Einleitung, Begrüßung, Erklärungen, Notizen oder Formatierungsmarkierungen wie 'Hier ist die Übersetzung:' hinzu.
3. Behalte alle Zeilenumbrüche, Listen, Eigennamen, Code, Zahlen und Links unverändert bei.
4. Erfinde keine zusätzlichen Inhalte hinzu.`;
  }

  async function streamTranslateSingleChunk({
    text,
    sourceLang,
    targetLang,
    tone,
    model,
    baseUrl,
    signal,
    onToken
  }) {
    const systemPrompt = buildPrompt(sourceLang, targetLang, tone);
    const cleanBaseUrl = (baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');

    const body = {
      model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      options: {
        temperature: tone === 'creative' ? 0.4 : 0.15,
        num_ctx: 4096
      }
    };

    const response = await fetch(`${cleanBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Ollama Fehler (${response.status}): ${errText || response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Der Browser konnte keinen Datenstream von Ollama empfangen.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulated = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // incomplete line kept in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);
          const token = json?.message?.content || '';
          if (token) {
            accumulated += token;
            onToken?.(token, accumulated);
          }
        } catch {
          // ignore partial JSON parse error
        }
      }
    }

    // Process leftover buffer if any
    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer.trim());
        const token = json?.message?.content || '';
        if (token) {
          accumulated += token;
          onToken?.(token, accumulated);
        }
      } catch {}
    }

    return accumulated.trim();
  }

  // Fast Sub-Second Web Translation Engine (Like DeepL / Google)
  async function translateFast(text, sourceLang = 'Automatisch erkennen', targetLang = 'Deutsch') {
    const sl = (!sourceLang || sourceLang === 'Automatisch erkennen' || sourceLang === 'auto')
      ? 'auto'
      : (LANG_CODES[sourceLang] || 'auto');
    const tl = LANG_CODES[targetLang] || targetLang || 'de';
    const cleanText = String(text || '').trim();
    if (!cleanText) return '';

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(cleanText)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Turbo-Übersetzer meldete HTTP ${response.status}`);
    }

    const data = await response.json();
    const parts = (data && Array.isArray(data[0])) ? data[0].map((item) => item[0] || '').join('') : '';
    return parts.trim() || cleanText;
  }

  async function translate({
    text,
    sourceLang = 'Automatisch erkennen',
    targetLang = 'Deutsch',
    tone = 'standard',
    engine,
    model,
    baseUrl,
    stream = true,
    signal,
    onProgress, // (currentChunk, totalChunks, accumulatedTotal)
    onChunkToken // (token, currentTotalText)
  }) {
    if (!text || !text.trim()) {
      throw new Error('Kein Text zum Übersetzen angegeben.');
    }

    const config = await getConfig();
    const currentEngine = engine || config.engine || 'turbo';

    // Fast Turbo Engine (0.3s - 0.5s sub-second speed!)
    if (currentEngine === 'turbo') {
      onProgress?.(1, 1, '');
      const fastResult = await translateFast(text, sourceLang, targetLang);
      onChunkToken?.(fastResult, fastResult);
      onProgress?.(1, 1, fastResult);
      return fastResult;
    }

    const finalModel = model || config.model || 'phi3:3.8b';
    const finalBaseUrl = baseUrl || config.baseUrl || 'http://127.0.0.1:11434';
    const finalTone = tone || config.tone || 'standard';

    const chunks = splitIntoChunks(text);
    const totalChunks = chunks.length;
    let accumulatedResult = '';

    for (let i = 0; i < totalChunks; i++) {
      if (signal?.aborted) {
        throw new Error('Übersetzung abgebrochen.');
      }

      onProgress?.(i + 1, totalChunks, accumulatedResult);
      const chunkText = chunks[i];
      let chunkTranslation = '';

      if (stream) {
        chunkTranslation = await streamTranslateSingleChunk({
          text: chunkText,
          sourceLang,
          targetLang,
          tone: finalTone,
          model: finalModel,
          baseUrl: finalBaseUrl,
          signal,
          onToken: (token) => {
            const currentFull = accumulatedResult
              ? `${accumulatedResult}\n\n${chunkTranslation}${token}`
              : `${chunkTranslation}${token}`;
            chunkTranslation += token;
            onChunkToken?.(token, currentFull);
          }
        });
      } else {
        // Non-streaming fallback
        const systemPrompt = buildPrompt(sourceLang, targetLang, finalTone);
        const res = await fetch(`${finalBaseUrl.replace(/\/+$/, '')}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: finalModel,
            stream: false,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: chunkText }
            ]
          }),
          signal
        });
        if (!res.ok) throw new Error(`Ollama Fehler: HTTP ${res.status}`);
        const data = await res.json();
        chunkTranslation = data?.message?.content?.trim() || '';
      }

      accumulatedResult = accumulatedResult
        ? `${accumulatedResult}\n\n${chunkTranslation}`
        : chunkTranslation;
      onProgress?.(i + 1, totalChunks, accumulatedResult);
    }

    return accumulatedResult;
  }

  // Audio Text-To-Speech helper
  function speak(text, langName) {
    if (!('speechSynthesis' in window)) {
      throw new Error('Text-To-Speech wird von diesem Browser nicht unterstützt.');
    }
    window.speechSynthesis.cancel();
    if (!text || !text.trim()) return;

    const utterance = new SpeechSynthesisUtterance(text.slice(0, 2000));

    // Map common language names to BCP-47 tags
    const langMap = {
      'Deutsch': 'de-DE',
      'Englisch': 'en-US',
      'Französisch': 'fr-FR',
      'Spanisch': 'es-ES',
      'Italienisch': 'it-IT',
      'Niederländisch': 'nl-NL',
      'Polnisch': 'pl-PL',
      'Portugiesisch': 'pt-PT',
      'Ukrainisch': 'uk-UA',
      'Russisch': 'ru-RU',
      'Chinesisch (vereinfacht)': 'zh-CN',
      'Chinesisch (traditionell)': 'zh-TW',
      'Japanisch': 'ja-JP',
      'Koreanisch': 'ko-KR',
      'Türkisch': 'tr-TR',
      'Bosnisch': 'bs-BA',
      'Kroatisch': 'hr-HR',
      'Serbisch': 'sr-RS',
      'Arabisch': 'ar-SA'
    };

    if (langName && langMap[langName]) {
      utterance.lang = langMap[langName];
    }
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  // Apply Custom Glossary (Wörterbuch-Filter)
  function applyGlossary(text, glossaryList) {
    if (!text || !Array.isArray(glossaryList) || glossaryList.length === 0) return text;
    let result = text;
    for (const item of glossaryList) {
      if (!item?.from || !item?.to) continue;
      try {
        const escaped = item.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const flags = item.matchCase ? 'g' : 'gi';
        const regex = new RegExp(`\\b${escaped}\\b`, flags);
        result = result.replace(regex, item.to);
      } catch {}
    }
    return result;
  }

  // Adjust Formality & Tone (Standard, Human, Formal, Informal)
  function adjustTone(text, targetLang, tone = 'standard') {
    if (!text || tone === 'standard') return text;
    const isGerman = !targetLang || targetLang === 'Deutsch' || targetLang === 'de';

    if (tone === 'human') {
      return humanizeText(text, targetLang);
    }

    if (isGerman) {
      if (tone === 'formal') {
        const map = [
          [/\bdu kannst\b/gi, 'können Sie'],
          [/\bkannst du\b/gi, 'können Sie'],
          [/\bdu hast\b/gi, 'haben Sie'],
          [/\bhast du\b/gi, 'haben Sie'],
          [/\bdu bist\b/gi, 'sind Sie'],
          [/\bbist du\b/gi, 'sind Sie'],
          [/\bdu wirst\b/gi, 'werden Sie'],
          [/\bwirst du\b/gi, 'werden Sie'],
          [/\bdu möchtest\b/gi, 'möchten Sie'],
          [/\bmöchtest du\b/gi, 'möchten Sie'],
          [/\bdu willst\b/gi, 'möchten Sie'],
          [/\bwillst du\b/gi, 'möchten Sie'],
          [/\bdu solltest\b/gi, 'sollten Sie'],
          [/\bsolltest du\b/gi, 'sollten Sie'],
          [/\bdu\b/gi, 'Sie'],
          [/\bdir\b/gi, 'Ihnen'],
          [/\bdich\b/gi, 'Sie'],
          [/\bdeine\b/gi, 'Ihre'],
          [/\bdeinen\b/gi, 'Ihren'],
          [/\bdeinem\b/gi, 'Ihrem'],
          [/\bdeines\b/gi, 'Ihres'],
          [/\bdein\b/gi, 'Ihr']
        ];
        let res = text;
        for (const [re, rep] of map) res = res.replace(re, rep);
        return res;
      }

      if (tone === 'informal') {
        const map = [
          [/\bkönnen Sie\b/gi, 'kannst du'],
          [/\bhaben Sie\b/gi, 'hast du'],
          [/\bsind Sie\b/gi, 'bist du'],
          [/\bwerden Sie\b/gi, 'wirst du'],
          [/\bmöchten Sie\b/gi, 'möchtest du'],
          [/\bsollten Sie\b/gi, 'solltest du'],
          [/\bIhre\b/gi, 'deine'],
          [/\bIhren\b/gi, 'deinen'],
          [/\bIhrem\b/gi, 'deinem'],
          [/\bIhr\b/gi, 'dein'],
          [/\bIhnen\b/gi, 'dir'],
          [/\bSie\b/gi, 'du']
        ];
        let res = text;
        for (const [re, rep] of map) res = res.replace(re, rep);
        return res;
      }
    }

    return text;
  }

  // Humanize Text (Menschlicher & natürlicher Sprachfluss ohne Roboter-Deutsch)
  function humanizeText(text, targetLang = 'Deutsch') {
    if (!text || text.length < 3) return text;
    const isGerman = !targetLang || targetLang === 'Deutsch' || targetLang === 'de';

    if (isGerman) {
      let res = text;

      const humanRules = [
        // Compound bureaucratic phrases -> natural phrases
        [/\bAufgrund der Tatsache, dass\b/gi, 'Weil'],
        [/\baufgrund der Tatsache, dass\b/gi, 'weil'],
        [/\bin der Lage sind, eine Entscheidung zu treffen\b/gi, 'entscheiden können'],
        [/\bin der Lage ist, eine Entscheidung zu treffen\b/gi, 'entscheiden kann'],
        [/\bin der Lage sein, eine Entscheidung zu treffen\b/gi, 'entscheiden können'],
        [/\beine Entscheidung zu treffen\b/gi, 'zu entscheiden'],
        [/\beine Entscheidung treffen\b/gi, 'entscheiden'],
        [/\beine Überprüfung durchführen\b/gi, 'prüfen'],
        [/\beine Überprüfung vornehmen\b/gi, 'prüfen'],
        [/\bin Anspruch zu nehmen\b/gi, 'zu nutzen'],
        [/\bin Anspruch nehmen\b/gi, 'nutzen'],
        [/\bzur Verfügung gestellt wird\b/gi, 'bereitsteht'],
        [/\bzur Verfügung gestellt werden\b/gi, 'bereitstehen'],
        [/\bzur Verfügung stellen\b/gi, 'anbieten'],
        [/\bzur Verfügung steht\b/gi, 'bereitsteht'],
        [/\bzur Verfügung stehen\b/gi, 'bereitstehen'],
        [/\bzur Verfügung\b/gi, 'bereit'],
        [/\bin der Lage sein, zu\b/gi, 'können'],
        [/\bin der Lage sind, zu\b/gi, 'können'],
        [/\bin der Lage ist, zu\b/gi, 'kann'],
        [/\bin Betracht ziehen\b/gi, 'überlegen'],
        [/\bunter Beweis stellen\b/gi, 'zeigen'],

        // Robot filler formulas
        [/\bEs ist wichtig zu beachten, dass\b/gi, 'Gut zu wissen:'],
        [/\bEs ist zu beachten, dass\b/gi, 'Wichtig:'],
        [/\bEs sollte beachtet werden, dass\b/gi, 'Denken Sie daran:'],
        [/\bEs wird empfohlen, dass Sie\b/gi, 'Am besten'],
        [/\bEs ist ratsam, zu\b/gi, 'Am besten'],
        [/\bEs ist erwähnenswert, dass\b/gi, 'Übrigens:'],
        [/\bWie bereits erwähnt,\b/gi, 'Wie gesagt,'],
        [/\bIn Anbetracht der Tatsache, dass\b/gi, 'Da'],
        [/\bUnter der Voraussetzung, dass\b/gi, 'Wenn'],
        [/\bZum jetzigen Zeitpunkt\b/gi, 'Aktuell'],
        [/\bZu einem späteren Zeitpunkt\b/gi, 'Später'],

        // Connectors -> warm, natural German
        [/\bIn Anbetracht dessen\b/g, 'Deshalb'],
        [/\bin Anbetracht dessen\b/g, 'deshalb'],
        [/\bEine Vielzahl von\b/g, 'Viele'],
        [/\beine Vielzahl von\b/g, 'viele'],
        [/\bEin hohes Maß an\b/g, 'Viel'],
        [/\bein hohes Maß an\b/g, 'viel'],
        [/\bIn erster Linie\b/gi, 'Vor allem'],
        [/\bin erster Linie\b/gi, 'vor allem'],
        [/\bIn regelmäßigen Abständen\b/gi, 'Regelmäßig'],
        [/\bEs wird darauf hingewiesen, dass\b/gi, 'Hinweis:'],
        [/\bist es wichtig zu beachten, dass\b/gi, 'gilt:'],
        [/\bEs ist von entscheidender Bedeutung\b/gi, 'Besonders wichtig:'],
        [/\bist von entscheidender Bedeutung\b/gi, 'ist entscheidend'],
        [/\bVerwenden Sie die nachfolgende Schaltfläche\b/gi, 'Klicken Sie auf den Button'],
        [/\bDarüber hinaus\b/gi, 'Außerdem'],
        [/\bDes Weiteren\b/gi, 'Zusätzlich'],
        [/\bNichtsdestotrotz\b/gi, 'Trotzdem'],
        [/\bIm Hinblick auf\b/gi, 'Rund um'],
        [/\bIn Bezug auf\b/gi, 'Zu'],
        [/\bDiesbezüglich\b/gi, 'Dazu'],
        [/\bZu diesem Zweck\b/gi, 'Dafür'],
        [/\bBeispielsweise\b/gi, 'Zum Beispiel'],
        [/\bIm Falle von\b/gi, 'Bei'],
        [/\bIm Falle eines\b/gi, 'Bei einem'],
        [/\bIm Falle einer\b/gi, 'Bei einer'],

        // Computer clichés -> natural user terminology
        [/\bauf die Schaltfläche\b/gi, 'auf den Button'],
        [/\bdie Schaltfläche\b/gi, 'den Button'],
        [/\bSchaltflächen\b/gi, 'Buttons'],
        [/\bBenutzeroberfläche\b/gi, 'Oberfläche'],
        [/\bdie Funktionalität\b/gi, 'die Funktion'],
        [/\bFunktionalitäten\b/gi, 'Funktionen'],
        [/\bFunktionalität\b/gi, 'Funktion'],
        [/\bAbonnement\b/gi, 'Abo'],
        [/\bvollumfänglich\b/gi, 'komplett'],
        [/\bunverzüglich\b/gi, 'sofort']
      ];

      for (const [re, rep] of humanRules) {
        res = res.replace(re, rep);
      }

      // Polish sentence spacing and capitalization
      res = res.replace(/\s+([.,!?:;])/g, '$1');
      res = res.replace(/:\s+([a-zäöü])/g, (m, c) => ': ' + c.toUpperCase());
      res = res.replace(/\s{2,}/g, ' ').trim();
      return res;
    }

    if (targetLang === 'Englisch' || targetLang === 'en') {
      let res = text;
      const enRules = [
        [/\bdue to the fact that\b/gi, 'because'],
        [/\bin order to\b/gi, 'to'],
        [/\bat the present time\b/gi, 'now'],
        [/\bit is important to note that\b/gi, 'note that'],
        [/\bmake a decision\b/gi, 'decide'],
        [/\bhas the capability to\b/gi, 'can'],
        [/\butilize\b/gi, 'use']
      ];
      for (const [re, rep] of enRules) res = res.replace(re, rep);
      return res.trim();
    }

    return text;
  }

  // Generate Alternative Phrasings (wie bei DeepL Alternativen)
  function generateAlternatives(text, targetLang, tone = 'standard') {
    if (!text || text.length < 5) return [];
    const alts = [];
    const isGerman = !targetLang || targetLang === 'Deutsch' || targetLang === 'de';

    if (isGerman) {
      // 1. Alternate tone variant (formal vs informal)
      const oppositeTone = tone === 'formal' ? 'informal' : 'formal';
      const toneAlt = adjustTone(text, targetLang, oppositeTone);
      if (toneAlt && toneAlt !== text) {
        alts.push(toneAlt);
      }

      // 2. Natural synonym variations
      const synonyms = [
        [/\bbietet\b/gi, 'liefert'],
        [/\bliefert\b/gi, 'ermöglicht'],
        [/\bermöglicht\b/gi, 'bietet'],
        [/\bhelfen\b/gi, 'unterstützen'],
        [/\bunterstützen\b/gi, 'helfen'],
        [/\bschnell\b/gi, 'zügig'],
        [/\beinfach\b/gi, 'unkompliziert'],
        [/\bhochwertige\b/gi, 'erstklassige'],
        [/\bautomatisch\b/gi, 'selbsttätig'],
        [/\bPreise\b/gi, 'Kosten'],
        [/\bDokumentation\b/gi, 'Anleitung'],
        [/\bModelle\b/gi, 'KI-Modelle']
      ];
      let synVariant = text;
      let matched = false;
      for (const [re, rep] of synonyms) {
        if (re.test(synVariant)) {
          synVariant = synVariant.replace(re, rep);
          matched = true;
          break;
        }
      }
      if (matched && synVariant !== text && !alts.includes(synVariant)) {
        alts.push(synVariant);
      }

      // 3. Compact / Fluent phrasing variant
      if (text.includes(' auf der Webseite ') || text.includes(' in der Lage ')) {
        const concise = text
          .replace(/ in der Lage (ist|sind), zu /gi, ' kann ')
          .replace(/ auf der Webseite /gi, ' online ');
        if (concise !== text && !alts.includes(concise)) {
          alts.push(concise);
        }
      }
    }

    return alts.slice(0, 3);
  }

  // Text Statistics (Zeichen, Wörter, Lesezeit)
  function getTextStats(text) {
    const raw = String(text || '').trim();
    if (!raw) return { chars: 0, words: 0, readSeconds: 0 };
    const words = raw.split(/\s+/).filter(Boolean).length;
    const chars = raw.length;
    const readSeconds = Math.max(1, Math.round(words / 3.3));
    return { chars, words, readSeconds };
  }

  // Export to global scope
  const api = {
    DEFAULT_CONFIG,
    LANGUAGES,
    LANG_CODES,
    TONES,
    getConfig,
    saveConfig,
    check,
    splitIntoChunks,
    translate,
    translateFast,
    speak,
    stopSpeaking,
    applyGlossary,
    adjustTone,
    humanizeText,
    generateAlternatives,
    getTextStats
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.WebTranslator = api;
  }
  if (typeof self !== 'undefined') {
    self.WebTranslator = api;
  }
})();
