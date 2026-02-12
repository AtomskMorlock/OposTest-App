// =======================
// APP.JS (versión completa)
// Compatible con el HTML que has pegado
// - Menú principal estático (no lo machacamos)
// - Importar preguntas desde la app
// - Exportar JSON
// - Test por temas (agrupados por bloque, toggle bloque)
// - Examen (100) y Examen por bloque (25)
// - Repaso pendientes (fallos/no sé)
// - Perfeccionamiento (repite fallos en el mismo test)
// - Pausa + guardar progreso + continuar
// - Banco: buscar/filtrar/editar/eliminar
// - Fix: localStorage corrupto (object is not iterable)
// =======================

// =======================
// STORAGE KEYS
// =======================
const LS_EXTRA_QUESTIONS = "chatgpt_extra_questions_v1";
const LS_STATS = "chatgpt_stats_v1";
const LS_HISTORY = "chatgpt_history_v1";
const LS_PENDING_REVIEW = "chatgpt_pending_review_v1";
const LS_PENDING_REVIEW_DONE = "chatgpt_pending_review_done_v1";
const LS_ACTIVE_PAUSED_TEST = "chatgpt_active_paused_test_v1";
const LS_DELETED_IDS = "chatgpt_deleted_ids_v1";
const LS_TTS_SETTINGS = "chatgpt_tts_settings_v1";

// ✅ NUEVO: IDs purgadas definitivamente (no deben volver aunque estén en questions.json)
const LS_PURGED_IDS = "chatgpt_purged_ids_v1";

// migración antigua
const LS_OLD_ADDED_QUESTIONS = "chatgpt_added_questions_v1";

// =======================
// MIGRACION CHARI -> CHATGPT
// =======================
function migrateLocalStorageChariToChatGPT() {
  const migrationFlag = "chatgpt_migration_chari_to_chatgpt_v1";
  try {
    if (localStorage.getItem(migrationFlag) === "done") return;
  } catch (err) {
    console.warn("No se pudo leer la marca de migracion", err);
  }

  const pairs = [
    ["chari_extra_questions_v1", LS_EXTRA_QUESTIONS],
    ["chari_stats_v1", LS_STATS],
    ["chari_history_v1", LS_HISTORY],
    ["chari_pending_review_v1", LS_PENDING_REVIEW],
    ["chari_pending_review_done_v1", LS_PENDING_REVIEW_DONE],
    ["chari_active_paused_test_v1", LS_ACTIVE_PAUSED_TEST],
    ["chari_deleted_ids_v1", LS_DELETED_IDS],
    ["chari_tts_settings_v1", LS_TTS_SETTINGS],
    ["chari_purged_ids_v1", LS_PURGED_IDS],
    ["chari_added_questions_v1", LS_OLD_ADDED_QUESTIONS],
    ["chari_dark_mode_v1", "chatgpt_dark_mode_v1"]
  ];

  for (const [oldKey, newKey] of pairs) {
    try {
      if (localStorage.getItem(newKey) !== null) continue;
      const oldValue = localStorage.getItem(oldKey);
      if (oldValue === null) continue;
      localStorage.setItem(newKey, oldValue);
    } catch (err) {
      console.warn("No se pudo migrar LocalStorage:", oldKey, "->", newKey, err);
    }
  }

  for (const [oldKey] of pairs) {
    try {
      localStorage.removeItem(oldKey);
    } catch (err) {
      console.warn("No se pudo borrar LocalStorage antiguo:", oldKey, err);
    }
  }

  try {
    localStorage.setItem(migrationFlag, "done");
  } catch (err) {
    console.warn("No se pudo guardar la marca de migracion", err);
  }
}

migrateLocalStorageChariToChatGPT();

// =======================
// SANITIZACIÓN LOCALSTORAGE (ARRANQUE)
// =======================
(function sanitizeLocalStorageOnStartup() {
  let touched = false;

  function saveIfChanged(key, newValue, oldValue) {
    if (JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
      lsSetJSON(key, newValue);
      touched = true;
    }
  }

  // --- STATS ---
  const rawStats = lsGetJSON(LS_STATS, {});
  const cleanStats = {};
  if (rawStats && typeof rawStats === "object") {
    for (const [id, val] of Object.entries(rawStats)) {
      if (val && typeof val === "object") {
        cleanStats[String(id)] = {
          seen: Number(val.seen) || 0,
          correct: Number(val.correct) || 0,
          wrong: Number(val.wrong) || 0,
          noSe: Number(val.noSe) || 0
        };
      }
    }
  }
  saveIfChanged(LS_STATS, cleanStats, rawStats);

  // --- PENDING / DONE / DELETED / PURGED ---
  function sanitizeIdArray(key) {
    const raw = lsGetJSON(key, []);
    const clean = normalizeIdArray(asArray(raw));
    saveIfChanged(key, clean, raw);
  }

  sanitizeIdArray(LS_PENDING_REVIEW);
  sanitizeIdArray(LS_PENDING_REVIEW_DONE);
  sanitizeIdArray(LS_DELETED_IDS);

  // ✅ NUEVO: sanea también las purgadas
  sanitizeIdArray(LS_PURGED_IDS);

  // --- HISTORY ---
  const rawHist = lsGetJSON(LS_HISTORY, []);
  const cleanHist = asArray(rawHist).filter(x => x && typeof x === "object");
  saveIfChanged(LS_HISTORY, cleanHist, rawHist);

  // --- EXTRA QUESTIONS ---
  const rawExtra = lsGetJSON(LS_EXTRA_QUESTIONS, []);
  const cleanExtra = asArray(rawExtra)
    .filter(q => q && typeof q === "object" && q.id != null)
    .map(q => ({ ...q, id: String(q.id) }));
  saveIfChanged(LS_EXTRA_QUESTIONS, cleanExtra, rawExtra);

  // --- PAUSED TEST ---
  const rawPaused = lsGetJSON(LS_ACTIVE_PAUSED_TEST, null);
  let pausedValid = true;

  if (rawPaused && typeof rawPaused === "object") {
    if (!Array.isArray(rawPaused.currentTestIds)) pausedValid = false;
    if (typeof rawPaused.currentIndex !== "number") pausedValid = false;
    if (typeof rawPaused.timeRemaining !== "number") pausedValid = false;
  }

  if (!pausedValid) {
    localStorage.removeItem(LS_ACTIVE_PAUSED_TEST);
    touched = true;
  }

  if (touched) {
    console.log("🧹 localStorage saneado correctamente");
  }
})();

// =======================
// MIGRACIÓN DE PREGUNTAS ANTIGUAS
// =======================
(function migrateOldQuestionsIfNeeded() {
  try {
    const oldRaw = localStorage.getItem(LS_OLD_ADDED_QUESTIONS);
    if (!oldRaw) return;

    const oldQuestions = JSON.parse(oldRaw);
    if (!Array.isArray(oldQuestions) || oldQuestions.length === 0) return;

    const newRaw = localStorage.getItem(LS_EXTRA_QUESTIONS);
    const newQuestions = newRaw ? JSON.parse(newRaw) : [];
    const safeNew = Array.isArray(newQuestions) ? newQuestions : [];

    // 🔒 existingIds SIEMPRE string
    const existingIds = new Set(
      safeNew
        .map(q => (q && q.id != null ? String(q.id) : ""))
        .filter(Boolean)
    );

    let imported = 0;
    oldQuestions.forEach(q => {
      if (!q) return;

      const idStr = (q.id != null ? String(q.id) : "");

      // si tiene id y ya existe, no importamos
      if (idStr && existingIds.has(idStr)) return;

      // guardamos normalizando id si existe
      const normalized = idStr ? { ...q, id: idStr } : { ...q };

      safeNew.push(normalized);
      if (idStr) existingIds.add(idStr);

      imported++;
    });

    if (imported > 0) {
      localStorage.setItem(LS_EXTRA_QUESTIONS, JSON.stringify(safeNew));
      console.log(`Migración completada: ${imported} preguntas recuperadas`);
    }
  } catch (e) {
    console.error("Error en migración de preguntas antiguas", e);
  }
})();

// =======================
// ESTADO GLOBAL
// =======================
let questionsBase = [];
let questionsExtra = [];
let questions = [];

let currentTest = [];
let currentIndex = 0;

let timer = null;
let timeRemaining = 0;

let correctCount = 0;
let wrongCount = 0;
let noSeCount = 0;

let mode = "practice"; // practice | exam | exam-block | review | perfection | bank
let sessionOpts = { mode: "practice", timeSeconds: 0, countNonAnsweredAsWrongOnFinish: false, meta: {} };
let answeredIds = new Set();

let perfectionQueue = [];
let perfectionSet = new Set();

let lastSessionAnswers = [];

let viewState = "question"; // question | feedback
let currentShuffledOptions = [];
let lastSelectedText = null;
let lastCorrectText = null;

// =======================
// DOM (IDs del HTML que has pegado)
// =======================
const mainMenu = document.getElementById("main-menu");
const testMenu = document.getElementById("test-menu");
const testContainer = document.getElementById("test-container");
const voiceSettingsContainer = document.getElementById("voice-settings-container");
const resultsContainer = document.getElementById("results-container");
const reviewContainer = document.getElementById("review-container");
const reviewText = document.getElementById("review-text");
const backToResultsBtn = document.getElementById("back-to-results-btn");
const statsContainer = document.getElementById("stats-container");
const importContainer = document.getElementById("import-container");
const configContainer = document.getElementById("config-container");
const configActions = document.getElementById("config-actions");
const backConfigBtn = document.getElementById("btn-back-config");

const dbCountPill = document.getElementById("db-count-pill");

const questionText = document.getElementById("question-text");
const answersContainer = document.getElementById("answers-container");
const continueBtn = document.getElementById("continue-btn");
const noSeBtn = document.getElementById("no-btn");
const timerDisplay = document.getElementById("timer");
const modePill = document.getElementById("mode-pill");
const motivationalPhraseEl = document.getElementById("motivational-phrase");

const ttsPanel = document.getElementById("tts-panel");
const ttsToggleBtn = document.getElementById("tts-toggle");
const ttsVoiceList = document.getElementById("tts-voice-list");
const ttsRateRange = document.getElementById("tts-rate");
const ttsPitchRange = document.getElementById("tts-pitch");
const ttsReadBtn = document.getElementById("tts-read");

const startTestBtn = document.getElementById("btn-start-test");
const quickTest10Btn = document.getElementById("btn-quick-test-10");
const quickTest20Btn = document.getElementById("btn-quick-test-20");
const openTestModalBtn = document.getElementById("btn-open-test-modal");
const testStartModal = document.getElementById("test-start-modal");
const closeTestModalBtn = document.getElementById("btn-close-test-modal");
const examSourceModal = document.getElementById("exam-source-modal");
const examSourceButtons = document.getElementById("exam-source-buttons");
const examStartBtn = document.getElementById("btn-exam-start");
const examCloseBtn = document.getElementById("btn-exam-close");
const voiceSettingsBtn = document.getElementById("btn-voice-settings");
const voiceSettingsBackBtn = document.getElementById("btn-voice-back");
const openImportBtn = document.getElementById("btn-open-import");
const exportJsonBtn = document.getElementById("btn-export-json");
const backToMenuBtnResults = document.getElementById("back-to-menu-btn");

const importTextarea = document.getElementById("import-textarea");
const importStatus = document.getElementById("import-status");
const btnImportQuestions = document.getElementById("btn-import-questions");
const btnClearImport = document.getElementById("btn-clear-import");
const btnClearAdded = document.getElementById("btn-clear-added");
const btnBackFromImport = document.getElementById("btn-back-from-import");

const resultsText = document.getElementById("results-text");
const statsContent = document.getElementById("stats-content");
const statsActions = document.getElementById("stats-actions");

// =======================
// MODAL (alert/confirm integrados)
// =======================
const modalOverlay = document.getElementById("app-modal-overlay");
const modalTitle = document.getElementById("app-modal-title");
const modalMessage = document.getElementById("app-modal-message");
const modalActions = document.getElementById("app-modal-actions");

function openModal({ title, message, actions }) {
  return new Promise(resolve => {
    if (!modalOverlay || !modalTitle || !modalMessage || !modalActions) {
      resolve(actions?.[0]?.value ?? null);
      return;
    }

    modalTitle.textContent = title || "Aviso";
    modalMessage.textContent = message || "";
    modalActions.innerHTML = "";

    const btns = [];

    (actions || []).forEach((action, index) => {
      const btn = document.createElement("button");
      btn.textContent = action.label || "Aceptar";
      btn.className = action.className || "";
      btn.style.width = "120px";
      btn.onclick = () => {
        closeModal();
        resolve(action.value);
      };
      modalActions.appendChild(btn);
      btns.push({ btn, action, index });
    });

    function onKey(e) {
      if (e.key === "Escape") {
        const cancel = btns.find(b => b.action.role === "cancel");
        if (cancel) {
          closeModal();
          resolve(cancel.action.value);
        }
      }
      if (e.key === "Enter") {
        const def = btns.find(b => b.action.default) || btns[0];
        if (def) {
          closeModal();
          resolve(def.action.value);
        }
      }
    }

    function closeModal() {
      modalOverlay.style.display = "none";
      modalOverlay.setAttribute("aria-hidden", "true");
      document.removeEventListener("keydown", onKey);
    }

    document.addEventListener("keydown", onKey);
    modalOverlay.style.display = "flex";
    modalOverlay.setAttribute("aria-hidden", "false");

    const defBtn = btns.find(b => b.action.default) || btns[0];
    if (defBtn) defBtn.btn.focus();
  });
}

function showAlert(message, title = "Aviso") {
  return openModal({
    title,
    message,
    actions: [
      { label: "Aceptar", value: true, className: "secondary", default: true }
    ]
  });
}

function showConfirm(message, opts = {}) {
  return openModal({
    title: opts.title || "Confirmar",
    message,
    actions: [
      {
        label: opts.confirmText || "Aceptar",
        value: true,
        className: opts.danger ? "danger" : "",
        default: true
      },
      {
        label: opts.cancelText || "Cancelar",
        value: false,
        className: "secondary",
        role: "cancel"
      }
    ]
  });
}

// =======================
// UTIL: STORAGE
// =======================
function lsGetJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function lsSetJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// =======================
// TTS (LECTURA POR VOZ)
// =======================
const TTS_DEFAULTS = {
  enabled: false,
  voiceURI: "",
  rate: 1,
  pitch: 1
};

let ttsSettings = { ...TTS_DEFAULTS };
let ttsVoices = [];
let ttsVoiceRetryCount = 0;
let ttsUserInteracted = false;
let ttsLastQuestionId = null;

const MOTIVATIONAL_FALLBACK = [
  "No estás procrastinando: estás entrenando la paciencia del tribunal.",
  "Cada tema que estudias es un punto menos que tendrá el listillo de tu alrededor.",
  "Hoy duele estudiar; mañana duele ver la lista de aprobados sin tu nombre.",
  "No eres lento: estás cargando el cerebro en alta calidad.",
  "El BOE no se memoriza solo. Lamentablemente.",
  "Estudia ahora para poder decir luego: “sí, fue duro, pero mira”.",
  "Tu futuro yo ya te está dando las gracias (aunque ahora te insulte).",
  "No es falta de motivación, es exceso de realidad. Sigue.",
  "Cada pregunta que fallas hoy es una que no te fallará el día del examen.",
  "Si fuera fácil, no habría plaza.",
  "El cansancio pasa. La plaza fija se queda.",
  "Hoy estudias artículos; mañana discutes trienios.",
  "No estás repitiendo el tema: lo estás clavando.",
  "A nadie le gusta estudiar… pero a nadie le gusta suspender.",
  "El tribunal no sabe tu nombre. Todavía.",
  "Estudiar oposiciones es aburrido. No aprobarlas es peor.",
  "No es obsesión: es estrategia a largo plazo.",
  "Si te rindes hoy, mañana tendrás que estudiar igual.",
  "No hace falta motivación. Hace falta sentarse.",
  "Un día menos de estudio es un día más lejos de la plaza.",
  "Nadie sueña con opositar, pero todo el mundo sueña con aprobar.",
  "Ahora mismo hay alguien estudiando menos que tú. Aprovecha.",
  "No estás perdiendo el tiempo: lo estás invirtiendo a interés compuesto.",
  "Suspender también enseña, pero aprobar enseña más rápido.",
  "Si te da pereza estudiar, imagina volver a hacerlo dentro de dos años.",
  "No te comparas con otros: compites contra el temario.",
  "Estudiar oposiciones es un maratón, no una huida hacia el sofá.",
  "Cada día que estudias es un día que el azar trabaja para ti.",
  "El cansancio es temporal. El BOE es eterno.",
  "No estás bloqueado: estás a punto de entenderlo.",
  "La plaza no se gana el día del examen, se cocina ahora.",
  "Nadie recuerda las tardes perdidas estudiando. Sí recuerdan aprobar.",
  "Esto no es sufrimiento: es entrenamiento mental con recompensa.",
  "Estudiar cuando no apetece es exactamente el truco.",
  "El temario no se va a estudiar solo mientras miras el techo.",
  "Si hoy avanzas poco, mañana avanzas sobre lo avanzado.",
  "No te falta capacidad, te sobran excusas. Hoy no las uses.",
  "El día del examen no se improvisa. Se llega con ventaja.",
  "No estudias para saberlo todo, estudias para saber más que otros.",
  "Algún día dirás: menos mal que no lo dejé."
];
let motivationalPhrases = MOTIVATIONAL_FALLBACK.slice();

function getRandomMotivationalPhrase() {
  const list = motivationalPhrases && motivationalPhrases.length ? motivationalPhrases : MOTIVATIONAL_FALLBACK;
  return list[Math.floor(Math.random() * list.length)];
}

function renderMotivationalPhrase() {
  if (!motivationalPhraseEl) return;
  motivationalPhraseEl.textContent = getRandomMotivationalPhrase();
}

function ttsLoadSettings() {
  const raw = lsGetJSON(LS_TTS_SETTINGS, null);
  if (raw && typeof raw === "object") {
    ttsSettings = {
      enabled: !!raw.enabled,
      voiceURI: typeof raw.voiceURI === "string" ? raw.voiceURI : "",
      rate: Number(raw.rate) || 1,
      pitch: Number(raw.pitch) || 1
    };
  } else {
    ttsSettings = { ...TTS_DEFAULTS };
  }
}

function ttsSaveSettings() {
  lsSetJSON(LS_TTS_SETTINGS, ttsSettings);
}

function ttsInitVoices() {
  if (!("speechSynthesis" in window)) return;

  const voices = window.speechSynthesis.getVoices();
  if (voices && voices.length) {
    ttsVoices = voices.slice();
    ttsVoiceRetryCount = 0;
    ttsPopulateVoiceButtons();
    return;
  }

  if (ttsVoiceRetryCount < 5) {
    ttsVoiceRetryCount += 1;
    setTimeout(ttsInitVoices, 300 * ttsVoiceRetryCount);
  }
}

function ttsGetSpanishVoicePreferred(voices) {
  if (!voices || !voices.length) return null;
  const preferredNames = ["mónica", "monica", "google español"];
  const byName = voices.filter(v => preferredNames.includes(String(v.name || "").toLowerCase()));
  if (byName.length) return byName[0];
  const esVoices = voices.filter(v => String(v.lang || "").toLowerCase().startsWith("es"));
  if (esVoices.length) {
    const esES = esVoices.find(v => String(v.lang || "").toLowerCase() === "es-es");
    return esES || esVoices[0];
  }
  return voices[0];
}

function ttsPopulateVoiceButtons() {
  if (!ttsVoiceList) return;

  ttsVoiceList.innerHTML = "";

  const preferredNames = ["mónica", "monica", "google español"];
  const esEsVoices = ttsVoices.filter(v => String(v.lang || "").toLowerCase() === "es-es");
  const allowedVoices = esEsVoices.filter(v =>
    preferredNames.includes(String(v.name || "").toLowerCase())
  );

  if (!allowedVoices.length) {
    const msg = document.createElement("div");
    msg.className = "small";
    msg.textContent = "No están disponibles las voces Mónica o Google español.";
    ttsVoiceList.appendChild(msg);
    return;
  }

  if (!ttsSettings.voiceURI || !allowedVoices.find(v => v.voiceURI === ttsSettings.voiceURI)) {
    ttsSettings.voiceURI = allowedVoices[0].voiceURI;
    ttsSaveSettings();
  }

  allowedVoices.forEach(v => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = ttsSettings.voiceURI === v.voiceURI ? "success" : "secondary";
    btn.textContent = v.name;
    btn.onclick = () => {
      ttsUserInteracted = true;
      ttsSettings.voiceURI = v.voiceURI;
      ttsSaveSettings();
      ttsPopulateVoiceButtons();
      ttsSpeakPreview(getRandomMotivationalPhrase(), v.voiceURI);
    };
    ttsVoiceList.appendChild(btn);
  });
}

function ttsApplyUIState() {
  const supported = "speechSynthesis" in window;
  if (ttsToggleBtn) {
    ttsToggleBtn.innerHTML = supported
      ? (ttsSettings.enabled ? "Voz" : "<s>Voz</s>")
      : "Voz no disponible";
    ttsToggleBtn.disabled = !supported;
  }

  if (ttsRateRange) ttsRateRange.value = String(ttsSettings.rate || 1);
  if (ttsPitchRange) ttsPitchRange.value = String(ttsSettings.pitch || 1);

  const disabled = !supported || !ttsSettings.enabled;
  if (ttsReadBtn) ttsReadBtn.disabled = disabled;
  ttsRefreshReadButtonLabel();
}

function ttsRefreshReadButtonLabel() {
  if (!ttsReadBtn) return;
  if (!("speechSynthesis" in window)) {
    ttsReadBtn.textContent = "Leer";
    return;
  }
  const isSpeaking = window.speechSynthesis.speaking || window.speechSynthesis.pending;
  ttsReadBtn.textContent = isSpeaking ? "Callar" : "Leer";
}

function ttsSpeak(text, opts = {}) {
  if (!("speechSynthesis" in window)) return;
  if (!ttsSettings.enabled) return;
  if (!text) return;

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  const rate = typeof opts.rate === "number" ? opts.rate : ttsSettings.rate;
  const pitch = typeof opts.pitch === "number" ? opts.pitch : ttsSettings.pitch;
  utter.rate = Math.min(2, Math.max(0.1, rate));
  utter.pitch = Math.min(2, Math.max(0.1, pitch));

  const voiceURI = opts.voiceURI || ttsSettings.voiceURI;
  if (voiceURI && ttsVoices.length) {
    const voice = ttsVoices.find(v => v.voiceURI === voiceURI);
    if (voice) utter.voice = voice;
  }

  if (!utter.voice) {
    const fallback = ttsGetSpanishVoicePreferred(ttsVoices);
    if (fallback) utter.voice = fallback;
  }

  if (utter.voice && utter.voice.lang) utter.lang = utter.voice.lang;
  else utter.lang = "es-ES";

  utter.onstart = () => ttsRefreshReadButtonLabel();
  utter.onend = () => ttsRefreshReadButtonLabel();
  utter.onerror = () => ttsRefreshReadButtonLabel();

  window.speechSynthesis.speak(utter);
}

function ttsSpeakPreview(text, voiceURI) {
  if (!("speechSynthesis" in window)) return;
  if (!text) return;

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = Math.min(2, Math.max(0.1, ttsSettings.rate || 1));
  utter.pitch = Math.min(2, Math.max(0.1, ttsSettings.pitch || 1));

  if (voiceURI && ttsVoices.length) {
    const voice = ttsVoices.find(v => v.voiceURI === voiceURI);
    if (voice) utter.voice = voice;
  }

  if (!utter.voice) {
    const fallback = ttsGetSpanishVoicePreferred(ttsVoices);
    if (fallback) utter.voice = fallback;
  }

  if (utter.voice && utter.voice.lang) utter.lang = utter.voice.lang;
  else utter.lang = "es-ES";

  utter.onstart = () => ttsRefreshReadButtonLabel();
  utter.onend = () => ttsRefreshReadButtonLabel();
  utter.onerror = () => ttsRefreshReadButtonLabel();

  window.speechSynthesis.speak(utter);
}
function ttsStop() {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  ttsRefreshReadButtonLabel();
}

function ttsSpeakQuestion(q, index, total) {
  if (!q) return;
  const options = currentShuffledOptions && currentShuffledOptions.length
    ? currentShuffledOptions
    : (q.opciones || []);
  const letters = ["A", "B", "C", "D"];
  const optionsText = options
    .map((opt, i) => `Opción ${letters[i] || String(i + 1)}: ${opt}.`)
    .join(" ");
  const text = `Pregunta ${index} de ${total}. ${q.pregunta}. Opciones: ${optionsText}`;
  ttsSpeak(text);
}

function ttsSpeakOnlyQuestion(q, index, total) {
  if (!q) return;
  const text = `Pregunta ${index} de ${total}. ${q.pregunta}.`;
  ttsSpeak(text);
}

function ttsSpeakOnlyOptions(q) {
  if (!q) return;
  const options = currentShuffledOptions && currentShuffledOptions.length
    ? currentShuffledOptions
    : (q.opciones || []);
  const letters = ["A", "B", "C", "D"];
  const optionsText = options
    .map((opt, i) => `Opción ${letters[i] || String(i + 1)}: ${opt}.`)
    .join(" ");
  const text = `Opciones: ${optionsText}`;
  ttsSpeak(text);
}

function ttsMaybeAutoRead(q) {
  if (!ttsSettings.enabled) return;
  if (!ttsUserInteracted) return;
  if (viewState !== "question") return;
  if (!q) return;
  const idStr = String(q.id);
  if (ttsLastQuestionId === idStr) return;
  ttsLastQuestionId = idStr;
  ttsSpeakQuestion(q, currentIndex + 1, currentTest.length);
}

function ttsBindUI() {
  if (ttsToggleBtn) {
    ttsToggleBtn.onclick = () => {
      ttsUserInteracted = true;
      ttsSettings.enabled = !ttsSettings.enabled;
      if (!ttsSettings.enabled) ttsStop();
      ttsSaveSettings();
      ttsApplyUIState();
    };
  }

  if (ttsRateRange) {
    ttsRateRange.oninput = () => {
      ttsUserInteracted = true;
      ttsSettings.rate = Number(ttsRateRange.value) || 1;
      ttsSaveSettings();
    };
  }

  if (ttsPitchRange) {
    ttsPitchRange.oninput = () => {
      ttsUserInteracted = true;
      ttsSettings.pitch = Number(ttsPitchRange.value) || 1;
      ttsSaveSettings();
    };
  }

  if (ttsReadBtn) {
    ttsReadBtn.onclick = () => {
      ttsUserInteracted = true;
      if ("speechSynthesis" in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
        ttsStop();
        return;
      }
      const q = currentTest[currentIndex];
      ttsSpeakQuestion(q, currentIndex + 1, currentTest.length);
    };
  }
}

// Init TTS
(function initTtsOnLoad() {
  ttsLoadSettings();
  ttsBindUI();
  ttsApplyUIState();
  ttsInitVoices();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      ttsVoices = window.speechSynthesis.getVoices();
      ttsPopulateVoiceButtons();
      ttsApplyUIState();
    };
  }
})();

// ✅ fuerza a array para evitar "object is not iterable"
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === "string") return [value];

  if (typeof value === "object") {
    if (Array.isArray(value.values)) return value.values;
    if (Array.isArray(value.items)) return value.items;

    const keys = Object.keys(value);
    const looksIndexed = keys.length && keys.every(k => /^\d+$/.test(k));
    if (looksIndexed) {
      return keys
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
        .map(k => value[k]);
    }
  }
  return [];
}

// =======================
// UTIL: IDS & NORMALIZACIÓN
// =======================

// Fuerza cualquier ID a string
function normalizeId(id) {
  return String(id);
}

// Alias (compatibilidad): algunas partes del código usan normId()
function normId(id) {
  return String(id);
}

// Normaliza un array de IDs a strings únicas
function normalizeIdArray(arr) {
  if (!Array.isArray(arr)) return [];
  return Array.from(new Set(arr.map(normalizeId)));
}

// =======================
// UTIL: SHUFFLE + TIME
// =======================
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
function shuffleCopy(arr) {
  const copy = Array.isArray(arr) ? arr.slice() : [];
  shuffleArray(copy);
  return copy;
}
function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// =======================
// UTIL: PUNTUACION OFICIAL
// =======================
function calcBruta(correct, wrong) {
  return Number(correct || 0) - Number(wrong || 0) * 0.3;
}

function calcNotaSobre100(correct, wrong, noSe) {
  const n = Number(correct || 0) + Number(wrong || 0) + Number(noSe || 0);
  if (!n) return 0;
  const bruta = calcBruta(correct, wrong);
  return (bruta / n) * 100;
}

// =======================
// UTIL: NORMALIZACIÓN / ORDEN TEMAS
// =======================
function extractTemaNumber(temaStr) {
  if (!temaStr) return null;
  const s = String(temaStr).trim();
  // Caso "1", "11", etc.
  const mNum = s.match(/^(\d+)$/);
  if (mNum) return parseInt(mNum[1], 10);
  // Caso "Tema 1", "tema 11", etc.
  const mTema = s.match(/tema\s+(\d+)/i);
  if (mTema) return parseInt(mTema[1], 10);
  return null;
}
function compareTemasNatural(a, b) {
  const na = extractTemaNumber(a);
  const nb = extractTemaNumber(b);
  if (na !== null && nb !== null) return na - nb;
  return String(a).localeCompare(String(b), "es", { sensitivity: "base", numeric: true });
}

function normalizeTemaKey(temaStr) {
  if (!temaStr) return "";
  const s = String(temaStr).trim();
  const n = extractTemaNumber(s);
  if (n !== null) return String(n);
  return s.replace(/\s+/g, " ").toLowerCase();
}

function formatTemaDisplay(temaStr) {
  if (!temaStr) return "Sin tema";
  const s = String(temaStr).trim();
  // Normaliza "1. ..." a "1. ..." (EM SPACE)
  const m = s.match(/^(\d+)\.\s*(.+)$/);
  if (m) {
    return `${m[1]}. \u2003${m[2].trim()}`;
  }
  return s;
}

// =======================
// ESTADÍSTICAS
// =======================
function getStats() {
  const raw = lsGetJSON(LS_STATS, {});
  const safe = (raw && typeof raw === "object") ? raw : {};

  // normaliza claves a string por si hay legados raros
  const clean = {};
  for (const [id, value] of Object.entries(safe)) {
    clean[String(id)] = value;
  }
  return clean;
}

function setStats(stats) {
  lsSetJSON(LS_STATS, stats && typeof stats === "object" ? stats : {});
}

function bumpStat(id, field) {
  const idStr = String(id);

  const stats = getStats();
  if (!stats[idStr]) stats[idStr] = { seen: 0, correct: 0, wrong: 0, noSe: 0 };

  if (field === "seen") stats[idStr].seen++;
  if (field === "correct") stats[idStr].correct++;
  if (field === "wrong") stats[idStr].wrong++;
  if (field === "noSe") stats[idStr].noSe++;

  setStats(stats);
}

function getSeenCount(id) {
  const idStr = String(id);
  const stats = getStats();
  return stats[idStr]?.seen ?? 0;
}

// =======================
// PENDIENTES REPASO
// =======================

// Lee una lista desde LS y la convierte a array "seguro"
function lsGetIdArray(key) {
  const raw = lsGetJSON(key, []);

  // casos correctos: ["1","2"] o [1,2]
  if (Array.isArray(raw)) return raw.map(normalizeId);

  // casos raros por bugs antiguos:
  // - { values: [...] } o { items: [...] } => asArray lo soporta
  // - { "0": "12", "1": "13" } => asArray lo soporta
  // - {} (por JSON.stringify(new Set([...])) => {}) => no hay forma de recuperar; devolvemos []
  const arr = asArray(raw).map(normalizeId);

  // Si era {} puro, asArray devuelve [], lo aceptamos
  return arr;
}

// Guarda SIEMPRE como array de strings
function lsSetIdArray(key, iterable) {
  const arr = Array.from(iterable || []).map(normalizeId);
  lsSetJSON(key, arr);
}

// --- getters/setters sets ---
function getPendingReviewSet() {
  return new Set(lsGetIdArray(LS_PENDING_REVIEW));
}
function setPendingReviewSet(setObj) {
  lsSetIdArray(LS_PENDING_REVIEW, setObj);
}

function getPendingDoneSet() {
  return new Set(lsGetIdArray(LS_PENDING_REVIEW_DONE));
}
function setPendingDoneSet(setObj) {
  lsSetIdArray(LS_PENDING_REVIEW_DONE, setObj);
}

// --- acciones ---
function markPending(id) {
  const pending = getPendingReviewSet();
  pending.add(normalizeId(id));
  setPendingReviewSet(pending);
}

function markReviewedDone(id) {
  const pending = getPendingReviewSet();
  const done = getPendingDoneSet();
  const s = normalizeId(id);

  pending.delete(s);
  done.add(s);

  setPendingReviewSet(pending);
  setPendingDoneSet(done);
}

// ids existentes (SIEMPRE string)
function getExistingIdSet() {
  return new Set((questions || []).map(q => normId(q.id)));
}

// Limpia ids fantasma en pending/done (por borradas o cambios) + normaliza a string
function prunePendingGhostIds() {
  const existing = getExistingIdSet();

  const pending = getPendingReviewSet();
  const done = getPendingDoneSet();

  let changed = false;

  // Normaliza internamente (por si venían números)
  const normalizedPending = new Set(Array.from(pending).map(normId));
  const normalizedDone = new Set(Array.from(done).map(normId));

  // limpia pending
  for (const id of Array.from(normalizedPending)) {
    if (!existing.has(id)) {
      normalizedPending.delete(id);
      changed = true;
    }
  }

  // limpia done
  for (const id of Array.from(normalizedDone)) {
    if (!existing.has(id)) {
      normalizedDone.delete(id);
      changed = true;
    }
  }

  // OJO: si una id está en done, no debe estar en pending
  for (const id of Array.from(normalizedDone)) {
    if (normalizedPending.has(id)) {
      normalizedPending.delete(id);
      changed = true;
    }
  }

  if (changed) {
    setPendingReviewSet(normalizedPending);
    setPendingDoneSet(normalizedDone);
  }
}

// (Opcional pero muy útil) contador único de pendientes reales
function getPendingRealCount() {
  prunePendingGhostIds();
  const existing = getExistingIdSet();
  const pending = getPendingReviewSet();
  const done = getPendingDoneSet();

  let count = 0;
  for (const id of pending) {
    if (existing.has(id) && !done.has(id)) count++;
  }
  return count;
}

// =======================
// HISTORIAL
// =======================
function addHistoryEntry(entry) {
  const raw = lsGetJSON(LS_HISTORY, []);
  const hist = asArray(raw);
  hist.push(entry);
  lsSetJSON(LS_HISTORY, hist);
}
function resetStatsHistory() {
  localStorage.removeItem(LS_STATS);
  localStorage.removeItem(LS_HISTORY);
  localStorage.removeItem(LS_PENDING_REVIEW);
  localStorage.removeItem(LS_PENDING_REVIEW_DONE);
}

// =======================
// QUESTIONS: LOAD + MERGE + DELETE FILTER
// =======================

function loadExtraQuestions() {
  const extra = lsGetJSON(LS_EXTRA_QUESTIONS, []);
  if (!Array.isArray(extra)) return [];

  // 🔒 Normalizamos IDs a string
  return extra.map(q => ({
    ...q,
    id: normalizeId(q.id)
  }));
}

function saveExtraQuestions(extraArr) {
  const clean = Array.isArray(extraArr)
    ? extraArr.map(q => ({ ...q, id: normalizeId(q.id) }))
    : [];

  lsSetJSON(LS_EXTRA_QUESTIONS, clean);
}

function mergeQuestions() {
  // 🔒 Normalizamos base
  const base = Array.isArray(questionsBase)
    ? questionsBase.map(q => ({ ...q, id: normalizeId(q.id) }))
    : [];

  const extra = loadExtraQuestions();

  const map = new Map();

  // Base primero
  for (const q of base) {
    map.set(q.id, q);
  }

  // Extra sobrescribe base si hay colisión
  for (const q of extra) {
    map.set(q.id, q);
  }

  questions = Array.from(map.values());
}

function applyDeletedFilter() {
  // Papelera (borrado lógico)
  const rawDeleted = lsGetJSON(LS_DELETED_IDS, []);
  const deletedSet = new Set(normalizeIdArray(rawDeleted));

  // Borrado definitivo (NO debe volver ni aunque esté en questions.json)
  const rawPurged = lsGetJSON(LS_PURGED_IDS, []);
  const purgedSet = new Set(normalizeIdArray(rawPurged));

  if (deletedSet.size || purgedSet.size) {
    questions = questions.filter(q =>
      !deletedSet.has(String(q.id)) &&
      !purgedSet.has(String(q.id))
    );
  }

  // Persistimos normalizado
  lsSetJSON(LS_DELETED_IDS, Array.from(deletedSet));
  lsSetJSON(LS_PURGED_IDS, Array.from(purgedSet));
}

function refreshDbCountPill() {
  const extraCount = loadExtraQuestions().length;
  if (extraCount > 0) {
    dbCountPill.textContent =
      `Preguntas en el banco: ${questions.length} ` +
      `(base ${questionsBase.length} + añadidas ${extraCount})`;
    return;
  }
  dbCountPill.textContent = `Preguntas en el banco: ${questions.length}`;
}

// =======================
// NAVEGACIÓN UI
// =======================

// ⚠️ IMPORTANTE:
// En tu app ya tienes un bloque "PENDIENTES REPASO" donde defines:
// - getExistingIdSet() (ids como string)
// - prunePendingGhostIds() (limpieza)
// Aquí NO debemos re-definir esas funciones, porque estabas pisándolas con versiones numéricas
// y eso rompe el contador + el pool de repaso.

// (No redefinir getExistingIdSet ni prunePendingGhostIds aquí)

function hideAll() {
  mainMenu.style.display = "none";
  testMenu.style.display = "none";
  testContainer.style.display = "none";
  configContainer.style.display = "none";
  voiceSettingsContainer.style.display = "none";
  resultsContainer.style.display = "none";
  if (testStartModal) testStartModal.style.display = "none";
  reviewContainer.style.display = "none";
  statsContainer.style.display = "none";
  importContainer.style.display = "none";
}

// =======================
// MENÚ PRINCIPAL
// =======================
function showMainMenu() {
  stopTimer();
  hideAll();
  mainMenu.style.display = "block";
  renderMotivationalPhrase();

  // Aseguramos zona de botones extra sin reescribir tu HTML
  let extraBox = document.getElementById("main-extra");
  if (!extraBox) {
    extraBox = document.createElement("div");
    extraBox.id = "main-extra";
    extraBox.style.marginTop = "12px";
    mainMenu.appendChild(extraBox);
  }
  // Limpieza y cálculo de pendientes reales
  prunePendingGhostIds();

  const existing = getExistingIdSet();     // Set<string>
  const pending = getPendingReviewSet();   // Set<string>
  const done = getPendingDoneSet();        // Set<string>

  let pendingCount = 0;
  for (const id of pending) {
    const s = String(id);
    if (existing.has(s) && !done.has(s)) pendingCount++;
  }

  const paused = lsGetJSON(LS_ACTIVE_PAUSED_TEST, null);
  const hist = lsGetJSON(LS_HISTORY, []);
  const last = [...hist].reverse().find(h => ((h?.correct || 0) + (h?.wrong || 0) + (h?.noSe || 0)) > 0) || null;

  const reviewBtn = document.getElementById("btn-review");
  if (reviewBtn) reviewBtn.textContent = `Repasar pendientes (${pendingCount})`;

  const rowPaused = document.getElementById("modal-row-paused");
  if (rowPaused) {
    rowPaused.innerHTML = paused
      ? `
        <button id="btn-continue-paused" class="secondary">Continuar test pausado</button>
        <button id="btn-cancel-paused" class="secondary">Cancelar test pausado</button>
      `
      : "";
  }

  extraBox.innerHTML = `
    <div class="small" id="main-db-pill" style="margin-top:8px;"></div>
    ${
      last
        ? `<div class="small" style="margin-top:6px;">
            <strong>Último test:</strong> ${escapeHtml(last.mode)} · ${last.correct}/${last.total} · ${new Date(last.date).toLocaleString("es-ES")}
           </div>`
        : ""
    }
  `;

  const row1 = document.getElementById("main-row-1");
  if (row1) {
    // Botones extra retirados del menú principal
  }

  const dbPillTarget = document.getElementById("main-db-pill");
  if (dbPillTarget && dbCountPill) {
    dbPillTarget.innerHTML = "";
    dbPillTarget.appendChild(dbCountPill);
  }

  if (paused) {
    document.getElementById("btn-continue-paused").onclick = () => resumePausedTest();
    document.getElementById("btn-cancel-paused").onclick = () => {
      clearPausedTest();
      showMainMenu();
    };
  }

  const btnReview = document.getElementById("btn-review");
  if (btnReview) btnReview.onclick = () => startReviewPending();
  const btnExam = document.getElementById("btn-exam");
  if (btnExam) btnExam.onclick = () => {
    closeTestStartModal();
    openExamSourceModal();
  };
  if (openConfigBtn) openConfigBtn.onclick = () => showConfigScreen();

  refreshDbCountPill();

  // ✅ Hook: añade el toggle de modo oscuro en el menú principal
  injectDarkModeToggleIntoMainMenu();
}

function showConfigScreen() {
  hideAll();
  configContainer.style.display = "block";

  if (configActions) {
    configActions.innerHTML = `
      <button id="btn-bank" class="secondary">Banco de preguntas</button>
      <button id="btn-stats" class="secondary">Estadísticas</button>
      <button id="btn-voice-settings" class="secondary">Voz</button>
    `;
  }

  const btnBank = document.getElementById("btn-bank");
  if (btnBank) btnBank.onclick = () => showQuestionBank();
  const btnStats = document.getElementById("btn-stats");
  if (btnStats) btnStats.onclick = () => showStatsScreen();
  const btnVoice = document.getElementById("btn-voice-settings");
  if (btnVoice) btnVoice.onclick = showVoiceSettingsScreen;
}

function openTestStartModal() {
  if (!testStartModal) return;
  testStartModal.style.display = "flex";
  testStartModal.setAttribute("aria-hidden", "false");
}

function closeTestStartModal() {
  if (!testStartModal) return;
  testStartModal.style.display = "none";
  testStartModal.setAttribute("aria-hidden", "true");
}

// =======================
// NAVEGACIÓN UI
// =======================
function showTestMenuScreen() {
  hideAll();
  testMenu.style.display = "block";
}

function showVoiceSettingsScreen() {
  hideAll();
  voiceSettingsContainer.style.display = "block";
  ttsApplyUIState();
}

function showTestScreen() {
  hideAll();
  testContainer.style.display = "block";
  ensurePauseAndFinishUI();
  updateModePill();
  ttsApplyUIState();
}

function showResultsScreen() {
  stopTimer();
  ttsStop();
  hideAll();
  resultsContainer.style.display = "block";
}

function showReviewScreen() {
  hideAll();
  reviewContainer.style.display = "block";

  if (!lastSessionAnswers || !lastSessionAnswers.length) {
    reviewText.innerHTML = "<p>No hay preguntas para repasar.</p>";
    return;
  }

  const blocks = lastSessionAnswers.map((a, idx) => {
    const optionsHtml = (a.opciones || []).map(opt => {
      const isChosen = a.elegida && opt === a.elegida;
      const isCorrect = a.correcta && opt === a.correcta;
      let style = "padding:8px;border:1px solid #b8d8ff;border-radius:10px;margin:6px 0;background:white;";
      if (isCorrect) style += "background:#e9f7ee;border-color:#9ad3b0;";
      if (isChosen && !isCorrect) style += "background:#ffe8e8;border-color:#ffb3b3;";
      return `<div style="${style}">${escapeHtml(opt)}</div>`;
    }).join("");

    return `
      <div class="card" style="margin:12px 0;text-align:left;">
        <div class="small" style="margin-bottom:6px;">${idx + 1}. ${escapeHtml(a.tema || "")}</div>
        <div style="font-weight:700;margin-bottom:8px;">${escapeHtml(a.pregunta || "")}</div>
        ${optionsHtml}
      </div>
    `;
  }).join("");

  reviewText.innerHTML = blocks;
}

function showStatsScreen() {
  hideAll();
  statsContainer.style.display = "block";

  const stats = getStats();
  const hist = asArray(lsGetJSON(LS_HISTORY, []));
  const now = new Date();
  const last10Start = new Date(now);
  last10Start.setHours(0, 0, 0, 0);
  last10Start.setDate(last10Start.getDate() - 9);
  const histLast10 = hist.filter(h => {
    const d = h?.date ? new Date(h.date) : null;
    return d && !isNaN(d) && d >= last10Start;
  });

  let totalAnswered = 0;
  let totalCorrect = 0;
  let totalWrong = 0;
  let totalNoSe = 0;
  let totalSeen = 0;
  let uniqueAnswered = 0;

  Object.values(stats).forEach(s => {
    const seen = Number(s?.seen) || 0;
    const correct = Number(s?.correct) || 0;
    const wrong = Number(s?.wrong) || 0;
    const noSe = Number(s?.noSe) || 0;
    totalSeen += seen;
    totalCorrect += correct;
    totalWrong += wrong;
    totalNoSe += noSe;
    if (correct + wrong + noSe > 0) uniqueAnswered += 1;
  });

  totalAnswered = totalCorrect + totalWrong + totalNoSe;
  const accuracy = totalAnswered ? (totalCorrect / totalAnswered) * 100 : 0;

  const totalTests = hist.length;
  const lastTest = totalTests ? hist[totalTests - 1] : null;

  const histTotals = hist.reduce(
    (acc, h) => {
      acc.tests += 1;
      acc.correct += Number(h.correct) || 0;
      acc.wrong += Number(h.wrong) || 0;
      acc.noSe += Number(h.noSe) || 0;
      acc.total += Number(h.total) || 0;
      return acc;
    },
    { tests: 0, correct: 0, wrong: 0, noSe: 0, total: 0 }
  );

  const last10Totals = histLast10.reduce(
    (acc, h) => {
      acc.tests += 1;
      acc.correct += Number(h.correct) || 0;
      acc.wrong += Number(h.wrong) || 0;
      acc.noSe += Number(h.noSe) || 0;
      acc.total += Number(h.total) || 0;
      return acc;
    },
    { tests: 0, correct: 0, wrong: 0, noSe: 0, total: 0 }
  );

  const histAnswered = histTotals.correct + histTotals.wrong + histTotals.noSe;
  const histAccuracy = histAnswered ? (histTotals.correct / histAnswered) * 100 : 0;
  const last10Answered = last10Totals.correct + last10Totals.wrong + last10Totals.noSe;
  const last10Accuracy = last10Answered ? (last10Totals.correct / last10Answered) * 100 : 0;
  const histScoreBruta = calcBruta(histTotals.correct, histTotals.wrong);
  const histScore100 = calcNotaSobre100(histTotals.correct, histTotals.wrong, histTotals.noSe);
  const last10ScoreBruta = calcBruta(last10Totals.correct, last10Totals.wrong);
  const last10Score100 = calcNotaSobre100(last10Totals.correct, last10Totals.wrong, last10Totals.noSe);

  const renderAccuracyCircle = (title, correct, wrong, noSe) => {
    const total = correct + wrong + noSe;
    const pct = total ? Math.round((correct / total) * 100) : 0;
    const wrongPct = 100 - pct;
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
        <div style="position:relative;width:140px;height:140px;border-radius:50%;background:conic-gradient(#2e8b57 0 ${pct}%, #d9534f ${pct}% 100%);display:flex;align-items:center;justify-content:center;">
          <div style="width:108px;height:108px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;box-shadow:inset 0 0 0 1px #e6e6e6;">
            <div style="font-weight:700;font-size:20px;">${pct}%</div>
            <div class="small">Aciertos</div>
          </div>
        </div>
        <div class="small">${escapeHtml(title)}</div>
        <div class="small">Fallos ${wrongPct}%</div>
      </div>
    `;
  };

  const byDay = new Map();
  hist.forEach(h => {
    const d = h?.date ? new Date(h.date) : null;
    if (!d || isNaN(d)) return;
    const dayKey = d.toISOString().slice(0, 10);
    const item = byDay.get(dayKey) || { tests: 0, correct: 0, wrong: 0, noSe: 0, total: 0 };
    item.tests += 1;
    item.correct += Number(h.correct) || 0;
    item.wrong += Number(h.wrong) || 0;
    item.noSe += Number(h.noSe) || 0;
    item.total += Number(h.total) || 0;
    byDay.set(dayKey, item);
  });

  const dayRows = Array.from(byDay.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, v]) => {
      const pct = v.total ? (v.correct / v.total) * 100 : 0;
      const dateLabel = new Date(`${day}T00:00:00`).toLocaleDateString("es-ES");
      return `
        <div class="small" style="margin:6px 0;">
          <strong>${dateLabel}:</strong> ${v.tests} tests · ${v.correct} aciertos · ${v.wrong} fallos · ${v.noSe} no lo sé · ${pct.toFixed(1)}%
        </div>
      `;
    })
    .join("");

  statsContent.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:20px;align-items:start;">
      <div class="card">
        <div style="font-weight:700;margin-bottom:8px;">Histórico total</div>
        <div><strong>Tests realizados:</strong> ${histTotals.tests}</div>
        <div><strong>Preguntas contestadas:</strong> ${histAnswered}</div>
        <div><strong>Aciertos:</strong> ${histTotals.correct}</div>
        <div><strong>Fallos:</strong> ${histTotals.wrong}</div>
        <div><strong>No lo sé:</strong> ${histTotals.noSe}</div>
        <div><strong>Porcentaje de acierto:</strong> ${histAccuracy.toFixed(1)}%</div>
        <div><strong>Puntuación total:</strong> ${histScoreBruta.toFixed(1)}</div>
        <div><strong>Nota sobre 100:</strong> ${histScore100.toFixed(2)}</div>
      </div>

      <div style="display:flex;flex-direction:column;align-items:center;gap:16px;">
        <div style="display:flex;gap:24px;align-items:center;justify-content:center;flex-wrap:wrap;">
          ${renderAccuracyCircle("Histórico total", histTotals.correct, histTotals.wrong, histTotals.noSe)}
          ${renderAccuracyCircle("Últimos 10 días", last10Totals.correct, last10Totals.wrong, last10Totals.noSe)}
        </div>
      </div>

      <div class="card">
        <div style="font-weight:700;margin-bottom:8px;">Últimos 10 días</div>
        <div><strong>Tests realizados:</strong> ${last10Totals.tests}</div>
        <div><strong>Preguntas contestadas:</strong> ${last10Answered}</div>
        <div><strong>Aciertos:</strong> ${last10Totals.correct}</div>
        <div><strong>Fallos:</strong> ${last10Totals.wrong}</div>
        <div><strong>No lo sé:</strong> ${last10Totals.noSe}</div>
        <div><strong>Porcentaje de acierto:</strong> ${last10Accuracy.toFixed(1)}%</div>
        <div><strong>Puntuación total:</strong> ${last10ScoreBruta.toFixed(1)}</div>
        <div><strong>Nota sobre 100:</strong> ${last10Score100.toFixed(2)}</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3>Historial de días</h3>
      ${dayRows || `<div class="small">No hay historial todavía.</div>`}
    </div>
  `;

  statsActions.innerHTML = `
    <button id="btn-stats-back" class="secondary">Volver</button>
    <button id="btn-reset-stats" class="secondary">Resetear estadísticas</button>
  `;

  document.getElementById("btn-stats-back").onclick = showConfigScreen;
  document.getElementById("btn-reset-stats").onclick = async () => {
    const ok = await showConfirm(
      "¿Seguro que quieres resetear estadísticas, historial y pendientes? (No borra preguntas)",
      { danger: true }
    );
    if (ok) {
      resetStatsHistory();
      showStatsScreen();
    }
  };
}

function showImportScreen() {
  hideAll();
  importContainer.style.display = "block";
}

// =======================
// TEST HEADER UI: PAUSA + TERMINAR
// =======================
function ensurePauseAndFinishUI() {
  // buscamos la primera row del test container (timer + mode pill)
  const controlsRow = document.getElementById("test-controls-row");
  if (!controlsRow) return;

  // pausa
  if (!document.getElementById("pause-btn")) {
    const pauseBtn = document.createElement("button");
    pauseBtn.id = "pause-btn";
    pauseBtn.className = "secondary";
    pauseBtn.textContent = "Pausar";
    pauseBtn.style.width = "80px";
    pauseBtn.style.margin = "0";
    pauseBtn.onclick = () => pauseTestToMenu();
    controlsRow.appendChild(pauseBtn);
  }

  // terminar
  if (!document.getElementById("finish-btn")) {
    const finishBtn = document.createElement("button");
    finishBtn.id = "finish-btn";
    finishBtn.className = "danger";
    finishBtn.textContent = "Terminar";
    finishBtn.style.width = "80px";
    finishBtn.style.margin = "0";
    finishBtn.onclick = async () => {
      const ok = await showConfirm("¿Terminar el test ahora?");
      if (ok) finishTest("manual");
    };
    controlsRow.appendChild(finishBtn);
  }
}

function updateProgressUI() {
  const textEl = document.getElementById("progress-text");
  const barEl = document.getElementById("progress-bar-fill");
  if (!textEl || !barEl) return;
  const total = currentTest.length || 0;
  const current = Math.min(currentIndex + 1, total);
  textEl.textContent = `${current}/${total}`;
  const pct = total ? (current / total) * 100 : 0;
  barEl.style.width = `${pct}%`;
}

function updateModePill() {
  const pretty = {
    practice: "Test",
    exam: "Examen",
    "exam-block": "Examen por bloque",
    review: "Repaso pendientes",
    perfection: "Perfeccionamiento",
    bank: "Banco"
  }[mode] || mode;

  modePill.textContent = `Modo: ${pretty}`;
}

// =======================
// PAUSA / CONTINUAR TEST
// =======================

function pauseTestToMenu() {
  stopTimer();
  ttsStop();

  if (!currentTest || !currentTest.length) {
    showMainMenu();
    return;
  }

  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    mode,
    sessionOpts,
    timeRemaining,
    currentIndex,
    currentTestIds: currentTest.map(q => String(q.id)),
    counts: { correctCount, wrongCount, noSeCount },
    lastSessionAnswers,
    answeredIds: Array.from(answeredIds),
    perfection: {
      queue: perfectionQueue.slice(),
      set: Array.from(perfectionSet)
    },
    view: {
      state: viewState,
      shuffledOptions: currentShuffledOptions.slice(),
      selectedText: lastSelectedText,
      correctText: lastCorrectText
    }
  };

  lsSetJSON(LS_ACTIVE_PAUSED_TEST, payload);
  showMainMenu();
}

async function resumePausedTest() {
  const saved = lsGetJSON(LS_ACTIVE_PAUSED_TEST, null);
  if (!saved) {
    await showAlert("No hay ningún test pausado.");
    showMainMenu();
    return;
  }

  const idToQ = new Map(questions.map(q => [String(q.id), q]));
  const pool = (saved.currentTestIds || [])
    .map(id => idToQ.get(String(id)))
    .filter(Boolean);

  if (!pool.length) {
    await showAlert("No se pudo reconstruir el test pausado (puede que hayas borrado preguntas).");
    localStorage.removeItem(LS_ACTIVE_PAUSED_TEST);
    showMainMenu();
    return;
  }

  mode = saved.mode || "practice";
  sessionOpts = saved.sessionOpts || {
    mode,
    timeSeconds: pool.length * 60,
    countNonAnsweredAsWrongOnFinish: false,
    meta: {}
  };

  currentTest = pool;
  currentIndex = Math.max(0, Math.min(saved.currentIndex || 0, currentTest.length));
  timeRemaining = Math.max(0, saved.timeRemaining || 0);

  correctCount = saved.counts?.correctCount || 0;
  wrongCount = saved.counts?.wrongCount || 0;
  noSeCount = saved.counts?.noSeCount || 0;

  lastSessionAnswers = Array.isArray(saved.lastSessionAnswers)
    ? saved.lastSessionAnswers
    : [];

  // 🔒 SIEMPRE strings
  answeredIds = new Set(asArray(saved.answeredIds).map(String));
  perfectionQueue = Array.isArray(saved.perfection?.queue)
    ? saved.perfection.queue.map(String)
    : [];
  perfectionSet = new Set(asArray(saved.perfection?.set).map(String));

  viewState = saved.view?.state || "question";
  currentShuffledOptions = Array.isArray(saved.view?.shuffledOptions)
    ? saved.view.shuffledOptions
    : [];
  lastSelectedText = saved.view?.selectedText ?? null;
  lastCorrectText = saved.view?.correctText ?? null;

  showTestScreen();

  if (viewState === "feedback") {
    const q = currentTest[currentIndex];
    if (!q) {
      viewState = "question";
      showQuestion();
      startTimer();
      return;
    }
    renderQuestionWithOptions(
      q,
      currentShuffledOptions.length
        ? currentShuffledOptions
        : shuffleCopy(q.opciones)
    );
    showAnswer(q, lastSelectedText);
  } else {
    showQuestion();
    startTimer();
  }
}

function clearPausedTest() {
  localStorage.removeItem(LS_ACTIVE_PAUSED_TEST);
}

// =======================
// SELECCIÓN TEMAS (agrupados por bloque)
// =======================
function groupTemasByBloque() {
  const map = new Map();
  for (const q of questions) {
    const bloque = q.bloque || "Sin bloque";
    const tema = q.tema || "Sin tema";
    const temaKey = normalizeTemaKey(tema);
    if (!map.has(bloque)) map.set(bloque, new Map());
    const temasMap = map.get(bloque);
    if (!temasMap.has(temaKey)) {
      temasMap.set(temaKey, tema);
    } else {
      const existing = temasMap.get(temaKey);
      const newClean = String(tema).trim().replace(/\s+/g, " ");
      const oldClean = String(existing).trim().replace(/\s+/g, " ");
      // Preferir versión más corta (menos espacios / texto)
      if (newClean.length < oldClean.length) temasMap.set(temaKey, tema);
    }
  }
  const bloques = Array.from(map.keys()).sort((a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" }));
  return bloques.map(b => ({
    bloque: b,
    temas: Array.from(map.get(b).values()).sort(compareTemasNatural)
  }));
}

function showTemaSelectionScreen() {
  mode = "practice";

  showTestMenuScreen();

  const stats = getStats();
  const temaCounts = new Map();
  for (const q of questions) {
    const temaKey = normalizeTemaKey(q.tema || "Sin tema");
    if (!temaCounts.has(temaKey)) temaCounts.set(temaKey, { total: 0, seen: 0 });
    const entry = temaCounts.get(temaKey);
    entry.total++;
    if ((stats[String(q.id)]?.seen || 0) > 0) entry.seen++;
  }

  const grouped = groupTemasByBloque();
  const totalQuestions = questions.length;

  testMenu.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <h2 style="margin:0;">Personaliza el test</h2>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
        <button id="btn-start-practice-top" class="success">Comenzar test</button>
        <button id="btn-perfection-toggle" class="secondary">Perfeccionamiento</button>
      </div>
    </div>
    <div class="small" style="margin-bottom:10px;"></div>

    <div style="margin:12px 0;text-align:center;">
      <div style="font-weight:700;margin-bottom:6px;">Filtrar</div>
      <div id="fuente-select-wrap" class="small"></div>
    </div>

    <div style="margin:12px 0;text-align:center;">
      <div class="row" style="justify-content:center;margin:8px 0;">
        <button id="btn-toggle-all" class="secondary">Marcar todas</button>
        <button id="btn-less-used">Solo preguntas menos usadas</button>
      </div>
    </div>

    <div id="tema-select-wrap"></div>

    <div style="margin:12px 0;text-align:center;">
      <div style="font-weight:700;margin:8px 0 6px 0;">Nº de preguntas</div>
      <div class="row" id="num-questions-buttons" style="justify-content:center;margin-bottom:6px;">
        <button class="secondary numq-btn" data-value="10">10</button>
        <button class="secondary numq-btn" data-value="20">20</button>
        <button class="secondary numq-btn" data-value="50">50</button>
        <button class="secondary numq-btn" data-value="100">100</button>
      </div>

      <div style="font-weight:700;margin:8px 0 6px 0;">Tiempo</div>
      <div class="row" id="time-mode-buttons" style="justify-content:center;margin-bottom:6px;">
        <button class="secondary time-btn" data-value="perq30">30s</button>
        <button class="secondary time-btn" data-value="perq45">45s</button>
        <button class="success time-btn" data-value="perq">1 min</button>
        <button class="secondary time-btn" data-value="perq75">1:15</button>
        <button class="secondary time-btn" data-value="perq90">1:30</button>
        <button class="secondary time-btn" data-value="perq120">2 min</button>
      </div>

      <div id="selected-count" style="margin-top:8px;text-align:center;"><strong>Preguntas seleccionadas:</strong> 0</div>
    </div>

    <div id="tema-bottom-actions" style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:12px;">
      <button id="btn-start-practice" class="success">Comenzar test</button>
      <button id="btn-back-main" class="secondary">Volver</button>
    </div>
  `;

  const wrap = document.getElementById("tema-select-wrap");
  const fuenteWrap = document.getElementById("fuente-select-wrap");

  grouped.forEach(({ bloque, temas }) => {
    const bloqueRow = document.createElement("div");
    bloqueRow.style.margin = "10px 0";
    bloqueRow.innerHTML = `
      <div style="padding:10px;border:1px solid rgba(0,0,0,0.08);border-radius:12px;background:white;">
        <label style="display:flex;align-items:center;gap:8px;font-weight:700;cursor:pointer;">
          <input type="checkbox" class="bloque-toggle" data-bloque="${escapeHtml(bloque)}">
          ${escapeHtml(bloque)}
        </label>
        <div class="temas-list" data-bloque="${escapeHtml(bloque)}" style="margin-top:8px;padding-left:22px;"></div>
      </div>
    `;
    wrap.appendChild(bloqueRow);

    const temasList = bloqueRow.querySelector(".temas-list");
    temas.forEach(t => {
      const temaKey = normalizeTemaKey(t);
      const temaDisplay = formatTemaDisplay(t);
      const counts = temaCounts.get(temaKey) || { total: 0, seen: 0 };
      const rawTema = String(t || "").trim();
      let temaNum = "";
      let temaText = "";
      const rawMatch = rawTema.match(/^(?:tema\s*)?(\d+)(?:\s*[\.\-:])?\s*(.*)$/i);
      if (rawMatch) {
        temaNum = `${rawMatch[1]}.`;
        temaText = rawMatch[2] ? rawMatch[2].trim() : "";
      }
      if (!temaText) {
        const displayMatch = temaDisplay.match(/^(\d+)\.\s*(.*)$/);
        if (displayMatch) {
          temaNum = `${displayMatch[1]}.`;
          temaText = displayMatch[2].trim();
        } else {
          temaText = temaDisplay;
        }
      }
      const line = document.createElement("label");
      line.style.display = "grid";
      line.style.gridTemplateColumns = "36px 28px 44px 1fr";
      line.style.alignItems = "start";
      line.style.columnGap = "4px";
      line.style.margin = "10px 0";
      line.style.cursor = "pointer";
      line.innerHTML = `
        <span class="small" style="color:#4b5b74;text-align:right;line-height:1.2;">${counts.seen}/${counts.total}</span>
        <input type="checkbox" class="tema-checkbox" data-bloque="${escapeHtml(bloque)}" data-tema-key="${escapeHtml(temaKey)}" value="${escapeHtml(t)}" style="margin-top:2px;width:18px;height:18px;justify-self:center;">
        <span style="display:block;line-height:1.35;text-align:left;">${escapeHtml(temaNum)}</span>
        <span style="display:block;line-height:1.35;text-align:justify;text-justify:inter-word;">${escapeHtml(temaText)}</span>
      `;
      temasList.appendChild(line);
    });
  });

  // Fuentes
  const fuentes = [...new Set(questions.map(q => q.fuente || "Sin fuente"))]
    .sort((a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" }));
  if (fuentes.length === 0) {
    fuenteWrap.innerHTML = "<em>No hay fuentes disponibles</em>";
  } else {
    fuenteWrap.className = "row";
    fuenteWrap.style.justifyContent = "center";
    fuenteWrap.style.gap = "10px";
    fuentes.forEach(f => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "success fuente-btn";
      btn.setAttribute("data-fuente", f);
      btn.textContent = f;
      btn.onclick = () => {
        btn.className = btn.className.includes("success")
          ? "fuente-btn"
          : "success fuente-btn";
        applyFuenteFilterToTemas();
        updateSelectedCount();
      };
      fuenteWrap.appendChild(btn);
    });
  }

  const lessUsedBtn = document.getElementById("btn-less-used");
  const toggleAllBtn = document.getElementById("btn-toggle-all");
  const perfectionBtn = document.getElementById("btn-perfection-toggle");
  const numButtonsWrap = document.getElementById("num-questions-buttons");
  let lessUsedActive = false;
  let perfectionActive = false;
  let numQuestionsValue = null;
  const timeButtonsWrap = document.getElementById("time-mode-buttons");
  let timeModeValue = "perq";
  const manualMinutes = document.getElementById("manual-minutes");

  if (timeButtonsWrap) {
    timeButtonsWrap.querySelectorAll(".time-btn").forEach(btn => {
      btn.onclick = () => {
        timeModeValue = btn.getAttribute("data-value") || "perq";
        timeButtonsWrap.querySelectorAll(".time-btn").forEach(b => {
          b.className = b === btn ? "success time-btn" : "secondary time-btn";
        });
        if (manualMinutes) manualMinutes.style.display = "none";
        updateSelectedCount();
      };
    });
  }

  wrap.querySelectorAll(".bloque-toggle").forEach(cb => {
    cb.addEventListener("change", () => {
      const b = cb.getAttribute("data-bloque");
      const checked = cb.checked;
      wrap.querySelectorAll(`.tema-checkbox[data-bloque="${cssEscape(b)}"]`).forEach(tcb => {
        tcb.checked = checked;
      });
      updateSelectedCount();
    });
  });

  wrap.querySelectorAll(".tema-checkbox").forEach(tcb => {
    tcb.addEventListener("change", () => {
      if (tcb.dataset.auto === "1") {
        tcb.dataset.auto = "0";
      }
      syncBloqueToggleState(tcb.getAttribute("data-bloque"));
      updateSelectedCount();
    });
  });
  fuenteWrap.querySelectorAll(".fuente-btn").forEach(() => {});

  if (lessUsedBtn) {
    lessUsedBtn.onclick = () => {
      lessUsedActive = !lessUsedActive;
      if (lessUsedActive) {
        lessUsedBtn.className = "success";
        lessUsedBtn.style.background = "";
        lessUsedBtn.style.borderColor = "";
      } else {
        lessUsedBtn.className = "";
        lessUsedBtn.style.background = "white";
        lessUsedBtn.style.borderColor = "#b8d8ff";
      }
      if (lessUsedActive) {
        markAutoTemasForLessUsed();
      } else {
        clearAutoTemaMarks();
      }
      updateSelectedCount();
    };
  }

  if (perfectionBtn) {
    perfectionBtn.onclick = () => {
      perfectionActive = !perfectionActive;
      updatePerfectionUi();
    };
  }

  if (toggleAllBtn) {
    toggleAllBtn.onclick = () => {
      const anyChecked = wrap.querySelectorAll(".tema-checkbox:checked").length > 0;
      if (!anyChecked) {
        wrap.querySelectorAll(".bloque-toggle").forEach(cb => {
          cb.checked = true;
          cb.indeterminate = false;
        });
        wrap.querySelectorAll(".tema-checkbox").forEach(cb => (cb.checked = true));
        toggleAllBtn.textContent = "Desmarcar todas";
      } else {
        wrap.querySelectorAll(".bloque-toggle").forEach(cb => {
          cb.checked = false;
          cb.indeterminate = false;
        });
        wrap.querySelectorAll(".tema-checkbox").forEach(cb => (cb.checked = false));
        toggleAllBtn.textContent = "Marcar todas";
      }
      updateSelectedCount();
    };
  }

  if (numButtonsWrap) {
    numButtonsWrap.querySelectorAll(".numq-btn").forEach(btn => {
      btn.onclick = () => {
        const isActive = btn.className.includes("success");
        if (isActive) {
          numQuestionsValue = null;
          btn.className = "secondary numq-btn";
        } else {
          numQuestionsValue = parseInt(btn.getAttribute("data-value") || "0", 10);
          numButtonsWrap.querySelectorAll(".numq-btn").forEach(b => {
            b.className = b === btn ? "success numq-btn" : "secondary numq-btn";
          });
        }
        updateSelectedCount();
      };
    });
  }
  const clearAllSelections = () => {
    lessUsedActive = false;
    perfectionActive = false;
    if (lessUsedBtn) lessUsedBtn.className = "";
    updatePerfectionUi();
    if (toggleAllBtn) toggleAllBtn.textContent = "Marcar todas";
    wrap.querySelectorAll("input").forEach(i => (i.disabled = false));
    wrap.querySelectorAll(".bloque-toggle").forEach(cb => {
      cb.checked = false;
      cb.indeterminate = false;
    });
    wrap.querySelectorAll(".tema-checkbox").forEach(cb => (cb.checked = false));
    wrap.querySelectorAll(".tema-checkbox").forEach(cb => (cb.dataset.auto = "0"));
    fuenteWrap.querySelectorAll(".fuente-btn").forEach(btn => {
      btn.className = "success fuente-btn";
    });
    if (numButtonsWrap) {
      numQuestionsValue = 10;
      numButtonsWrap.querySelectorAll(".numq-btn").forEach(b => {
        b.className = b.getAttribute("data-value") === "10" ? "success numq-btn" : "secondary numq-btn";
      });
    }
    applyFuenteFilterToTemas();
    updateSelectedCount();
  };

  document.getElementById("btn-back-main").onclick = showMainMenu;

  document.getElementById("btn-start-practice").onclick = () => {
    const config = buildSelectionConfigFromUI();
    startTestWithConfig(config);
  };
  document.getElementById("btn-start-practice-top").onclick = () => {
    const config = buildSelectionConfigFromUI();
    startTestWithConfig(config);
  };

  updateSelectedCount();
  applyFuenteFilterToTemas();

  function syncBloqueToggleState(bloque) {
    const bloqueCb = wrap.querySelector(`.bloque-toggle[data-bloque="${cssEscape(bloque)}"]`);
    const temasCbs = Array.from(wrap.querySelectorAll(`.tema-checkbox[data-bloque="${cssEscape(bloque)}"]`));
    const checkedCount = temasCbs.filter(x => x.checked).length;
    if (checkedCount === 0) {
      bloqueCb.checked = false;
      bloqueCb.indeterminate = false;
    } else if (checkedCount === temasCbs.length) {
      bloqueCb.checked = true;
      bloqueCb.indeterminate = false;
    } else {
      bloqueCb.checked = false;
      bloqueCb.indeterminate = true;
    }
  }

  function buildSelectionConfigFromUI() {
    const temasChecked = Array.from(wrap.querySelectorAll(".tema-checkbox:checked"))
      .filter(cb => cb.dataset.auto !== "1")
      .map(cb => cb.getAttribute("data-tema-key"))
      .filter(Boolean);
    const fuentesChecked = Array.from(fuenteWrap.querySelectorAll(".fuente-btn.success"))
      .map(btn => btn.getAttribute("data-fuente"));

    return {
      mode: perfectionActive ? "perfection" : "practice",
      allQuestions: false,
      lessUsed: lessUsedActive,
      temas: temasChecked,
      fuentes: fuentesChecked,
      fuentesActiveCount: fuentesChecked.length,
      numQuestions: numQuestionsValue,
      timeMode: timeModeValue,
      manualMinutes: 15
    };
  }

  function updateSelectedCount() {
    const config = buildSelectionConfigFromUI();
    const pool = buildPoolFromConfig(config);
    document.getElementById("selected-count").innerHTML =
      `<strong>Preguntas seleccionadas:</strong> ${pool.length} / ${totalQuestions}`;
  }

  function applyFuenteFilterToTemas() {
    const fuentesChecked = Array.from(fuenteWrap.querySelectorAll(".fuente-btn.success"))
      .map(btn => btn.getAttribute("data-fuente"));
    const fuenteSet = new Set(fuentesChecked);

    wrap.querySelectorAll(".tema-checkbox").forEach(cb => {
      const temaKey = cb.getAttribute("data-tema-key");
      const label = cb.closest("label");
      if (!label) return;
      if (fuenteSet.size === 0) {
        label.style.display = "none";
        return;
      }
      const hasMatch = questions.some(q =>
        normalizeTemaKey(q.tema) === temaKey && fuenteSet.has(q.fuente || "Sin fuente")
      );
      label.style.display = hasMatch ? "grid" : "none";
    });
  }

  function getActiveFuenteSet() {
    const fuentesChecked = Array.from(fuenteWrap.querySelectorAll(".fuente-btn.success"))
      .map(btn => btn.getAttribute("data-fuente"));
    return new Set(fuentesChecked);
  }

  function markAutoTemasForLessUsed() {
    clearAutoTemaMarks();
    const fuenteSet = getActiveFuenteSet();
    const candidates = questions.filter(q => fuenteSet.has(q.fuente || "Sin fuente"));
    const neverSeen = candidates.filter(q => getSeenCount(q.id) === 0);

    let selected = [];
    if (neverSeen.length > 0) {
      selected = neverSeen;
    } else {
      const sorted = candidates.slice().sort((a, b) => getSeenCount(a.id) - getSeenCount(b.id));
      const takeCount = Math.max(1, Math.ceil(sorted.length * 0.2));
      selected = sorted.slice(0, takeCount);
    }

    const temaKeys = new Set(selected.map(q => normalizeTemaKey(q.tema)));
    wrap.querySelectorAll(".tema-checkbox").forEach(cb => {
      const temaKey = cb.getAttribute("data-tema-key");
      if (temaKeys.has(temaKey)) {
        cb.checked = true;
        cb.dataset.auto = "1";
      }
    });
  }

  function clearAutoTemaMarks() {
    wrap.querySelectorAll(".tema-checkbox").forEach(cb => {
      if (cb.dataset.auto === "1") {
        cb.checked = false;
        cb.dataset.auto = "0";
      }
    });
  }

  function updatePerfectionUi() {
    if (!perfectionBtn) return;
    if (perfectionActive) {
      perfectionBtn.className = "success";
    } else {
      perfectionBtn.className = "secondary";
    }
    const label = perfectionActive ? "Iniciar perfeccionamiento" : "Comenzar test";
    const topBtn = document.getElementById("btn-start-practice-top");
    const bottomBtn = document.getElementById("btn-start-practice");
    if (topBtn) topBtn.textContent = label;
    if (bottomBtn) bottomBtn.textContent = label;
  }
}

function buildPoolFromConfig(config) {
  let pool = [];

  if (config.allQuestions) {
    pool = [...questions];
  } else {
    if (!config.temas || config.temas.length === 0) {
      pool = config.lessUsed ? [...questions] : [];
    } else {
      const temaSet = new Set(config.temas);
      pool = questions.filter(q => temaSet.has(normalizeTemaKey(q.tema)));
    }
  }

  if (config.fuentesActiveCount === 0) {
    pool = [];
  } else if (config.fuentes && config.fuentes.length > 0) {
    const fuenteSet = new Set(config.fuentes);
    pool = pool.filter(q => fuenteSet.has(q.fuente || "Sin fuente"));
  }

  if (config.lessUsed) {
    const baseSet = new Set(pool.map(q => String(q.id)));
    const neverSeen = questions.filter(q => getSeenCount(q.id) === 0);

    if (neverSeen.length > 0) {
      for (const q of neverSeen) {
        if (!baseSet.has(String(q.id))) {
          pool.push(q);
          baseSet.add(String(q.id));
        }
      }
      const seenList = pool.map(q => getSeenCount(q.id)).sort((a, b) => a - b);
      const median = seenList.length ? seenList[Math.floor(seenList.length / 2)] : 0;
      pool = pool.filter(q => getSeenCount(q.id) <= median || getSeenCount(q.id) === 0);
    } else {
      const sorted = pool.slice().sort((a, b) => getSeenCount(a.id) - getSeenCount(b.id));
      const takeCount = Math.max(1, Math.ceil(sorted.length * 0.2));
      pool = sorted.slice(0, takeCount);
    }
  }

  if (typeof config.numQuestions === "number" && config.numQuestions > 0) {
    shuffleArray(pool);
    pool = pool.slice(0, config.numQuestions);
  } else {
    shuffleArray(pool);
  }

  return pool;
}

// =======================
// MODO EXAMEN POR FUENTES (MODAL)
// =======================
let selectedExamSources = new Set();

function openExamSourceModal() {
  if (!examSourceModal || !examSourceButtons) return;

  selectedExamSources = new Set();
  examSourceButtons.innerHTML = "";

  const fuentes = [...new Set((questions || []).map(q => q.fuente || "Sin fuente"))]
    .sort((a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" }));

  fuentes.forEach(fuente => {
    const btn = document.createElement("button");
    btn.textContent = fuente;
    btn.className = "secondary fuente-btn";
    btn.onclick = () => {
      const key = String(fuente);
      if (selectedExamSources.has(key)) {
        selectedExamSources.delete(key);
        btn.className = "secondary fuente-btn";
      } else {
        selectedExamSources.add(key);
        btn.className = "secondary";
      }
    };
    examSourceButtons.appendChild(btn);
  });

  examSourceModal.style.display = "flex";
}

function closeExamSourceModal() {
  if (!examSourceModal) return;
  examSourceModal.style.display = "none";
}

function startExamFromSources() {
  if (!selectedExamSources.size) {
    showAlert("Selecciona al menos una fuente.");
    return;
  }

  const poolAll = (questions || []).filter(q =>
    selectedExamSources.has(String(q.fuente || "Sin fuente"))
  );

  if (poolAll.length < 100) {
    showAlert("No hay suficientes preguntas para un examen de 100.");
    return;
  }

  shuffleArray(poolAll);
  const pool = poolAll.slice(0, 100);

  mode = "exam";
  closeExamSourceModal();

  startSession(pool, {
    mode: "exam",
    timeSeconds: 100 * 60,
    countNonAnsweredAsWrongOnFinish: true,
    meta: { fuentes: Array.from(selectedExamSources) }
  });
}

// =======================
// MENÚ EXAMEN
// =======================
function showExamMenu() {
  showTestMenuScreen();

  testMenu.innerHTML = `
    <h2>Modo examen</h2>
    <button id="btn-exam-full">Examen completo (100 preguntas / 100 min)</button>
    <button id="btn-exam-by-block">Examen por bloque (25 preguntas / 25 min)</button>
    <button id="btn-back-main" class="secondary">Volver</button>
  `;

  document.getElementById("btn-back-main").onclick = showMainMenu;
  document.getElementById("btn-exam-full").onclick = () => startExamFull();
  document.getElementById("btn-exam-by-block").onclick = () => showExamByBlockSelect();
}

function startExamFull() {
  mode = "exam";

  // Agrupar por bloque y contar
  const byBloque = new Map();
  for (const q of questions) {
    const b = q.bloque || "Sin bloque";
    if (!byBloque.has(b)) byBloque.set(b, []);
    byBloque.get(b).push(q);
  }

  const bloques = Array.from(byBloque.entries()); // [ [bloque, qs], ... ]
  const perBlock = 25;
  let pool = [];

  // Si hay 4+ bloques, elegimos los 4 con MÁS preguntas (no por orden alfabético)
  if (bloques.length >= 4) {
    const top4 = bloques
      .sort((a, b) => b[1].length - a[1].length) // desc por tamaño
      .slice(0, 4);

    for (const [bloque, qs] of top4) {
      const copy = qs.slice();
      shuffleArray(copy);
      pool.push(...copy.slice(0, perBlock));
    }
  } else {
    // Si hay menos de 4 bloques, tiramos de todo
    pool = [...questions];
    shuffleArray(pool);
    pool = pool.slice(0, 100);
  }

  // Rellenar hasta 100 con preguntas fuera de las ya usadas
  if (pool.length < 100) {
    const ids = new Set(pool.map(q => String(q.id)));
    const rest = questions.filter(q => !ids.has(String(q.id)));
    shuffleArray(rest);
    pool.push(...rest.slice(0, 100 - pool.length));
  }

  // Asegurar tamaño exacto
  if (pool.length > 100) pool = pool.slice(0, 100);

  startSession(pool, {
    mode: "exam",
    timeSeconds: 100 * 60,
    countNonAnsweredAsWrongOnFinish: true,
    meta: {}
  });
}

function showExamByBlockSelect() {
  showTestMenuScreen();

  const bloques = [...new Set(questions.map(q => q.bloque || "Sin bloque"))]
    .sort((a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" }));

  testMenu.innerHTML = `
    <h2>Examen por bloque (25 preguntas / 25 min)</h2>
    <div id="block-list"></div>
    <button id="btn-back" class="secondary">Volver</button>
  `;

  const list = document.getElementById("block-list");
  bloques.forEach(b => {
    const btn = document.createElement("button");
    btn.textContent = b;
    btn.onclick = () => {
      const qs = questions.filter(q => (q.bloque || "Sin bloque") === b);
      shuffleArray(qs);
      const pool = qs.slice(0, 25);
      startSession(pool, {
        mode: "exam-block",
        timeSeconds: 25 * 60,
        countNonAnsweredAsWrongOnFinish: true,
        meta: { bloque: b }
      });
    };
    list.appendChild(btn);
  });

  document.getElementById("btn-back").onclick = showExamMenu;
}

// =======================
// REPASO PENDIENTES (solo pendientes reales)
// =======================
function startReviewPending() {
  prunePendingGhostIds();

  const existing = getExistingIdSet();   // strings
  const pending = getPendingReviewSet(); // strings
  const done = getPendingDoneSet();      // strings

  const ids = Array.from(pending).filter(id =>
    existing.has(String(id)) && !done.has(String(id))
  );

  const idSet = new Set(ids.map(String));
  const pool = (questions || []).filter(q => idSet.has(String(q.id)));

  if (pool.length === 0) {
    showAlert("No tienes preguntas pendientes de repaso");
    return;
  }

  mode = "review";
  shuffleArray(pool);

  startSession(pool, {
    mode: "review",
    timeSeconds: pool.length * 60,
    countNonAnsweredAsWrongOnFinish: false,
    meta: {}
  });
}

// =======================
// INICIO SESIÓN
// =======================
function startTestWithConfig(config) {
  const pool = buildPoolFromConfig(config);
  if (!pool.length) {
    showAlert("No has seleccionado ninguna pregunta. Selecciona al menos un tema o usa 'Todas las preguntas'.");
    return;
  }

  const total = pool.length;
  const perQuestionSeconds = (() => {
    switch (config.timeMode) {
      case "perq30": return 30;
      case "perq45": return 45;
      case "perq75": return 75;
      case "perq90": return 90;
      case "perq120": return 120;
      case "perq":
      default: return 60;
    }
  })();
  const timeSeconds = config.timeMode === "manual"
    ? config.manualMinutes * 60
    : total * perQuestionSeconds;

  if (config.mode === "perfection") {
    mode = "perfection";
    perfectionQueue = [];
    perfectionSet = new Set();
  } else {
    mode = "practice";
  }

  startSession(pool, {
    mode: config.mode,
    timeSeconds,
    countNonAnsweredAsWrongOnFinish: config.numQuestions > 0 ? true : false,
    meta: {}
  });
}

function startQuickTest(numQuestions, minutes) {
  if (!questions || questions.length === 0) {
    showAlert("No hay preguntas cargadas.");
    return;
  }

  const pool = questions.slice();
  shuffleArray(pool);
  const selected = pool.slice(0, Math.min(numQuestions, pool.length));

  mode = "practice";
  startSession(selected, {
    mode: "practice",
    timeSeconds: minutes * 60,
    countNonAnsweredAsWrongOnFinish: true,
    meta: { quick: true, count: numQuestions, minutes }
  });
}

function startSession(pool, opts) {
  // si empezamos sesión nueva, borramos pausado
  clearPausedTest();

  currentTest = [...pool];
  currentIndex = 0;

  correctCount = 0;
  wrongCount = 0;
  noSeCount = 0;

  lastSessionAnswers = [];
  answeredIds = new Set();

  const baseTestIds = currentTest.map(q => String(q.id));
  sessionOpts = {
    mode: opts.mode || mode,
    timeSeconds: Math.max(0, opts.timeSeconds || (currentTest.length * 60)),
    countNonAnsweredAsWrongOnFinish: !!opts.countNonAnsweredAsWrongOnFinish,
    meta: { ...(opts.meta || {}), baseTestIds }
  };

  timeRemaining = sessionOpts.timeSeconds;

  viewState = "question";
  currentShuffledOptions = [];
  lastSelectedText = null;
  lastCorrectText = null;

  showTestScreen();
  showQuestion();
  startTimer();
}

// =======================
// TEST RENDER + LÓGICA
// =======================
function renderQuestionWithOptions(q, opcionesOrdenadas) {
  questionText.textContent = `${currentIndex + 1}. ${q.pregunta}`;
  answersContainer.innerHTML = "";

  noSeBtn.style.display = "inline-block";
  noSeBtn.disabled = false;

  continueBtn.style.display = "none";

  currentShuffledOptions = opcionesOrdenadas.slice();

  const letters = ["A", "B", "C", "D"];
  opcionesOrdenadas.forEach((opt, idx) => {
    const btn = document.createElement("button");
    const letter = letters[idx] || String(idx + 1);
    btn.innerHTML = `
      <span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid #b8d8ff;border-radius:6px;margin-right:8px;font-weight:700;">${letter}</span>
      <span style="text-align:left;flex:1;">${escapeHtml(opt)}</span>
    `;
    btn.className = "answer-btn";
    btn.dataset.optionText = opt;
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.onclick = () => checkAnswer(opt, q);
    answersContainer.appendChild(btn);
  });

  updateProgressUI();
  ttsMaybeAutoRead(q);
}

function showQuestion() {
  if (currentIndex >= currentTest.length) {
    if (mode === "perfection" && perfectionQueue.length > 0) {
      // ✅ ids en perfeccionamiento son strings
      const pendingQs = perfectionQueue
        .map(id => questions.find(q => String(q.id) === String(id)))
        .filter(Boolean);

      perfectionQueue = [];
      perfectionSet = new Set();
      shuffleArray(pendingQs);
      currentTest.push(...pendingQs);
    } else {
      finishTest("completed");
      return;
    }
  }

  const q = currentTest[currentIndex];
  bumpStat(q.id, "seen");

  viewState = "question";
  lastSelectedText = null;
  lastCorrectText = null;

  renderQuestionWithOptions(q, shuffleCopy(q.opciones));
}

function checkAnswer(selectedText, q) {
  ttsUserInteracted = true;
  const correctText = q.opciones[q.respuesta_correcta];
  const isCorrect = selectedText === correctText;

  // ✅ answeredIds siempre strings
  answeredIds.add(String(q.id));

  if (isCorrect) {
    correctCount++;
    bumpStat(q.id, "correct");

    if (mode === "review") markReviewedDone(q.id);

    if (mode === "perfection") {
      const idStr = String(q.id);
      perfectionSet.delete(idStr);
      perfectionQueue = perfectionQueue.filter(id => String(id) !== idStr);
    }
  } else {
    wrongCount++;
    bumpStat(q.id, "wrong");

    // ✅ fallos siempre a pendientes (incluido examen)
    markPending(q.id);

    if (mode === "perfection") {
      const idStr = String(q.id);
      if (!perfectionSet.has(idStr)) {
        perfectionSet.add(idStr);
        perfectionQueue.push(idStr);
      }
    }
  }

  lastSessionAnswers.push(
    buildAnswerRecord(q, selectedText, correctText, isCorrect ? "ACIERTO" : "FALLO")
  );
  showAnswer(q, selectedText);
}

function onNoSe() {
  ttsUserInteracted = true;
  const q = currentTest[currentIndex];

  // ✅ answeredIds siempre strings
  answeredIds.add(String(q.id));

  noSeCount++;
  bumpStat(q.id, "noSe");

  // ✅ no lo sé => pendientes
  markPending(q.id);

  const correctText = q.opciones[q.respuesta_correcta];
  lastSessionAnswers.push(buildAnswerRecord(q, null, correctText, "NOSE"));

  if (mode === "perfection") {
    const idStr = String(q.id);
    if (!perfectionSet.has(idStr)) {
      perfectionSet.add(idStr);
      perfectionQueue.push(idStr);
    }
  }

  showAnswer(q, null);
}

function showAnswer(q, selectedTextOrNull) {
  stopTimer();
  ttsStop();

  viewState = "feedback";
  lastSelectedText = selectedTextOrNull;
  lastCorrectText = q.opciones[q.respuesta_correcta];

  noSeBtn.style.display = "none";
  noSeBtn.disabled = true;

  const correctText = q.opciones[q.respuesta_correcta];
  const buttons = answersContainer.querySelectorAll(".answer-btn");

  buttons.forEach(btn => {
    const t = (btn.dataset.optionText || "").toString();
    if (t === correctText) btn.style.backgroundColor = "lightgreen";
    else if (selectedTextOrNull !== null && t === selectedTextOrNull) btn.style.backgroundColor = "salmon";
    btn.disabled = false;
    btn.style.cursor = "pointer";
  });

  const exp = document.createElement("p");
  exp.style.marginTop = "10px";
  exp.style.opacity = "0.95";
  exp.textContent = q.explicacion || "";
  answersContainer.appendChild(exp);

  continueBtn.style.display = "inline-block";
  continueBtn.onclick = () => {
    ttsUserInteracted = true;
    if (answersContainer.contains(exp)) answersContainer.removeChild(exp);
    buttons.forEach(btn => (btn.style.backgroundColor = ""));
    buttons.forEach(btn => {
      btn.onclick = null;
      btn.style.cursor = "";
    });

    currentIndex++;
    viewState = "question";
    showQuestion();
    startTimer();
  };

  buttons.forEach(btn => {
    btn.onclick = () => continueBtn.click();
  });
}

function buildAnswerRecord(q, selectedText, correctText, result) {
  return {
    id: q.id,
    tema: q.tema || "",
    bloque: q.bloque || "",
    fuente: q.fuente || "",
    modelo: q.modelo || "",
    pregunta: q.pregunta || "",
    opciones: Array.isArray(q.opciones) ? q.opciones.slice() : [],
    correcta: correctText || "",
    elegida: selectedText ?? "",
    resultado: result,
    explicacion: q.explicacion || ""
  };
}

// =======================
// TIMER
// =======================
function startTimer() {
  stopTimer();
  timerDisplay.textContent = formatTime(timeRemaining);

  timer = setInterval(() => {
    timeRemaining--;
    if (timeRemaining < 0) timeRemaining = 0;
    timerDisplay.textContent = formatTime(timeRemaining);

    if (timeRemaining <= 0) {
      stopTimer();
      finishTest("time");
    }
  }, 1000);
}
function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

// =======================
// FINALIZAR (fix: no contestadas -> pendientes si aplica)
// =======================
function finalizeUnansweredAsPendingIfNeeded() {
  if (!sessionOpts?.countNonAnsweredAsWrongOnFinish) return;

  for (const q of currentTest) {
    const idStr = String(q.id);
    if (!answeredIds.has(idStr)) {
      markPending(idStr);
    }
  }
}

function finishTest(reason = "manual") {
  stopTimer();
  ttsStop();
  finalizeUnansweredAsPendingIfNeeded();

  const nTotal = correctCount + wrongCount + noSeCount;
  const scoreBruta = calcBruta(correctCount, wrongCount);
  const score100 = calcNotaSobre100(correctCount, wrongCount, noSeCount);

  addHistoryEntry({
    date: new Date().toISOString(),
    mode,
    total: currentTest.length,
    correct: correctCount,
    wrong: wrongCount,
    noSe: noSeCount,
    scoreBruta,
    score100,
    reason
  });

  clearPausedTest();
  showResultsScreen();

  resultsText.innerHTML = `
    <p><strong>Aciertos:</strong> ${correctCount}</p>
    <p><strong>Fallos:</strong> ${wrongCount}</p>
    <p><strong>No lo sé:</strong> ${noSeCount}</p>
    <p><strong>Puntuación bruta:</strong> ${scoreBruta.toFixed(1)}</p>
    <p><strong>Nota sobre 100:</strong> ${score100.toFixed(2)}</p>
    <p><strong>Total preguntas:</strong> ${nTotal}</p>

    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:12px;">
      <button id="btn-copy-test-text">Copiar test en portapapeles</button>
      <button id="btn-repeat-test">Repetir test</button>
      <button id="btn-review-test">Repasar test</button>
    </div>
  `;

  document.getElementById("btn-copy-test-text").onclick = () => exportLastTestText("copy");
  document.getElementById("btn-repeat-test").onclick = () => repeatLastTest();
  document.getElementById("btn-review-test").onclick = () => showReviewScreen();

  backToMenuBtnResults.onclick = showMainMenu;
  if (backToResultsBtn) backToResultsBtn.onclick = showResultsScreen;
}

function buildPoolFromIds(ids) {
  const idToQ = new Map(questions.map(q => [String(q.id), q]));
  return asArray(ids)
    .map(id => idToQ.get(String(id)))
    .filter(Boolean);
}

function repeatLastTest() {
  const repeatMode = sessionOpts?.mode || mode || "practice";
  const baseIds = sessionOpts?.meta?.baseTestIds;
  let pool = [];

  if (!baseIds || !baseIds.length) {
    showAlert("No se pudo repetir el test porque no se encontro el pool original de esta sesion.");
    return;
  }

  pool = buildPoolFromIds(baseIds);
  if (pool.length !== baseIds.length) {
    showAlert("No se pudo repetir el test porque faltan preguntas del pool original.");
    return;
  }

  mode = repeatMode;
  if (repeatMode === "perfection") {
    perfectionQueue = [];
    perfectionSet = new Set();
  }

  startSession(pool, {
    mode: repeatMode,
    timeSeconds: sessionOpts?.timeSeconds || (pool.length * 60),
    countNonAnsweredAsWrongOnFinish: !!sessionOpts?.countNonAnsweredAsWrongOnFinish,
    meta: { ...(sessionOpts?.meta || {}) }
  });
}

// =======================
// EXPORT TEXTO ÚLTIMO TEST
// =======================
function buildLastTestText() {
  const lines = [];
  lines.push(`RESULTADOS: Aciertos ${correctCount} | Fallos ${wrongCount} | No lo sé ${noSeCount}`);
  lines.push(`MODO: ${mode}`);
  lines.push(`---`);

  lastSessionAnswers.forEach((a, idx) => {
    lines.push(`Q${idx + 1} (id ${a.id}) [${a.bloque}] ${a.tema}`);
    lines.push(a.pregunta);
    lines.push(`A) ${a.opciones[0] ?? ""}`);
    lines.push(`B) ${a.opciones[1] ?? ""}`);
    lines.push(`C) ${a.opciones[2] ?? ""}`);
    lines.push(`D) ${a.opciones[3] ?? ""}`);
    lines.push(`ELEGIDA: ${a.elegida || "(no lo sé)"}`);
    lines.push(`CORRECTA: ${a.correcta}`);
    lines.push(`RESULTADO: ${a.resultado}`);
    if (a.explicacion) lines.push(`EXPLICACIÓN: ${a.explicacion}`);
    lines.push(`---`);
  });

  return lines.join("\n");
}

function exportLastTestText(modeExport) {
  const text = buildLastTestText();

  if (modeExport === "copy") {
    navigator.clipboard.writeText(text)
      .then(() => showAlert("Texto copiado al portapapeles."))
      .catch(() => showAlert("No se pudo copiar automáticamente."));
    return;
  }

  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ultimo_test_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =======================
// EXPORT JSON (base + añadidas - eliminadas)
// =======================
function exportQuestionsJSON() {
  mergeQuestions();
  applyDeletedFilter();

  const payload = JSON.stringify(questions, null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `questions_export_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =======================
// IMPORTACIÓN (desde import-container)
// =======================
function normalizeCorrectaToIndex(letter) {
  const L = String(letter || "").trim().toUpperCase();
  const map = { A: 0, B: 1, C: 2, D: 3 };
  return map[L];
}

// Devuelve el siguiente ID como NÚMERO (contador interno seguro)
// ✅ NO reutiliza IDs borradas (papelera) y evita colisiones al restaurar
function nextIdNumber() {
  const nums = [];

  // Base
  if (Array.isArray(questionsBase)) {
    for (const q of questionsBase) {
      const n = parseInt(String(q?.id), 10);
      if (Number.isInteger(n)) nums.push(n);
    }
  }

  // Extra
  const extra = loadExtraQuestions();
  for (const q of extra) {
    const n = parseInt(String(q?.id), 10);
    if (Number.isInteger(n)) nums.push(n);
  }

  // Deleted IDs (papelera)
  const deleted = lsGetJSON(LS_DELETED_IDS, []);
  for (const id of asArray(deleted)) {
    const n = parseInt(String(id), 10);
    if (Number.isInteger(n)) nums.push(n);
  }

  // Purged IDs (borrado definitivo)
  const purged = lsGetJSON(LS_PURGED_IDS, []);
  for (const id of asArray(purged)) {
    const n = parseInt(String(id), 10);
    if (Number.isInteger(n)) nums.push(n);
  }

  const maxId = nums.length ? Math.max(...nums) : 0;
  return maxId + 1;
}

// Parser del formato por bloques con '---'
function parseImportBlocks(raw) {
  const blocks = String(raw || "")
    .split("\n---")
    .map(b => b.replace(/^\s*---\s*/g, "").trim())
    .filter(Boolean);

  const parsed = [];
  const errors = [];

  blocks.forEach((blockText, idx) => {
    const lines = blockText.split("\n").map(l => l.trim()).filter(Boolean);

    const obj = {};
    let currentKey = null;

    function setKeyVal(key, val) {
      const k = key.toLowerCase();
      obj[k] = val;
    }

    lines.forEach(line => {
      // claves tipo "tema: ..."
      const m = line.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s*:\s*(.*)$/);
      if (m) {
        currentKey = m[1].trim();
        setKeyVal(currentKey, m[2].trim());
        return;
      }
      // opciones "A) ..."
      const o = line.match(/^([ABCD])\)\s*(.*)$/i);
      if (o) {
        obj[o[1].toLowerCase()] = o[2].trim();
        currentKey = null;
        return;
      }
      // si estamos en una clave multilinea
      if (currentKey) {
        const k = currentKey.toLowerCase();
        obj[k] = (obj[k] ? obj[k] + "\n" : "") + line;
      }
    });

    const required = ["tema", "bloque", "fuente", "pregunta", "a", "b", "c", "d", "correcta", "explicacion"];
    const missing = required.filter(k => !obj[k] || String(obj[k]).trim() === "");
    if (missing.length) {
      errors.push(`Bloque #${idx + 1}: faltan ${missing.join(", ")}`);
      return;
    }

    const corrIdx = normalizeCorrectaToIndex(obj.correcta);
    if (corrIdx === undefined) {
      errors.push(`Bloque #${idx + 1}: "correcta" inválida (usa A/B/C/D)`);
      return;
    }

    parsed.push({
      tema: obj.tema.trim(),
      bloque: obj.bloque.trim(),
      fuente: obj.fuente.trim(),
      pregunta: obj.pregunta.trim(),
      opciones: [obj.a, obj.b, obj.c, obj.d],
      respuesta_correcta: corrIdx,
      explicacion: obj.explicacion.trim()
    });
  });

  return { parsed, errors };
}

function importQuestionsFromTextarea() {
  importStatus.innerHTML = "";
  const raw = importTextarea.value || "";

  const { parsed, errors } = parseImportBlocks(raw);
  if (errors.length) {
    importStatus.innerHTML =
      `<div class="small" style="color:#b00020;">No se pudo parsear:\n` +
      `${errors.map(e => `<div>${escapeHtml(e)}</div>`).join("")}</div>`;
    return;
  }

  if (!parsed.length) {
    importStatus.innerHTML = `<div class="small" style="color:#b00020;">No se encontró ninguna pregunta.</div>`;
    return;
  }

  // Asegura estado actualizado
  mergeQuestions();
  applyDeletedFilter();

  // ✅ IDs existentes desde el banco actual (strings)
  const existingIds = new Set((questions || []).map(q => String(q?.id)).filter(Boolean));

  // contador interno numérico (no reutiliza borradas)
  let nextNum = nextIdNumber();

  // añadimos en extra
  const extra = loadExtraQuestions();
  let added = 0;

  parsed.forEach(q => {
    // busca el siguiente id libre
    while (existingIds.has(String(nextNum))) nextNum++;

    const idStr = String(nextNum);
    nextNum++;
    existingIds.add(idStr);

    const withId = { ...q, id: idStr }; // 🔒 SIEMPRE string
    extra.push(withId);
    added++;
  });

  saveExtraQuestions(extra);

  mergeQuestions();
  applyDeletedFilter();
  refreshDbCountPill();

  importStatus.innerHTML = `<div class="small" style="color:#006b2d;">✅ Importadas ${added} preguntas.</div>`;

  // ✅ limpiar textarea tras importar
  importTextarea.value = "";
}

function clearImportTextarea() {
  importTextarea.value = "";
  importStatus.innerHTML = "";
}

async function clearAddedQuestions() {
  const ok = await showConfirm("¿Seguro que quieres borrar TODAS las preguntas añadidas desde la app?", { danger: true });
  if (!ok) return;

  localStorage.removeItem(LS_EXTRA_QUESTIONS);
  // Nota: no tocamos deletedIds ni estadísticas

  mergeQuestions();
  applyDeletedFilter();
  refreshDbCountPill();

  importStatus.innerHTML = `<div class="small" style="color:#006b2d;">✅ Preguntas añadidas vaciadas.</div>`;
}

// =======================
// BANCO DE PREGUNTAS (buscar / filtrar / editar / eliminar)
// =======================
function showQuestionBank() {
  mode = "bank";
  showTestMenuScreen();

  const bloques = [...new Set(questions.map(q => q.bloque || "Sin bloque"))]
    .sort((a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" }));

  const fuentes = [...new Set(questions.map(q => q.fuente || "Sin fuente"))]
    .sort((a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" }));

  testMenu.innerHTML = `
    <h2>Banco de preguntas</h2>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0;">
      <input id="bank-search" type="text" placeholder="Buscar texto..." style="flex:1;max-width:520px;padding:8px;border-radius:10px;border:1px solid #b8d8ff;">
      <button id="bank-back" class="secondary">Volver</button>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;">
      <label>Bloque:
        <select id="bank-filter-bloque">
          <option value="">(Todos)</option>
          ${bloques.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("")}
        </select>
      </label>

      <label>Fuente:
        <select id="bank-filter-fuente">
          <option value="">(Todas)</option>
          ${fuentes.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("")}
        </select>
      </label>

    </div>

    <div class="row" style="margin:10px 0;justify-content:center;width:100%;">
      <button id="bank-refresh" class="secondary" style="flex:1;min-width:160px;">Buscar</button>
      <button id="bank-import-questions" class="secondary" style="flex:1;min-width:160px;">Importar preguntas</button>
      <button id="bank-export-json" class="secondary" style="flex:1;min-width:200px;">Exportar preguntas (JSON)</button>
      <button id="bank-trash" class="secondary" style="flex:1;min-width:140px;">Papelera</button>
    </div>

    <div id="bank-results" style="margin-top:12px;"></div>
  `;

  document.getElementById("bank-back").onclick = showConfigScreen;
  document.getElementById("bank-export-json").onclick = exportQuestionsJSON;
  document.getElementById("bank-import-questions").onclick = () => {
    clearImportTextarea();
    showImportScreen();
  };
  document.getElementById("bank-trash").onclick = () => showTrashScreen();

  const runSearch = () => {
    const term = (document.getElementById("bank-search").value || "").trim().toLowerCase();
    const fb = document.getElementById("bank-filter-bloque").value;
    const ff = document.getElementById("bank-filter-fuente").value;
    const fm = "";

    let res = [...questions];

    if (fb) res = res.filter(q => (q.bloque || "Sin bloque") === fb);
    if (ff) res = res.filter(q => (q.fuente || "Sin fuente") === ff);

    if (term) {
      res = res.filter(q => {
        const hay = [
          q.tema, q.bloque, q.fuente, q.modelo,
          q.pregunta, ...(q.opciones || []), q.explicacion
        ].join(" ").toLowerCase();
        return hay.includes(term);
      });
    }

    renderBankResults(res.slice(0, 200));
  };

  document.getElementById("bank-refresh").onclick = runSearch;
  document.getElementById("bank-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  runSearch();
}

function renderBankResults(list) {
  const box = document.getElementById("bank-results");
  if (!box) return;

  if (!list.length) {
    box.innerHTML = "<p>No hay resultados.</p>";
    return;
  }

  const stats = getStats();

  box.innerHTML = list.map(q => {
    const seen = stats[q.id]?.seen ?? 0;
    return `
      <div class="card" style="padding:12px;">
        <div style="font-weight:700;margin-bottom:6px;">#${q.id} · ${escapeHtml(q.bloque || "")} · ${escapeHtml(q.tema || "")}</div>
        <div class="small" style="margin-bottom:6px;"><strong>Fuente:</strong> ${escapeHtml(q.fuente || "")} ${q.modelo ? `(Modelo ${escapeHtml(q.modelo)})` : ""} · <strong>Vistas:</strong> ${seen}</div>
        <div style="margin-bottom:8px;">${escapeHtml(q.pregunta || "")}</div>
        <div class="small">
          <div>A) ${escapeHtml(q.opciones?.[0] ?? "")}</div>
          <div>B) ${escapeHtml(q.opciones?.[1] ?? "")}</div>
          <div>C) ${escapeHtml(q.opciones?.[2] ?? "")}</div>
          <div>D) ${escapeHtml(q.opciones?.[3] ?? "")}</div>
          <div style="margin-top:6px;"><strong>Correcta:</strong> ${["A","B","C","D"][q.respuesta_correcta] ?? "?"} · ${escapeHtml(q.opciones?.[q.respuesta_correcta] ?? "")}</div>
          <div style="margin-top:6px;"><strong>Explicación:</strong> ${escapeHtml(q.explicacion || "")}</div>
        </div>
        <div class="row" style="margin-top:10px;">
          <button data-edit="${q.id}" class="secondary">Editar</button>
          <button data-del="${q.id}" class="danger">Eliminar</button>
        </div>
      </div>
    `;
  }).join("");

  box.querySelectorAll("button[data-edit]").forEach(btn => {
    btn.onclick = () => openEditQuestionModal(btn.getAttribute("data-edit"));
  });
  box.querySelectorAll("button[data-del]").forEach(btn => {
    btn.onclick = () => deleteQuestion(btn.getAttribute("data-del"));
  });
}

function openEditQuestionModal(id) {
  const idStr = String(id);
  const q = questions.find(x => String(x.id) === idStr);
  if (!q) {
    showAlert("No encontrada.");
    return;
  }

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.right = "0";
  overlay.style.bottom = "0";
  overlay.style.background = "rgba(0,0,0,0.5)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "14px";
  overlay.style.zIndex = "9999";

  const card = document.createElement("div");
  card.style.background = "#fff";
  card.style.width = "100%";
  card.style.maxWidth = "720px";
  card.style.borderRadius = "14px";
  card.style.padding = "12px";
  card.style.maxHeight = "85vh";
  card.style.overflow = "auto";

  const correctLetter = ["A", "B", "C", "D"][q.respuesta_correcta] ?? "A";

  card.innerHTML = `
    <h3>Editar pregunta #${escapeHtml(idStr)}</h3>
    <label style="display:block;margin:8px 0;">Tema:
      <input id="edit-tema" style="width:100%;padding:8px;border-radius:10px;border:1px solid #b8d8ff;" value="${escapeHtmlAttr(q.tema || "")}">
    </label>
    <label style="display:block;margin:8px 0;">Bloque:
      <input id="edit-bloque" style="width:100%;padding:8px;border-radius:10px;border:1px solid #b8d8ff;" value="${escapeHtmlAttr(q.bloque || "")}">
    </label>
    <label style="display:block;margin:8px 0;">Fuente:
      <input id="edit-fuente" style="width:100%;padding:8px;border-radius:10px;border:1px solid #b8d8ff;" value="${escapeHtmlAttr(q.fuente || "")}">
    </label>
    <label style="display:block;margin:8px 0;">Modelo (A/B o vacío):
      <input id="edit-modelo" style="width:120px;padding:8px;border-radius:10px;border:1px solid #b8d8ff;" value="${escapeHtmlAttr(q.modelo || "")}">
    </label>
    <label style="display:block;margin:8px 0;">Pregunta:
      <textarea id="edit-pregunta" style="width:100%;padding:8px;min-height:70px;border-radius:10px;border:1px solid #b8d8ff;"></textarea>
    </label>
    <label style="display:block;margin:8px 0;">A)
      <input id="edit-a" style="width:100%;padding:8px;border-radius:10px;border:1px solid #b8d8ff;" value="${escapeHtmlAttr(q.opciones?.[0] ?? "")}">
    </label>
    <label style="display:block;margin:8px 0;">B)
      <input id="edit-b" style="width:100%;padding:8px;border-radius:10px;border:1px solid #b8d8ff;" value="${escapeHtmlAttr(q.opciones?.[1] ?? "")}">
    </label>
    <label style="display:block;margin:8px 0;">C)
      <input id="edit-c" style="width:100%;padding:8px;border-radius:10px;border:1px solid #b8d8ff;" value="${escapeHtmlAttr(q.opciones?.[2] ?? "")}">
    </label>
    <label style="display:block;margin:8px 0;">D)
      <input id="edit-d" style="width:100%;padding:8px;border-radius:10px;border:1px solid #b8d8ff;" value="${escapeHtmlAttr(q.opciones?.[3] ?? "")}">
    </label>

    <label style="display:block;margin:8px 0;">Correcta (A/B/C/D):
      <input id="edit-correcta" style="width:120px;padding:8px;border-radius:10px;border:1px solid #b8d8ff;" value="${escapeHtmlAttr(correctLetter)}">
    </label>

    <label style="display:block;margin:8px 0;">Explicación:
      <textarea id="edit-exp" style="width:100%;padding:8px;min-height:70px;border-radius:10px;border:1px solid #b8d8ff;"></textarea>
    </label>

    <div class="row" style="margin-top:10px;">
      <button id="edit-save" class="secondary">Guardar</button>
      <button id="edit-cancel" class="danger">Cancelar</button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  card.querySelector("#edit-pregunta").value = q.pregunta || "";
  card.querySelector("#edit-exp").value = q.explicacion || "";

  card.querySelector("#edit-cancel").onclick = () => document.body.removeChild(overlay);

  card.querySelector("#edit-save").onclick = () => {
    const tema = card.querySelector("#edit-tema").value.trim();
    const bloque = card.querySelector("#edit-bloque").value.trim();
    const fuente = card.querySelector("#edit-fuente").value.trim();
    const modelo = card.querySelector("#edit-modelo").value.trim();
    const pregunta = card.querySelector("#edit-pregunta").value.trim();

    const A = card.querySelector("#edit-a").value.trim();
    const B = card.querySelector("#edit-b").value.trim();
    const C = card.querySelector("#edit-c").value.trim();
    const D = card.querySelector("#edit-d").value.trim();

    const corr = card.querySelector("#edit-correcta").value.trim().toUpperCase();
    const idx = { A: 0, B: 1, C: 2, D: 3 }[corr];
    if (idx === undefined) {
      showAlert("Correcta inválida. Usa A/B/C/D.");
      return;
    }

    const exp = card.querySelector("#edit-exp").value.trim();

    const updated = {
      ...q,
      id: idStr, // 🔒 garantizamos string
      tema, bloque, fuente, modelo,
      pregunta,
      opciones: [A, B, C, D],
      respuesta_correcta: idx,
      explicacion: exp
    };

    // 🔒 Reemplazo seguro en extras por ID string
    const extra = loadExtraQuestions().filter(x => String(x.id) !== idStr);
    extra.push(updated);
    saveExtraQuestions(extra);

    mergeQuestions();
    applyDeletedFilter();
    refreshDbCountPill();

    document.body.removeChild(overlay);
    showQuestionBank();
  };
}

async function deleteQuestion(id) {
  const idStr = String(id);
  const ok = await showConfirm(
    `¿Eliminar la pregunta #${idStr}? (Podrás restaurarla desde "Papelera")`,
    { danger: true }
  );
  if (!ok) return;

  const deletedRaw = lsGetJSON(LS_DELETED_IDS, []);
  const deleted = new Set(normalizeIdArray(deletedRaw));
  deleted.add(idStr);
  lsSetJSON(LS_DELETED_IDS, Array.from(deleted));

  const extra = loadExtraQuestions().filter(x => String(x.id) !== idStr);
  saveExtraQuestions(extra);

  mergeQuestions();
  applyDeletedFilter();
  refreshDbCountPill();

  showQuestionBank();
}

// =======================
// PAPELERA (modo trash)
// =======================

function showTrashScreen() {
  mode = "trash";
  showTestMenuScreen();

  // IDs eliminados (strings)
  const deletedIds = new Set(normalizeIdArray(lsGetJSON(LS_DELETED_IDS, [])));

  // Todas las preguntas posibles (base + extras, SIN filtrar borradas)
  const base = Array.isArray(questionsBase)
    ? questionsBase.map(q => ({ ...q, id: String(q.id) }))
    : [];

  const extra = loadExtraQuestions();

  const map = new Map();
  base.forEach(q => map.set(q.id, q));
  extra.forEach(q => map.set(q.id, q));

  const deletedQuestions = Array.from(map.values())
    .filter(q => deletedIds.has(String(q.id)));

  testMenu.innerHTML = `
    <h2>Papelera de preguntas</h2>

    <div class="small" style="margin-bottom:10px;">
      Preguntas eliminadas lógicamente. Puedes restaurarlas o borrarlas definitivamente.
    </div>

    <div class="row" style="margin-bottom:10px;">
      <button id="trash-back" class="secondary">Volver</button>
    </div>

    <div id="trash-results"></div>
  `;

  document.getElementById("trash-back").onclick = showMainMenu;

  renderTrashResults(deletedQuestions);
}

function renderTrashResults(list) {
  const box = document.getElementById("trash-results");
  if (!box) return;

  if (!list.length) {
    box.innerHTML = "<p>No hay preguntas en la papelera.</p>";
    return;
  }

  box.innerHTML = list.map(q => `
    <div class="card" style="padding:12px;">
      <div style="font-weight:700;margin-bottom:6px;">
        #${escapeHtml(q.id)} · ${escapeHtml(q.bloque || "")} · ${escapeHtml(q.tema || "")}
      </div>

      <div class="small" style="margin-bottom:6px;">
        <strong>Fuente:</strong> ${escapeHtml(q.fuente || "")}
        ${q.modelo ? `(Modelo ${escapeHtml(q.modelo)})` : ""}
      </div>

      <div style="margin-bottom:8px;">
        ${escapeHtml(q.pregunta || "")}
      </div>

      <div class="row" style="margin-top:10px;">
        <button data-restore="${escapeHtml(q.id)}" class="secondary">Restaurar</button>
        <button data-purge="${escapeHtml(q.id)}" class="danger">Borrar definitivamente</button>
      </div>
    </div>
  `).join("");

  box.querySelectorAll("button[data-restore]").forEach(btn => {
    btn.onclick = () => restoreDeletedQuestion(btn.getAttribute("data-restore"));
  });

  box.querySelectorAll("button[data-purge]").forEach(btn => {
    btn.onclick = () => purgeDeletedQuestion(btn.getAttribute("data-purge"));
  });
}

function restoreDeletedQuestion(id) {
  const idStr = String(id);

  const deletedRaw = lsGetJSON(LS_DELETED_IDS, []);
  const deleted = new Set(normalizeIdArray(deletedRaw));

  if (!deleted.has(idStr)) return;

  deleted.delete(idStr);
  lsSetJSON(LS_DELETED_IDS, Array.from(deleted));

  mergeQuestions();
  applyDeletedFilter();
  refreshDbCountPill();

  showTrashScreen();
}

async function purgeDeletedQuestion(id) {
  const idStr = String(id);

  const ok = await showConfirm(
    `¿Borrar DEFINITIVAMENTE la pregunta #${idStr}? Esta acción no se puede deshacer.`,
    { danger: true }
  );
  if (!ok) return;

  // 1) Eliminar de deletedIds
  const deletedRaw = lsGetJSON(LS_DELETED_IDS, []);
  const deleted = new Set(normalizeIdArray(deletedRaw));
  deleted.delete(idStr);
  lsSetJSON(LS_DELETED_IDS, Array.from(deleted));

  // ✅ NUEVO: Marcar como purgada para que NO vuelva aunque esté en questions.json
  const purgedRaw = lsGetJSON(LS_PURGED_IDS, []);
  const purged = new Set(normalizeIdArray(purgedRaw));
  purged.add(idStr);
  lsSetJSON(LS_PURGED_IDS, Array.from(purged));

  // 2) Eliminar definitivamente de preguntas añadidas
  const extra = loadExtraQuestions().filter(q => String(q.id) !== idStr);
  saveExtraQuestions(extra);

  // 3) Eliminar de pendientes
  const pending = getPendingReviewSet();
  const done = getPendingDoneSet();

  pending.delete(idStr);
  done.delete(idStr);

  setPendingReviewSet(pending);
  setPendingDoneSet(done);

  // 4) Eliminar estadísticas asociadas
  const stats = getStats();
  if (stats[idStr]) {
    delete stats[idStr];
    setStats(stats);
  }

  mergeQuestions();
  applyDeletedFilter();
  refreshDbCountPill();

  showTrashScreen();
}

// =======================
// BACKUP COMPLETO (EXPORT / IMPORT)
// =======================

const BACKUP_VERSION = 1;

function exportFullBackup() {
  const payload = {
    app: "chatgpt-oposiciones",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),

    data: {
      extraQuestions: lsGetJSON(LS_EXTRA_QUESTIONS, []),
      stats: lsGetJSON(LS_STATS, {}),
      history: lsGetJSON(LS_HISTORY, []),
      pending: lsGetJSON(LS_PENDING_REVIEW, []),
      pendingDone: lsGetJSON(LS_PENDING_REVIEW_DONE, []),
      deletedIds: lsGetJSON(LS_DELETED_IDS, []),

      // ✅ NUEVO: purgadas definitivas (si no, “vuelven” tras importar)
      purgedIds: lsGetJSON(LS_PURGED_IDS, []),

      pausedTest: lsGetJSON(LS_ACTIVE_PAUSED_TEST, null)
    }
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `backup_chatgpt_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function importFullBackupFromText(rawText) {
  let parsed;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    showAlert("El archivo no es un JSON válido.");
    return;
  }

  const appId = parsed?.app;
  if (!appId || (appId !== "chatgpt-oposiciones" && appId !== "chari-oposiciones")) {
    showAlert("Este archivo no parece un backup válido de la app.");
    return;
  }

  if (parsed.version !== BACKUP_VERSION) {
    showAlert(
      `Versión de backup no compatible.\n` +
      `Esperada: ${BACKUP_VERSION}\n` +
      `Encontrada: ${parsed.version}`
    );
    return;
  }

  if (!parsed.data || typeof parsed.data !== "object") {
    showAlert("El backup está corrupto (data inválida).");
    return;
  }

  const ok = await showConfirm(
    "⚠️ IMPORTANTE ⚠️\n\n" +
    "Este proceso SOBRESCRIBIRÁ TODOS los datos actuales:\n" +
    "- preguntas añadidas\n" +
    "- estadísticas\n" +
    "- pendientes\n" +
    "- papelera\n" +
    "- purgadas definitivas\n" +
    "- test pausado\n\n" +
    "¿Seguro que quieres continuar?",
    { danger: true }
  );
  if (!ok) return;

  const d = parsed.data;

  // Sobrescritura controlada
  if (Array.isArray(d.extraQuestions)) {
    lsSetJSON(LS_EXTRA_QUESTIONS, d.extraQuestions);
  }

  if (typeof d.stats === "object") {
    lsSetJSON(LS_STATS, d.stats);
  }

  if (Array.isArray(d.history)) {
    lsSetJSON(LS_HISTORY, d.history);
  }

  if (Array.isArray(d.pending)) {
    lsSetJSON(LS_PENDING_REVIEW, d.pending);
  }

  if (Array.isArray(d.pendingDone)) {
    lsSetJSON(LS_PENDING_REVIEW_DONE, d.pendingDone);
  }

  if (Array.isArray(d.deletedIds)) {
    lsSetJSON(LS_DELETED_IDS, d.deletedIds);
  }

  // ✅ NUEVO: purgadas definitivas
  if (Array.isArray(d.purgedIds)) {
    lsSetJSON(LS_PURGED_IDS, d.purgedIds);
  } else {
    // si el backup es antiguo y no trae purgedIds, dejamos vacío
    lsSetJSON(LS_PURGED_IDS, []);
  }

  if (d.pausedTest === null || typeof d.pausedTest === "object") {
    lsSetJSON(LS_ACTIVE_PAUSED_TEST, d.pausedTest);
  }

  await showAlert("Backup importado correctamente.\nLa aplicación se reiniciará.");

  // Recarga total para garantizar estado limpio
  location.reload();
}

// =======================
// MODO OSCURO (PERSISTENTE)
// =======================

const LS_DARK_MODE = "chatgpt_dark_mode_v1";

function isDarkModeEnabled() {
  return lsGetJSON(LS_DARK_MODE, false) === true;
}

function setDarkModeEnabled(enabled) {
  lsSetJSON(LS_DARK_MODE, !!enabled);
  applyDarkModeToDocument();
}

function ensureDarkModeStyleTag() {
  let style = document.getElementById("dark-mode-style");
  if (style) return style;

  style = document.createElement("style");
  style.id = "dark-mode-style";
  style.textContent = `
    /* =======================
       DARK MODE THEME
       ======================= */

    body.chatgpt-dark {
      background: #0b0f14 !important;
      color: #e6eaf0 !important;
    }

    body.chatgpt-dark h1,
    body.chatgpt-dark h2,
    body.chatgpt-dark h3,
    body.chatgpt-dark h4,
    body.chatgpt-dark p,
    body.chatgpt-dark label,
    body.chatgpt-dark .small,
    body.chatgpt-dark div,
    body.chatgpt-dark span {
      color: #e6eaf0;
    }

    body.chatgpt-dark hr {
      border-color: rgba(255,255,255,0.12);
    }

    /* Contenedores principales (por si tienen fondo blanco) */
    body.chatgpt-dark #main-menu,
    body.chatgpt-dark #test-menu,
    body.chatgpt-dark #test-container,
    body.chatgpt-dark #results-container,
    body.chatgpt-dark #import-container {
      background: transparent !important;
    }

    /* Cards */
    body.chatgpt-dark .card,
    body.chatgpt-dark [style*="background:white"],
    body.chatgpt-dark [style*="background: white"] {
      background: rgba(255,255,255,0.06) !important;
      border: 1px solid rgba(255,255,255,0.10) !important;
      box-shadow: none !important;
    }

    /* Inputs / textarea / select */
    body.chatgpt-dark input,
    body.chatgpt-dark textarea,
    body.chatgpt-dark select {
      background: rgba(255,255,255,0.06) !important;
      color: #e6eaf0 !important;
      border: 1px solid rgba(255,255,255,0.16) !important;
      outline: none !important;
    }

    body.chatgpt-dark input::placeholder,
    body.chatgpt-dark textarea::placeholder {
      color: rgba(230,234,240,0.6) !important;
    }

    /* Botones genéricos */
    body.chatgpt-dark button {
      background: rgba(255,255,255,0.10);
      color: #e6eaf0;
      border: 1px solid rgba(255,255,255,0.14);
    }

    body.chatgpt-dark button:hover {
      filter: brightness(1.08);
    }

    /* Clases existentes */
    body.chatgpt-dark button.secondary {
      background: rgba(120,170,255,0.18);
      border-color: rgba(120,170,255,0.30);
    }

    body.chatgpt-dark button.success {
      background: rgba(120,170,255,0.18);
      border-color: rgba(120,170,255,0.30);
    }

    body.chatgpt-dark button.danger {
      background: rgba(255,90,90,0.18);
      border-color: rgba(255,90,90,0.35);
    }

    body.chatgpt-dark .answer-btn[style*="lightgreen"] {
      background: rgba(70, 160, 110, 0.28) !important;
    }
    body.chatgpt-dark .answer-btn[style*="salmon"] {
      background: rgba(190, 90, 90, 0.28) !important;
    }

    body.chatgpt-dark #no-btn {
      background: rgba(255,255,255,0.10) !important;
      border: 1px solid rgba(255,255,255,0.14) !important;
    }

    body.chatgpt-dark .modal,
    body.chatgpt-dark .modal * {
      color: #000 !important;
    }

    body.chatgpt-dark .modal button {
      background: rgba(120,170,255,0.22) !important;
      border-color: rgba(120,170,255,0.35) !important;
      color: #000 !important;
    }

    /* Pills / badges (por si usan fondo claro) */
    body.chatgpt-dark #mode-pill,
    body.chatgpt-dark #db-count-pill {
      background: rgba(255,255,255,0.08) !important;
      color: #e6eaf0 !important;
      border: 1px solid rgba(255,255,255,0.12) !important;
    }
  `;
  document.head.appendChild(style);
  return style;
}

function applyDarkModeToDocument() {
  ensureDarkModeStyleTag();

  const enabled = isDarkModeEnabled();
  document.body.classList.toggle("chatgpt-dark", enabled);

  // Si quieres, aquí podríamos también ajustar algún inline style concreto si lo hubiera
  // pero por ahora lo resolvemos vía CSS global.
}

function injectDarkModeToggleIntoMainMenu() {
  const row = document.getElementById("main-darkmode-row");
  if (!row) return;
  row.innerHTML = "";

  const btn = document.createElement("button");
  btn.id = "btn-darkmode-toggle";
  btn.className = "secondary";
  btn.textContent = isDarkModeEnabled() ? "Modo claro" : "Modo oscuro";
  btn.onclick = () => {
    const newVal = !isDarkModeEnabled();
    setDarkModeEnabled(newVal);
    btn.textContent = newVal ? "Modo claro" : "Modo oscuro";
  };
  row.appendChild(btn);
}

// Aplicar el modo al cargar la app (por si el usuario ya lo tenía activado)
(function initDarkModeOnLoad() {
  applyDarkModeToDocument();
})();

// =======================
// ESCAPE helpers
// =======================
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeHtmlAttr(str) {
  return escapeHtml(str).replaceAll("\n", " ");
}

// Escapa valores para usarlos dentro de selectores CSS (querySelector/querySelectorAll)
function cssEscape(val) {
  const s = String(val ?? "");
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(s);
  }
  // Fallback razonable (no perfecto, pero evita roturas comunes)
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\A ")
    .replaceAll("\r", "");
}

// =======================
// ATAJOS DE TECLADO (TEST)
// =======================

(function setupKeyboardShortcuts() {
  // Evitamos registrar más de una vez
  if (window.__chatgptKeyboardShortcutsInstalled) return;
  window.__chatgptKeyboardShortcutsInstalled = true;

  function isTestVisible() {
    if (!testContainer) return false;
    const style = window.getComputedStyle(testContainer);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  document.addEventListener("keydown", (e) => {
    // No interferir al escribir en inputs o textareas
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    // Solo actuamos si estamos en pantalla de test (visible de verdad)
    if (!isTestVisible()) return;

    const key = e.key.toLowerCase();

    // =======================
    // ATAJOS TTS
    // =======================
    if (key === "l") {
      e.preventDefault();
      ttsUserInteracted = true;
      const q = currentTest[currentIndex];
      ttsSpeakQuestion(q, currentIndex + 1, currentTest.length);
      return;
    }
    if (key === "s") {
      e.preventDefault();
      ttsUserInteracted = true;
      ttsStop();
      return;
    }

    // =======================
    // ESTADO: PREGUNTA
    // =======================
    if (viewState === "question") {
      // A/B/C/D
      if (["a", "b", "c", "d"].includes(key)) {
        const idx = { a: 0, b: 1, c: 2, d: 3 }[key];
        const q = currentTest[currentIndex];
        if (!q) return;

        const opt = currentShuffledOptions[idx];
        if (opt !== undefined) {
          e.preventDefault();
          checkAnswer(opt, q);
        }
        return;
      }

      // 1/2/3/4
      if (["1", "2", "3", "4"].includes(key)) {
        const idx = parseInt(key, 10) - 1;
        const q = currentTest[currentIndex];
        if (!q) return;

        const opt = currentShuffledOptions[idx];
        if (opt !== undefined) {
          e.preventDefault();
          checkAnswer(opt, q);
        }
        return;
      }

      // 0 => No lo sé
      if (key === "0") {
        e.preventDefault();
        onNoSe();
        return;
      }
    }

    // =======================
    // ESTADO: FEEDBACK
    // =======================
    if (viewState === "feedback") {
      if (key === "enter" || key === " ") {
        e.preventDefault();
        if (continueBtn && continueBtn.style.display !== "none") {
          continueBtn.click();
        }
      }
    }
  });
})();

// =======================
// EVENTS (HTML)
// =======================
startTestBtn.onclick = () => showTemaSelectionScreen();
quickTest10Btn.onclick = () => startQuickTest(10, 10);
quickTest20Btn.onclick = () => startQuickTest(20, 20);
if (openTestModalBtn) openTestModalBtn.onclick = openTestStartModal;
if (closeTestModalBtn) closeTestModalBtn.onclick = closeTestStartModal;
if (examStartBtn) examStartBtn.onclick = () => startExamFromSources();
if (examCloseBtn) examCloseBtn.onclick = closeExamSourceModal;
if (voiceSettingsBtn) voiceSettingsBtn.onclick = showVoiceSettingsScreen;
const openConfigBtn = document.getElementById("btn-open-config");
if (openConfigBtn) openConfigBtn.onclick = () => showConfigScreen();
if (backConfigBtn) backConfigBtn.onclick = showMainMenu;
openImportBtn.onclick = () => {
  // ✅ al entrar, vacío para pruebas (como pediste)
  clearImportTextarea();
  showImportScreen();
};
exportJsonBtn.onclick = () => exportQuestionsJSON();

backToMenuBtnResults.onclick = showMainMenu;

noSeBtn.onclick = onNoSe;

btnImportQuestions.onclick = importQuestionsFromTextarea;
btnClearImport.onclick = clearImportTextarea;
btnClearAdded.onclick = clearAddedQuestions;
btnBackFromImport.onclick = showMainMenu;
if (voiceSettingsBackBtn) voiceSettingsBackBtn.onclick = showConfigScreen;

// =======================
// INIT
// =======================
function isVisibleEl(el) {
  return !!(el && el.offsetParent !== null);
}

function handleEscBack() {
  const finishBtn = document.getElementById("finish-btn");
  if (isVisibleEl(finishBtn)) {
    finishBtn.click();
    return;
  }

  const candidates = [
    document.getElementById("btn-close-test-modal"),
    document.getElementById("btn-exam-close"),
    document.getElementById("back-to-results-btn"),
    document.getElementById("back-to-menu-btn"),
    document.getElementById("btn-back-main"),
    document.getElementById("bank-back"),
    document.getElementById("btn-back-from-import"),
    document.getElementById("btn-stats-back"),
    document.getElementById("btn-voice-back")
  ];

  for (const btn of candidates) {
    if (isVisibleEl(btn)) {
      btn.click();
      return;
    }
  }
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    handleEscBack();
  }
});

fetch("frases_motivadoras.json")
  .then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status} cargando frases_motivadoras.json`);
    return res.json();
  })
  .then(data => {
    const list = data && Array.isArray(data["Frases motivadoras"])
      ? data["Frases motivadoras"].filter(Boolean)
      : [];
    if (list.length) motivationalPhrases = list;
    if (mainMenu && mainMenu.style.display !== "none") {
      renderMotivationalPhrase();
    }
  })
  .catch(err => {
    console.warn("No se pudieron cargar las frases motivadoras", err);
  });

fetch("questions_manifest.json")
  .then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status} cargando questions_manifest.json`);
    return res.json();
  })
  .then(manifest => {
    const files = Array.isArray(manifest?.files) ? manifest.files.filter(Boolean) : [];
    if (!files.length) throw new Error("Manifest vacio o sin 'files'");

    return Promise.all(
      files.map(file =>
        fetch(file).then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status} cargando ${file}`);
          return res.json();
        })
      )
    );
  })
  .then(datasets => {
    const merged = [];
    for (const data of datasets) {
      if (Array.isArray(data)) merged.push(...data);
    }
    questionsBase = merged;
    mergeQuestions();
    applyDeletedFilter();
    refreshDbCountPill();
    showMainMenu();
  })
  .catch(err => {
    showAlert("Error cargando questions_manifest.json o alguno de sus archivos");
    console.error(err);
    questionsBase = [];
    mergeQuestions();
    applyDeletedFilter();
    refreshDbCountPill();
    showMainMenu();
  });
