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
const LS_UI_STATE = "chatgpt_ui_state_v1";

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
let isOvertime = false;
let overtimeSeconds = 0;
let timeUpPromptOpen = false;
let clockModeRecordTarget = 0;
let baseAnsweredIds = new Set();
let baseCounts = { correct: 0, wrong: 0, noSe: 0 };
let baseTestIdSet = new Set();

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
let homeConfigOpenTimer = null;
let homeVoiceCloseTimer = null;
let homeConfigCloseTimer = null;
let homeStartCloseTimer = null;
let importBackHandler = null;
let importScreenMode = "batch";

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
const answerExplanation = document.getElementById("answer-explanation");
const answersContainer = document.getElementById("answers-container");
const testBottom = document.getElementById("test-bottom");
const testContentScroll = document.getElementById("test-content-scroll");
const testActionsFixed = document.getElementById("test-actions-fixed");
const continueBtn = document.getElementById("continue-btn");
const noSeBtn = document.getElementById("no-btn");
const timerDisplay = document.getElementById("timer");
const modePill = document.getElementById("mode-pill");
const motivationalPhraseEl = document.getElementById("motivational-phrase");
const appVersionBadgeEl = document.getElementById("app-version-badge");
const homeGlobalProgressEl = document.getElementById("home-global-progress");
const homeGlobalProgressOkEl = document.getElementById("home-global-progress-ok");
const homeGlobalProgressBadEl = document.getElementById("home-global-progress-bad");
const homeGlobalProgressEmptyEl = document.getElementById("home-global-progress-empty");

const ttsPanel = document.getElementById("tts-panel");
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

let openTestModalTimer = null;
let homeActionTimer = null;
let testBottomResizeObserver = null;
let testBottomResizeRaf = null;
let testAnswerDockRaf = null;
let pendingFinishReason = null;
let customJumpTopScrollHandler = null;
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
const btnCopyImportTemplate = document.getElementById("btn-copy-import-template");
const btnToggleImportTemplate = document.getElementById("btn-toggle-import-template");
const importTitle = document.getElementById("import-title");
const importBatchSection = document.getElementById("import-batch-section");
const importManualSection = document.getElementById("import-manual-section");
const importTemplateBox = document.getElementById("import-template-box");
const importJsonTemplate = document.getElementById("import-json-template");
const manualIdInput = document.getElementById("manual-id");
const manualBloqueInput = document.getElementById("manual-bloque");
const manualTemaInput = document.getElementById("manual-tema");
const manualPreguntaInput = document.getElementById("manual-pregunta");
const manualOpAInput = document.getElementById("manual-op-a");
const manualOpBInput = document.getElementById("manual-op-b");
const manualOpCInput = document.getElementById("manual-op-c");
const manualOpDInput = document.getElementById("manual-op-d");
const manualCorrectaSelect = document.getElementById("manual-correcta");
const manualExplicacionInput = document.getElementById("manual-explicacion");
const btnManualAddQuestion = document.getElementById("btn-manual-add-question");

const resultsText = document.getElementById("results-text");
const statsContent = document.getElementById("stats-content");
const statsActions = document.getElementById("stats-actions");
const appSplash = document.getElementById("app-splash");
const APP_SPLASH_REEL_VALUES = [
  "F-",
  "F",
  "F+",
  "E-",
  "E",
  "E+",
  "D-",
  "D",
  "D+",
  "C-",
  "C",
  "C+",
  "B-",
  "B",
  "B+",
  "A-",
  "A",
  "A+"
];
const APP_SPLASH_REEL_RENDER_VALUES = [...APP_SPLASH_REEL_VALUES].reverse();
const APP_SPLASH_REEL_STEP_DURATIONS_MS = [
  180,
  150,
  130,
  115,
  100,
  90,
  82,
  74,
  68,
  64,
  62,
  64,
  72,
  84,
  220,
  420,
  620
];
const APP_SPLASH_REEL_START_MS = 2000;
const APP_SPLASH_REEL_STEP_GAP_MS = 16;
const APP_SPLASH_REEL_BOOTSTRAP_MS = 140;
const APP_SPLASH_ASCENT_DELAY_AFTER_REEL_MS = 760;
const APP_SPLASH_ASCENT_DURATION_MS = 1200;
const APP_SPLASH_HIDE_FADE_MS = 820;
const APP_SPLASH_HOME_LOGO_FADE_IN_MS = 520;
const APP_SPLASH_HANDOFF_FADE_MS = 980;
const APP_SPLASH_LOGO_HTML = `
  <span class="app-splash-test">TEST</span>
  <span class="app-splash-grade">
    <span class="app-splash-grade-draw" id="app-splash-grade-draw" aria-hidden="true">
      <span class="draw-char draw-f">F</span><span class="draw-char draw-sign">-</span>
    </span>
    <span class="app-splash-grade-reel" id="app-splash-grade-reel" aria-hidden="true">
      <span class="app-splash-grade-track" id="app-splash-grade-track"></span>
    </span>
  </span>
`;
const APP_SPLASH_DEBUG_MODES = new Set(["draw", "reel", "done", "ascend"]);
const APP_HOME_DEBUG_MODE = (function parseHomeDebugMode() {
  function normalizeHomeDebugMode(raw) {
    const v = String(raw || "").trim().toLowerCase();
    if (!v) return "";
    if (v === "logo" || v === "logo-only" || v === "prehome" || v === "pre-home") return "logo";
    if (v === "home" || v === "final" || v === "full") return "home";
    return "";
  }

  let mode = "";
  if (typeof document !== "undefined" && document.documentElement) {
    mode = normalizeHomeDebugMode(document.documentElement.getAttribute("data-home-debug-mode"));
  }
  if (typeof window === "undefined" || !window.location || !window.location.search) return mode;

  const params = new URLSearchParams(window.location.search);
  const enabled = /^(1|true|yes|on)$/i.test(String(params.get("homeDebug") || ""));
  if (!enabled) return mode;
  const modeRaw = params.get("homeDebugMode") || params.get("homeDebugStage") || "home";
  return normalizeHomeDebugMode(modeRaw) || "home";
})();
const APP_HOME_DEBUG_FREEZE = !!APP_HOME_DEBUG_MODE;
const APP_SPLASH_SESSION_SEEN_KEY = "opostest_splash_seen_in_tab_v1";
const APP_SPLASH_SEEN_IN_TAB = (function wasSplashSeenInCurrentTab() {
  try {
    return sessionStorage.getItem(APP_SPLASH_SESSION_SEEN_KEY) === "1";
  } catch (_) {
    return false;
  }
})();
const APP_SPLASH_SKIP_ON_RELOAD = (function detectReloadNavigation() {
  try {
    if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return false;
    const navEntries = performance.getEntriesByType("navigation");
    if (!Array.isArray(navEntries) || navEntries.length === 0) return false;
    const navEntry = navEntries[0];
    return APP_SPLASH_SEEN_IN_TAB || !!(navEntry && navEntry.type === "reload");
  } catch (_) {
    // ignore
  }
  return APP_SPLASH_SEEN_IN_TAB;
})();
const APP_SPLASH_DISABLED = APP_HOME_DEBUG_FREEZE || APP_SPLASH_SKIP_ON_RELOAD;
try {
  sessionStorage.setItem(APP_SPLASH_SESSION_SEEN_KEY, "1");
} catch (_) {}
let appSkipNextHomeIntroAnimation = APP_SPLASH_SKIP_ON_RELOAD;
let appSplashHideTimer = null;
let appSplashStartTimer = null;
let appSplashReelStepTimer = null;
let appSplashAscentTimer = null;
let appSplashTimelineDoneTimer = null;
let appSplashHandoffTimer = null;
let appSplashFadeOutTimer = null;
let appSplashHidden = false;
let appSplashAppReady = !appSplash;
let appSplashTimelineDone = !appSplash;
let appSplashSharedHomeLogo = null;
let appSplashSharedHomeLogoOriginalHTML = "";
let appSplashSharedHomeLogoOriginalParent = null;
let appSplashSharedHomeLogoOriginalNextSibling = null;
let appSplashUsesSharedHomeLogo = false;
let appSplashPendingHomeLogoContinuity = false;
let appSplashSharedLogoUnpinRaf1 = null;
let appSplashSharedLogoUnpinRaf2 = null;
const TEST_MENU_DETAIL_SCREENS = new Set([
  "test-menu",
  "tema-selection",
  "exam-menu",
  "exam-block-select"
]);
let uiLastScreenState = "home";

function clearSharedLogoViewportPin() {
  if (appSplashSharedLogoUnpinRaf1) {
    cancelAnimationFrame(appSplashSharedLogoUnpinRaf1);
    appSplashSharedLogoUnpinRaf1 = null;
  }
  if (appSplashSharedLogoUnpinRaf2) {
    cancelAnimationFrame(appSplashSharedLogoUnpinRaf2);
    appSplashSharedLogoUnpinRaf2 = null;
  }
  if (!appSplashSharedHomeLogo) return;
  const s = appSplashSharedHomeLogo.style;
  s.position = "";
  s.left = "";
  s.top = "";
  s.width = "";
  s.height = "";
  s.margin = "";
  s.transform = "";
  s.zIndex = "";
  s.pointerEvents = "";
  s.willChange = "";
  s.transition = "";
}

function setupSplashWithSharedHomeLogo() {
  if (appSplashUsesSharedHomeLogo || !appSplash || !mainMenu) return;
  const splashStage = appSplash.querySelector(".app-splash-stage");
  const homeLogo = mainMenu.querySelector("h1");
  if (!splashStage || !homeLogo) return;

  const legacySplashLogo = splashStage.querySelector(".app-splash-logo-line");
  if (legacySplashLogo && legacySplashLogo !== homeLogo) legacySplashLogo.remove();

  appSplashSharedHomeLogo = homeLogo;
  appSplashSharedHomeLogoOriginalHTML = homeLogo.innerHTML;
  appSplashSharedHomeLogoOriginalParent = homeLogo.parentNode;
  appSplashSharedHomeLogoOriginalNextSibling = homeLogo.nextSibling;

  homeLogo.classList.add("app-splash-logo-line", "app-splash-home-logo");
  homeLogo.setAttribute("aria-label", "TESTA+");
  homeLogo.innerHTML = APP_SPLASH_LOGO_HTML;
  splashStage.appendChild(homeLogo);
  if (document.body) document.body.classList.add("splash-shared-logo");
  appSplashUsesSharedHomeLogo = true;
}

function restoreSharedHomeLogoAfterSplash() {
  if (!appSplashUsesSharedHomeLogo || !appSplashSharedHomeLogo) return;
  const homeLogo = appSplashSharedHomeLogo;
  const parent = appSplashSharedHomeLogoOriginalParent;
  const nextSibling = appSplashSharedHomeLogoOriginalNextSibling;

  homeLogo.classList.remove("app-splash-logo-line", "app-splash-home-logo");
  homeLogo.removeAttribute("aria-label");
  if (
    appSplashSharedHomeLogoOriginalHTML &&
    String(homeLogo.innerHTML || "").trim() !== String(appSplashSharedHomeLogoOriginalHTML).trim()
  ) {
    homeLogo.innerHTML = appSplashSharedHomeLogoOriginalHTML;
  }

  if (parent) {
    if (nextSibling && nextSibling.parentNode === parent) {
      parent.insertBefore(homeLogo, nextSibling);
    } else {
      parent.appendChild(homeLogo);
    }
  }

  // Limpia cualquier pin previo; en iOS/Safari fijar temporalmente con
  // position:fixed puede provocar un salto lateral en el handoff.
  clearSharedLogoViewportPin();

  appSplashUsesSharedHomeLogo = false;
  appSplashPendingHomeLogoContinuity = true;
}

function prepareSharedLogoForHomeHandoff() {
  if (!appSplashUsesSharedHomeLogo || !appSplashSharedHomeLogo) return;
  if (!appSplashSharedHomeLogoOriginalHTML) return;
  if (
    String(appSplashSharedHomeLogo.innerHTML || "").trim() === String(appSplashSharedHomeLogoOriginalHTML).trim()
  ) {
    return;
  }
  appSplashSharedHomeLogo.innerHTML = appSplashSharedHomeLogoOriginalHTML;
}

function getActiveSplashLogoEl() {
  if (appSplashUsesSharedHomeLogo && appSplashSharedHomeLogo) return appSplashSharedHomeLogo;
  if (!appSplash) return null;
  return appSplash.querySelector(".app-splash-logo-line");
}

function measureHomeLogoRectForSplashAscent() {
  if (!mainMenu) return null;

  if (!appSplashUsesSharedHomeLogo) {
    const homeLogo = mainMenu.querySelector("h1");
    if (!homeLogo) return null;
    return homeLogo.getBoundingClientRect();
  }

  const parent = appSplashSharedHomeLogoOriginalParent;
  if (!parent) return null;

  const ghost = document.createElement("h1");
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.position = "absolute";
  ghost.style.visibility = "hidden";
  ghost.style.pointerEvents = "none";
  ghost.style.opacity = "0";
  ghost.style.margin = "0";
  ghost.innerHTML = appSplashSharedHomeLogoOriginalHTML;

  const hadSettled = mainMenu.classList.contains("home-logo-settled");
  if (!hadSettled) mainMenu.classList.add("home-logo-settled");
  const nextSibling = appSplashSharedHomeLogoOriginalNextSibling;
  if (nextSibling && nextSibling.parentNode === parent) {
    parent.insertBefore(ghost, nextSibling);
  } else {
    parent.appendChild(ghost);
  }

  const rect = ghost.getBoundingClientRect();
  ghost.remove();
  if (!hadSettled) mainMenu.classList.remove("home-logo-settled");
  return (rect && rect.width && rect.height) ? rect : null;
}

function parseAppSplashDebugConfig() {
  if (typeof window === "undefined" || !window.location || !window.location.search) return null;
  const params = new URLSearchParams(window.location.search);
  const enabled = /^(1|true|yes|on)$/i.test(String(params.get("splashDebug") || ""));
  if (!enabled) return null;

  const phaseRaw = String(params.get("phase") || "done").trim().toLowerCase();
  const phase = APP_SPLASH_DEBUG_MODES.has(phaseRaw) ? phaseRaw : "done";

  let gradeRaw = String(params.get("grade") || "A+").trim().toUpperCase();
  gradeRaw = gradeRaw.replace(/\s+/g, "");
  const grade = APP_SPLASH_REEL_VALUES.includes(gradeRaw) ? gradeRaw : "A+";

  return { phase, grade };
}

const APP_SPLASH_DEBUG_CONFIG = parseAppSplashDebugConfig();
const APP_SPLASH_DEBUG_ENABLED = !!APP_SPLASH_DEBUG_CONFIG;

if (appSplash && document.body && !APP_SPLASH_DISABLED) {
  setupSplashWithSharedHomeLogo();
}

function scheduleAppSplashAscent() {
  if (!appSplash || appSplashTimelineDone) return;
  if (appSplashAscentTimer) clearTimeout(appSplashAscentTimer);
  appSplashAscentTimer = setTimeout(() => {
    if (!appSplash) return;
    syncSplashAscentWithHomeLogo();
    appSplash.classList.add("is-ascending");
    if (appSplashTimelineDoneTimer) clearTimeout(appSplashTimelineDoneTimer);
    appSplashTimelineDoneTimer = setTimeout(() => {
      appSplashTimelineDone = true;
      maybeHideAppSplash();
    }, APP_SPLASH_ASCENT_DURATION_MS);
  }, APP_SPLASH_ASCENT_DELAY_AFTER_REEL_MS);
}

function syncSplashAscentWithHomeLogo() {
  if (!appSplash || !mainMenu) return;
  const splashLogo = getActiveSplashLogoEl();
  const homeRect = measureHomeLogoRectForSplashAscent();
  if (!splashLogo || !homeRect) return;

  const splashRect = splashLogo.getBoundingClientRect();
  if (!splashRect.width || !splashRect.height || !homeRect.width || !homeRect.height) return;

  const splashCx = splashRect.left + splashRect.width / 2;
  const splashCy = splashRect.top + splashRect.height / 2;
  const homeCx = homeRect.left + homeRect.width / 2;
  const homeCy = homeRect.top + homeRect.height / 2;
  const dx = homeCx - splashCx;
  const dy = homeCy - splashCy;
  const scaleRaw = homeRect.height / splashRect.height;
  const scale = Math.min(1.2, Math.max(0.7, scaleRaw || 1));

  appSplash.style.setProperty("--app-splash-ascent-x", `${dx.toFixed(2)}px`);
  appSplash.style.setProperty("--app-splash-ascent-y", `${dy.toFixed(2)}px`);
  appSplash.style.setProperty("--app-splash-ascent-scale", scale.toFixed(4));
}

function renderSplashGradeValue(value) {
  const m = String(value || "").match(/^([A-F])([+-]?)$/);
  if (!m) return `<span class="grade-letter">${escapeHtml(String(value || ""))}</span>`;
  const letter = escapeHtml(m[1]);
  const sign = m[2] ? `<span class="grade-sign">${escapeHtml(m[2])}</span>` : "";
  return `<span class="grade-letter">${letter}</span>${sign}`;
}

if (appSplash && document.body) {
  if (APP_SPLASH_DISABLED) {
    appSplashHidden = true;
    appSplashAppReady = true;
    appSplashTimelineDone = true;
    appSplash.classList.add("is-hidden");
    appSplash.setAttribute("aria-hidden", "true");
    appSplash.style.display = "none";
  } else {
  document.body.classList.add("splash-active");
  const reelTrack = document.getElementById("app-splash-grade-track");
  const prefersReducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const initialReelIndex = APP_SPLASH_DEBUG_ENABLED
    ? Math.max(0, APP_SPLASH_REEL_VALUES.indexOf(APP_SPLASH_DEBUG_CONFIG.grade))
    : (prefersReducedMotion ? (APP_SPLASH_REEL_VALUES.length - 1) : 0);
  if (reelTrack) {
    reelTrack.innerHTML = APP_SPLASH_REEL_RENDER_VALUES
      .map(v => `<span class="app-splash-grade-item">${renderSplashGradeValue(v)}</span>`)
      .join("");
    reelTrack.style.setProperty("--reel-max-index", String(APP_SPLASH_REEL_VALUES.length - 1));
    reelTrack.style.setProperty("--reel-index", String(initialReelIndex));
  }
  if (APP_SPLASH_DEBUG_ENABLED) {
    appSplash.classList.add("is-started");
    if (APP_SPLASH_DEBUG_CONFIG.phase !== "draw") {
      appSplash.classList.add("is-reel-running");
    }
    if (APP_SPLASH_DEBUG_CONFIG.phase === "done" || APP_SPLASH_DEBUG_CONFIG.phase === "ascend") {
      appSplash.classList.add("is-reel-done");
      prepareSharedLogoForHomeHandoff();
    }
    if (APP_SPLASH_DEBUG_CONFIG.phase === "ascend") {
      appSplash.classList.add("is-ascending");
    }
  } else if (prefersReducedMotion) {
    appSplash.classList.add("is-started", "is-reel-running", "is-reel-done", "is-ascending");
    prepareSharedLogoForHomeHandoff();
    appSplashTimelineDone = true;
  } else {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        appSplash.classList.add("is-started");
      });
    });
    appSplashStartTimer = setTimeout(() => {
      startAppSplashReel();
    }, APP_SPLASH_REEL_START_MS);
  }
  }
}

function startAppSplashReel() {
  if (!appSplash) return;
  const reelTrack = document.getElementById("app-splash-grade-track");
  if (!reelTrack) {
    appSplashTimelineDone = true;
    maybeHideAppSplash();
    return;
  }
  appSplash.classList.add("is-reel-running");
  let reelIndex = 0;

  const step = () => {
    if (reelIndex >= APP_SPLASH_REEL_VALUES.length - 1) {
      appSplash.classList.add("is-reel-done");
      prepareSharedLogoForHomeHandoff();
      scheduleAppSplashAscent();
      return;
    }
    const ms = APP_SPLASH_REEL_STEP_DURATIONS_MS[reelIndex] || 120;
    reelIndex += 1;
    reelTrack.style.transitionDuration = `${ms}ms`;
    reelTrack.style.setProperty("--reel-index", String(reelIndex));
    appSplashReelStepTimer = setTimeout(step, ms + APP_SPLASH_REEL_STEP_GAP_MS);
  };

  appSplashReelStepTimer = setTimeout(step, APP_SPLASH_REEL_BOOTSTRAP_MS);
}

function maybeHideAppSplash(opts = {}) {
  if (appSplashHidden) return;
  if (!appSplashAppReady || !appSplashTimelineDone) return;
  appSplashHidden = true;

  const prefersReducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const immediate = !!opts.immediate || prefersReducedMotion;
  const delay = immediate ? 0 : 120;
  const hideFadeMs = immediate ? 0 : APP_SPLASH_HIDE_FADE_MS;
  const homeLogoFadeInMs = (immediate || appSplashUsesSharedHomeLogo) ? 0 : APP_SPLASH_HOME_LOGO_FADE_IN_MS;

  const finalize = () => {
    if (!appSplash) {
      if (document.body) document.body.classList.remove("splash-active");
      return;
    }

    const body = document.body;
    const isHomeScreen = !!(body && body.classList.contains("is-home-screen"));

    if (appSplashReelStepTimer) {
      clearTimeout(appSplashReelStepTimer);
      appSplashReelStepTimer = null;
    }
    if (appSplashStartTimer) {
      clearTimeout(appSplashStartTimer);
      appSplashStartTimer = null;
    }
    if (appSplashAscentTimer) {
      clearTimeout(appSplashAscentTimer);
      appSplashAscentTimer = null;
    }
    if (appSplashTimelineDoneTimer) {
      clearTimeout(appSplashTimelineDoneTimer);
      appSplashTimelineDoneTimer = null;
    }
    if (appSplashFadeOutTimer) {
      clearTimeout(appSplashFadeOutTimer);
      appSplashFadeOutTimer = null;
    }
    if (appSplashHandoffTimer) {
      clearTimeout(appSplashHandoffTimer);
      appSplashHandoffTimer = null;
    }

    const hideSplashNow = () => {
      appSplash.classList.add("is-hidden");
      appSplash.setAttribute("aria-hidden", "true");
      if (appSplashUsesSharedHomeLogo) {
        if (hideFadeMs > 0) {
          const restoreDelayMs = Math.min(120, Math.max(24, Math.floor(hideFadeMs * 0.25)));
          setTimeout(() => {
            restoreSharedHomeLogoAfterSplash();
          }, restoreDelayMs);
        } else {
          restoreSharedHomeLogoAfterSplash();
        }
      }
      setTimeout(() => {
        appSplash.style.display = "none";
        const shouldTriggerHomeIntro = !!(
          document.body &&
          document.body.classList.contains("is-home-screen") &&
          mainMenu
        );
        if (shouldTriggerHomeIntro) {
          triggerHomeIntroAnimation();
        }
        if (document.body) {
          // Quitar esta clase en el siguiente tick evita un frame "sin estilo"
          // entre el logo de splash y el logo de home.
          setTimeout(() => {
            if (document.body) document.body.classList.remove("splash-shared-logo");
          }, 0);
        }
      }, hideFadeMs + 40);
      if (document.body) document.body.classList.remove("splash-active");
    };

    if (isHomeScreen && body) {
      if (!appSplashUsesSharedHomeLogo) {
        body.classList.add("splash-handoff");
        appSplashHandoffTimer = setTimeout(() => {
          if (document.body) document.body.classList.remove("splash-handoff");
          appSplashHandoffTimer = null;
        }, Math.max(APP_SPLASH_HANDOFF_FADE_MS, homeLogoFadeInMs + hideFadeMs + 120));
      }

      if (homeLogoFadeInMs > 0) {
        appSplashFadeOutTimer = setTimeout(() => {
          if (mainMenu) mainMenu.classList.add("home-logo-settled");
          hideSplashNow();
          appSplashFadeOutTimer = null;
        }, homeLogoFadeInMs);
      } else {
        if (mainMenu) mainMenu.classList.add("home-logo-settled");
        hideSplashNow();
      }
      return;
    }

    hideSplashNow();
  };

  if (appSplashHideTimer) clearTimeout(appSplashHideTimer);
  appSplashHideTimer = setTimeout(() => {
    appSplashHideTimer = null;
    finalize();
  }, delay);
}

function markAppReadyForSplashExit() {
  if (APP_SPLASH_DEBUG_ENABLED) return;
  appSplashAppReady = true;
  maybeHideAppSplash();
}

// =======================
// MODAL (alert/confirm integrados)
// =======================
const modalOverlay = document.getElementById("app-modal-overlay");
const modalTitle = document.getElementById("app-modal-title");
const modalMessage = document.getElementById("app-modal-message");
const modalActions = document.getElementById("app-modal-actions");

function showPauseExplanationOverlay(text) {
  const msg = String(text || "").trim();
  let box = document.getElementById("pause-explanation-overlay");
  if (!msg) {
    if (box) box.remove();
    return;
  }
  if (!box) {
    box = document.createElement("div");
    box.id = "pause-explanation-overlay";
  }
  if (modalOverlay) {
    const modal = modalOverlay.querySelector(".modal");
    if (box.parentElement !== modalOverlay) {
      if (modal) {
        modalOverlay.insertBefore(box, modal);
      } else {
        modalOverlay.appendChild(box);
      }
    } else if (modal && box.nextElementSibling !== modal) {
      modalOverlay.insertBefore(box, modal);
    }
  } else if (!box.parentElement) {
    document.body.appendChild(box);
  }
  box.textContent = msg;
  box.scrollTop = 0;
}

function hidePauseExplanationOverlay() {
  const box = document.getElementById("pause-explanation-overlay");
  if (box) box.remove();
}

function positionPauseExplanationOverlay() {
  const box = document.getElementById("pause-explanation-overlay");
  if (!box) return;
  if (modalOverlay && box.parentElement === modalOverlay) {
    const modal = modalOverlay.querySelector(".modal");
    const overlayRect = modalOverlay.getBoundingClientRect();
    const modalRect = modal ? modal.getBoundingClientRect() : null;
    const modalTop = modalRect ? modalRect.top : overlayRect.bottom;
    const available = Math.floor(modalTop - overlayRect.top - 16);
    box.style.maxHeight = `${Math.max(120, available)}px`;
    return;
  }
  const modal = modalOverlay ? modalOverlay.querySelector(".modal") : null;
  if (!modal) return;
  const modalRect = modal.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();
  const gapTop = Math.max(0, modalRect.top);
  const centeredTop = Math.max(12, Math.round((gapTop - boxRect.height) / 2));
  box.style.top = `${centeredTop}px`;
}

function openModal({ title, message, actions, titleAlign, actionsClassName, hideTitle = false, hideMessage = false }) {
  return new Promise(resolve => {
    if (!modalOverlay || !modalTitle || !modalMessage || !modalActions) {
      resolve(actions?.[0]?.value ?? null);
      return;
    }

    modalTitle.style.display = hideTitle ? "none" : "";
    modalMessage.style.display = hideMessage ? "none" : "";
    modalTitle.textContent = hideTitle ? "" : (title ?? "Aviso");
    modalTitle.style.textAlign = hideTitle ? "" : (titleAlign || "");
    modalMessage.textContent = hideMessage ? "" : (message || "");
    modalActions.innerHTML = "";
    modalActions.className = `row modal-actions${actionsClassName ? ` ${actionsClassName}` : ""}`;

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

const buttonPressTimers = new WeakMap();
const elementPressTimers = new WeakMap();
const HOME_PRESS_DELAY_MS = 150;
const HOME_EXPAND_MIN_MS = 170;
const HOME_EXPAND_MAX_MS = 620;
const HOME_EXPAND_MS_PER_PX = 1.1;

function clampNumber(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function calcProportionalExpandMs(fromPx, toPx) {
  const delta = Math.max(1, Math.abs((Number(toPx) || 0) - (Number(fromPx) || 0)));
  return clampNumber(Math.round(delta * HOME_EXPAND_MS_PER_PX), HOME_EXPAND_MIN_MS, HOME_EXPAND_MAX_MS);
}

function applyHomeExpandTiming(el, fromPx, toPx) {
  if (!(el instanceof HTMLElement)) return HOME_EXPAND_MIN_MS;
  const ms = calcProportionalExpandMs(fromPx, toPx);
  el.style.setProperty("--home-expand-duration", `${ms}ms`);
  return ms;
}

function scheduleHomeAction(fn) {
  if (homeActionTimer) clearTimeout(homeActionTimer);
  homeActionTimer = setTimeout(() => {
    homeActionTimer = null;
    fn();
  }, HOME_PRESS_DELAY_MS);
}
function flashElementPress(el) {
  if (!(el instanceof HTMLElement)) return;
  const prev = elementPressTimers.get(el);
  if (prev) clearTimeout(prev);
  el.classList.remove("panel-press-flash");
  void el.offsetWidth;
  el.classList.add("panel-press-flash");
  const timerId = setTimeout(() => {
    el.classList.remove("panel-press-flash");
    elementPressTimers.delete(el);
  }, HOME_PRESS_DELAY_MS);
  elementPressTimers.set(el, timerId);
}

function flashButtonPress(btn) {
  if (!(btn instanceof HTMLElement) || btn.disabled) return;
  const cs = getComputedStyle(btn);
  if (Number(cs.opacity) <= 0.01) return;
  const prev = buttonPressTimers.get(btn);
  if (prev) clearTimeout(prev);
  btn.classList.remove("btn-press-flash");
  // Reflow para reiniciar la animación si se pulsa repetidamente.
  void btn.offsetWidth;
  btn.classList.add("btn-press-flash");
  const timerId = setTimeout(() => {
    btn.classList.remove("btn-press-flash");
    buttonPressTimers.delete(btn);
  }, HOME_PRESS_DELAY_MS);
  buttonPressTimers.set(btn, timerId);

  if (btn.id === "btn-open-test-modal") {
    const homeStartPanel = document.getElementById("home-start-panel");
    flashElementPress(homeStartPanel);
  } else if (btn.id === "home-btn-quick") {
    const homeQuickRow = document.getElementById("home-quick-row");
    flashElementPress(homeQuickRow);
  } else if (btn.id === "home-btn-exam") {
    const homeExamRow = document.getElementById("home-exam-row");
    flashElementPress(homeExamRow);
  } else if (btn.id === "home-btn-clock") {
    const homeClockRow = document.getElementById("home-clock-row");
    flashElementPress(homeClockRow);
  } else if (btn.id === "home-btn-review") {
    const homeReviewRow = document.getElementById("home-review-row");
    flashElementPress(homeReviewRow);
  } else if (btn.id === "home-btn-voice") {
    const homeVoiceRow = document.getElementById("home-voice-row");
    flashElementPress(homeVoiceRow);
  }
}

function updateTestBottomScrollClearance() {
  if (!testContainer || !testBottom) return;
  const bottomHeight = Math.ceil(testBottom.getBoundingClientRect().height || testBottom.offsetHeight || 0);
  const minClearance = 340;
  const extraGapAboveAnswers = 22;
  const clearance = Math.max(minClearance, bottomHeight + extraGapAboveAnswers);
  testContainer.style.setProperty("--test-bottom-clearance", `${clearance}px`);
}

function scheduleTestBottomScrollClearanceUpdate() {
  if (testBottomResizeRaf) cancelAnimationFrame(testBottomResizeRaf);
  testBottomResizeRaf = requestAnimationFrame(() => {
    testBottomResizeRaf = null;
    updateTestBottomScrollClearance();
  });
}

function isMobileTestViewport() {
  return !!(window.matchMedia && window.matchMedia("(max-width: 700px)").matches);
}

function moveAnswersToBottomDock() {
  if (!testBottom || !answersContainer || !testActionsFixed) return;
  if (answersContainer.parentElement !== testBottom) {
    testBottom.insertBefore(answersContainer, testActionsFixed);
  }
  testBottom.classList.remove("answers-after-actions");
}

function moveAnswersToScrollArea() {
  if (!testContentScroll || !answersContainer || !testBottom) return;
  if (answersContainer.parentElement !== testContentScroll) {
    testContentScroll.appendChild(answersContainer);
  }
  testBottom.classList.add("answers-after-actions");
}

function updateTestAnswerDocking() {
  if (!testContainer || !questionText || !answersContainer) return;
  if (!isMobileTestViewport() || testContainer.style.display === "none") {
    moveAnswersToBottomDock();
    return;
  }
  if (!testActionsFixed || !testContentScroll || !testBottom) return;

  // Medimos con respuestas en su posición natural (encima de controles).
  moveAnswersToBottomDock();

  const hasExplanation = !!(
    answerExplanation &&
    answerExplanation.style.display !== "none" &&
    String(answerExplanation.textContent || "").trim()
  );
  const anchorEl = hasExplanation ? answerExplanation : questionText;
  const anchorBottom = anchorEl.getBoundingClientRect().bottom;
  const actionsTop = testActionsFixed.getBoundingClientRect().top;
  const answersHeight = Math.ceil(answersContainer.getBoundingClientRect().height || 0);
  const buffer = 12;
  const shouldPushBelowControls = (anchorBottom + answersHeight + buffer) > actionsTop;

  if (shouldPushBelowControls) {
    moveAnswersToScrollArea();
  }
}

function scheduleTestAnswerDockingUpdate() {
  if (testAnswerDockRaf) cancelAnimationFrame(testAnswerDockRaf);
  testAnswerDockRaf = requestAnimationFrame(() => {
    testAnswerDockRaf = null;
    updateTestAnswerDocking();
  });
}

function ensureTestBottomClearanceObserver() {
  if (!testBottom) return;
  if (typeof ResizeObserver === "function") {
    if (!testBottomResizeObserver) {
      testBottomResizeObserver = new ResizeObserver(() => {
        scheduleTestBottomScrollClearanceUpdate();
      });
    }
    testBottomResizeObserver.disconnect();
    testBottomResizeObserver.observe(testBottom);
  }
  scheduleTestBottomScrollClearanceUpdate();
  scheduleTestAnswerDockingUpdate();
}

document.addEventListener("pointerdown", e => {
  const btn = e.target instanceof Element ? e.target.closest("button") : null;
  if (btn) flashButtonPress(btn);
}, { passive: true });

document.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const btn = e.target instanceof Element ? e.target.closest("button") : null;
  if (btn) flashButtonPress(btn);
});

window.addEventListener("resize", () => {
  scheduleTestBottomScrollClearanceUpdate();
  scheduleTestAnswerDockingUpdate();
}, { passive: true });

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

function unlockBootingUiMask() {
  if (!document.body) return;
  document.body.classList.remove("app-booting");
}

function setUiScreenState(screen, extra = {}) {
  const payload = {
    screen: String(screen || "home"),
    savedAt: new Date().toISOString(),
    ...(extra && typeof extra === "object" ? extra : {})
  };
  uiLastScreenState = payload.screen;
  lsSetJSON(LS_UI_STATE, payload);
}

function getUiScreenState() {
  const raw = lsGetJSON(LS_UI_STATE, null);
  if (!raw || typeof raw !== "object") return null;
  const screen = String(raw.screen || "").trim();
  if (!screen) return null;
  uiLastScreenState = screen;
  return { ...raw, screen };
}

function resolveImportBackTarget(handler) {
  if (handler === showQuestionBank) return "bank";
  if (handler === showConfigScreen) return "config";
  if (handler === showVoiceSettingsScreen) return "voice-settings";
  return "home";
}

function resolveImportBackHandler(target) {
  switch (String(target || "").trim()) {
    case "bank": return showQuestionBank;
    case "config": return showConfigScreen;
    case "voice-settings": return showVoiceSettingsScreen;
    default: return showMainMenu;
  }
}

function detectCurrentUiScreen() {
  if (isElementShown(testContainer)) return "test";
  if (isElementShown(resultsContainer)) return "results";
  if (isElementShown(reviewContainer)) return "review";
  if (isElementShown(statsContainer)) return "stats";
  if (isElementShown(importContainer)) return "import";
  if (isElementShown(voiceSettingsContainer)) return "voice-settings";
  if (isElementShown(configContainer)) return "config";
  if (isElementShown(testMenu)) {
    if (mode === "bank") return "bank";
    if (mode === "trash") return "trash";
    if (TEST_MENU_DETAIL_SCREENS.has(uiLastScreenState)) return uiLastScreenState;
    return "test-menu";
  }
  if (isElementShown(mainMenu)) return "home";
  return "home";
}

function persistUiStateForReload() {
  const screen = detectCurrentUiScreen();
  if (screen === "import") {
    setUiScreenState("import", {
      mode: importScreenMode === "manual" ? "manual" : "batch",
      backTarget: resolveImportBackTarget(importBackHandler)
    });
  } else {
    setUiScreenState(screen);
  }

  if (screen === "test") {
    const payload = buildPausedTestPayload();
    if (payload) lsSetJSON(LS_ACTIVE_PAUSED_TEST, payload);
  }
}

async function restoreUiScreenAfterBootstrap() {
  if (APP_HOME_DEBUG_FREEZE) {
    showMainMenu();
    return;
  }

  const state = getUiScreenState();
  if (!state) {
    showMainMenu();
    return;
  }

  switch (state.screen) {
    case "home":
      showMainMenu();
      return;
    case "config":
      showConfigScreen();
      return;
    case "voice-settings":
      showVoiceSettingsScreen();
      return;
    case "stats":
      showStatsScreen();
      return;
    case "bank":
      showQuestionBank();
      return;
    case "trash":
      showTrashScreen();
      return;
    case "tema-selection":
      showTemaSelectionScreen();
      return;
    case "exam-menu":
      showExamMenu();
      return;
    case "exam-block-select":
      showExamByBlockSelect();
      return;
    case "test-menu":
      showTemaSelectionScreen();
      return;
    case "results":
      showResultsScreen();
      return;
    case "review":
      showReviewScreen();
      return;
    case "import": {
      const modeValue = state.mode === "manual" ? "manual" : "batch";
      const backHandler = resolveImportBackHandler(state.backTarget);
      showImportScreen(modeValue, backHandler);
      return;
    }
    case "test": {
      const saved = lsGetJSON(LS_ACTIVE_PAUSED_TEST, null);
      if (saved) {
        await resumePausedTest();
        return;
      }
      showMainMenu();
      return;
    }
    default:
      showMainMenu();
  }
}

window.addEventListener("pagehide", persistUiStateForReload);
window.addEventListener("beforeunload", persistUiStateForReload);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persistUiStateForReload();
});

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
let ttsSpeakSeq = 0;
let ttsActiveMeta = null;
let ttsPausedResume = null;

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
let lastMotivationalPhrase = "";
let motivationalFadeTimer = null;
const MOTIVATIONAL_MAX_LINE_CHARS = 36;
const MOTIVATIONAL_SPLIT_WINDOW = 14;

function findMotivationalMiddlePunctuationIndex(text) {
  const punctuationIndexes = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "," || ch === "." || ch === ":") punctuationIndexes.push(i);
  }
  if (!punctuationIndexes.length) return -1;

  const minMiddle = Math.floor(text.length * 0.2);
  const maxMiddle = Math.ceil(text.length * 0.8);
  const middleCandidates = punctuationIndexes.filter(idx => idx >= minMiddle && idx <= maxMiddle);
  const candidates = middleCandidates.length
    ? middleCandidates
    : punctuationIndexes.filter(idx => idx > 0 && idx < text.length - 1);
  if (!candidates.length) return -1;

  const middle = (text.length - 1) / 2;
  let bestIdx = candidates[0];
  let bestDistance = Math.abs(bestIdx - middle);

  for (let i = 1; i < candidates.length; i += 1) {
    const distance = Math.abs(candidates[i] - middle);
    if (distance < bestDistance) {
      bestIdx = candidates[i];
      bestDistance = distance;
    }
  }
  return bestIdx;
}

function splitMotivationalLine(line, maxChars = MOTIVATIONAL_MAX_LINE_CHARS) {
  const normalized = String(line || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const target = Math.floor(normalized.length / 2);
  const minSearch = Math.max(1, target - MOTIVATIONAL_SPLIT_WINDOW);
  const maxSearch = Math.min(normalized.length - 1, target + MOTIVATIONAL_SPLIT_WINDOW);
  let splitAt = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let idx = minSearch; idx <= maxSearch; idx += 1) {
    if (normalized[idx] !== " ") continue;
    const distance = Math.abs(idx - target);
    if (distance < bestDistance) {
      splitAt = idx;
      bestDistance = distance;
    }
  }
  if (splitAt === -1) splitAt = target;

  const left = normalized.slice(0, splitAt).trim();
  const right = normalized.slice(splitAt).trim();
  const chunks = [];
  if (left) chunks.push(...splitMotivationalLine(left, maxChars));
  if (right) chunks.push(...splitMotivationalLine(right, maxChars));
  return chunks;
}

function formatMotivationalPhrase(phrase) {
  const normalized = String(phrase || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const punctuationIdx = findMotivationalMiddlePunctuationIndex(normalized);
  if (punctuationIdx === -1) return splitMotivationalLine(normalized).join("\n");

  const left = normalized.slice(0, punctuationIdx + 1).trim();
  const right = normalized.slice(punctuationIdx + 1).trim();
  const lines = [];
  lines.push(...splitMotivationalLine(left));
  if (right) lines.push(...splitMotivationalLine(right));
  return lines.join("\n");
}

function getRandomMotivationalPhrase(excludePhrase = "") {
  const list = motivationalPhrases && motivationalPhrases.length ? motivationalPhrases : MOTIVATIONAL_FALLBACK;
  if (!list.length) return "";
  if (list.length === 1) return list[0];

  const excluded = String(excludePhrase || "").trim();
  const candidates = excluded ? list.filter(item => item !== excluded) : list;
  const pool = candidates.length ? candidates : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

function renderMotivationalPhrase(forceDifferent = false, animated = false) {
  if (!motivationalPhraseEl) return;

  const setNextPhrase = () => {
    const nextPhrase = forceDifferent
      ? getRandomMotivationalPhrase(lastMotivationalPhrase)
      : getRandomMotivationalPhrase();
    lastMotivationalPhrase = nextPhrase;
    motivationalPhraseEl.textContent = formatMotivationalPhrase(nextPhrase);
  };

  if (!animated) {
    if (motivationalFadeTimer) {
      clearTimeout(motivationalFadeTimer);
      motivationalFadeTimer = null;
    }
    motivationalPhraseEl.classList.remove("is-fading-out");
    setNextPhrase();
    return;
  }

  if (motivationalFadeTimer) clearTimeout(motivationalFadeTimer);
  motivationalPhraseEl.classList.add("is-fading-out");

  motivationalFadeTimer = setTimeout(() => {
    setNextPhrase();
    motivationalPhraseEl.classList.remove("is-fading-out");
    motivationalFadeTimer = null;
  }, 170);
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
  const preferredNames = ["mónica", "monica", "google español", "siri"];
  const byName = voices.filter(v => {
    const n = String(v.name || "").toLowerCase();
    return preferredNames.some(p => n.includes(p));
  });
  if (byName.length) return byName[0];
  const esVoices = voices.filter(v => String(v.lang || "").toLowerCase().startsWith("es"));
  if (esVoices.length) {
    const esES = esVoices.find(v => String(v.lang || "").toLowerCase() === "es-es");
    return esES || esVoices[0];
  }
  return voices[0];
}

function ttsPopulateVoiceButtons() {
  const targets = [ttsVoiceList, document.getElementById("home-tts-voice-list")]
    .filter((el, idx, arr) => !!el && arr.indexOf(el) === idx);
  if (!targets.length) return;

  targets.forEach(el => { el.innerHTML = ""; });

  const normalizeName = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const esVoices = ttsVoices.filter(v => String(v.lang || "").toLowerCase().startsWith("es"));

  if (!esVoices.length) {
    targets.forEach(target => {
      const msg = document.createElement("div");
      msg.className = "small";
      msg.textContent = "No hay voces en español disponibles en este dispositivo.";
      target.appendChild(msg);
    });
    return;
  }

  const monicaVoice =
    esVoices.find(v => normalizeName(v.name).includes("monica")) ||
    esVoices[0];

  const googleNamedVoice = esVoices.find(v => {
    const n = normalizeName(v.name);
    return n.includes("google") && (n.includes("espanol") || n.includes("spanish"));
  });
  const googleVoice =
    (googleNamedVoice && googleNamedVoice.voiceURI !== monicaVoice.voiceURI)
      ? googleNamedVoice
      : (esVoices.find(v => v.voiceURI !== monicaVoice.voiceURI) || null);

  const entries = [
    { label: "Mónica", voice: monicaVoice, enabled: !!monicaVoice },
    { label: "Google español", voice: googleVoice, enabled: !!googleVoice }
  ];

  // Añadir voces Siri en español cuando existan (sin duplicar voiceURI)
  const fixedVoiceUris = new Set(entries.filter(e => e.enabled).map(e => e.voice.voiceURI));
  const siriEsVoices = esVoices.filter(v => normalizeName(v.name).includes("siri"));
  siriEsVoices.forEach(v => {
    if (fixedVoiceUris.has(v.voiceURI)) return;
    entries.push({ label: v.name || "Siri (español)", voice: v, enabled: true });
    fixedVoiceUris.add(v.voiceURI);
  });

  const selectableVoices = entries.filter(e => e.enabled).map(e => e.voice);
  if (!ttsSettings.voiceURI || !selectableVoices.find(v => v.voiceURI === ttsSettings.voiceURI)) {
    ttsSettings.voiceURI = selectableVoices[0].voiceURI;
    ttsSaveSettings();
  }

  targets.forEach(target => {
    const isHomeVoiceListTarget = target.id === "home-tts-voice-list";
    entries.forEach(entry => {
      const btn = document.createElement("button");
      btn.type = "button";
      const isSelected = entry.enabled && ttsSettings.voiceURI === entry.voice.voiceURI;
      btn.className = isSelected ? "success" : "secondary";
      if (isHomeVoiceListTarget) btn.classList.add("home-voice-choice");
      btn.textContent = entry.label;
      if (!entry.enabled) {
        btn.disabled = true;
        btn.title = "No disponible en este dispositivo";
      } else if (entry.voice?.name) {
        btn.title = entry.voice.name;
      }
      btn.onclick = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (!entry.enabled) return;
        ttsUserInteracted = true;
        ttsSettings.voiceURI = entry.voice.voiceURI;
        ttsSaveSettings();
        ttsPopulateVoiceButtons();
        ttsSpeakPreview(getRandomMotivationalPhrase(), entry.voice.voiceURI);
      };
      target.appendChild(btn);
    });
  });
}

function ttsApplyUIState() {
  const supported = "speechSynthesis" in window;
  if (ttsRateRange) ttsRateRange.value = String(ttsSettings.rate || 1);
  if (ttsPitchRange) ttsPitchRange.value = String(ttsSettings.pitch || 1);
  const homeTtsRate = document.getElementById("home-tts-rate");
  const homeTtsPitch = document.getElementById("home-tts-pitch");
  if (homeTtsRate) {
    homeTtsRate.value = String(ttsSettings.rate || 1);
    homeTtsRate.disabled = !supported;
  }
  if (homeTtsPitch) {
    homeTtsPitch.value = String(ttsSettings.pitch || 1);
    homeTtsPitch.disabled = !supported;
  }

  if (ttsReadBtn) {
    ttsReadBtn.disabled = !supported;
    ttsReadBtn.classList.toggle("tts-active", !!ttsSettings.enabled);
  }
  ttsRefreshReadButtonLabel();
}

function ttsRefreshReadButtonLabel() {
  if (!ttsReadBtn) return;
  ttsReadBtn.innerHTML = `<span class="tts-read-icon" aria-hidden="true">🔊</span>`;
}

function ttsSpeak(text, opts = {}) {
  if (!("speechSynthesis" in window)) return;
  if (!ttsSettings.enabled) return;
  if (!text) return;

  ttsSpeakSeq += 1;
  const seq = ttsSpeakSeq;
  const meta = opts && opts.meta && typeof opts.meta === "object" ? opts.meta : null;

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

  utter.onstart = () => {
    ttsActiveMeta = {
      seq,
      active: true,
      finished: false,
      type: typeof meta?.type === "string" ? meta.type : "generic",
      questionId: typeof meta?.questionId === "string" ? meta.questionId : null,
      questionTextLength: typeof meta?.questionText === "string" ? meta.questionText.length : 0,
      hasOptions: typeof meta?.optionsText === "string" ? meta.optionsText.length > 0 : false,
      totalTextLength: String(text).length,
      lastBoundary: 0
    };
    ttsRefreshReadButtonLabel();
  };
  utter.onboundary = e => {
    if (!ttsActiveMeta || ttsActiveMeta.seq !== seq) return;
    if (typeof e.charIndex === "number" && e.charIndex >= 0) {
      ttsActiveMeta.lastBoundary = e.charIndex;
    }
  };
  utter.onend = () => {
    if (ttsActiveMeta && ttsActiveMeta.seq === seq) {
      ttsActiveMeta.active = false;
      ttsActiveMeta.finished = true;
    }
    ttsRefreshReadButtonLabel();
  };
  utter.onerror = () => {
    if (ttsActiveMeta && ttsActiveMeta.seq === seq) {
      ttsActiveMeta.active = false;
      ttsActiveMeta.finished = false;
    }
    ttsRefreshReadButtonLabel();
  };

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
  if (ttsActiveMeta) ttsActiveMeta.active = false;
  ttsRefreshReadButtonLabel();
}

function ttsEnsureSentence(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (/[.!?…]$/.test(normalized)) return normalized;
  return `${normalized}.`;
}

function ttsBuildOptionsText(options) {
  const letters = ["A", "B", "C", "D"];
  return (options || [])
    .filter(opt => String(opt || "").trim())
    .map((opt, i) => `${letters[i] || String(i + 1)}. ${ttsEnsureSentence(opt)}`)
    .join(" ");
}

function ttsPrepareResumeFromPause() {
  ttsPausedResume = null;
  const state = ttsActiveMeta;
  if (!state || !state.active) return;

  const q = currentTest[currentIndex];
  if (!q) return;
  const currentQuestionId = String(q.id);
  if (state.questionId !== currentQuestionId) return;

  let part = null;
  if (state.type === "questionOnly") {
    part = "question";
  } else if (state.type === "optionsOnly") {
    part = "options";
  } else if (state.type === "question") {
    const boundary = Math.max(0, Number(state.lastBoundary) || 0);
    if (boundary < state.questionTextLength) part = "question";
    else if (state.hasOptions) part = "options";
  }

  if (!part) return;
  ttsPausedResume = { questionId: currentQuestionId, part };
}

function ttsResumeAfterPauseIfNeeded() {
  const resume = ttsPausedResume;
  ttsPausedResume = null;
  if (!resume || !ttsSettings.enabled) return;

  const q = currentTest[currentIndex];
  if (!q || String(q.id) !== resume.questionId) return;

  if (resume.part === "question") {
    ttsSpeakOnlyQuestion(q);
    return;
  }
  if (resume.part === "options") {
    ttsSpeakOnlyOptions(q);
  }
}

function ttsSpeakQuestion(q, index, total) {
  if (!q) return;
  const options = currentShuffledOptions && currentShuffledOptions.length
    ? currentShuffledOptions
    : (q.opciones || []);
  const optionsText = ttsBuildOptionsText(options);
  const questionText = ttsEnsureSentence(q.pregunta);
  const text = optionsText ? `${questionText} ${optionsText}` : questionText;
  ttsSpeak(text, {
    meta: {
      type: "question",
      questionId: String(q.id),
      questionText,
      optionsText
    }
  });
}

function ttsSpeakOnlyQuestion(q, index, total) {
  if (!q) return;
  const text = ttsEnsureSentence(q.pregunta);
  ttsSpeak(text, {
    meta: {
      type: "questionOnly",
      questionId: String(q.id),
      questionText: text,
      optionsText: ""
    }
  });
}

function ttsSpeakOnlyOptions(q) {
  if (!q) return;
  const options = currentShuffledOptions && currentShuffledOptions.length
    ? currentShuffledOptions
    : (q.opciones || []);
  const text = ttsBuildOptionsText(options);
  ttsSpeak(text, {
    meta: {
      type: "optionsOnly",
      questionId: String(q.id),
      questionText: "",
      optionsText: text
    }
  });
}

function ttsMaybeAutoRead(q) {
  if (!ttsSettings.enabled) return;
  if (viewState !== "question") return;
  if (!q) return;
  const idStr = String(q.id);
  if (ttsLastQuestionId === idStr) return;
  ttsLastQuestionId = idStr;
  ttsSpeakQuestion(q, currentIndex + 1, currentTest.length);
}

function ttsBindUI() {
  if (ttsRateRange) {
    ttsRateRange.oninput = () => {
      ttsUserInteracted = true;
      ttsSettings.rate = Number(ttsRateRange.value) || 1;
      ttsSaveSettings();
      ttsApplyUIState();
    };
  }

  if (ttsPitchRange) {
    ttsPitchRange.oninput = () => {
      ttsUserInteracted = true;
      ttsSettings.pitch = Number(ttsPitchRange.value) || 1;
      ttsSaveSettings();
      ttsApplyUIState();
    };
  }

  if (ttsReadBtn) {
    ttsReadBtn.onclick = () => {
      ttsUserInteracted = true;
      const supported = "speechSynthesis" in window;
      if (!supported) return;
      if (!ttsSettings.enabled) {
        ttsSettings.enabled = true;
        ttsSaveSettings();
        ttsApplyUIState();
        const q = currentTest[currentIndex];
        ttsSpeakQuestion(q, currentIndex + 1, currentTest.length);
        return;
      }
      ttsSettings.enabled = false;
      ttsStop();
      ttsSaveSettings();
      ttsApplyUIState();
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

function formatSpeedTime(sec) {
  const safe = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(safe / 60);
  const s = String(safe % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function formatTimerDisplay() {
  if (isOvertime) return `+${formatTime(overtimeSeconds)}`;
  return formatTime(timeRemaining);
}

function isClockModeValue(modeValue = mode) {
  return /^clock-(1|5)m$/.test(String(modeValue || ""));
}

function isSurvivalModeValue(modeValue = mode) {
  return String(modeValue || "") === "survival";
}

function isArcadeModeValue(modeValue = mode) {
  return isClockModeValue(modeValue) || isSurvivalModeValue(modeValue);
}

function isRepeatSessionValue(opts = sessionOpts) {
  return !!(opts && typeof opts === "object" && opts.meta && opts.meta.isRepeatSession === true);
}

function isStatsEligibleHistoryEntry(entry) {
  return !!(entry && entry.finished !== false && !isArcadeModeValue(entry.mode));
}

function normalizeForMatch(str) {
  let s = String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/c\s*\+\s*\+/g, "cplusplus");
  s = s.replace(/c\s*#/g, "csharp");
  return s;
}

function hasCombinedAnswerOptions(options) {
  const list = Array.isArray(options) ? options : [];
  const riskyPatterns = [
    // Referencias a "anteriores/superiores/previas"
    /\btodas?\s+las?\s+anteriores\b/,
    /\btodos?\s+los?\s+anteriores\b/,
    /\btodo\s+lo\s+anterior\b/,
    /\blas?\s+dos\s+anteriores\b/,
    /\bninguna\s+anterior\b/,
    /\bningun[oa]\s+anterior\b/,
    /\bninguna\s+de\s+las?\s+anteriores\b/,
    /\bninguno\s+de\s+los?\s+anteriores\b/,
    /\bningun[oa]\s+de\s+lo\s+anterior\b/,
    /\btodas?\s+las?\s+(opciones|respuestas|alternativas)\s+anteriores\b/,
    /\bningun[oa]\s+de\s+las?\s+(opciones|respuestas|alternativas)\s+anteriores\b/,
    /\b(anteriores?|precedentes?|previas?|superiores?)\b/,

    // Formulaciones tipo "ambas/ninguna/todas son ..."
    /\bambas?\s+son\b/,
    /\bson\s+ambas?\b/,
    /\bninguna\s+es\b/,
    /\bninguno\s+es\b/,
    /\btodas?\s+son\b/,
    /\btodas?\s+las?\s+respuestas?\s+son\b/,
    /\bninguna\s+de\s+las?\s+(otras?\s+)?respuestas?\b/,
    /\bninguna\s+respuesta\s+es\b/,
    /\blas?\s+anteriores?\s+son\b/,

    // Referencias a posiciones ("la primera", etc.) que dependen del orden
    /\b(opcion|opciones|respuesta|respuestas|alternativa|alternativas)\s+(primera|segunda|tercera|cuarta)\b/,
    /\bla\s+(primera|segunda|tercera|cuarta)\b/,
    /\blas?\s+(primera|segunda|tercera|cuarta)\s+y\s+las?\s+(primera|segunda|tercera|cuarta)\b/,

    // Referencias explícitas por letra
    /\b(respuesta|respuestas|opcion|opciones)\s*[abcd](\s*(y|e|,|\/|&)\s*[abcd])+/,
    /\b(la\s+)?[a-d]\s*(y|e|,|\/|&)\s*(la\s+)?[a-d]\b/,
    /\b[a-d]\s*,\s*[a-d]\s*(y|e|,|\/|&)\s*[a-d]\b/,
    /\b(la|respuesta|opcion)\s*[a-d]\s*(es|son)\b/,
    /\b(es|son)\s+la?\s*[a-d]\b/
  ];

  for (const opt of list) {
    let s = normalizeForMatch(opt);
    if (!s) continue;
    // A) / B. / C: -> A B C para detectar combinaciones por letra
    s = s.replace(/\b([a-d])\s*[\)\.\:]/g, "$1 ");
    if (riskyPatterns.some(re => re.test(s))) return true;
  }
  return false;
}

function updateTimerStyle() {
  if (!timerDisplay) return;
  timerDisplay.classList.remove("timer-warn", "timer-danger", "timer-blink");

  const total = Math.max(0, sessionOpts?.timeSeconds || 0);
  if (!total) return;

  if (isOvertime) {
    timerDisplay.classList.add("timer-danger");
    return;
  }

  const elapsed = total - Math.max(0, timeRemaining);
  const pct = (elapsed / total) * 100;

  if (pct >= 95) {
    timerDisplay.classList.add("timer-danger", "timer-blink");
  } else if (pct >= 90) {
    timerDisplay.classList.add("timer-danger");
  } else if (pct >= 70) {
    timerDisplay.classList.add("timer-warn");
  }
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

function format1Comma(n) {
  return Number(n || 0).toFixed(1).replace(".", ",");
}

function getLocalDaySerial(dateObj) {
  if (!(dateObj instanceof Date) || isNaN(dateObj)) return null;
  return Math.floor(
    Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()) / 86400000
  );
}

function getDebugHomeStreakOverrideDays() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const raw = params.get("debug_streak_days");
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  } catch {
    return null;
  }
}

function buildHomeLastTestInfo(entries) {
  const debugStreak = getDebugHomeStreakOverrideDays();
  if (debugStreak !== null) {
    return {
      displayText: `Racha: ${debugStreak} ${debugStreak === 1 ? "día" : "días"}`,
      subText: "Simulación",
      isStreak: debugStreak > 0,
      streakDays: debugStreak,
      daysAgo: 0
    };
  }

  const rows = asArray(entries)
    .filter(e => e && e.finished !== false)
    .filter(e => ((Number(e?.correct) || 0) + (Number(e?.wrong) || 0) + (Number(e?.noSe) || 0)) > 0)
    .map(e => {
      const d = new Date(e.date);
      const serial = getLocalDaySerial(d);
      if (!d || isNaN(d) || serial === null) return null;
      return { ts: d.getTime(), day: serial };
    })
    .filter(Boolean);

  if (!rows.length) {
    return {
      displayText: "Racha: 0 días",
      subText: "Sin tests finalizados",
      isStreak: false,
      streakDays: 0,
      daysAgo: null
    };
  }

  const last = rows.reduce((best, cur) => (cur.ts > best.ts ? cur : best), rows[0]);
  const todaySerial = getLocalDaySerial(new Date());
  const daysAgo = Math.max(0, Number(todaySerial) - Number(last.day));

  const daySet = new Set(rows.map(r => r.day));
  let streak = 0;
  if (daySet.has(todaySerial)) {
    for (let d = todaySerial; daySet.has(d); d -= 1) streak += 1;
  }

  if (streak > 0) {
    return {
      displayText: `Racha: ${streak} ${streak === 1 ? "día" : "días"}`,
      subText: "",
      isStreak: true,
      streakDays: streak,
      daysAgo
    };
  }

  return {
    displayText: "Racha: 0 días",
    subText: `Último test hace ${daysAgo} ${daysAgo === 1 ? "día" : "días"}`,
    isStreak: false,
    streakDays: 0,
    daysAgo
  };
}

function buildHomeStreakCardHtml(info) {
  const streakDays = Math.max(0, Number(info?.streakDays) || 0);
  const onCount = Math.min(7, streakDays);
  const isMaxStreak = streakDays >= 7;
  const flames = Array.from({ length: 7 }, (_, i) => {
    const cls = i < onCount ? "is-on" : "is-off";
    return `<span class="streak-flame ${cls}" aria-hidden="true">🔥</span>`;
  }).join("");
  const subText = String(info?.subText || "").trim();
  return `
    <div class="streak-main ${isMaxStreak ? "is-max-streak" : ""}">
      <div class="streak-texts">
        <div class="streak-text">${escapeHtml(String(info?.displayText || "Racha: 0 días"))}</div>
        ${subText ? `<div class="streak-subtext">${escapeHtml(subText)}</div>` : ""}
      </div>
      <div class="streak-flames" aria-label="Racha de 7 días">${flames}</div>
    </div>
  `;
}

function getClockBest(modeKey) {
  const rows = asArray(lsGetJSON(LS_HISTORY, []))
    .filter(e => e && e.finished !== false)
    .filter(e => String(e.mode || "") === String(modeKey || ""));
  let best = 0;
  for (const e of rows) {
    const c = Number(e?.correct) || 0;
    if (c > best) best = c;
  }
  return best;
}

function getAppVersion() {
  return String(window.APP_VERSION || "").trim();
}

function renderAppVersionBadge() {
  if (!appVersionBadgeEl) return;
  const version = getAppVersion();
  appVersionBadgeEl.textContent = version ? `v${version}` : "";
}

function bumpVersion(type) {
  const version = getAppVersion();
  const parts = version.split(".").map(v => Number(v));
  if (parts.length !== 3 || parts.some(v => !Number.isInteger(v) || v < 0)) {
    throw new Error("APP_VERSION inválida");
  }
  let [major, minor, patch] = parts;
  if (type === "patch") {
    patch += 1;
  } else if (type === "minor") {
    minor += 1;
    patch = 0;
  } else if (type === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else {
    throw new Error("Tipo de incremento inválido");
  }
  const next = `${major}.${minor}.${patch}`;
  window.APP_VERSION = next;
  renderAppVersionBadge();
  return next;
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
  const done = getPendingDoneSet();
  pending.add(normalizeId(id));
  done.delete(normalizeId(id));
  setPendingReviewSet(pending);
  setPendingDoneSet(done);
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
  const extra = loadExtraQuestions();
  const baseIdSet = new Set(
    (Array.isArray(questionsBase) ? questionsBase : []).map(q => String(q.id))
  );
  // "Añadidas" solo cuenta preguntas nuevas (ID no existente en base).
  const addedCount = extra.reduce((acc, q) => {
    return acc + (baseIdSet.has(String(q?.id)) ? 0 : 1);
  }, 0);

  if (addedCount > 0) {
    dbCountPill.textContent =
      `Preguntas en el banco: ${questions.length} ` +
      `(base ${questionsBase.length} + añadidas ${addedCount})`;
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
  unlockBootingUiMask();
  closeHomeStartPanel();
  closeHomeConfigPanel();
  closeHomeVoicePanel();
  if (mainMenu) mainMenu.classList.remove("home-no-intro");
  document.body.classList.remove("is-home-screen");
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

function isElementShown(el) {
  if (!el) return false;
  const cs = window.getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden";
}

function ensureHomeStarsLayer() {
  if (!mainMenu) return;
  let stars = mainMenu.querySelector(".stars");
  if (!stars) {
    stars = document.createElement("div");
    stars.className = "stars";
    stars.setAttribute("aria-hidden", "true");
    mainMenu.insertBefore(stars, mainMenu.firstChild);
  }
}

function triggerHomeIntroAnimation() {
  if (!mainMenu) return;
  const keepLogoContinuity = appSplashPendingHomeLogoContinuity;
  const skipIntroNow = !!appSkipNextHomeIntroAnimation;
  if (skipIntroNow) appSkipNextHomeIntroAnimation = false;
  if (keepLogoContinuity) {
    mainMenu.classList.add("home-logo-continuity");
    appSplashPendingHomeLogoContinuity = false;
  }
  if (APP_HOME_DEBUG_FREEZE) {
    if (document.body) document.body.classList.add("home-debug-freeze");
    if (document.body) {
      document.body.classList.toggle("home-debug-logo-only", APP_HOME_DEBUG_MODE === "logo");
    }
    mainMenu.classList.add("home-loaded", "home-static");
    return;
  }
  if (skipIntroNow) {
    mainMenu.classList.add("home-no-intro");
    mainMenu.classList.add("home-loaded");
    if (keepLogoContinuity) {
      mainMenu.classList.remove("home-logo-continuity");
    }
    return;
  }
  mainMenu.classList.remove("home-loaded");
  // Fuerza reflow para reiniciar animaciones CSS de entrada en Safari/iOS.
  void mainMenu.offsetWidth;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      mainMenu.classList.add("home-loaded");
      if (keepLogoContinuity) {
        setTimeout(() => {
          if (mainMenu) mainMenu.classList.remove("home-logo-continuity");
        }, 1300);
      }
    });
  });
}

function getHomeReviewPreset(totalPending) {
  const total = Math.max(0, Number(totalPending) || 0);
  if (total < 10) return { counts: [] };
  if (total < 20) return { counts: [10] };
  if (total < 50) return { counts: [10, 20] };
  if (total < 100) return { counts: [10, 20, 50] };
  return { counts: [10, 20, 50, 100] };
}

function getAvailableExamBlocks() {
  const bloques = [...new Set((questions || []).map(q => q.bloque || "Sin bloque"))];
  const blockNumber = (name) => {
    const m = String(name || "").match(/bloque\s*(\d+)/i);
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
  };
  return bloques.sort((a, b) => {
    const na = blockNumber(a);
    const nb = blockNumber(b);
    if (na !== nb) return na - nb;
    return String(a).localeCompare(String(b), "es", { sensitivity: "base" });
  });
}

function splitBloqueInfo(rawBloque) {
  const text = String(rawBloque || "").trim();
  const m = text.match(/^Bloque\s*(\d+)\.?\s*(.*)$/i) || text.match(/^(\d+)\.?\s*(.*)$/);
  if (m) {
    return {
      number: String(m[1] || "").trim(),
      name: String(m[2] || "").trim()
    };
  }
  return { number: "", name: text };
}

function splitTemaInfo(rawTema) {
  const text = String(rawTema || "").trim();
  const m = text.match(/^(\d{1,3})\s*\.\s*(.*)$/);
  if (m) {
    return {
      number: String(m[1] || "").trim(),
      name: String(m[2] || "").trim()
    };
  }
  return { number: "", name: text };
}

function buildExplanationText(q) {
  const bloqueInfo = splitBloqueInfo(q?.bloque);
  const temaInfo = splitTemaInfo(q?.tema);

  const bloqueLine = bloqueInfo.number
    ? `Bloque ${bloqueInfo.number}: ${bloqueInfo.name || "Sin nombre"}`
    : `Bloque: ${bloqueInfo.name || "Sin bloque"}`;
  const temaLine = temaInfo.number
    ? `Tema ${temaInfo.number}: ${temaInfo.name || "Sin nombre"}`
    : `Tema: ${temaInfo.name || "Sin tema"}`;

  const exp = String(q?.explicacion || "").trim();
  return `${bloqueLine}\n${temaLine}${exp ? `\n\n${exp}` : ""}`;
}

function openHomeStartPanel() {
  if (homeStartCloseTimer) {
    clearTimeout(homeStartCloseTimer);
    homeStartCloseTimer = null;
  }
  if (homeConfigOpenTimer) {
    clearTimeout(homeConfigOpenTimer);
    homeConfigOpenTimer = null;
  }
  closeHomeConfigPanel();
  closeHomeQuickPanel();
  closeHomeExamPanel();
  closeHomeClockPanel();
  closeHomeReviewPanel();
  const row = document.getElementById("main-primary-row");
  const panel = document.getElementById("home-start-panel");
  if (!row || !panel) return;
  row.classList.remove("is-start-closing");
  const fromPx = 56;
  const toPx = Math.max(fromPx, panel.scrollHeight + 56);
  applyHomeExpandTiming(row, fromPx, toPx);
  applyHomeExpandTiming(panel, fromPx, toPx);
  panel.style.setProperty("--home-panel-open-height", `${toPx}px`);
  row.classList.add("is-start-open");
  panel.setAttribute("aria-hidden", "false");
}

function closeHomeStartPanel() {
  if (homeStartCloseTimer) {
    clearTimeout(homeStartCloseTimer);
    homeStartCloseTimer = null;
  }
  closeHomeQuickPanel();
  closeHomeExamPanel();
  closeHomeClockPanel();
  closeHomeReviewPanel();
  const row = document.getElementById("main-primary-row");
  const panel = document.getElementById("home-start-panel");
  if (!row || !panel) return;
  row.classList.add("is-start-closing");
  const fromPx = Math.max(56, panel.scrollHeight + 56);
  const toPx = 56;
  applyHomeExpandTiming(row, fromPx, toPx);
  applyHomeExpandTiming(panel, fromPx, toPx);
  row.classList.remove("is-start-open");
  panel.setAttribute("aria-hidden", "true");
  homeStartCloseTimer = setTimeout(() => {
    row.classList.remove("is-start-closing");
    homeStartCloseTimer = null;
  }, 340);
}

function openHomeQuickPanel() {
  closeHomeExamPanel();
  closeHomeClockPanel();
  closeHomeReviewPanel();
  const mainRow = document.getElementById("main-primary-row");
  const row = document.getElementById("home-quick-row");
  const panel = document.getElementById("home-quick-panel");
  if (!row || !panel) return;
  const fromPx = 44;
  const toPx = Math.max(fromPx + 80, fromPx + panel.scrollHeight + 16);
  applyHomeExpandTiming(row, fromPx, toPx);
  row.style.setProperty("--home-row-open-height", `${toPx}px`);
  if (mainRow) mainRow.classList.add("is-quick-open");
  row.classList.add("is-quick-open");
  panel.setAttribute("aria-hidden", "false");
}

function closeHomeQuickPanel() {
  const mainRow = document.getElementById("main-primary-row");
  const row = document.getElementById("home-quick-row");
  const panel = document.getElementById("home-quick-panel");
  if (row) {
    const fromPx = Math.max(44, row.scrollHeight);
    const toPx = 44;
    applyHomeExpandTiming(row, fromPx, toPx);
  }
  if (mainRow) mainRow.classList.remove("is-quick-open");
  if (!row || !panel) return;
  row.classList.remove("is-quick-open");
  panel.setAttribute("aria-hidden", "true");
}

function openHomeExamPanel() {
  closeHomeQuickPanel();
  closeHomeClockPanel();
  closeHomeReviewPanel();
  closeHomeExamBlockPanel();
  const mainRow = document.getElementById("main-primary-row");
  const row = document.getElementById("home-exam-row");
  const panel = document.getElementById("home-exam-panel");
  if (!row || !panel) return;
  const fromPx = 44;
  const toPx = Math.max(fromPx + 80, fromPx + panel.scrollHeight + 16);
  applyHomeExpandTiming(row, fromPx, toPx);
  row.style.setProperty("--home-row-open-height", `${toPx}px`);
  if (mainRow) mainRow.classList.add("is-quick-open");
  row.classList.add("is-quick-open");
  panel.setAttribute("aria-hidden", "false");
}

function closeHomeExamPanel() {
  closeHomeExamBlockPanel();
  const mainRow = document.getElementById("main-primary-row");
  const row = document.getElementById("home-exam-row");
  const panel = document.getElementById("home-exam-panel");
  if (row) {
    const fromPx = Math.max(44, row.scrollHeight);
    const toPx = 44;
    applyHomeExpandTiming(row, fromPx, toPx);
  }
  if (mainRow) mainRow.classList.remove("is-quick-open");
  if (!row || !panel) return;
  row.classList.remove("is-quick-open");
  panel.setAttribute("aria-hidden", "true");
}

function openHomeExamBlockPanel() {
  const row = document.getElementById("home-exam-row");
  const panel = document.getElementById("home-exam-block-panel");
  if (!row || !panel) return;
  const currentMax = Number.parseFloat(getComputedStyle(row).maxHeight) || 44;
  const fromPx = Math.max(44, currentMax);
  const toPx = Math.max(fromPx + 120, fromPx + panel.scrollHeight + 26);
  applyHomeExpandTiming(row, fromPx, toPx);
  row.style.setProperty("--home-row-open-height-block", `${toPx}px`);
  row.classList.add("is-block-open");
  panel.setAttribute("aria-hidden", "false");
}

function closeHomeExamBlockPanel() {
  const row = document.getElementById("home-exam-row");
  const panel = document.getElementById("home-exam-block-panel");
  if (!row || !panel) return;
  const fromPx = Math.max(44, Number.parseFloat(getComputedStyle(row).maxHeight) || row.scrollHeight || 44);
  const toPx = Math.max(44, Number.parseFloat(row.style.getPropertyValue("--home-row-open-height")) || 44);
  applyHomeExpandTiming(row, fromPx, toPx);
  row.classList.remove("is-block-open");
  panel.setAttribute("aria-hidden", "true");
}

function openHomeClockPanel() {
  closeHomeExamPanel();
  closeHomeQuickPanel();
  closeHomeReviewPanel();
  const mainRow = document.getElementById("main-primary-row");
  const row = document.getElementById("home-clock-row");
  const panel = document.getElementById("home-clock-panel");
  if (!row || !panel) return;
  const fromPx = 44;
  const toPx = Math.max(fromPx + 80, fromPx + panel.scrollHeight + 16);
  applyHomeExpandTiming(row, fromPx, toPx);
  row.style.setProperty("--home-row-open-height", `${toPx}px`);
  if (mainRow) mainRow.classList.add("is-quick-open");
  row.classList.add("is-quick-open");
  panel.setAttribute("aria-hidden", "false");
}

function closeHomeClockPanel() {
  const mainRow = document.getElementById("main-primary-row");
  const row = document.getElementById("home-clock-row");
  const panel = document.getElementById("home-clock-panel");
  if (row) {
    const fromPx = Math.max(44, row.scrollHeight);
    const toPx = 44;
    applyHomeExpandTiming(row, fromPx, toPx);
  }
  if (mainRow) mainRow.classList.remove("is-quick-open");
  if (!row || !panel) return;
  row.classList.remove("is-quick-open");
  panel.setAttribute("aria-hidden", "true");
}

function openHomeReviewPanel() {
  closeHomeExamPanel();
  closeHomeQuickPanel();
  closeHomeClockPanel();
  const mainRow = document.getElementById("main-primary-row");
  const row = document.getElementById("home-review-row");
  const panel = document.getElementById("home-review-panel");
  if (!row || !panel) return;
  const fromPx = 44;
  const toPx = Math.max(fromPx + 80, fromPx + panel.scrollHeight + 16);
  applyHomeExpandTiming(row, fromPx, toPx);
  applyHomeExpandTiming(panel, fromPx, toPx);
  row.style.setProperty("--home-row-open-height-review", `${toPx}px`);
  if (mainRow) mainRow.classList.add("is-review-open");
  row.classList.add("is-review-open");
  panel.setAttribute("aria-hidden", "false");
}

function closeHomeReviewPanel() {
  const mainRow = document.getElementById("main-primary-row");
  const row = document.getElementById("home-review-row");
  const panel = document.getElementById("home-review-panel");
  if (panel) {
    const fromPx = Math.max(44, Number.parseFloat(getComputedStyle(row).maxHeight) || row.scrollHeight || 44);
    const toPx = 44;
    applyHomeExpandTiming(row, fromPx, toPx);
    applyHomeExpandTiming(panel, fromPx, toPx);
  }
  if (mainRow) mainRow.classList.remove("is-review-open");
  if (!row || !panel) return;
  row.classList.remove("is-review-open");
  panel.setAttribute("aria-hidden", "true");
}

function openHomeConfigPanel(instant = false) {
  if (homeConfigOpenTimer) {
    clearTimeout(homeConfigOpenTimer);
    homeConfigOpenTimer = null;
  }
  if (homeConfigCloseTimer) {
    clearTimeout(homeConfigCloseTimer);
    homeConfigCloseTimer = null;
  }
  closeHomeStartPanel();
  closeHomeVoicePanel();
  const row = document.getElementById("main-config-row");
  const panel = document.getElementById("home-config-panel");
  if (!row || !panel) return;
  row.classList.remove("is-config-closing");
  const fromPx = 56;
  const toPx = Math.max(fromPx, panel.scrollHeight + 56);
  applyHomeExpandTiming(row, fromPx, toPx);
  applyHomeExpandTiming(panel, fromPx, toPx);
  panel.style.setProperty("--home-panel-open-height", `${toPx}px`);
  if (instant) row.classList.add("is-config-instant");
  row.classList.add("is-config-open");
  panel.setAttribute("aria-hidden", "false");
  if (instant) {
    setTimeout(() => {
      row.classList.remove("is-config-instant");
    }, 60);
  }
}

function closeHomeConfigPanel() {
  if (homeConfigOpenTimer) {
    clearTimeout(homeConfigOpenTimer);
    homeConfigOpenTimer = null;
  }
  if (homeConfigCloseTimer) {
    clearTimeout(homeConfigCloseTimer);
    homeConfigCloseTimer = null;
  }
  closeHomeVoicePanel(true);
  const row = document.getElementById("main-config-row");
  const panel = document.getElementById("home-config-panel");
  if (!row || !panel) return;
  const wasOpen = row.classList.contains("is-config-open");
  const wasClosing = row.classList.contains("is-config-closing");
  if (!wasOpen && !wasClosing) {
    panel.setAttribute("aria-hidden", "true");
    return;
  }
  const fromPx = Math.max(56, panel.scrollHeight + 56);
  const toPx = 56;
  applyHomeExpandTiming(row, fromPx, toPx);
  applyHomeExpandTiming(panel, fromPx, toPx);
  row.classList.add("is-config-closing");
  row.classList.remove("is-config-open");
  panel.setAttribute("aria-hidden", "true");
  homeConfigCloseTimer = setTimeout(() => {
    row.classList.remove("is-config-closing");
    homeConfigCloseTimer = null;
  }, 340);
}

function openHomeVoicePanel() {
  const configRow = document.getElementById("main-config-row");
  const row = document.getElementById("home-voice-row");
  const panel = document.getElementById("home-voice-panel");
  if (!row || !panel) return;
  if (homeVoiceCloseTimer) {
    clearTimeout(homeVoiceCloseTimer);
    homeVoiceCloseTimer = null;
  }
  // Primero renderizamos contenido y estado estando cerrado para que
  // al abrir se apliquen correctamente las transiciones en cascada.
  ttsPopulateVoiceButtons();
  ttsApplyUIState();
  row.classList.remove("is-voice-closing");
  if (configRow) configRow.classList.add("is-voice-open");
  row.classList.add("is-voice-open");
  panel.setAttribute("aria-hidden", "false");
}

function closeHomeVoicePanel(immediate = false) {
  const configRow = document.getElementById("main-config-row");
  const row = document.getElementById("home-voice-row");
  const panel = document.getElementById("home-voice-panel");
  if (!row || !panel) return;
  if (homeVoiceCloseTimer) {
    clearTimeout(homeVoiceCloseTimer);
    homeVoiceCloseTimer = null;
  }
  const wasOpen = row.classList.contains("is-voice-open");
  if (wasOpen) row.classList.add("is-voice-closing");
  row.classList.remove("is-voice-open");
  panel.setAttribute("aria-hidden", "true");
  if (wasOpen && !immediate) {
    homeVoiceCloseTimer = setTimeout(() => {
      if (configRow) configRow.classList.remove("is-voice-open");
      row.classList.remove("is-voice-closing");
      homeVoiceCloseTimer = null;
    }, 340);
  } else {
    if (configRow) configRow.classList.remove("is-voice-open");
    row.classList.remove("is-voice-closing");
  }
}

// =======================
// MENÚ PRINCIPAL
// =======================
function showMainMenu() {
  stopTimer();
  hideAll();
  setUiScreenState("home");
  const splashActive = !!(document.body && document.body.classList.contains("splash-active"));
  mainMenu.classList.remove("home-loaded");
  if (splashActive) mainMenu.classList.remove("home-logo-settled");
  if (!splashActive) mainMenu.classList.remove("home-logo-continuity");
  document.body.classList.add("is-home-screen");
  mainMenu.style.display = "block";
  ensureHomeStarsLayer();
  renderMotivationalPhrase();
  renderAppVersionBadge();

  // Aseguramos zona de botones extra sin reescribir tu HTML
  let extraBox = document.getElementById("main-extra");
  if (!extraBox) {
    extraBox = document.createElement("div");
    extraBox.id = "main-extra";
    mainMenu.appendChild(extraBox);
  }
  extraBox.style.marginTop = "auto";
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

  // Barra global de progreso (home): verde = vistas no pendientes, rojo = pendientes, blanco = no vistas
  if (homeGlobalProgressEl && homeGlobalProgressOkEl && homeGlobalProgressBadEl && homeGlobalProgressEmptyEl) {
    const total = Math.max(0, questions.length);
    let seen = 0;
    const stats = getStats();
    for (const q of questions) {
      if ((stats[String(q.id)]?.seen || 0) > 0) seen += 1;
    }
    const bad = Math.min(total, pendingCount);
    const ok = Math.max(0, Math.min(total, seen) - bad);
    const empty = Math.max(0, total - Math.min(total, seen));

    homeGlobalProgressOkEl.style.width = total > 0 ? `${(ok / total) * 100}%` : "0%";
    homeGlobalProgressBadEl.style.width = total > 0 ? `${(bad / total) * 100}%` : "0%";
    homeGlobalProgressEmptyEl.style.width = total > 0 ? `${(empty / total) * 100}%` : "100%";
    homeGlobalProgressEl.title = `Aciertos: ${ok} · Fallos: ${bad} · No vistas: ${empty} · Total: ${total}`;
  }

  const paused = lsGetJSON(LS_ACTIVE_PAUSED_TEST, null);
  const histRaw = lsGetJSON(LS_HISTORY, []);
  const hist = asArray(histRaw).filter(h => h && h.finished !== false);
  const homeLastInfo = buildHomeLastTestInfo(hist);

  const reviewBtn = document.getElementById("btn-review");
  if (reviewBtn) reviewBtn.textContent = `Fallos ❌ (${pendingCount})`;

  const rowPaused = document.getElementById("modal-row-paused");
  if (rowPaused) {
    rowPaused.innerHTML = paused
      ? `
        <button id="btn-continue-paused" class="secondary">Continuar</button>
        <button id="btn-cancel-paused" class="secondary">Descartar</button>
      `
      : "";
  }

  const reviewPreset = getHomeReviewPreset(pendingCount);
  const clockBest1m = getClockBest("clock-1m");
  const clockBest5m = getClockBest("clock-5m");
  const survivalBest = getClockBest("survival");
  const examBlocks = getAvailableExamBlocks();
  const reviewQuickButtonsHtml = reviewPreset.counts
    .map(n => `<button type="button" class="secondary home-review-option" data-limit="${n}">${n}</button>`)
    .join("");
  const examBlockButtonsHtml = examBlocks
    .map(b => `<button type="button" class="secondary home-exam-block-option" data-block="${escapeHtml(String(b))}">${escapeHtml(String(b))}</button>`)
    .join("");

  extraBox.innerHTML = `
    <div id="main-buttons">
      <div class="row ${paused ? "is-paused" : ""}" id="main-primary-row">
        <button id="btn-open-test-modal" class="success btn-primary">Iniciar test</button>
        <div id="home-start-panel" class="home-start-panel" aria-hidden="true">
          <div class="home-start-panel-title">Iniciar test</div>
          ${paused ? `
            <div class="row home-start-row double paused-actions">
              <button id="home-btn-continue-paused" class="secondary home-start-option">Continuar</button>
              <button id="home-btn-cancel-paused" class="secondary home-start-option">Descartar</button>
            </div>
          ` : ""}
          <div class="row home-start-row single" id="home-quick-row">
            <button id="home-btn-quick" class="secondary home-start-option">Rápido</button>
            <div id="home-quick-panel" class="home-quick-panel" aria-hidden="true">
              <div class="row home-quick-buttons">
                <button id="home-btn-quick-10" class="secondary home-quick-option">10</button>
                <button id="home-btn-quick-20" class="secondary home-quick-option">20</button>
              </div>
            </div>
          </div>
          <div class="row home-start-row single">
            <button id="home-btn-custom" class="secondary home-start-option">Personalizado</button>
          </div>
          <div class="row home-start-row single" id="home-review-row">
            <button id="home-btn-review" class="secondary home-start-option">Fallos ❌ (${pendingCount})</button>
            <div id="home-review-panel" class="home-review-panel" aria-hidden="true">
              <div class="home-review-panel-title">Fallos ❌ (${pendingCount})</div>
              <div class="row home-review-buttons">
                ${reviewQuickButtonsHtml}
                <button type="button" class="secondary home-review-option" data-limit="all" ${pendingCount === 0 ? "disabled" : ""}>Todas</button>
              </div>
            </div>
          </div>
          <div class="row home-start-row single" id="home-exam-row">
            <button id="home-btn-exam" class="secondary home-start-option">Modo examen 📝</button>
            <div id="home-exam-panel" class="home-quick-panel" aria-hidden="true">
              <div class="row home-exam-buttons">
                <button id="home-btn-exam-full" class="secondary home-quick-option">Completo (100)</button>
                <div id="home-exam-block-row" class="home-exam-block-row">
                  <button id="home-btn-exam-by-block" class="secondary home-quick-option">Por bloque (20)</button>
                  <div id="home-exam-block-panel" class="home-exam-block-panel" aria-hidden="true">
                    <div class="row home-exam-block-buttons">
                      ${examBlockButtonsHtml}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="row home-start-row single" id="home-clock-row">
            <button id="home-btn-clock" class="secondary home-start-option">Contrarreloj ⏱️</button>
            <div id="home-clock-panel" class="home-quick-panel" aria-hidden="true">
              <div class="row home-quick-buttons">
                <button id="home-btn-clock-1m" class="secondary home-quick-option">1m 🔥 ${clockBest1m}</button>
                <button id="home-btn-clock-5m" class="secondary home-quick-option">5m 🔥 ${clockBest5m}</button>
              </div>
            </div>
          </div>
          <div class="row home-start-row single">
            <button id="home-btn-survival" class="secondary home-start-option">Supervivencia 💀 🔥 ${survivalBest}</button>
          </div>
        </div>
      </div>
      <div class="row" id="main-config-row">
        <button id="btn-open-config" class="secondary">Configuración</button>
        <div id="home-config-panel" class="home-config-panel" aria-hidden="true">
          <div class="home-config-panel-title">Configuración</div>
          <div class="row home-config-row single home-config-option" id="home-voice-row">
            <button id="home-btn-voice" class="secondary">Voz</button>
            <div id="home-voice-panel" class="home-voice-panel" aria-hidden="true">
              <div class="home-voice-panel-title">Voz</div>
              <div id="home-tts-voice-list" class="row home-tts-voice-list"></div>
              <div class="row home-voice-sliders">
                <label class="small">Velocidad
                  <input id="home-tts-rate" type="range" min="0.7" max="1.3" step="0.1" />
                </label>
                <label class="small">Tono
                  <input id="home-tts-pitch" type="range" min="0.8" max="1.2" step="0.1" />
                </label>
              </div>
            </div>
          </div>
          <div class="row home-config-row single">
            <button id="home-btn-bank" class="secondary home-config-option">Banco de preguntas</button>
          </div>
          <div class="row home-config-row single">
            <button id="home-btn-stats" class="secondary home-config-option">Estadísticas</button>
          </div>
          <div class="row home-config-row single">
            <button id="home-btn-darkmode" class="secondary home-config-option">Modo oscuro</button>
          </div>
        </div>
      </div>
      <div class="row" id="main-meta-row">
        <div class="small ${Number(homeLastInfo?.streakDays || 0) >= 7 ? "is-max-streak" : ""}" id="main-last-test" style="text-align:center;margin-top:8px;">
          ${buildHomeStreakCardHtml(homeLastInfo)}
        </div>
      </div>
    </div>
  `;

  mainMenu.onclick = (e) => {
    if (!document.body.classList.contains("is-home-screen")) return;
    const buttonsRoot = document.getElementById("main-buttons");
    if (!buttonsRoot) return;
    if (buttonsRoot.contains(e.target)) return;
    closeHomeStartPanel();
    closeHomeConfigPanel();
  };

  const row1 = document.getElementById("main-row-1");
  if (row1) {
    // Botones extra retirados del menú principal
  }

  const openTestModalBtnNow = document.getElementById("btn-open-test-modal");
  if (openTestModalBtnNow) openTestModalBtnNow.onclick = openTestStartModal;
  const homeStartPanelTitle = document.querySelector("#main-primary-row .home-start-panel-title");
  if (homeStartPanelTitle) homeStartPanelTitle.onclick = () => closeHomeStartPanel();
  const homeBtnQuick = document.getElementById("home-btn-quick");
  if (homeBtnQuick) homeBtnQuick.onclick = () => {
    scheduleHomeAction(() => {
      const quickRow = document.getElementById("home-quick-row");
      if (quickRow && quickRow.classList.contains("is-quick-open")) closeHomeQuickPanel();
      else openHomeQuickPanel();
    });
  };
  const homeBtnClock = document.getElementById("home-btn-clock");
  if (homeBtnClock) homeBtnClock.onclick = () => {
    scheduleHomeAction(() => {
      const clockRow = document.getElementById("home-clock-row");
      if (clockRow && clockRow.classList.contains("is-quick-open")) closeHomeClockPanel();
      else openHomeClockPanel();
    });
  };
  const homeBtnQuick10 = document.getElementById("home-btn-quick-10");
  if (homeBtnQuick10) homeBtnQuick10.onclick = () => {
    closeHomeStartPanel();
    startQuickTest(10, 10);
  };
  const homeBtnQuick20 = document.getElementById("home-btn-quick-20");
  if (homeBtnQuick20) homeBtnQuick20.onclick = () => {
    closeHomeStartPanel();
    startQuickTest(20, 20);
  };
  const homeBtnClock1m = document.getElementById("home-btn-clock-1m");
  if (homeBtnClock1m) homeBtnClock1m.onclick = () => {
    closeHomeStartPanel();
    startClockMode(1);
  };
  const homeBtnClock5m = document.getElementById("home-btn-clock-5m");
  if (homeBtnClock5m) homeBtnClock5m.onclick = () => {
    closeHomeStartPanel();
    startClockMode(5);
  };
  const homeBtnSurvival = document.getElementById("home-btn-survival");
  if (homeBtnSurvival) homeBtnSurvival.onclick = () => {
    closeHomeStartPanel();
    startSurvivalMode();
  };
  const homeBtnCustom = document.getElementById("home-btn-custom");
  if (homeBtnCustom) homeBtnCustom.onclick = () => {
    closeHomeStartPanel();
    showTemaSelectionScreen();
  };
  const homeBtnReview = document.getElementById("home-btn-review");
  if (homeBtnReview) homeBtnReview.onclick = () => {
    scheduleHomeAction(() => {
      if (pendingCount === 0) {
        startReviewPending();
        return;
      }
      const row = document.getElementById("home-review-row");
      if (row && row.classList.contains("is-review-open")) closeHomeReviewPanel();
      else openHomeReviewPanel();
    });
  };
  const homeReviewQuickButtons = document.querySelectorAll(".home-review-option");
  homeReviewQuickButtons.forEach(btn => {
    btn.onclick = () => {
      const limitRaw = btn.getAttribute("data-limit");
      const limit = limitRaw === "all" ? null : Number(limitRaw);
      closeHomeStartPanel();
      startReviewPending(Number.isFinite(limit) && limit > 0 ? limit : null);
    };
  });
  const homeBtnExam = document.getElementById("home-btn-exam");
  if (homeBtnExam) homeBtnExam.onclick = () => {
    scheduleHomeAction(() => {
      const examRow = document.getElementById("home-exam-row");
      if (examRow && examRow.classList.contains("is-quick-open")) {
        closeHomeExamPanel();
        return;
      }
      openHomeExamPanel();
    });
  };
  const homeBtnExamFull = document.getElementById("home-btn-exam-full");
  if (homeBtnExamFull) homeBtnExamFull.onclick = () => {
    closeHomeStartPanel();
    startExamFull();
  };
  const homeBtnExamByBlock = document.getElementById("home-btn-exam-by-block");
  if (homeBtnExamByBlock) homeBtnExamByBlock.onclick = () => {
    scheduleHomeAction(() => {
      const row = document.getElementById("home-exam-row");
      if (row && row.classList.contains("is-block-open")) {
        closeHomeExamBlockPanel();
        return;
      }
      openHomeExamBlockPanel();
    });
  };
  const homeExamBlockOptions = document.querySelectorAll(".home-exam-block-option");
  homeExamBlockOptions.forEach(btn => {
    btn.onclick = () => {
      const bloque = String(btn.getAttribute("data-block") || "").trim();
      if (!bloque) return;
      closeHomeStartPanel();
      startExamByBlock(bloque);
    };
  });
  const homeStartOptions = document.querySelectorAll(".home-start-option");
  homeStartOptions.forEach((btn, idx) => {
    const delay = `${idx * 70}ms`;
    btn.style.setProperty("--home-delay", delay);
    const row = btn.closest(".home-start-row");
    if (row && (row.id === "home-quick-row" || row.id === "home-exam-row" || row.id === "home-clock-row" || row.id === "home-review-row")) {
      row.style.setProperty("--home-row-delay", delay);
    }
  });

  const openConfigBtnNow = document.getElementById("btn-open-config");
  if (openConfigBtnNow) {
    openConfigBtnNow.onclick = () => {
      scheduleHomeAction(() => {
        const configRow = document.getElementById("main-config-row");
        if (configRow && configRow.classList.contains("is-config-open")) {
          closeHomeConfigPanel();
          return;
        }
        openHomeConfigPanel();
      });
    };
  }
  const homeConfigPanelTitle = document.querySelector("#main-config-row .home-config-panel-title");
  if (homeConfigPanelTitle) homeConfigPanelTitle.onclick = () => closeHomeConfigPanel();
  const homeBtnBank = document.getElementById("home-btn-bank");
  if (homeBtnBank) homeBtnBank.onclick = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    closeHomeConfigPanel();
    showQuestionBank();
  };
  const homeBtnStats = document.getElementById("home-btn-stats");
  if (homeBtnStats) homeBtnStats.onclick = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    closeHomeConfigPanel();
    showStatsScreen();
  };
  const homeBtnVoice = document.getElementById("home-btn-voice");
  if (homeBtnVoice) homeBtnVoice.onclick = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    scheduleHomeAction(() => {
      const row = document.getElementById("home-voice-row");
      if (row && row.classList.contains("is-voice-open")) {
        closeHomeVoicePanel();
        return;
      }
      openHomeVoicePanel();
    });
  };
  const homeVoicePanel = document.getElementById("home-voice-panel");
  if (homeVoicePanel) {
    homeVoicePanel.onclick = (e) => {
      if (e) e.stopPropagation();
    };
    homeVoicePanel.ontouchstart = (e) => {
      if (e) e.stopPropagation();
    };
  }
  const homeVoiceList = document.getElementById("home-tts-voice-list");
  if (homeVoiceList) {
    homeVoiceList.onclick = (e) => {
      if (e) e.stopPropagation();
    };
    homeVoiceList.ontouchstart = (e) => {
      if (e) e.stopPropagation();
    };
  }
  const homeTtsRate = document.getElementById("home-tts-rate");
  if (homeTtsRate) {
    homeTtsRate.oninput = () => {
      ttsUserInteracted = true;
      ttsSettings.rate = Number(homeTtsRate.value) || 1;
      ttsSaveSettings();
      ttsApplyUIState();
    };
  }
  const homeTtsPitch = document.getElementById("home-tts-pitch");
  if (homeTtsPitch) {
    homeTtsPitch.oninput = () => {
      ttsUserInteracted = true;
      ttsSettings.pitch = Number(homeTtsPitch.value) || 1;
      ttsSaveSettings();
      ttsApplyUIState();
    };
  }
  ttsPopulateVoiceButtons();
  ttsApplyUIState();

  if (paused) {
    const modalContinuePaused = document.getElementById("btn-continue-paused");
    if (modalContinuePaused) modalContinuePaused.onclick = () => resumePausedTest();
    const modalCancelPaused = document.getElementById("btn-cancel-paused");
    if (modalCancelPaused) modalCancelPaused.onclick = () => {
      clearPausedTest();
      showMainMenu();
    };
    const homeContinuePaused = document.getElementById("home-btn-continue-paused");
    if (homeContinuePaused) homeContinuePaused.onclick = () => {
      closeHomeStartPanel();
      resumePausedTest();
    };
    const homeCancelPaused = document.getElementById("home-btn-cancel-paused");
    if (homeCancelPaused) homeCancelPaused.onclick = () => {
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
  refreshDbCountPill();

  // ✅ Hook: añade el toggle de modo oscuro en el menú principal
  injectDarkModeToggleIntoMainMenu();
  if (splashActive) {
    mainMenu.classList.remove("home-loaded");
  } else {
    triggerHomeIntroAnimation();
  }
}

function showConfigScreen() {
  hideAll();
  setUiScreenState("config");
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
  if (document.body.classList.contains("is-home-screen")) {
    const startRow = document.getElementById("main-primary-row");
    if (startRow && startRow.classList.contains("is-start-open")) {
      scheduleHomeAction(() => closeHomeStartPanel());
      return;
    }
    if (openTestModalTimer) clearTimeout(openTestModalTimer);
    openTestModalTimer = setTimeout(() => {
      openHomeStartPanel();
      openTestModalTimer = null;
    }, HOME_PRESS_DELAY_MS);
    return;
  }
  if (!testStartModal) return;
  if (openTestModalTimer) clearTimeout(openTestModalTimer);
  openTestModalTimer = setTimeout(() => {
    testStartModal.style.display = "flex";
    testStartModal.setAttribute("aria-hidden", "false");
    openTestModalTimer = null;
  }, HOME_PRESS_DELAY_MS);
}

function closeTestStartModal() {
  closeHomeStartPanel();
  closeHomeConfigPanel();
  if (!testStartModal) return;
  if (openTestModalTimer) {
    clearTimeout(openTestModalTimer);
    openTestModalTimer = null;
  }
  testStartModal.style.display = "none";
  testStartModal.setAttribute("aria-hidden", "true");
}

// =======================
// NAVEGACIÓN UI
// =======================
function showTestMenuScreen() {
  if (customJumpTopScrollHandler && testMenu) {
    testMenu.removeEventListener("scroll", customJumpTopScrollHandler);
    customJumpTopScrollHandler = null;
  }
  hideAll();
  setUiScreenState("test-menu");
  testMenu.classList.remove("customize-test-theme");
  testMenu.classList.remove("bank-theme");
  testMenu.style.display = "block";
}

function showVoiceSettingsScreen() {
  hideAll();
  setUiScreenState("voice-settings");
  voiceSettingsContainer.style.display = "block";
  ttsApplyUIState();
}

function showTestScreen() {
  hideAll();
  setUiScreenState("test");
  testContainer.style.display = "";
  ensurePauseAndFinishUI();
  ensureTestBottomClearanceObserver();
  scheduleTestAnswerDockingUpdate();
  updateModePill();
  updateTestTopUiForMode();
  ttsApplyUIState();
}

function showResultsScreen() {
  stopTimer();
  ttsStop();
  hideAll();
  setUiScreenState("results");
  resultsContainer.style.display = "block";
}

function showReviewScreen() {
  hideAll();
  setUiScreenState("review");
  reviewContainer.style.display = "block";

  if (!lastSessionAnswers || !lastSessionAnswers.length) {
    reviewText.innerHTML = "<p>No hay preguntas para repasar.</p>";
    return;
  }

  const blocks = lastSessionAnswers.map((a, idx) => {
    const optionsHtml = (a.opciones || []).map(opt => {
      const isChosen = a.elegida && opt === a.elegida;
      const isCorrect = a.correcta && opt === a.correcta;
      let style = "padding:8px;border:1px solid var(--border);border-radius:10px;margin:6px 0;background:var(--surface);";
      if (isCorrect) style += "background:var(--success-soft);border-color:var(--success-border);";
      if (isChosen && !isCorrect) style += "background:var(--error-soft);border-color:var(--error-border);";
      return `<div style="${style}">${escapeHtml(opt)}</div>`;
    }).join("");

    return `
      <div class="review-item">
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
  setUiScreenState("stats");
  statsContainer.style.display = "block";

  const stats = getStats();
  const histRaw = lsGetJSON(LS_HISTORY, []);
  const hist = asArray(histRaw).filter(isStatsEligibleHistoryEntry);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const last7Start = new Date(todayStart);
  last7Start.setDate(last7Start.getDate() - 6);
  const histLast7 = hist.filter(h => {
    const d = h?.date ? new Date(h.date) : null;
    return d && !isNaN(d) && d >= last7Start;
  });

  const firstSessionDate = hist.reduce((minDate, h) => {
    const d = h?.date ? new Date(h.date) : null;
    if (!d || isNaN(d)) return minDate;
    if (!minDate) return d;
    return d < minDate ? d : minDate;
  }, null);
  const firstSessionStart = firstSessionDate ? new Date(firstSessionDate) : null;
  if (firstSessionStart) firstSessionStart.setHours(0, 0, 0, 0);
  const daysSinceFirstSession = firstSessionStart
    ? Math.max(0, Math.floor((todayStart.getTime() - firstSessionStart.getTime()) / dayMs))
    : 0;
  // Requisito de negocio: mostrar la tarjeta de 7 días solo si el histórico supera 7 días.
  const showLast7Card = daysSinceFirstSession > 7;

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

  const last7Totals = histLast7.reduce(
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
  const last7Answered = last7Totals.correct + last7Totals.wrong + last7Totals.noSe;
  const last7Accuracy = last7Answered ? (last7Totals.correct / last7Answered) * 100 : 0;
  const histScoreBruta = calcBruta(histTotals.correct, histTotals.wrong);
  const histScore100 = calcNotaSobre100(histTotals.correct, histTotals.wrong, histTotals.noSe);
  const last7ScoreBruta = calcBruta(last7Totals.correct, last7Totals.wrong);
  const last7Score100 = calcNotaSobre100(last7Totals.correct, last7Totals.wrong, last7Totals.noSe);

  const calcAvgSpeedFromHistory = (entries) => {
    const agg = asArray(entries).reduce((acc, h) => {
      const timeUsedSec = Number(h?.timeUsedSec);
      const answered = (Number(h?.correct) || 0) + (Number(h?.wrong) || 0) + (Number(h?.noSe) || 0);
      if (!Number.isFinite(timeUsedSec) || timeUsedSec < 0 || answered <= 0) return acc;
      acc.time += timeUsedSec;
      acc.answered += answered;
      return acc;
    }, { time: 0, answered: 0 });
    if (!agg.answered) return 0;
    return agg.time / agg.answered;
  };

  const histAvgSpeedSec = calcAvgSpeedFromHistory(hist);
  const last7AvgSpeedSec = calcAvgSpeedFromHistory(histLast7);

  const renderAccuracyCircle = (title, correct, wrong, noSe) => {
    const total = correct + wrong + noSe;
    const pct = total ? Math.round((correct / total) * 100) : 0;
    const wrongPct = 100 - pct;
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
        <div style="position:relative;width:140px;height:140px;border-radius:50%;background:conic-gradient(var(--accent-success) 0 ${pct}%, var(--accent-danger) ${pct}% 100%);display:flex;align-items:center;justify-content:center;">
          <div style="width:108px;height:108px;border-radius:50%;background:var(--surface);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--border) 75%, transparent);">
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
      const answered = v.correct + v.wrong + v.noSe;
      const dateLabel = new Date(`${day}T00:00:00`).toLocaleDateString("es-ES");
      return `
        <div class="small" style="margin:6px 0;">
          <strong>${dateLabel}:</strong> ${answered} respondidas · ${v.correct} aciertos · ${v.wrong} fallos · ${v.noSe} no lo sé
        </div>
      `;
    })
    .join("");

  statsContent.innerHTML = `
    <div class="stats-grid">
      <div class="card stats-card">
        <div style="font-weight:700;margin-bottom:8px;">Histórico total</div>
        <div><strong>Tests realizados:</strong> ${histTotals.tests}</div>
        <div style="height:6px;"></div>
        <div><strong>Preguntas contestadas:</strong> ${histAnswered}</div>
        <div><strong>Aciertos:</strong> ${histTotals.correct}</div>
        <div><strong>Fallos:</strong> ${histTotals.wrong}</div>
        <div><strong>No lo sé:</strong> ${histTotals.noSe}</div>
        <div style="height:6px;"></div>
        <div><strong>Porcentaje de acierto:</strong> ${histAccuracy.toFixed(1)}%</div>
        <div><strong>Nota media:</strong> ${histScore100.toFixed(1)}/100</div>
        <div><strong>Velocidad media:</strong> ${formatSpeedTime(histAvgSpeedSec)}</div>
        <div class="stats-circle">
          ${renderAccuracyCircle("Histórico total", histTotals.correct, histTotals.wrong, histTotals.noSe)}
        </div>
      </div>
      ${showLast7Card ? `
      <div class="card stats-card">
        <div style="font-weight:700;margin-bottom:8px;">Últimos 7 días</div>
        <div><strong>Tests realizados:</strong> ${last7Totals.tests}</div>
        <div style="height:6px;"></div>
        <div><strong>Preguntas contestadas:</strong> ${last7Answered}</div>
        <div><strong>Aciertos:</strong> ${last7Totals.correct}</div>
        <div><strong>Fallos:</strong> ${last7Totals.wrong}</div>
        <div><strong>No lo sé:</strong> ${last7Totals.noSe}</div>
        <div style="height:6px;"></div>
        <div><strong>Porcentaje de acierto:</strong> ${last7Accuracy.toFixed(1)}%</div>
        <div><strong>Nota media:</strong> ${last7Score100.toFixed(1)}/100</div>
        <div><strong>Velocidad media:</strong> ${formatSpeedTime(last7AvgSpeedSec)}</div>
        <div class="stats-circle">
          ${renderAccuracyCircle("Últimos 7 días", last7Totals.correct, last7Totals.wrong, last7Totals.noSe)}
        </div>
      </div>
      ` : ""}
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

  document.getElementById("btn-stats-back").onclick = () => {
    showMainMenu();
    openHomeConfigPanel(true);
  };
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

function setImportScreenMode(modeValue) {
  const mode = modeValue === "manual" ? "manual" : "batch";
  importScreenMode = mode;
  if (importBatchSection) importBatchSection.style.display = mode === "batch" ? "block" : "none";
  if (importManualSection) importManualSection.style.display = mode === "manual" ? "block" : "none";
  if (importTitle) importTitle.textContent = mode === "manual" ? "Importar preguntas · Manual" : "Importar preguntas · Conjunto";
}

function showImportScreen(modeValue = "batch", backHandler = null) {
  setImportScreenMode(modeValue);
  if (typeof backHandler === "function") {
    importBackHandler = backHandler;
  } else if (isElementShown(testMenu) && mode === "bank") {
    importBackHandler = showQuestionBank;
  } else if (isElementShown(configContainer)) {
    importBackHandler = showConfigScreen;
  } else if (isElementShown(voiceSettingsContainer)) {
    importBackHandler = showVoiceSettingsScreen;
  } else {
    importBackHandler = showMainMenu;
  }
  setUiScreenState("import", {
    mode: importScreenMode === "manual" ? "manual" : "batch",
    backTarget: resolveImportBackTarget(importBackHandler)
  });
  hideAll();
  importContainer.style.display = "block";
  if (importScreenMode === "batch") setImportTemplateExpanded(false);
  if (importScreenMode === "manual") refreshManualBloqueTemaSelectors();
  clearManualImportForm();
}

function backFromImportScreen() {
  const goBack = typeof importBackHandler === "function" ? importBackHandler : showMainMenu;
  importBackHandler = null;
  goBack();
}

// =======================
// TEST HEADER UI: PAUSA
// =======================
function ensurePauseAndFinishUI() {
  // buscamos la primera row del test container (timer + mode pill)
  const controlsRow = document.getElementById("test-controls-row");
  if (!controlsRow) return;

  const oldFinishBtn = document.getElementById("finish-btn");
  if (oldFinishBtn) oldFinishBtn.remove();

  // pausa
  if (!document.getElementById("pause-btn")) {
    const pauseBtn = document.createElement("button");
    pauseBtn.id = "pause-btn";
    pauseBtn.className = "secondary";
    pauseBtn.textContent = "Pausar";
    pauseBtn.onclick = () => showPauseExitOptions();
    controlsRow.appendChild(pauseBtn);
  }
}

function updateProgressUI() {
  updateTestTopUiForMode();
  const textEl = document.getElementById("progress-text");
  const barEl = document.getElementById("progress-bar-fill");
  if (!textEl || !barEl) return;
  if (isArcadeModeValue()) return;
  const total = currentTest.length || 0;
  const current = Math.min(currentIndex + 1, total);
  textEl.textContent = `${current}/${total}`;
  const pct = total ? (current / total) * 100 : 0;
  barEl.style.width = `${pct}%`;
}

function updateTestTopUiForMode() {
  const progressWrap = document.getElementById("test-progress");
  const progressText = document.getElementById("progress-text");
  const isClockMode = isClockModeValue();
  const isSurvivalMode = isSurvivalModeValue();
  const isArcadeMode = isArcadeModeValue();
  if (progressWrap) progressWrap.style.display = isArcadeMode ? "none" : "";
  if (timerDisplay) timerDisplay.style.visibility = isSurvivalMode ? "hidden" : "";
  if (progressText) {
    progressText.style.display = isArcadeMode ? "" : "";
    if (isArcadeMode) {
      const fire = correctCount > clockModeRecordTarget ? " 🔥" : "";
      progressText.textContent = `${correctCount}${fire}`;
    }
  }
}

function updateModePill() {
  if (modePill) modePill.textContent = "";
}

// =======================
// PAUSA / CONTINUAR TEST
// =======================

function buildPausedTestPayload() {
  if (!currentTest || !currentTest.length) return null;
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    mode,
    sessionOpts,
    timeRemaining,
    isOvertime,
    overtimeSeconds,
    baseCounts,
    baseAnsweredIds: Array.from(baseAnsweredIds),
    baseTestIds: Array.from(baseTestIdSet),
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
}

function pauseTestToMenu() {
  stopTimer();
  ttsStop();

  const payload = buildPausedTestPayload();
  if (!payload) {
    showMainMenu();
    return;
  }

  lsSetJSON(LS_ACTIVE_PAUSED_TEST, payload);
  showMainMenu();
}

function discardCurrentTestAndExit() {
  stopTimer();
  ttsStop();
  localStorage.removeItem(LS_ACTIVE_PAUSED_TEST);
  showMainMenu();
}

async function showPauseExitOptions() {
  const shouldResumeTimer = !!timer;
  stopTimer();
  ttsPrepareResumeFromPause();
  ttsStop();
  let readCurrentQuestionOnContinue = false;
  const pauseExplanationText = (viewState === "feedback" && answerExplanation)
    ? String(answerExplanation.textContent || "").trim()
    : "";
  showPauseExplanationOverlay(pauseExplanationText);
  document.body.classList.add("is-pause-modal-open");
  const handlePauseOverlayReposition = () => positionPauseExplanationOverlay();
  window.addEventListener("resize", handlePauseOverlayReposition);

  let action = null;
  try {
    while (true) {
      const modalPromise = openModal({
        hideTitle: true,
        hideMessage: true,
        actionsClassName: "modal-actions-vertical",
        actions: [
          { label: "Continuar", value: "continue", className: "secondary pause-exit-btn", role: "cancel", default: true },
          { label: "Leer en voz alta", value: "read", className: `${ttsSettings.enabled ? "success" : ""} pause-exit-btn` },
          { label: "Guardar y salir", value: "save", className: "secondary pause-exit-btn" },
          { label: "Descartar y salir", value: "discard", className: "danger pause-exit-btn" }
        ]
      });
      requestAnimationFrame(handlePauseOverlayReposition);
      setTimeout(handlePauseOverlayReposition, 40);
      action = await modalPromise;
      if (action !== "read") break;
      ttsSettings.enabled = !ttsSettings.enabled;
      if (!ttsSettings.enabled) {
        ttsPausedResume = null;
        readCurrentQuestionOnContinue = false;
      } else if (!ttsPausedResume) {
        // Si no había lectura en curso al pausar, leeremos al continuar.
        readCurrentQuestionOnContinue = true;
      }
      ttsSaveSettings();
      ttsApplyUIState();
    }
  } finally {
    window.removeEventListener("resize", handlePauseOverlayReposition);
    document.body.classList.remove("is-pause-modal-open");
    hidePauseExplanationOverlay();
  }

  if (action === "continue") {
    if (shouldResumeTimer) startTimer();
    if (readCurrentQuestionOnContinue && ttsSettings.enabled && viewState === "question") {
      const q = currentTest[currentIndex];
      ttsSpeakQuestion(q, currentIndex + 1, currentTest.length);
    } else {
      ttsResumeAfterPauseIfNeeded();
    }
    return;
  }
  if (action === "discard") {
    ttsPausedResume = null;
    discardCurrentTestAndExit();
    return;
  }
  if (action === "save") {
    ttsPausedResume = null;
    pauseTestToMenu();
    return;
  }
  if (shouldResumeTimer) startTimer();
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
  clockModeRecordTarget = isArcadeModeValue(sessionOpts.mode)
    ? Math.max(0, Number(sessionOpts?.meta?.clockRecordTarget) || 0)
    : 0;

  currentTest = pool;
  currentIndex = Math.max(0, Math.min(saved.currentIndex || 0, currentTest.length));
  timeRemaining = Math.max(0, saved.timeRemaining || 0);
  isOvertime = !!saved.isOvertime;
  overtimeSeconds = Math.max(0, saved.overtimeSeconds || 0);
  timeUpPromptOpen = false;
  baseCounts = {
    correct: saved.baseCounts?.correct || 0,
    wrong: saved.baseCounts?.wrong || 0,
    noSe: saved.baseCounts?.noSe || 0
  };
  baseAnsweredIds = new Set(asArray(saved.baseAnsweredIds).map(String));
  baseTestIdSet = new Set(asArray(saved.baseTestIds).map(String));

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
  ttsLastQuestionId = null;

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
    if (sessionOpts.timeSeconds > 0) startTimer();
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
  const customScrollContainer = testMenu;
  const scrollCustomTo = (target = "top", behavior = "smooth") => {
    if (!customScrollContainer) return;
    const top = target === "bottom" ? customScrollContainer.scrollHeight : 0;
    try {
      customScrollContainer.scrollTo({ top, behavior });
    } catch (_) {
      customScrollContainer.scrollTop = top;
    }
  };

  showTestMenuScreen();
  setUiScreenState("tema-selection");
  testMenu.classList.add("customize-test-theme");

  const stats = getStats();
  const temaCounts = new Map();
  const temaToQuestions = new Map();
  for (const q of questions) {
    const temaKey = normalizeTemaKey(q.tema || "Sin tema");
    if (!temaCounts.has(temaKey)) temaCounts.set(temaKey, { total: 0, seen: 0 });
    const entry = temaCounts.get(temaKey);
    entry.total++;
    if ((stats[String(q.id)]?.seen || 0) > 0) entry.seen++;
    if (!temaToQuestions.has(temaKey)) temaToQuestions.set(temaKey, []);
    temaToQuestions.get(temaKey).push(q);
  }

  const grouped = groupTemasByBloque();
  const totalQuestions = questions.length;

  testMenu.innerHTML = `
    <div class="row custom-top-head">
      <button id="custom-jump-top" class="secondary" aria-label="Subir al inicio" title="Subir">↑</button>
    </div>

    <div id="custom-time-card" class="card" style="margin:12px 0;text-align:center;padding:10px;">
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
        <button class="secondary time-btn" data-value="perq90">1:30</button>
        <button class="secondary time-btn" data-value="perq120">2 min</button>
      </div>

      <div id="selected-count" style="margin-top:8px;text-align:center;"><strong>Preguntas seleccionadas:</strong> 0</div>
    </div>

    <div id="custom-filter-card" class="card" style="margin:12px 0;text-align:center;padding:10px;">
      <div style="font-weight:700;margin-bottom:6px;">Filtrar</div>
      <div id="fuente-select-wrap" class="small"></div>
    </div>

    <div id="custom-options-card" class="card" style="margin:12px 0;text-align:center;padding:10px;">
      <div class="row" style="justify-content:center;margin:8px 0;">
        <button id="btn-toggle-all">Marcar todas</button>
        <button id="btn-less-used">Solo preguntas no/menos vistas</button>
      </div>
      <div class="row" style="justify-content:center;margin:8px 0;">
        <button id="btn-seen-only">Solo preguntas ya vistas</button>
      </div>
    </div>

    <div id="custom-modes-card" class="card" style="margin:12px 0;text-align:center;padding:10px;">
      <div style="font-weight:700;margin-bottom:6px;">Modos</div>
      <div class="row" style="justify-content:center;margin:8px 0;">
        <button id="btn-perfection-toggle">Perfeccionamiento</button>
      </div>
    </div>

    <div id="tema-select-wrap"></div>

    <div id="tema-start-sticky" style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:12px;">
      <button id="btn-back-main" class="secondary">Volver</button>
      <button id="btn-start-practice" class="success">Iniciar test</button>
      <button id="custom-jump-bottom" class="secondary" aria-label="Bajar al final" title="Bajar">↓</button>
    </div>
  `;

  const customJumpTopBtn = document.getElementById("custom-jump-top");
  if (customJumpTopBtn) customJumpTopBtn.onclick = () => scrollCustomTo("top");
  const customJumpBottomBtn = document.getElementById("custom-jump-bottom");
  if (customJumpBottomBtn) customJumpBottomBtn.onclick = () => scrollCustomTo("bottom");
  if (customScrollContainer) {
    if (customJumpTopScrollHandler) {
      customScrollContainer.removeEventListener("scroll", customJumpTopScrollHandler);
      customJumpTopScrollHandler = null;
    }
    customJumpTopScrollHandler = () => {
      if (!customJumpTopBtn) return;
      const show = (customScrollContainer.scrollTop || 0) > 12;
      customJumpTopBtn.classList.toggle("is-hidden", !show);
    };
    customScrollContainer.addEventListener("scroll", customJumpTopScrollHandler, { passive: true });
    customJumpTopScrollHandler();
  }

  const wrap = document.getElementById("tema-select-wrap");
  const fuenteWrap = document.getElementById("fuente-select-wrap");

  grouped.forEach(({ bloque, temas }) => {
    const bloqueTotalQuestions = temas.reduce((sum, t) => {
      const k = normalizeTemaKey(t);
      const c = temaCounts.get(k) || { total: 0 };
      return sum + (Number(c.total) || 0);
    }, 0);
    const bloqueRow = document.createElement("div");
    bloqueRow.style.margin = "10px 0";
    bloqueRow.innerHTML = `
      <div class="bloque-card">
        <div class="bloque-head">
          <button type="button" class="bloque-expander" data-bloque="${escapeHtml(bloque)}" aria-expanded="false" style="width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;font-weight:700;font-size:28px;line-height:1;cursor:pointer;padding:0;">+</button>
          <span class="small bloque-count" data-bloque="${escapeHtml(bloque)}" data-total="${bloqueTotalQuestions}" style="min-width:64px;text-align:right;color:var(--muted);">0/${bloqueTotalQuestions}</span>
          <span class="bloque-label">${escapeHtml(bloque)}</span>
          <input type="checkbox" class="bloque-toggle" data-bloque="${escapeHtml(bloque)}" style="display:none;">
        </div>
        <div class="temas-list" data-bloque="${escapeHtml(bloque)}" style="margin-top:8px;padding-left:22px;display:none;"></div>
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
      const line = document.createElement("div");
      line.className = "tema-line";
      line.style.display = "grid";
      line.style.gridTemplateColumns = "36px 44px 1fr";
      line.style.alignItems = "start";
      line.style.columnGap = "6px";
      line.style.margin = "10px 0";
      line.style.cursor = "pointer";
      line.innerHTML = `
        <input type="checkbox" class="tema-checkbox" data-bloque="${escapeHtml(bloque)}" data-tema-key="${escapeHtml(temaKey)}" data-total="${counts.total}" value="${escapeHtml(t)}" style="display:none;">
        <span class="small tema-count" style="grid-column:1;grid-row:1;color:var(--muted);text-align:right;line-height:1.2;">${counts.total}</span>
        <span style="grid-column:2;grid-row:1;display:block;line-height:1.35;text-align:left;">${escapeHtml(temaNum)}</span>
        <span style="grid-column:3;grid-row:1;display:block;line-height:1.35;text-align:justify;text-justify:inter-word;align-self:start;">${escapeHtml(temaText)}</span>
        <div class="tema-progress" data-tema-key="${escapeHtml(temaKey)}" style="grid-column:1 / 3;grid-row:1;margin-top:28px;" aria-hidden="true">
          <span class="tema-progress-ok" style="width:0%;"></span>
          <span class="tema-progress-bad" style="width:0%;"></span>
          <span class="tema-progress-empty" style="width:100%;"></span>
        </div>
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
  const seenOnlyBtn = document.getElementById("btn-seen-only");
  const toggleAllBtn = document.getElementById("btn-toggle-all");
  const perfectionBtn = document.getElementById("btn-perfection-toggle");
  const numButtonsWrap = document.getElementById("num-questions-buttons");
  let lessUsedActive = false;
  let seenOnlyActive = false;
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
      cb.indeterminate = false;
      wrap.querySelectorAll(`.tema-checkbox[data-bloque="${cssEscape(b)}"]`).forEach(tcb => {
        tcb.checked = checked;
      });
      syncBloqueToggleState(b);
      updateSelectedCount();
    });
  });

  wrap.querySelectorAll(".bloque-expander").forEach(btn => {
    btn.addEventListener("click", () => {
      const b = btn.getAttribute("data-bloque");
      const list = wrap.querySelector(`.temas-list[data-bloque="${cssEscape(b)}"]`);
      if (!list) return;
      const isCollapsed = list.style.display === "none";
      list.style.display = isCollapsed ? "block" : "none";
      btn.textContent = isCollapsed ? "−" : "+";
      btn.setAttribute("aria-expanded", isCollapsed ? "true" : "false");
    });
  });

  wrap.querySelectorAll(".bloque-head").forEach(head => {
    head.addEventListener("click", (ev) => {
      if (ev.target && ev.target.closest(".bloque-expander")) return;
      ev.preventDefault();
      const cb = head.querySelector(".bloque-toggle");
      if (!cb) return;
      const card = head.closest(".bloque-card");
      if (!card) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      const prevTimer = Number(card.dataset.pressTimer || "0");
      if (prevTimer) window.clearTimeout(prevTimer);
      card.classList.remove("bloque-press-flash");
      void card.offsetWidth;
      card.classList.add("bloque-press-flash");
      const timerId = window.setTimeout(() => {
        card.classList.remove("bloque-press-flash");
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        delete card.dataset.pressTimer;
      }, 130);
      card.dataset.pressTimer = String(timerId);
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
  wrap.querySelectorAll(".tema-line").forEach(line => {
    line.addEventListener("click", ev => {
      ev.preventDefault();
      const cb = line.querySelector(".tema-checkbox");
      if (!cb) return;
      const prevTimer = Number(line.dataset.pressTimer || "0");
      if (prevTimer) window.clearTimeout(prevTimer);
      line.classList.remove("tema-press-flash");
      void line.offsetWidth;
      line.classList.add("tema-press-flash");
      const timerId = window.setTimeout(() => {
        line.classList.remove("tema-press-flash");
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        delete line.dataset.pressTimer;
      }, 130);
      line.dataset.pressTimer = String(timerId);
    });
  });
  fuenteWrap.querySelectorAll(".fuente-btn").forEach(() => {});

  const setSimpleToggleButtonState = (btn, active) => {
    if (!btn) return;
    btn.className = active ? "success" : "";
    if (!active) {
      btn.style.background = "var(--surface)";
      btn.style.borderColor = "var(--border)";
    } else {
      btn.style.background = "";
      btn.style.borderColor = "";
    }
  };

  const deactivateLessUsedFilter = () => {
    if (!lessUsedActive) return;
    lessUsedActive = false;
    setSimpleToggleButtonState(lessUsedBtn, false);
    clearAutoTemaMarks();
  };

  const deactivateSeenOnlyFilter = () => {
    if (!seenOnlyActive) return;
    seenOnlyActive = false;
    setSimpleToggleButtonState(seenOnlyBtn, false);
  };

  const deactivateExclusiveFiltersForToggleAll = () => {
    deactivateLessUsedFilter();
    deactivateSeenOnlyFilter();
  };

  const deactivateToggleAllForExclusiveFilters = () => {
    if (!toggleAllBtn) return;
    toggleAllBtn.textContent = "Marcar todas";
    toggleAllBtn.className = "";
  };

  if (lessUsedBtn) {
    lessUsedBtn.onclick = () => {
      const nextState = !lessUsedActive;
      if (nextState) {
        deactivateToggleAllForExclusiveFilters();
        deactivateSeenOnlyFilter();
        lessUsedActive = true;
        setSimpleToggleButtonState(lessUsedBtn, true);
        markAutoTemasForLessUsed();
      } else {
        deactivateLessUsedFilter();
      }
      updateSelectedCount();
    };
  }

  if (seenOnlyBtn) {
    seenOnlyBtn.onclick = () => {
      const nextState = !seenOnlyActive;
      if (nextState) {
        deactivateToggleAllForExclusiveFilters();
        deactivateLessUsedFilter();
        seenOnlyActive = true;
        setSimpleToggleButtonState(seenOnlyBtn, true);
      } else {
        deactivateSeenOnlyFilter();
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
      deactivateExclusiveFiltersForToggleAll();
      const anyChecked = wrap.querySelectorAll(".tema-checkbox:checked").length > 0;
      if (!anyChecked) {
        wrap.querySelectorAll(".bloque-toggle").forEach(cb => {
          cb.checked = true;
          cb.indeterminate = false;
        });
        wrap.querySelectorAll(".tema-checkbox").forEach(cb => (cb.checked = true));
        toggleAllBtn.textContent = "Desmarcar todas";
        toggleAllBtn.className = "success";
      } else {
        wrap.querySelectorAll(".bloque-toggle").forEach(cb => {
          cb.checked = false;
          cb.indeterminate = false;
        });
        wrap.querySelectorAll(".tema-checkbox").forEach(cb => (cb.checked = false));
        toggleAllBtn.textContent = "Marcar todas";
        toggleAllBtn.className = "";
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
    seenOnlyActive = false;
    perfectionActive = false;
    setSimpleToggleButtonState(lessUsedBtn, false);
    setSimpleToggleButtonState(seenOnlyBtn, false);
    updatePerfectionUi();
    if (toggleAllBtn) {
      toggleAllBtn.textContent = "Marcar todas";
      toggleAllBtn.className = "";
    }
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
      seenOnly: seenOnlyActive,
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
    updateBloqueCounts();
    updateSelectionHighlights();
  }

  function updateTemaCountsForFuentes() {
    const pendingSet = getPendingReviewSet();
    const fuenteSet = getActiveFuenteSet();
    wrap.querySelectorAll(".tema-checkbox").forEach(cb => {
      const temaKey = cb.getAttribute("data-tema-key");
      const label = cb.closest(".tema-line");
      const countEl = label ? label.querySelector(".tema-count") : null;
      const progressEl = label ? label.querySelector(".tema-progress") : null;
      const list = temaToQuestions.get(temaKey) || [];
      let total = 0;
      let seen = 0;
      let pending = 0;
      for (const q of list) {
        const f = q.fuente || "Sin fuente";
        if (!fuenteSet.has(f)) continue;
        total += 1;
        if ((stats[String(q.id)]?.seen || 0) > 0) seen += 1;
        if (pendingSet.has(String(q.id))) pending += 1;
      }
      const bad = Math.min(total, pending);
      const ok = Math.max(0, Math.min(total, seen) - bad);
      const empty = Math.max(0, total - Math.min(total, seen));
      cb.setAttribute("data-total", String(total));
      if (countEl) countEl.textContent = `${total}`;
      if (progressEl) {
        const okEl = progressEl.querySelector(".tema-progress-ok");
        const badEl = progressEl.querySelector(".tema-progress-bad");
        const emptyEl = progressEl.querySelector(".tema-progress-empty");
        if (okEl) okEl.style.width = total > 0 ? `${(ok / total) * 100}%` : "0%";
        if (badEl) badEl.style.width = total > 0 ? `${(bad / total) * 100}%` : "0%";
        if (emptyEl) emptyEl.style.width = total > 0 ? `${(empty / total) * 100}%` : "100%";
        progressEl.title = `Aciertos: ${ok} · Fallos: ${bad} · No vistas: ${empty}`;
      }
    });
  }

  function updateBloqueCounts() {
    wrap.querySelectorAll(".bloque-count").forEach(el => {
      const b = el.getAttribute("data-bloque");
      let total = 0;
      wrap.querySelectorAll(`.tema-checkbox[data-bloque="${cssEscape(b)}"]`).forEach(cb => {
        total += Number(cb.getAttribute("data-total")) || 0;
      });
      el.setAttribute("data-total", String(total));
      let selected = 0;
      wrap.querySelectorAll(`.tema-checkbox[data-bloque="${cssEscape(b)}"]:checked`).forEach(cb => {
        const t = Number(cb.getAttribute("data-total")) || 0;
        selected += t;
      });
      el.textContent = `${selected}/${total}`;
    });
  }

  function applyFuenteFilterToTemas() {
    const fuentesChecked = Array.from(fuenteWrap.querySelectorAll(".fuente-btn.success"))
      .map(btn => btn.getAttribute("data-fuente"));
    const fuenteSet = new Set(fuentesChecked);

    wrap.querySelectorAll(".tema-checkbox").forEach(cb => {
      const temaKey = cb.getAttribute("data-tema-key");
      const label = cb.closest(".tema-line");
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
    updateTemaCountsForFuentes();
    updateBloqueCounts();
    updateSelectionHighlights();
  }

  function updateSelectionHighlights() {
    wrap.querySelectorAll(".bloque-card").forEach(card => card.classList.remove("is-active"));
    wrap.querySelectorAll(".tema-line").forEach(line => line.classList.remove("is-active"));

    wrap.querySelectorAll(".tema-checkbox").forEach(cb => {
      const line = cb.closest(".tema-line");
      if (line && cb.checked) line.classList.add("is-active");
    });

    wrap.querySelectorAll(".bloque-toggle").forEach(cb => {
      const card = cb.closest(".bloque-card");
      if (!card) return;
      if (cb.checked && !cb.indeterminate) {
        card.classList.add("is-active");
      }
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
      perfectionBtn.className = "";
    }
    const bottomBtn = document.getElementById("btn-start-practice");
    if (bottomBtn) bottomBtn.textContent = "Iniciar test";
  }
}

function buildPoolFromConfig(config) {
  let pool = [];

  if (config.allQuestions) {
    pool = [...questions];
  } else {
    if (!config.temas || config.temas.length === 0) {
      pool = (config.lessUsed || config.seenOnly) ? [...questions] : [];
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
  } else if (config.seenOnly) {
    pool = pool.filter(q => getSeenCount(q.id) > 0);
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
  setUiScreenState("exam-menu");

  testMenu.innerHTML = `
    <h2>Modo examen</h2>
    <button id="btn-exam-full">Examen completo (100 preguntas / 100 min)</button>
    <button id="btn-exam-by-block">Examen por bloque (20 preguntas / 20 min)</button>
    <button id="btn-back-main" class="secondary">Volver</button>
  `;

  document.getElementById("btn-back-main").onclick = showMainMenu;
  document.getElementById("btn-exam-full").onclick = () => startExamFull();
  document.getElementById("btn-exam-by-block").onclick = () => showExamByBlockSelect();
}

function startExamFull() {
  mode = "exam";
  const all = (questions || []).slice();
  if (all.length < 100) {
    showAlert("No hay suficientes preguntas para un examen completo (100).");
    return;
  }

  const getTemaKey = (q) => {
    const temaText = String(q?.tema || "").trim();
    const m = temaText.match(/^(\d{1,3})\s*\./);
    if (m) return `tema-${Number(m[1])}`;
    return `tema-text-${normalizeTemaKey(temaText || String(q?.id || ""))}`;
  };
  const getBloqueKey = (q) => String(q?.bloque || "Sin bloque");

  const byBloque = new Map();
  const byTema = new Map();
  for (const q of all) {
    const bk = getBloqueKey(q);
    if (!byBloque.has(bk)) byBloque.set(bk, []);
    byBloque.get(bk).push(q);

    const tk = getTemaKey(q);
    if (!byTema.has(tk)) byTema.set(tk, []);
    byTema.get(tk).push(q);
  }

  let pool = [];
  const usedIds = new Set();
  const usedTemas = new Set();
  const addIfNew = (q) => {
    const id = String(q?.id ?? "");
    if (!id || usedIds.has(id)) return false;
    pool.push(q);
    usedIds.add(id);
    usedTemas.add(getTemaKey(q));
    return true;
  };

  // 1) Asegurar representación de todos los bloques disponibles.
  for (const qs of byBloque.values()) {
    const copy = qs.slice();
    shuffleArray(copy);
    const picked = copy.find(q => !usedIds.has(String(q.id)));
    if (picked) addIfNew(picked);
  }

  // 2) Intentar 1 pregunta por tema (siempre que se pueda).
  const temaKeys = Array.from(byTema.keys());
  shuffleArray(temaKeys);
  for (const tk of temaKeys) {
    if (usedTemas.has(tk)) continue;
    const copy = byTema.get(tk).slice();
    shuffleArray(copy);
    const picked = copy.find(q => !usedIds.has(String(q.id)));
    if (picked) addIfNew(picked);
  }

  // 3) Rellenar aleatoriamente hasta 100 si faltan preguntas.
  if (pool.length < 100) {
    const rest = all.filter(q => !usedIds.has(String(q.id)));
    shuffleArray(rest);
    for (const q of rest) {
      if (addIfNew(q) && pool.length >= 100) break;
    }
  }

  // 4) Si sobran (más de 100 temas), recortar manteniendo bloques representados.
  if (pool.length > 100) {
    const byBloqueInPool = new Map();
    for (const q of pool) {
      const bk = getBloqueKey(q);
      if (!byBloqueInPool.has(bk)) byBloqueInPool.set(bk, []);
      byBloqueInPool.get(bk).push(q);
    }
    const keep = [];
    const keepIds = new Set();
    for (const qs of byBloqueInPool.values()) {
      const copy = qs.slice();
      shuffleArray(copy);
      const picked = copy[0];
      if (!picked) continue;
      const id = String(picked.id);
      if (keepIds.has(id)) continue;
      keep.push(picked);
      keepIds.add(id);
    }
    const rest = pool.filter(q => !keepIds.has(String(q.id)));
    shuffleArray(rest);
    for (const q of rest) {
      if (keep.length >= 100) break;
      keep.push(q);
      keepIds.add(String(q.id));
    }
    pool = keep.slice(0, 100);
  }

  startSession(pool, {
    mode: "exam",
    timeSeconds: 100 * 60,
    countNonAnsweredAsWrongOnFinish: true,
    meta: {}
  });
}

function startExamByBlock(bloqueName) {
  const target = String(bloqueName || "").trim();
  if (!target) return;
  const qs = (questions || []).filter(q => (q.bloque || "Sin bloque") === target);
  if (!qs.length) {
    showAlert("No hay preguntas en ese bloque.");
    return;
  }
  shuffleArray(qs);
  const pool = qs.slice(0, 20);
  startSession(pool, {
    mode: "exam-block",
    timeSeconds: 20 * 60,
    countNonAnsweredAsWrongOnFinish: true,
    meta: { bloque: target }
  });
}

function showExamByBlockSelect() {
  showTestMenuScreen();
  setUiScreenState("exam-block-select");

  const bloques = getAvailableExamBlocks();

  testMenu.innerHTML = `
    <h2>Examen por bloque (20 preguntas / 20 min)</h2>
    <div id="block-list"></div>
    <button id="btn-back" class="secondary">Volver</button>
  `;

  const list = document.getElementById("block-list");
  bloques.forEach(b => {
    const btn = document.createElement("button");
    btn.textContent = b;
    btn.onclick = () => startExamByBlock(b);
    list.appendChild(btn);
  });

  document.getElementById("btn-back").onclick = showExamMenu;
}

// =======================
// REPASO PENDIENTES (solo pendientes reales)
// =======================
function startReviewPending(limitCount = null) {
  prunePendingGhostIds();

  const existing = getExistingIdSet();   // strings
  const pending = getPendingReviewSet(); // strings
  const done = getPendingDoneSet();      // strings

  const ids = Array.from(pending).filter(id =>
    existing.has(String(id)) && !done.has(String(id))
  );

  const idSet = new Set(ids.map(String));
  let pool = (questions || []).filter(q => idSet.has(String(q.id)));

  if (pool.length === 0) {
    showAlert("No tienes preguntas pendientes de repaso");
    return;
  }

  mode = "review";
  shuffleArray(pool);
  const limit = Number(limitCount);
  if (Number.isFinite(limit) && limit > 0) {
    pool = pool.slice(0, Math.min(limit, pool.length));
  }

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

function startClockMode(minutes) {
  if (!questions || questions.length === 0) {
    showAlert("No hay preguntas cargadas.");
    return;
  }

  const safeMinutes = Number(minutes) === 5 ? 5 : 1;
  const pool = shuffleCopy(questions);
  const modeKey = `clock-${safeMinutes}m`;
  const recordTarget = getClockBest(modeKey);
  mode = modeKey;

  startSession(pool, {
    mode: modeKey,
    timeSeconds: safeMinutes * 60,
    countNonAnsweredAsWrongOnFinish: false,
    allowContinueOnTimeUp: false,
    meta: { clock: true, minutes: safeMinutes, clockRecordTarget: recordTarget }
  });
}

function startSurvivalMode() {
  if (!questions || questions.length === 0) {
    showAlert("No hay preguntas cargadas.");
    return;
  }

  const pool = shuffleCopy(questions);
  const modeKey = "survival";
  const recordTarget = getClockBest(modeKey);
  mode = modeKey;

  startSession(pool, {
    mode: modeKey,
    timeSeconds: 0,
    countNonAnsweredAsWrongOnFinish: false,
    allowContinueOnTimeUp: false,
    meta: { survival: true, clockRecordTarget: recordTarget }
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
    timeSeconds: Math.max(0, Number.isFinite(opts.timeSeconds) ? opts.timeSeconds : (currentTest.length * 60)),
    allowContinueOnTimeUp: opts.allowContinueOnTimeUp !== false,
    countNonAnsweredAsWrongOnFinish: !!opts.countNonAnsweredAsWrongOnFinish,
    meta: { ...(opts.meta || {}), baseTestIds }
  };
  clockModeRecordTarget = isArcadeModeValue(sessionOpts.mode)
    ? Math.max(0, Number(sessionOpts?.meta?.clockRecordTarget) || 0)
    : 0;

  timeRemaining = sessionOpts.timeSeconds;
  isOvertime = false;
  overtimeSeconds = 0;
  timeUpPromptOpen = false;
  baseAnsweredIds = new Set();
  baseCounts = { correct: 0, wrong: 0, noSe: 0 };
  baseTestIdSet = new Set(baseTestIds);

  viewState = "question";
  currentShuffledOptions = [];
  lastSelectedText = null;
  lastCorrectText = null;
  pendingFinishReason = null;
  ttsLastQuestionId = null;

  showTestScreen();
  showQuestion();
  if (sessionOpts.timeSeconds > 0) startTimer();
  else {
    stopTimer();
    if (timerDisplay) {
      timerDisplay.textContent = "";
      updateTimerStyle();
    }
  }
}

// =======================
// TEST RENDER + LÓGICA
// =======================
function wireAnswerEliminateGesture(btn) {
  if (!(btn instanceof HTMLElement)) return;
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let toggledInThisGesture = false;
  const SWIPE_X = 30;
  const SWIPE_Y_MAX = 44;
  const MAX_DRAG = 72;

  const resetDragVisual = () => {
    btn.classList.remove("is-swipe-drag");
    btn.style.removeProperty("--swipe-dx");
    btn.style.removeProperty("--swipe-progress");
  };

  const updateDragVisual = (dx) => {
    if (!tracking || toggledInThisGesture) return;
    if (dx >= 0) {
      resetDragVisual();
      return;
    }
    const clamped = Math.max(-MAX_DRAG, dx);
    const progress = Math.min(1, Math.abs(clamped) / MAX_DRAG);
    btn.classList.add("is-swipe-drag");
    btn.style.setProperty("--swipe-dx", `${clamped}px`);
    btn.style.setProperty("--swipe-progress", String(progress));
  };

  const markConsumed = () => {
    btn.dataset.swipeConsumedUntil = String(Date.now() + 700);
  };

  const tryToggle = (x, y) => {
    if (!tracking || toggledInThisGesture) return false;
    const dx = x - startX;
    const dy = y - startY;
    updateDragVisual(dx);
    if (dx <= -SWIPE_X && Math.abs(dy) <= SWIPE_Y_MAX) {
      btn.classList.toggle("is-eliminated");
      toggledInThisGesture = true;
      markConsumed();
      resetDragVisual();
      return true;
    }
    return false;
  };

  const begin = (x, y) => {
    tracking = true;
    toggledInThisGesture = false;
    startX = x;
    startY = y;
    resetDragVisual();
  };

  const end = (x, y) => {
    if (!tracking) return;
    tryToggle(x, y);
    tracking = false;
    resetDragVisual();
  };

  const isTouchDevice = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);

  if (isTouchDevice) {
    // Touch-only path to avoid duplicate toggles on browsers that emit both pointer and touch.
    btn.addEventListener("touchstart", (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      begin(t.clientX, t.clientY);
    }, { passive: true });

    btn.addEventListener("touchmove", (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      tryToggle(t.clientX, t.clientY);
    }, { passive: true });

    btn.addEventListener("touchend", (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      end(t.clientX, t.clientY);
    }, { passive: true });

    btn.addEventListener("touchcancel", () => {
      tracking = false;
      toggledInThisGesture = false;
      resetDragVisual();
    }, { passive: true });
    return;
  }

  if (window.PointerEvent) {
    btn.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary) return;
      begin(e.clientX, e.clientY);
    }, { passive: true });

    btn.addEventListener("pointermove", (e) => {
      if (!e.isPrimary) return;
      tryToggle(e.clientX, e.clientY);
    }, { passive: true });

    btn.addEventListener("pointerup", (e) => {
      if (!e.isPrimary) return;
      end(e.clientX, e.clientY);
    }, { passive: true });

    btn.addEventListener("pointercancel", () => {
      tracking = false;
      toggledInThisGesture = false;
      resetDragVisual();
    }, { passive: true });
    return;
  }

  // Mouse fallback
  btn.addEventListener("mousedown", (e) => begin(e.clientX, e.clientY));
  btn.addEventListener("mousemove", (e) => tryToggle(e.clientX, e.clientY));
  btn.addEventListener("mouseup", (e) => end(e.clientX, e.clientY));
  btn.addEventListener("mouseleave", () => {
    tracking = false;
    toggledInThisGesture = false;
    resetDragVisual();
  });
}

function renderQuestionWithOptions(q, opcionesOrdenadas) {
  questionText.textContent = `${currentIndex + 1}. ${q.pregunta}`;
  answersContainer.innerHTML = "";
  if (answerExplanation) {
    answerExplanation.textContent = "";
    answerExplanation.style.display = "none";
  }

  const isSurvivalMode = isSurvivalModeValue();
  noSeBtn.style.display = "inline-block";
  noSeBtn.textContent = "No lo sé";
  noSeBtn.classList.toggle("is-mode-disabled", isSurvivalMode);
  noSeBtn.classList.toggle("is-survival-disabled", isSurvivalMode);
  if (isSurvivalMode) {
    noSeBtn.disabled = true;
    noSeBtn.onclick = null;
  } else {
    noSeBtn.disabled = false;
    noSeBtn.onclick = onNoSe;
  }

  if (continueBtn) {
    continueBtn.style.display = "none";
    continueBtn.onclick = null;
  }

  currentShuffledOptions = opcionesOrdenadas.slice();

  const letters = ["A", "B", "C", "D"];
  opcionesOrdenadas.forEach((opt, idx) => {
    const btn = document.createElement("button");
    const letter = letters[idx] || String(idx + 1);
    btn.innerHTML = `
      <span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid var(--border);border-radius:6px;margin-right:8px;font-weight:700;">${letter}</span>
      <span class="answer-text" style="text-align:left;flex:1;">${escapeHtml(opt)}</span>
    `;
    btn.className = "answer-btn";
    btn.dataset.optionText = opt;
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.onclick = () => {
      const consumedUntil = Number(btn.dataset.swipeConsumedUntil || "0");
      if (consumedUntil > Date.now()) return;
      checkAnswer(opt, q);
    };
    wireAnswerEliminateGesture(btn);
    answersContainer.appendChild(btn);
  });

  scheduleTestBottomScrollClearanceUpdate();
  scheduleTestAnswerDockingUpdate();
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
  const idStr = String(q.id);
  const isPerfectionRepeat = mode === "perfection" && baseAnsweredIds.has(idStr);
  const isRepeatSession = isRepeatSessionValue();
  if (!isPerfectionRepeat && !isRepeatSession) bumpStat(q.id, "seen");

  viewState = "question";
  lastSelectedText = null;
  lastCorrectText = null;

  const opcionesOrdenadas = hasCombinedAnswerOptions(q.opciones)
    ? (Array.isArray(q.opciones) ? q.opciones.slice() : [])
    : shuffleCopy(q.opciones);
  renderQuestionWithOptions(q, opcionesOrdenadas);
}

function checkAnswer(selectedText, q) {
  ttsUserInteracted = true;
  const correctText = q.opciones[q.respuesta_correcta];
  const isCorrect = selectedText === correctText;
  const idStr = String(q.id);
  const isBase = mode === "perfection" && baseTestIdSet.has(idStr);
  const isFirstBaseAttempt = isBase && !baseAnsweredIds.has(idStr);
  const isRepeatSession = isRepeatSessionValue();

  // ✅ answeredIds siempre strings
  answeredIds.add(idStr);

  if (isCorrect) {
    correctCount++;
    if (!isRepeatSession && (mode !== "perfection" || isFirstBaseAttempt)) bumpStat(q.id, "correct");

    if (mode === "review" && !isRepeatSession) markReviewedDone(q.id);

    if (mode === "perfection") {
      perfectionSet.delete(idStr);
      perfectionQueue = perfectionQueue.filter(id => String(id) !== idStr);
      if (isFirstBaseAttempt) {
        baseAnsweredIds.add(idStr);
        baseCounts.correct++;
      }
    }
  } else {
    wrongCount++;
    if (!isRepeatSession && (mode !== "perfection" || isFirstBaseAttempt)) bumpStat(q.id, "wrong");

    // ✅ fallos siempre a pendientes (incluido examen)
    if (mode !== "perfection" || isFirstBaseAttempt) markPending(q.id);

    if (mode === "perfection") {
      if (!perfectionSet.has(idStr)) {
        perfectionSet.add(idStr);
        perfectionQueue.push(idStr);
      }
      if (isFirstBaseAttempt) {
        baseAnsweredIds.add(idStr);
        baseCounts.wrong++;
      }
    }
  }

  lastSessionAnswers.push(
    buildAnswerRecord(q, selectedText, correctText, isCorrect ? "ACIERTO" : "FALLO")
  );
  updateTestTopUiForMode();
  if (isSurvivalModeValue() && !isCorrect) {
    pendingFinishReason = "survival-fail";
    showAnswer(q, selectedText);
    return;
  }
  showAnswer(q, selectedText);
}

function onNoSe() {
  if (isSurvivalModeValue()) return;
  ttsUserInteracted = true;
  const q = currentTest[currentIndex];
  const idStr = String(q.id);
  const isBase = mode === "perfection" && baseTestIdSet.has(idStr);
  const isFirstBaseAttempt = isBase && !baseAnsweredIds.has(idStr);
  const isRepeatSession = isRepeatSessionValue();

  // ✅ answeredIds siempre strings
  answeredIds.add(idStr);

  noSeCount++;
  if (!isRepeatSession && (mode !== "perfection" || isFirstBaseAttempt)) bumpStat(q.id, "noSe");

  // ✅ no lo sé => pendientes
  if (mode !== "perfection" || isFirstBaseAttempt) markPending(q.id);

  const correctText = q.opciones[q.respuesta_correcta];
  lastSessionAnswers.push(buildAnswerRecord(q, null, correctText, "NOSE"));
  updateTestTopUiForMode();

  if (mode === "perfection") {
    if (!perfectionSet.has(idStr)) {
      perfectionSet.add(idStr);
      perfectionQueue.push(idStr);
    }
    if (isFirstBaseAttempt) {
      baseAnsweredIds.add(idStr);
      baseCounts.noSe++;
    }
  }

  showAnswer(q, null);
}

function showAnswer(q, selectedTextOrNull) {
  ttsStop();

  viewState = "feedback";
  lastSelectedText = selectedTextOrNull;
  lastCorrectText = q.opciones[q.respuesta_correcta];

  const isSurvivalMode = isSurvivalModeValue();
  noSeBtn.style.display = "inline-block";
  noSeBtn.classList.remove("is-mode-disabled", "is-survival-disabled");
  noSeBtn.disabled = false;
  noSeBtn.textContent = "Continuar";

  const correctText = q.opciones[q.respuesta_correcta];
  const buttons = answersContainer.querySelectorAll(".answer-btn");

  buttons.forEach(btn => {
    const t = (btn.dataset.optionText || "").toString();
    btn.classList.remove("is-correct", "is-wrong", "is-swipe-drag");
    btn.style.removeProperty("--swipe-dx");
    btn.style.removeProperty("--swipe-progress");
    if (t === correctText) btn.classList.add("is-correct");
    else if (selectedTextOrNull !== null && t === selectedTextOrNull) btn.classList.add("is-wrong");
    btn.disabled = false;
    btn.style.cursor = "pointer";
  });

  const exp = document.createElement("p");
  exp.style.margin = "0";
  exp.textContent = buildExplanationText(q);
  if (answerExplanation) {
    answerExplanation.innerHTML = "";
    answerExplanation.appendChild(exp);
    answerExplanation.style.display = "flex";
  }

  const continueFromFeedback = () => {
    ttsUserInteracted = true;
    if (answerExplanation && answerExplanation.contains(exp)) {
      answerExplanation.removeChild(exp);
      answerExplanation.style.display = "none";
    }
    buttons.forEach(btn => btn.classList.remove("is-correct", "is-wrong"));
    buttons.forEach(btn => {
      btn.onclick = null;
      btn.style.cursor = "";
    });

    if (pendingFinishReason) {
      const reason = pendingFinishReason;
      pendingFinishReason = null;
      finishTest(reason);
      return;
    }

    currentIndex++;
    viewState = "question";
    showQuestion();
  };
  if (continueBtn) {
    continueBtn.style.display = "none";
    continueBtn.onclick = continueFromFeedback;
  }
  noSeBtn.onclick = continueFromFeedback;

  buttons.forEach(btn => {
    btn.onclick = continueFromFeedback;
  });
  scheduleTestBottomScrollClearanceUpdate();
  scheduleTestAnswerDockingUpdate();
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
  timerDisplay.textContent = formatTimerDisplay();
  updateTimerStyle();

  if (!isOvertime && timeRemaining <= 0) {
    stopTimer();
    handleTimeUp();
    return;
  }

  timer = setInterval(() => {
    if (isOvertime) {
      overtimeSeconds++;
      timerDisplay.textContent = formatTimerDisplay();
      updateTimerStyle();
      return;
    }

    timeRemaining--;
    if (timeRemaining < 0) timeRemaining = 0;
    timerDisplay.textContent = formatTimerDisplay();
    updateTimerStyle();

    if (timeRemaining <= 0) {
      stopTimer();
      handleTimeUp();
    }
  }, 1000);
}
function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function isResultsVisible() {
  if (!resultsContainer) return false;
  const style = window.getComputedStyle(resultsContainer);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

async function handleTimeUp() {
  if (isResultsVisible()) return;
  if (timeUpPromptOpen) return;

  if (sessionOpts?.allowContinueOnTimeUp === false) {
    finishTest("time");
    return;
  }

  timeUpPromptOpen = true;

  const choice = await openModal({
    title: "Times Up!",
    message: "",
    titleAlign: "center",
    actions: [
      {
        label: "Aceptar la derrota",
        value: "defeat",
        className: "danger"
      },
      {
        label: "Continuar",
        value: "continue",
        className: "secondary",
        role: "cancel",
        default: true
      }
    ]
  });

  timeUpPromptOpen = false;

  if (choice === "continue") {
    isOvertime = true;
    overtimeSeconds = 0;
    startTimer();
    return;
  }

  finishTest("time");
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
  timeUpPromptOpen = false;
  finalizeUnansweredAsPendingIfNeeded();

  const useCounts = mode === "perfection"
    ? { correct: baseCounts.correct, wrong: baseCounts.wrong, noSe: baseCounts.noSe }
    : { correct: correctCount, wrong: wrongCount, noSe: noSeCount };
  const currentModeKey = sessionOpts?.mode || mode;
  const isArcadeMode = isArcadeModeValue(currentModeKey);
  const isSurvivalMode = isSurvivalModeValue(currentModeKey);
  const previousArcadeBest = isArcadeMode ? getClockBest(mode) : 0;
  const isDarkTheme = document.body.classList.contains("chatgpt-dark") || document.body.classList.contains("chari-dark");
  const nTotal = correctCount + wrongCount + noSeCount;
  const isRepeatSession = isRepeatSessionValue();
  const scoreBruta = calcBruta(useCounts.correct, useCounts.wrong);
  const score100 = calcNotaSobre100(useCounts.correct, useCounts.wrong, useCounts.noSe);
  const baseTotal = sessionOpts?.meta?.baseTestIds?.length || currentTest.length;
  const maxBruta = mode === "perfection" ? baseTotal : currentTest.length;
  const baseTime = Math.max(0, sessionOpts?.timeSeconds || 0);
  const elapsedUsedSec = (() => {
    if (isOvertime) return baseTime + Math.max(0, overtimeSeconds || 0);
    return Math.max(0, baseTime - Math.max(0, timeRemaining || 0));
  })();
  const answeredForSpeed = useCounts.correct + useCounts.wrong + useCounts.noSe;
  const avgSpeedSec = answeredForSpeed > 0 ? (elapsedUsedSec / answeredForSpeed) : 0;
  const timeTotalLabel = formatTime(baseTime);
  const hasTimedSession = baseTime > 0 || isOvertime;
  const timeRestLabel = (() => {
    if (isOvertime) {
      const totalUsed = baseTime + Math.max(0, overtimeSeconds || 0);
      return `${formatTime(totalUsed)}/${formatTime(baseTime)}`;
    }
    return `${formatTime(Math.max(0, timeRemaining || 0))}/${timeTotalLabel}`;
  })();

  if (!isRepeatSession) {
    addHistoryEntry({
      date: new Date().toISOString(),
      mode,
      total: mode === "perfection" ? baseTotal : currentTest.length,
      correct: useCounts.correct,
      wrong: useCounts.wrong,
      noSe: useCounts.noSe,
      scoreBruta,
      score100,
      timeUsedSec: elapsedUsedSec,
      avgSpeedSec,
      reason,
      finished: true
    });
  }

  clearPausedTest();
  showResultsScreen();
  if (resultsContainer) {
    resultsContainer.classList.toggle("is-arcade-results", isArcadeMode);
  }

  const isNewArcadeRecord = isArcadeMode && useCounts.correct > previousArcadeBest;
  const clockRecordLine = isArcadeMode
    ? (
      isNewArcadeRecord
        ? `<p style="color:var(--accent-success);font-weight:700;">¡Es un nuevo récord!</p>`
        : `<p style="color:${isDarkTheme ? "var(--text)" : "#000"};font-weight:600;">Récord: ${Math.max(previousArcadeBest, useCounts.correct)}</p>`
    )
    : "";
  const passLabel = isArcadeMode
    ? `<p style="color:var(--home-accent);font-weight:700;font-size:40px;line-height:1.1;">🔥 ${useCounts.correct} 🔥</p>`
    : (score100 >= 50
      ? `<p style="color:var(--accent-success);font-weight:700;font-size:32px;">¡Aprobado!</p>`
      : `<p style="color:var(--accent-danger);font-weight:700;font-size:32px;">Suspendido...</p>`);
  const aciertosLine = `<p><strong>Aciertos:</strong> ${correctCount}</p>`;

  resultsText.innerHTML = `
    <div class="${isArcadeMode ? "arcade-results-stack" : ""}">
      ${isArcadeMode ? `<h2 class="arcade-results-title">Resultados</h2>` : ""}
      <div style="height:8px;"></div>
      ${passLabel}
      ${isArcadeMode ? `<div class="arcade-score-meta">${aciertosLine}${clockRecordLine}</div>` : clockRecordLine}
      ${isArcadeMode ? "" : `<p><strong>Nota:</strong> ${score100.toFixed(1)}/100</p>`}
      ${isArcadeMode ? "" : `<p><strong>Puntuación bruta:</strong> ${format1Comma(scoreBruta)}/${maxBruta}</p>`}
      <div style="height:8px;"></div>
      ${isArcadeMode ? "" : aciertosLine}
      ${isSurvivalMode ? "" : `<p><strong>Fallos:</strong> ${wrongCount}</p>`}
      ${isSurvivalMode ? "" : `<p><strong>No lo sé:</strong> ${noSeCount}</p>`}
      <div style="height:8px;"></div>
      ${isArcadeMode ? "" : `<p><strong>Total preguntas:</strong> ${nTotal}</p>`}
      ${hasTimedSession && !isArcadeMode ? `<p><strong>Tiempo restante:</strong> ${timeRestLabel}</p>` : ""}
      ${hasTimedSession && !isSurvivalMode ? `<p><strong>Velocidad media:</strong> ${formatSpeedTime(avgSpeedSec)}</p>` : ""}
    </div>
  `;
  const resultsActionsBottom = document.getElementById("results-actions-bottom");
  if (resultsActionsBottom) {
    resultsActionsBottom.innerHTML = `
      <button id="btn-new-test" class="secondary">Nuevo test</button>
      ${isArcadeMode ? "" : `<button id="btn-repeat-test">Repetir test</button>`}
      <button id="btn-review-test">Repasar test</button>
    `;
    resultsActionsBottom.appendChild(backToMenuBtnResults);
  }

  const newTestBtn = document.getElementById("btn-new-test");
  if (newTestBtn) newTestBtn.onclick = () => startNewTestFromResults();
  const repeatBtn = document.getElementById("btn-repeat-test");
  if (repeatBtn) repeatBtn.onclick = () => repeatLastTest();
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

function buildPoolPreferUnseen(candidates, opts = {}) {
  const list = Array.isArray(candidates) ? candidates.slice() : [];
  const count = Math.max(0, Number(opts.count) || list.length);
  const excludeIds = new Set(asArray(opts.excludeIds).map(String));
  const preferredFallbackIds = new Set(asArray(opts.preferredFallbackIds).map(String));

  const fresh = list.filter(q => !excludeIds.has(String(q.id)));
  const preferredFallback = list.filter(q => excludeIds.has(String(q.id)) && preferredFallbackIds.has(String(q.id)));
  const rest = list.filter(q => excludeIds.has(String(q.id)) && !preferredFallbackIds.has(String(q.id)));

  shuffleArray(fresh);
  shuffleArray(preferredFallback);
  shuffleArray(rest);

  const out = [];
  const seen = new Set();
  const pushUnique = (q) => {
    const id = String(q?.id ?? "");
    if (!id || seen.has(id)) return false;
    out.push(q);
    seen.add(id);
    return true;
  };

  for (const q of fresh) {
    if (out.length >= count) break;
    pushUnique(q);
  }
  for (const q of preferredFallback) {
    if (out.length >= count) break;
    pushUnique(q);
  }
  for (const q of rest) {
    if (out.length >= count) break;
    pushUnique(q);
  }

  return out;
}

function startNewTestFromResults() {
  const modeKey = sessionOpts?.mode || mode || "practice";
  const baseIds = asArray(sessionOpts?.meta?.baseTestIds).map(String);
  const answeredIds = new Set(asArray(lastSessionAnswers).map(a => String(a?.id || "")).filter(Boolean));
  const failedIds = new Set(
    asArray(lastSessionAnswers)
      .filter(a => String(a?.resultado || "").toUpperCase() !== "ACIERTO")
      .map(a => String(a?.id || ""))
      .filter(Boolean)
  );

  const desiredCount = (() => {
    if (sessionOpts?.meta?.quick && Number(sessionOpts?.meta?.count) > 0) return Number(sessionOpts.meta.count);
    if (modeKey === "exam") return 100;
    if (modeKey === "exam-block") return 20;
    if (modeKey === "review") return baseIds.length || currentTest.length;
    return baseIds.length || currentTest.length || 10;
  })();

  let pool = [];

  if (modeKey === "review") {
    prunePendingGhostIds();
    const existing = getExistingIdSet();
    const pending = getPendingReviewSet();
    const done = getPendingDoneSet();
    const ids = Array.from(pending).filter(id => existing.has(String(id)) && !done.has(String(id)));
    const candidates = buildPoolFromIds(ids);
    pool = buildPoolPreferUnseen(candidates, {
      count: desiredCount,
      excludeIds: Array.from(answeredIds),
      preferredFallbackIds: Array.from(failedIds)
    });
    if (!pool.length) {
      showAlert("No hay preguntas disponibles para iniciar un nuevo repaso.");
      return;
    }
  } else if (modeKey === "exam-block") {
    const targetBlock = String(sessionOpts?.meta?.bloque || "").trim();
    const candidates = (questions || []).filter(q => (q.bloque || "Sin bloque") === targetBlock);
    pool = buildPoolPreferUnseen(candidates, { count: desiredCount, excludeIds: Array.from(answeredIds) });
  } else if (modeKey === "exam") {
    pool = buildPoolPreferUnseen(questions || [], { count: desiredCount, excludeIds: Array.from(answeredIds) });
  } else if (modeKey === "practice" && sessionOpts?.meta?.quick) {
    pool = buildPoolPreferUnseen(questions || [], { count: desiredCount, excludeIds: Array.from(answeredIds) });
  } else if (isClockModeValue(modeKey) || isSurvivalModeValue(modeKey)) {
    const ordered = buildPoolPreferUnseen(questions || [], {
      count: (questions || []).length,
      excludeIds: Array.from(answeredIds)
    });
    pool = ordered;
  } else {
    const basePool = buildPoolFromIds(baseIds);
    const candidates = basePool.length ? basePool : (questions || []);
    pool = buildPoolPreferUnseen(candidates, { count: desiredCount, excludeIds: Array.from(answeredIds) });
  }

  if (!pool.length) {
    showAlert("No se pudo iniciar un nuevo test con los parámetros de la última sesión.");
    return;
  }

  mode = modeKey;
  if (modeKey === "perfection") {
    perfectionQueue = [];
    perfectionSet = new Set();
  }

  startSession(pool, {
    mode: modeKey,
    timeSeconds: modeKey === "review" ? (pool.length * 60) : (sessionOpts?.timeSeconds || (pool.length * 60)),
    countNonAnsweredAsWrongOnFinish: !!sessionOpts?.countNonAnsweredAsWrongOnFinish,
    allowContinueOnTimeUp: sessionOpts?.allowContinueOnTimeUp !== false,
    meta: { ...(sessionOpts?.meta || {}), isRepeatSession: true }
  });
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
    meta: { ...(sessionOpts?.meta || {}), isRepeatSession: true }
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

    const required = ["tema", "bloque", "pregunta", "a", "b", "c", "d", "correcta", "explicacion"];
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
      pregunta: obj.pregunta.trim(),
      opciones: [obj.a, obj.b, obj.c, obj.d],
      respuesta_correcta: corrIdx,
      explicacion: obj.explicacion.trim()
    });
  });

  return { parsed, errors };
}

function parseImportJsonQuestions(raw) {
  const parsed = [];
  const errors = [];
  const text = String(raw || "").trim();
  if (!text) return { parsed, errors: ["JSON vacío."] };

  const attempts = [];
  const pushAttempt = v => {
    const t = String(v || "").trim();
    if (!t) return;
    if (!attempts.includes(t)) attempts.push(t);
  };

  // Intento directo
  pushAttempt(text);

  // Sin coma final
  const noTrailingComma = text.replace(/,\s*$/, "").trim();
  pushAttempt(noTrailingComma);

  // Soporta múltiples objetos separados por coma sin corchetes:
  // {...}, {...}
  const looksObjectListWithoutBrackets =
    !/^\s*\[/.test(noTrailingComma) &&
    /^\s*\{[\s\S]*\}\s*(,\s*\{[\s\S]*\}\s*)*$/.test(noTrailingComma);
  if (looksObjectListWithoutBrackets) {
    pushAttempt(`[${noTrailingComma}]`);
  }

  let data = null;
  let parsedOk = false;
  for (const candidate of attempts) {
    try {
      data = JSON.parse(candidate);
      parsedOk = true;
      break;
    } catch {
      // siguiente intento
    }
  }
  if (!parsedOk) {
    return { parsed, errors: ["JSON inválido."] };
  }

  const isQuestionObject =
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    ("pregunta" in data || "opciones" in data || "respuesta_correcta" in data || "correcta" in data);

  const list = Array.isArray(data)
    ? data
    : (Array.isArray(data?.preguntas)
      ? data.preguntas
      : (Array.isArray(data?.questions)
        ? data.questions
        : (isQuestionObject ? [data] : null)));

  if (!Array.isArray(list)) {
    return { parsed, errors: ["El JSON no contiene un array de preguntas."] };
  }

  list.forEach((item, idx) => {
    if (!item || typeof item !== "object") {
      errors.push(`Ítem #${idx + 1}: formato inválido.`);
      return;
    }
    const tema = String(item.tema || "").trim();
    const bloque = String(item.bloque || "").trim();
    const pregunta = String(item.pregunta || "").trim();
    const explicacion = String(item.explicacion || "").trim();

    let opciones = [];
    if (Array.isArray(item.opciones) && item.opciones.length >= 4) {
      opciones = item.opciones.slice(0, 4).map(v => String(v ?? "").trim());
    } else {
      opciones = [item.a, item.b, item.c, item.d].map(v => String(v ?? "").trim());
    }

    let corrIdx;
    if (Number.isInteger(item.respuesta_correcta) && item.respuesta_correcta >= 0 && item.respuesta_correcta <= 3) {
      corrIdx = item.respuesta_correcta;
    } else {
      corrIdx = normalizeCorrectaToIndex(item.correcta ?? item.respuestaCorrecta ?? "");
    }

    const missing = [];
    if (!tema) missing.push("tema");
    if (!bloque) missing.push("bloque");
    if (!pregunta) missing.push("pregunta");
    if (!explicacion) missing.push("explicacion");
    if (opciones.some(o => !o)) missing.push("opciones A/B/C/D");
    if (corrIdx === undefined) missing.push("respuesta correcta");
    if (missing.length) {
      errors.push(`Ítem #${idx + 1}: faltan/son inválidos: ${missing.join(", ")}.`);
      return;
    }

    parsed.push({
      tema,
      bloque,
      pregunta,
      opciones,
      respuesta_correcta: corrIdx,
      explicacion
    });
  });

  return { parsed, errors };
}

function appendImportedQuestions(parsed, importKind = "conjunto") {
  mergeQuestions();
  applyDeletedFilter();

  const existingIds = getAllKnownIdsSet();
  let nextConjuntoSeq = 1;
  while (existingIds.has(`Usuario.Conjunto.${String(nextConjuntoSeq).padStart(4, "0")}`)) nextConjuntoSeq++;
  const extra = loadExtraQuestions();
  let added = 0;
  const sourceLabel = importKind === "manual" ? "Usuario Manual" : "Usuario Conjunto";
  const idPrefix = importKind === "manual" ? "Usuario.Manual" : "Usuario.Conjunto";

  parsed.forEach((q) => {
    let idStr = `${idPrefix}.${String(nextConjuntoSeq).padStart(4, "0")}`;
    nextConjuntoSeq++;
    while (existingIds.has(idStr)) {
      idStr = `${idPrefix}.${String(nextConjuntoSeq).padStart(4, "0")}`;
      nextConjuntoSeq++;
    }
    existingIds.add(idStr);
    extra.push({ ...(q || {}), id: idStr, fuente: sourceLabel });
    added++;
  });

  saveExtraQuestions(extra);
  mergeQuestions();
  applyDeletedFilter();
  refreshDbCountPill();
  return added;
}

function getAllKnownIdsSet() {
  const used = new Set();
  const collect = v => {
    const s = String(v || "").trim();
    if (s) used.add(s);
  };
  asArray(questionsBase).forEach(q => collect(q?.id));
  asArray(loadExtraQuestions()).forEach(q => collect(q?.id));
  asArray(lsGetJSON(LS_DELETED_IDS, [])).forEach(collect);
  asArray(lsGetJSON(LS_PURGED_IDS, [])).forEach(collect);
  return used;
}

function getNextUserIdByPrefix(prefix) {
  const used = getAllKnownIdsSet();
  let n = 1;
  while (true) {
    const candidate = `${prefix}.${String(n).padStart(4, "0")}`;
    if (!used.has(candidate)) return candidate;
    n++;
  }
}

function refreshManualTemaOptionsForBloque(bloque, preferredTema = "", grouped = null) {
  if (!manualTemaInput) return;
  const groupedData = Array.isArray(grouped) ? grouped : groupTemasByBloque();
  const blockData = groupedData.find(g => g.bloque === bloque);
  const temas = Array.isArray(blockData?.temas) ? blockData.temas : [];

  manualTemaInput.innerHTML = "";
  if (!temas.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Sin temas disponibles";
    manualTemaInput.appendChild(opt);
    manualTemaInput.value = "";
    return;
  }

  temas.forEach(t => {
    const opt = document.createElement("option");
    opt.value = String(t);
    opt.textContent = String(t);
    manualTemaInput.appendChild(opt);
  });

  const hasPreferred = temas.includes(preferredTema);
  manualTemaInput.value = hasPreferred ? preferredTema : String(temas[0]);
}

function refreshManualBloqueTemaSelectors(preferredBloque = "", preferredTema = "") {
  if (!manualBloqueInput || !manualTemaInput) return;
  const grouped = groupTemasByBloque();
  const currentBloque = preferredBloque || String(manualBloqueInput.value || "");
  const currentTema = preferredTema || String(manualTemaInput.value || "");

  manualBloqueInput.innerHTML = "";
  if (!grouped.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Sin bloques disponibles";
    manualBloqueInput.appendChild(opt);
    manualBloqueInput.value = "";
    refreshManualTemaOptionsForBloque("", "", grouped);
    return;
  }

  grouped.forEach(({ bloque }) => {
    const opt = document.createElement("option");
    opt.value = String(bloque);
    opt.textContent = String(bloque);
    manualBloqueInput.appendChild(opt);
  });

  const hasPreferredBlock = grouped.some(g => g.bloque === currentBloque);
  const selectedBloque = hasPreferredBlock ? currentBloque : String(grouped[0].bloque);
  manualBloqueInput.value = selectedBloque;
  refreshManualTemaOptionsForBloque(selectedBloque, currentTema, grouped);
}

function clearManualImportForm() {
  if (manualIdInput) manualIdInput.value = getNextUserIdByPrefix("Usuario.Manual");
  if (manualPreguntaInput) manualPreguntaInput.value = "";
  if (manualOpAInput) manualOpAInput.value = "";
  if (manualOpBInput) manualOpBInput.value = "";
  if (manualOpCInput) manualOpCInput.value = "";
  if (manualOpDInput) manualOpDInput.value = "";
  if (manualCorrectaSelect) manualCorrectaSelect.value = "A";
  if (manualExplicacionInput) manualExplicacionInput.value = "";
}

function addManualQuestionToPool() {
  importStatus.innerHTML = "";

  const bloque = String(manualBloqueInput?.value || "").trim();
  const tema = String(manualTemaInput?.value || "").trim();
  const pregunta = String(manualPreguntaInput?.value || "").trim();
  const opA = String(manualOpAInput?.value || "").trim();
  const opB = String(manualOpBInput?.value || "").trim();
  const opC = String(manualOpCInput?.value || "").trim();
  const opD = String(manualOpDInput?.value || "").trim();
  const correcta = normalizeCorrectaToIndex(manualCorrectaSelect?.value || "A");
  const explicacion = String(manualExplicacionInput?.value || "").trim();

  const missing = [];
  if (!bloque) missing.push("bloque");
  if (!tema) missing.push("tema");
  if (!pregunta) missing.push("pregunta");
  if (!opA) missing.push("respuesta A");
  if (!opB) missing.push("respuesta B");
  if (!opC) missing.push("respuesta C");
  if (!opD) missing.push("respuesta D");
  if (!explicacion) missing.push("explicación");

  if (missing.length) {
    const msg = `Faltan campos: ${missing.join(", ")}.`;
    importStatus.innerHTML = `<div class="small status-error">${escapeHtml(msg)}</div>`;
    showAlert(`Error de formato:\n${msg}`);
    return;
  }

  const manualId = getNextUserIdByPrefix("Usuario.Manual");

  const parsed = [{ tema, bloque, fuente: "Usuario Manual", pregunta, opciones: [opA, opB, opC, opD], respuesta_correcta: correcta, explicacion }];
  const question = parsed[0];

  mergeQuestions();
  applyDeletedFilter();

  const existingIds = new Set((questions || []).map(q => String(q?.id)).filter(Boolean));
  const deletedIds = new Set(asArray(lsGetJSON(LS_DELETED_IDS, [])).map(v => String(v)));
  const purgedIds = new Set(asArray(lsGetJSON(LS_PURGED_IDS, [])).map(v => String(v)));
  const extra = loadExtraQuestions();

  if (existingIds.has(manualId) || deletedIds.has(manualId) || purgedIds.has(manualId)) {
    const msg = `El ID ${manualId} ya existe o está reservado.`;
    importStatus.innerHTML = `<div class="small status-error">${escapeHtml(msg)}</div>`;
    showAlert(`Error de formato:\n${msg}`);
    return;
  }
  const finalId = manualId;

  extra.push({ ...question, id: finalId, fuente: "Usuario Manual" });
  saveExtraQuestions(extra);
  mergeQuestions();
  applyDeletedFilter();
  refreshDbCountPill();
  clearManualImportForm();
  importStatus.innerHTML = `<div class="small status-ok">✅ Pregunta añadida a la pool (ID ${escapeHtml(finalId)}).</div>`;
}

function importQuestionsFromTextarea() {
  importStatus.innerHTML = "";
  const raw = String(importTextarea.value || "");
  let text = raw.trim();
  if (!text) {
    importStatus.innerHTML = `<div class="small status-error">No se encontró ninguna pregunta.</div>`;
    return;
  }

  // Si viene en formato array JSON, quitamos corchetes externos para
  // estandarizar entrada y evitar errores de pegado al mezclar formatos.
  if (text.startsWith("[") && text.endsWith("]")) {
    text = text.slice(1, -1).trim();
    importTextarea.value = text;
  }
  if (!text) {
    importStatus.innerHTML = `<div class="small status-error">Formato inválido: contenido vacío tras quitar corchetes.</div>`;
    showAlert("Error de formato: el contenido está vacío.");
    return;
  }

  const looksJson = /^[\[{]/.test(text);

  const { parsed, errors } = looksJson
    ? parseImportJsonQuestions(text)
    : parseImportBlocks(text);
  if (errors.length) {
    const msg = errors.slice(0, 6).join("\n");
    importStatus.innerHTML =
      `<div class="small status-error">No se pudo parsear:\n` +
      `${errors.map(e => `<div>${escapeHtml(e)}</div>`).join("")}</div>`;
    showAlert(`Error de formato. Revisa el contenido:\n${msg}`);
    return;
  }

  if (!parsed.length) {
    importStatus.innerHTML = `<div class="small status-error">No se encontró ninguna pregunta.</div>`;
    return;
  }
  const added = appendImportedQuestions(parsed, "conjunto");

  importStatus.innerHTML = `<div class="small status-ok">✅ Importadas ${added} preguntas.</div>`;

  // ✅ limpiar textarea tras importar
  importTextarea.value = "";
}

function copyImportTemplateToClipboard() {
  const text = String(importJsonTemplate?.textContent || "").trim();
  if (!text) return;
  navigator.clipboard.writeText(text)
    .then(() => {
      importStatus.innerHTML = `<div class="small status-ok">✅ Plantilla copiada al portapapeles.</div>`;
    })
    .catch(() => {
      importStatus.innerHTML = `<div class="small status-error">No se pudo copiar la plantilla.</div>`;
    });
}

function setImportTemplateExpanded(expanded) {
  if (!btnToggleImportTemplate || !importJsonTemplate || !importTemplateBox) return;
  const isOpen = !!expanded;
  btnToggleImportTemplate.setAttribute("aria-expanded", isOpen ? "true" : "false");
  importJsonTemplate.hidden = !isOpen;
  importTemplateBox.classList.toggle("is-collapsed", !isOpen);
}

function toggleImportTemplateExpanded() {
  if (!btnToggleImportTemplate) return;
  const nowExpanded = btnToggleImportTemplate.getAttribute("aria-expanded") === "true";
  setImportTemplateExpanded(!nowExpanded);
}

function importQuestionSetFromFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt,.json,application/json,text/plain";

  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    let raw = "";
    try {
      raw = await file.text();
    } catch {
      showAlert("No se pudo leer el archivo.");
      return;
    }

    const text = String(raw || "");
    const looksJson = /\.json$/i.test(file.name) || /^[\s\r\n]*[\[{]/.test(text);
    const result = looksJson ? parseImportJsonQuestions(text) : parseImportBlocks(text);
    const { parsed, errors } = result;

    if (errors.length) {
      const msg = errors.slice(0, 6).join("\n");
      showAlert(`No se pudo importar el conjunto:\n${msg}`);
      return;
    }
    if (!parsed.length) {
      showAlert("El archivo no contiene preguntas válidas.");
      return;
    }

    const added = appendImportedQuestions(parsed, "conjunto");
    showAlert(`Importadas ${added} preguntas desde conjunto.`);
    showQuestionBank();
  };

  input.click();
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

  importStatus.innerHTML = `<div class="small status-ok">✅ Preguntas añadidas vaciadas.</div>`;
}

async function restoreQuestionsToFactory() {
  const ok = await showConfirm(
    "¿Restaurar de fábrica el banco de preguntas? Esto deshará ediciones, recuperará eliminadas y quitará añadidas desde la app.",
    { danger: true }
  );
  if (!ok) return;

  localStorage.removeItem(LS_EXTRA_QUESTIONS);
  lsSetJSON(LS_DELETED_IDS, []);
  lsSetJSON(LS_PURGED_IDS, []);

  mergeQuestions();
  applyDeletedFilter();
  prunePendingGhostIds();
  refreshDbCountPill();

  showQuestionBank();
}

// =======================
// BANCO DE PREGUNTAS (buscar / filtrar / editar / eliminar)
// =======================
function showQuestionBank() {
  mode = "bank";
  showTestMenuScreen();
  setUiScreenState("bank");
  testMenu.classList.add("bank-theme");
  const bankScrollContainer = testMenu;

  const scrollBankTo = (target = "top", behavior = "smooth") => {
    if (!bankScrollContainer) return;
    const top = target === "bottom" ? bankScrollContainer.scrollHeight : 0;
    try {
      bankScrollContainer.scrollTo({ top, behavior });
    } catch (_) {
      bankScrollContainer.scrollTop = top;
    }
  };

  const bloques = [...new Set(questions.map(q => q.bloque || "Sin bloque"))]
    .sort((a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" }));

  const fuentes = [...new Set(questions.map(q => q.fuente || "Sin fuente"))]
    .sort((a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" }));

  testMenu.innerHTML = `
    <div class="row bank-top-head">
      <div id="bank-db-pill-target"></div>
      <button id="bank-back" class="secondary">Volver</button>
      <button id="bank-jump-top" class="secondary" aria-label="Subir al inicio de resultados" title="Subir">↑</button>
    </div>

    <div id="bank-actions-card" class="card">
      <div id="bank-import-row" class="bank-import-row">
        <button id="bank-import-questions" class="secondary">Importar preguntas</button>
        <div id="bank-import-panel" class="bank-import-panel" aria-hidden="true">
          <button id="bank-import-manual" class="secondary">Manual</button>
          <button id="bank-import-batch" class="secondary">Conjunto</button>
        </div>
      </div>
      <div class="row bank-actions-row bank-top-actions-row">
        <button id="bank-trash" class="secondary">Papelera</button>
        <button id="bank-restore-factory" class="secondary">RESTAURAR DE FÁBRICA</button>
      </div>
    </div>

    <div id="bank-bloque-filter-card" class="card bank-inline-filter-card">
      <div id="bank-bloque-filter-title" class="bank-inline-filter-title">Bloque</div>
      <div id="bank-filter-bloque-wrap" class="row bank-inline-filter-buttons">
        ${bloques.map(b => `<button type="button" class="success fuente-btn" data-bloque="${escapeHtml(b)}">${escapeHtml(b)}</button>`).join("")}
      </div>
    </div>

    <div id="bank-fuente-filter-card" class="card bank-inline-filter-card">
      <div id="bank-fuente-filter-title" class="bank-inline-filter-title">Fuente</div>
      <div id="bank-filter-fuente-wrap" class="row bank-inline-filter-buttons">
        ${fuentes.map(f => `<button type="button" class="success fuente-btn" data-fuente="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}
      </div>
    </div>

    <div id="bank-top-card" class="card">
      <div class="bank-search-row">
        <button id="bank-refresh" class="secondary">Buscar</button>
        <div class="bank-search-input-wrap">
          <input id="bank-search" type="text" placeholder="Que incluya...">
          <button type="button" id="bank-search-clear" class="bank-search-clear" aria-label="Limpiar búsqueda">×</button>
        </div>
      </div>

      <div class="row bank-search-scope-row" id="bank-search-scope-wrap">
        <button type="button" id="bank-scope-tema" class="success fuente-btn">Tema</button>
        <button type="button" id="bank-scope-qa" class="success fuente-btn">Pregunta/Respuestas</button>
      </div>
    </div>

    <div id="bank-results"></div>
    <button id="bank-jump-bottom" class="secondary" aria-label="Bajar al final de resultados" title="Bajar">↓</button>
  `;

  document.getElementById("bank-back").onclick = () => {
    showMainMenu();
    openHomeConfigPanel(true);
  };
  const bankJumpTopBtn = document.getElementById("bank-jump-top");
  if (bankJumpTopBtn) bankJumpTopBtn.onclick = () => scrollBankTo("top");
  const bankJumpBottomBtn = document.getElementById("bank-jump-bottom");
  if (bankJumpBottomBtn) bankJumpBottomBtn.onclick = () => scrollBankTo("bottom");
  document.getElementById("bank-import-questions").onclick = () => {
    const row = document.getElementById("bank-import-row");
    const panel = document.getElementById("bank-import-panel");
    if (!row || !panel) return;
    const open = !row.classList.contains("is-open");
    row.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
  };
  document.getElementById("bank-import-manual").onclick = () => {
    clearImportTextarea();
    showImportScreen("manual", showQuestionBank);
  };
  document.getElementById("bank-import-batch").onclick = () => {
    clearImportTextarea();
    showImportScreen("batch", showQuestionBank);
  };
  document.getElementById("bank-trash").onclick = () => showTrashScreen();
  document.getElementById("bank-restore-factory").onclick = () => restoreQuestionsToFactory();

  const bankDbPillTarget = document.getElementById("bank-db-pill-target");
  if (bankDbPillTarget && dbCountPill) {
    bankDbPillTarget.innerHTML = "";
    bankDbPillTarget.appendChild(dbCountPill);
  }
  refreshDbCountPill();
  const BANK_PAGE_SIZE = 50;
  let bankFilteredResults = [];
  let bankPageIndex = 0;
  let bankSearchTerm = "";

  const renderCurrentBankPage = () => {
    const total = bankFilteredResults.length;
    if (total === 0) {
      renderBankResults([], { total: 0, start: 0, pageSize: BANK_PAGE_SIZE, term: bankSearchTerm });
      return;
    }
    const maxPage = Math.max(0, Math.ceil(total / BANK_PAGE_SIZE) - 1);
    bankPageIndex = Math.min(Math.max(bankPageIndex, 0), maxPage);
    const start = bankPageIndex * BANK_PAGE_SIZE;
    const pageItems = bankFilteredResults.slice(start, start + BANK_PAGE_SIZE);
    renderBankResults(pageItems, { total, start, pageSize: BANK_PAGE_SIZE, term: bankSearchTerm });

    const prevBtn = document.getElementById("bank-page-prev");
    const nextBtn = document.getElementById("bank-page-next");
    if (prevBtn) {
      prevBtn.onclick = () => {
        if (bankPageIndex <= 0) return;
        bankPageIndex--;
        renderCurrentBankPage();
        requestAnimationFrame(() => scrollBankTo("bottom", "auto"));
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        if ((bankPageIndex + 1) * BANK_PAGE_SIZE >= total) return;
        bankPageIndex++;
        renderCurrentBankPage();
        requestAnimationFrame(() => scrollBankTo("bottom", "auto"));
      };
    }
  };

  const runSearch = () => {
    const term = (document.getElementById("bank-search").value || "").trim().toLowerCase();
    bankSearchTerm = term;
    const searchTemaOn = document.getElementById("bank-scope-tema")?.classList.contains("success");
    const searchQaOn = document.getElementById("bank-scope-qa")?.classList.contains("success");
    const fb = Array.from(document.querySelectorAll('#bank-filter-bloque-wrap .fuente-btn.success'))
      .map(btn => String(btn.getAttribute("data-bloque") || "").trim())
      .filter(Boolean);
    const ff = Array.from(document.querySelectorAll('#bank-filter-fuente-wrap .fuente-btn.success'))
      .map(btn => String(btn.getAttribute("data-fuente") || "").trim())
      .filter(Boolean);
    const fm = "";

    let res = [...questions];

    if (fb.length > 0) {
      const fbSet = new Set(fb);
      res = res.filter(q => fbSet.has(q.bloque || "Sin bloque"));
    } else {
      res = [];
    }
    if (ff.length > 0) {
      const ffSet = new Set(ff);
      res = res.filter(q => ffSet.has(q.fuente || "Sin fuente"));
    } else {
      res = [];
    }

    if (term) {
      if (!searchTemaOn && !searchQaOn) {
        bankFilteredResults = [];
        bankPageIndex = 0;
        renderCurrentBankPage();
        return;
      }
      res = res.filter(q => {
        const hay = [
          ...(searchTemaOn ? [q.tema] : []),
          ...(searchQaOn ? [q.pregunta, ...(q.opciones || [])] : [])
        ].join(" ").toLowerCase();
        return hay.includes(term);
      });
    }

    bankFilteredResults = res;
    bankPageIndex = 0;
    renderCurrentBankPage();
  };

  document.getElementById("bank-refresh").onclick = runSearch;
  const bankSearchInput = document.getElementById("bank-search");
  const bankSearchClearBtn = document.getElementById("bank-search-clear");
  const syncBankSearchClear = () => {
    if (!bankSearchInput || !bankSearchClearBtn) return;
    const hasText = !!String(bankSearchInput.value || "").trim();
    bankSearchClearBtn.classList.toggle("is-visible", hasText);
  };
  bankSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
  bankSearchInput.addEventListener("input", syncBankSearchClear);
  if (bankSearchClearBtn) {
    bankSearchClearBtn.onclick = () => {
      bankSearchInput.value = "";
      syncBankSearchClear();
      bankSearchInput.focus();
      runSearch();
    };
  }
  const setupScopeToggle = (id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.onclick = () => {
      const isActive = btn.classList.contains("success");
      btn.className = isActive ? "secondary fuente-btn" : "success fuente-btn";
      runSearch();
    };
  };
  setupScopeToggle("bank-scope-tema");
  setupScopeToggle("bank-scope-qa");
  document.querySelectorAll("#bank-filter-bloque-wrap .fuente-btn").forEach(btn => {
    btn.onclick = () => {
      const isActive = btn.classList.contains("success");
      btn.className = isActive ? "secondary fuente-btn" : "success fuente-btn";
      runSearch();
    };
  });
  document.querySelectorAll("#bank-filter-fuente-wrap .fuente-btn").forEach(btn => {
    btn.onclick = () => {
      const isActive = btn.classList.contains("success");
      btn.className = isActive ? "secondary fuente-btn" : "success fuente-btn";
      runSearch();
    };
  });

  const setupBankFilterCollapse = (cardId, titleId) => {
    const card = document.getElementById(cardId);
    const title = document.getElementById(titleId);
    if (!card || !title) return;
    title.setAttribute("role", "button");
    title.setAttribute("tabindex", "0");
    card.classList.add("is-collapsed");
    title.setAttribute("aria-expanded", "false");
    const toggle = () => {
      const collapsed = !card.classList.contains("is-collapsed");
      card.classList.toggle("is-collapsed", collapsed);
      title.setAttribute("aria-expanded", String(!collapsed));
      title.blur();
    };
    title.onclick = toggle;
    title.onkeydown = (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggle();
    };
  };
  setupBankFilterCollapse("bank-bloque-filter-card", "bank-bloque-filter-title");
  setupBankFilterCollapse("bank-fuente-filter-card", "bank-fuente-filter-title");

  syncBankSearchClear();
  runSearch();
}

function renderBankResults(list, meta = {}) {
  const box = document.getElementById("bank-results");
  if (!box) return;
  const totalCount = Number(meta.total ?? list.length) || 0;
  const start = Number(meta.start ?? 0) || 0;
  const term = String(meta.term || "").trim();

  if (!list.length && totalCount === 0) {
    box.innerHTML = "<p>No hay resultados.</p>";
    return;
  }

  const from = totalCount > 0 ? start + 1 : 0;
  const to = totalCount > 0 ? Math.min(start + list.length, totalCount) : 0;
  const showPrev = start > 0;
  const showNext = to < totalCount;
  const paginationHtml = totalCount > 0
    ? `
      <div class="row" style="justify-content:space-between;align-items:center;gap:10px;margin-top:12px;">
        <div style="width:44px;display:flex;justify-content:flex-start;">
          ${showPrev ? `<button id="bank-page-prev" class="secondary" aria-label="Página anterior">←</button>` : ""}
        </div>
        <div class="small" style="text-align:center;flex:1;">
          Mostrando de ${from} a ${to} de ${totalCount}
        </div>
        <div style="width:44px;display:flex;justify-content:flex-end;">
          ${showNext ? `<button id="bank-page-next" class="secondary" aria-label="Página siguiente">→</button>` : ""}
        </div>
      </div>
    `
    : "";

  box.innerHTML = list.map(q => {
    return `
      <div class="card" style="padding:12px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px;">
          <div><strong>ID:</strong> ${highlightBankSearchText(q.id || "", term)}</div>
          <div class="small" style="text-align:right;"><strong>Fuente:</strong> ${highlightBankSearchText(q.fuente || "", term)} ${q.modelo ? `(Modelo ${escapeHtml(q.modelo)})` : ""}</div>
        </div>
        <div style="margin-bottom:8px;"><strong>Bloque:</strong> ${highlightBankSearchText(q.bloque || "", term)}</div>
        <div style="margin-bottom:8px;"><strong>Tema:</strong> ${highlightBankSearchText(q.tema || "", term)}</div>
        <div style="margin-bottom:10px;"><strong>Pregunta:</strong> ${highlightBankSearchText(q.pregunta || "", term)}</div>
        <div>
          <div><strong>Respuestas:</strong></div>
          <div style="${q.respuesta_correcta === 0 ? "color:var(--accent-success);text-decoration:underline 2px var(--accent-success);text-underline-offset:3px;" : ""}">A) ${highlightBankSearchText(q.opciones?.[0] ?? "", term)}</div>
          <div style="${q.respuesta_correcta === 1 ? "color:var(--accent-success);text-decoration:underline 2px var(--accent-success);text-underline-offset:3px;" : ""}">B) ${highlightBankSearchText(q.opciones?.[1] ?? "", term)}</div>
          <div style="${q.respuesta_correcta === 2 ? "color:var(--accent-success);text-decoration:underline 2px var(--accent-success);text-underline-offset:3px;" : ""}">C) ${highlightBankSearchText(q.opciones?.[2] ?? "", term)}</div>
          <div style="${q.respuesta_correcta === 3 ? "color:var(--accent-success);text-decoration:underline 2px var(--accent-success);text-underline-offset:3px;" : ""}">D) ${highlightBankSearchText(q.opciones?.[3] ?? "", term)}</div>
          <div style="margin-top:6px;"><strong>Explicación:</strong> ${highlightBankSearchText(q.explicacion || "", term)}</div>
        </div>
        <div class="row" style="margin-top:10px;">
          <button data-edit="${q.id}" class="secondary">Editar</button>
          <button data-del="${q.id}" class="danger">Eliminar</button>
        </div>
      </div>
    `;
  }).join("") + paginationHtml;

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
  overlay.style.background = "var(--overlay-scrim)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "14px";
  overlay.style.zIndex = "9999";

  const card = document.createElement("div");
  card.style.background = "var(--surface)";
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
      <input id="edit-tema" style="width:100%;padding:8px;border-radius:10px;border:1px solid var(--border);" value="${escapeHtmlAttr(q.tema || "")}">
    </label>
    <label style="display:block;margin:8px 0;">Bloque:
      <input id="edit-bloque" style="width:100%;padding:8px;border-radius:10px;border:1px solid var(--border);" value="${escapeHtmlAttr(q.bloque || "")}">
    </label>
    <label style="display:block;margin:8px 0;">Fuente:
      <input id="edit-fuente" style="width:100%;padding:8px;border-radius:10px;border:1px solid var(--border);" value="${escapeHtmlAttr(q.fuente || "")}">
    </label>
    <label style="display:block;margin:8px 0;">Pregunta:
      <textarea id="edit-pregunta" style="width:100%;padding:8px;min-height:70px;border-radius:10px;border:1px solid var(--border);"></textarea>
    </label>
    <label style="display:block;margin:8px 0;">A)
      <input id="edit-a" style="width:100%;padding:8px;border-radius:10px;border:1px solid var(--border);" value="${escapeHtmlAttr(q.opciones?.[0] ?? "")}">
    </label>
    <label style="display:block;margin:8px 0;">B)
      <input id="edit-b" style="width:100%;padding:8px;border-radius:10px;border:1px solid var(--border);" value="${escapeHtmlAttr(q.opciones?.[1] ?? "")}">
    </label>
    <label style="display:block;margin:8px 0;">C)
      <input id="edit-c" style="width:100%;padding:8px;border-radius:10px;border:1px solid var(--border);" value="${escapeHtmlAttr(q.opciones?.[2] ?? "")}">
    </label>
    <label style="display:block;margin:8px 0;">D)
      <input id="edit-d" style="width:100%;padding:8px;border-radius:10px;border:1px solid var(--border);" value="${escapeHtmlAttr(q.opciones?.[3] ?? "")}">
    </label>

    <label style="display:block;margin:8px 0;">Correcta (A/B/C/D):
      <input id="edit-correcta" style="width:120px;padding:8px;border-radius:10px;border:1px solid var(--border);" value="${escapeHtmlAttr(correctLetter)}">
    </label>

    <label style="display:block;margin:8px 0;">Explicación:
      <textarea id="edit-exp" style="width:100%;padding:8px;min-height:70px;border-radius:10px;border:1px solid var(--border);"></textarea>
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
      tema, bloque, fuente,
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
  setUiScreenState("trash");

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
      Preguntas eliminadas. Puedes restaurarlas o borrarlas definitivamente.
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

    body.chatgpt-dark:not(.is-home-screen) {
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

    /* Mantener color del logo TESTA+ en home */
    body.chatgpt-dark #main-menu h1 .logo-test {
      color: var(--home-title) !important;
    }
    body.chatgpt-dark #main-menu h1 .logo-aplus,
    body.chatgpt-dark #main-menu h1 .logo-aplus .logo-a,
    body.chatgpt-dark #main-menu h1 .logo-aplus .logo-plus {
      color: var(--home-accent) !important;
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

    /* Botones: unificados con la paleta de variables del tema oscuro */
    body.chatgpt-dark button {
      background: var(--surface) !important;
      color: var(--text) !important;
      border: 1px solid var(--border) !important;
    }

    body.chatgpt-dark button:hover {
      filter: brightness(1.05);
    }

    body.chatgpt-dark button.secondary,
    body.chatgpt-dark button.success {
      background: var(--brand-soft) !important;
      border-color: color-mix(in srgb, var(--brand) 40%, var(--border)) !important;
    }

    body.chatgpt-dark button.danger {
      background: var(--error-soft) !important;
      border-color: var(--error-border) !important;
      color: var(--text) !important;
    }

    /* Voz (home): mismo color para Mónica y Google español */
    body.chatgpt-dark.is-home-screen .home-voice-choice,
    body.chari-dark.is-home-screen .home-voice-choice,
    body.chatgpt-dark.is-home-screen .home-voice-choice.secondary,
    body.chari-dark.is-home-screen .home-voice-choice.secondary,
    body.chatgpt-dark.is-home-screen .home-voice-choice.success,
    body.chari-dark.is-home-screen .home-voice-choice.success {
      background: var(--surface) !important;
      border-color: color-mix(in srgb, var(--brand) 50%, var(--border)) !important;
      box-shadow: none !important;
      color: var(--text) !important;
    }

    body.chatgpt-dark .answer-btn.is-correct {
      background: rgba(70, 160, 110, 0.28) !important;
    }
    body.chatgpt-dark .answer-btn.is-wrong {
      background: rgba(190, 90, 90, 0.28) !important;
    }

    body.chatgpt-dark .modal-overlay {
      background: rgba(4, 8, 18, 0.68) !important;
    }

    body.chatgpt-dark .modal {
      background: var(--surface-soft) !important;
      border: 1px solid var(--border) !important;
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.45) !important;
      color: var(--text) !important;
    }

    body.chatgpt-dark .modal-title,
    body.chatgpt-dark .modal-message,
    body.chatgpt-dark .modal p,
    body.chatgpt-dark .modal span,
    body.chatgpt-dark .modal div,
    body.chatgpt-dark .modal label {
      color: #e6eaf0 !important;
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
  document.body.classList.toggle("chari-dark", enabled);

  // Si quieres, aquí podríamos también ajustar algún inline style concreto si lo hubiera
  // pero por ahora lo resolvemos vía CSS global.
}

function injectDarkModeToggleIntoMainMenu() {
  const btn = document.getElementById("home-btn-darkmode");
  if (!btn) return;

  const sync = () => {
    const enabled = isDarkModeEnabled();
    btn.setAttribute("aria-pressed", String(enabled));
    btn.setAttribute("aria-label", enabled ? "Desactivar modo oscuro" : "Activar modo oscuro");
  };

  btn.onclick = () => {
    const newVal = !isDarkModeEnabled();
    setDarkModeEnabled(newVal);
    sync();
  };

  sync();
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

function escapeRegex(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightBankSearchText(text, rawTerm) {
  const source = String(text ?? "");
  const term = String(rawTerm || "").trim();
  if (!term) return escapeHtml(source);
  const re = new RegExp(`(${escapeRegex(term)})`, "ig");
  const parts = source.split(re);
  return parts
    .map((part, idx) => (idx % 2 === 1 ? `<mark class="bank-hit">${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join("");
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
        if (isSurvivalModeValue()) {
          const firstAnswerBtn = answersContainer ? answersContainer.querySelector(".answer-btn") : null;
          if (firstAnswerBtn instanceof HTMLElement) firstAnswerBtn.click();
          return;
        }
        if (noSeBtn) noSeBtn.click();
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
  showImportScreen("batch", showConfigScreen);
};
exportJsonBtn.onclick = () => exportQuestionsJSON();

backToMenuBtnResults.onclick = showMainMenu;

noSeBtn.onclick = onNoSe;

btnImportQuestions.onclick = importQuestionsFromTextarea;
btnClearImport.onclick = clearImportTextarea;
btnClearAdded.onclick = clearAddedQuestions;
btnBackFromImport.onclick = backFromImportScreen;
if (btnCopyImportTemplate) btnCopyImportTemplate.onclick = copyImportTemplateToClipboard;
if (btnToggleImportTemplate) btnToggleImportTemplate.onclick = toggleImportTemplateExpanded;
if (btnManualAddQuestion) btnManualAddQuestion.onclick = addManualQuestionToPool;
if (manualBloqueInput) {
  manualBloqueInput.onchange = () => {
    refreshManualTemaOptionsForBloque(String(manualBloqueInput.value || ""));
  };
}
if (voiceSettingsBackBtn) voiceSettingsBackBtn.onclick = showConfigScreen;
if (motivationalPhraseEl) {
  motivationalPhraseEl.title = "Pulsa para cambiar la frase";
  motivationalPhraseEl.addEventListener("click", e => {
    e.preventDefault();
    const selection = window.getSelection ? window.getSelection() : null;
    if (selection && selection.removeAllRanges) selection.removeAllRanges();
    renderMotivationalPhrase(true, true);
  });
}

// =======================
// INIT
// =======================
function isVisibleEl(el) {
  return !!(el && el.offsetParent !== null);
}

function isTestScreenVisible() {
  if (!testContainer) return false;
  const style = window.getComputedStyle(testContainer);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function handleEscBack() {
  const isModalOpen = !!(
    modalOverlay &&
    modalOverlay.getAttribute("aria-hidden") === "false" &&
    window.getComputedStyle(modalOverlay).display !== "none"
  );
  if (isModalOpen) return;

  const pauseBtn = document.getElementById("pause-btn");
  if (isTestScreenVisible() && isVisibleEl(pauseBtn)) {
    pauseBtn.click();
    return;
  }

  const homeVoiceRow = document.getElementById("home-voice-row");
  if (homeVoiceRow && homeVoiceRow.classList.contains("is-voice-open")) {
    closeHomeVoicePanel();
    return;
  }

  const mainConfigRow = document.getElementById("main-config-row");
  if (mainConfigRow && mainConfigRow.classList.contains("is-config-open")) {
    closeHomeConfigPanel();
    return;
  }

  const mainPrimaryRow = document.getElementById("main-primary-row");
  if (mainPrimaryRow && mainPrimaryRow.classList.contains("is-start-open")) {
    closeHomeStartPanel();
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

function initMobilePortraitLock() {
  const tryLockPortrait = () => {
    const orientation = screen && screen.orientation;
    if (!orientation || typeof orientation.lock !== "function") return;
    orientation.lock("portrait").catch(() => {});
  };

  // Limpieza por si en una versión anterior se activó el overlay de orientación.
  if (document.body) document.body.classList.remove("orientation-lock-active");

  window.addEventListener("orientationchange", tryLockPortrait, { passive: true });
  window.addEventListener("resize", tryLockPortrait, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      tryLockPortrait();
    }
  });
  tryLockPortrait();
}

initMobilePortraitLock();

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
  .then(async datasets => {
    const merged = [];
    for (const data of datasets) {
      if (Array.isArray(data)) merged.push(...data);
    }
    questionsBase = merged;
    mergeQuestions();
    applyDeletedFilter();
    refreshDbCountPill();
    await restoreUiScreenAfterBootstrap();
  })
  .catch(async err => {
    showAlert("Error cargando questions_manifest.json o alguno de sus archivos");
    console.error(err);
    questionsBase = [];
    mergeQuestions();
    applyDeletedFilter();
    refreshDbCountPill();
    await restoreUiScreenAfterBootstrap();
  })
  .finally(() => {
    markAppReadyForSplashExit();
  });

  // commit test identidad noreply
