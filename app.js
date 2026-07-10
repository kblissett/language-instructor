(() => {
  "use strict";

  // This is intentionally a browser-only app. Nothing here is a secret; the API key
  // is supplied by the learner at runtime and saved only in that browser's localStorage.
  const API_URL = "https://api.openai.com/v1/responses";
  const MODEL = "gpt-5.6-terra";
  const KEY_STORAGE = "spanish-review.openai.api-key";
  const SAFETY_ID_STORAGE = "spanish-review.safety-id";
  const MAX_CHARS = 1800;

  const REVIEW_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "errors", "natural_version"],
    properties: {
      summary: {
        type: "string",
        description: "A short, encouraging summary of the review in the learner's language when possible."
      },
      errors: {
        type: "array",
        description: "Every actual error or clearly non-natural phrase worth changing. Keep spans atomic, sorted, and non-overlapping.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["start", "end", "original", "replacement", "category", "explanation"],
          properties: {
            start: { type: "integer", minimum: 0, description: "Zero-based UTF-16 JavaScript string offset into the submitted text." },
            end: { type: "integer", minimum: 0, description: "Exclusive UTF-16 JavaScript string offset into the submitted text." },
            original: { type: "string", description: "Must exactly equal text.slice(start, end). Use an empty string for a missing word or punctuation mark." },
            replacement: { type: "string", description: "The corrected text that replaces original, or the inserted text when original is empty." },
            category: { type: "string", description: "A brief category, such as Agreement, Verb tense, Spelling, Word choice, or Punctuation." },
            explanation: { type: "string", description: "A compact, precise explanation that teaches the relevant Spanish rule or usage." }
          }
        }
      },
      natural_version: {
        type: "string",
        description: "An optional, more natural full rewrite. Use an empty string when the original is already natural or a rewrite would not help."
      }
    }
  };

  const FOLLOW_UP_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["answer"],
    properties: {
      answer: { type: "string", description: "A short, accurate, friendly answer to the learner's question." }
    }
  };

  const REVIEW_INSTRUCTIONS = `You are a careful and encouraging Spanish writing instructor. Review the learner's Spanish text exactly as written.

Find every real error in grammar, spelling, punctuation, agreement, verb form, syntax, or word choice. Also identify wording that is clearly unnatural for ordinary Spanish, but do not mark harmless regional variation, personal style, or a correct alternative as an error. Keep corrections atomic: one span should cover one teachable issue. Do not create overlapping spans.

Each annotation must use zero-based UTF-16 JavaScript string offsets in the original text. The required invariant is original === text.slice(start, end). For something missing, use start === end and original === "" at the exact insertion point. The replacement must be only the text that should replace the span. Check all offsets and this invariant before responding.

Use a short, concrete category and a concise explanation. Include a more natural full version only when it gives the learner useful optional phrasing; otherwise return an empty string. Be supportive, precise, and avoid filler.`;

  const els = {
    composer: document.querySelector("#composer-view"),
    results: document.querySelector("#results-view"),
    reviewForm: document.querySelector("#review-form"),
    text: document.querySelector("#student-text"),
    characterCount: document.querySelector("#character-count"),
    reviewButton: document.querySelector("#review-button"),
    keyReminder: document.querySelector("#key-reminder"),
    summary: document.querySelector("#review-summary"),
    annotatedText: document.querySelector("#annotated-text"),
    correctionList: document.querySelector("#correction-list"),
    correctionCount: document.querySelector("#correction-count"),
    naturalPanel: document.querySelector("#natural-panel"),
    naturalVersion: document.querySelector("#natural-version"),
    followUpForm: document.querySelector("#follow-up-form"),
    followUpInput: document.querySelector("#follow-up-input"),
    followUpButton: document.querySelector("#follow-up-button"),
    conversation: document.querySelector("#conversation"),
    settings: document.querySelector("#settings-dialog"),
    settingsForm: document.querySelector("#settings-form"),
    openSettings: document.querySelector("#open-settings"),
    closeSettings: document.querySelector("#close-settings"),
    apiKey: document.querySelector("#api-key"),
    keyError: document.querySelector("#key-error"),
    toggleKey: document.querySelector("#toggle-key"),
    forgetKey: document.querySelector("#forget-key"),
    loadingTemplate: document.querySelector("#loading-template")
  };

  let currentReview = null;
  let currentText = "";

  function getApiKey() {
    return localStorage.getItem(KEY_STORAGE) || "";
  }

  function saveApiKey(key) {
    localStorage.setItem(KEY_STORAGE, key);
    updateKeyReminder();
  }

  function getSafetyIdentifier() {
    let id = localStorage.getItem(SAFETY_ID_STORAGE);
    if (!id) {
      const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      id = `spanish_review_${random}`;
      localStorage.setItem(SAFETY_ID_STORAGE, id);
    }
    return id;
  }

  function updateKeyReminder() {
    const hasKey = Boolean(getApiKey());
    els.keyReminder.textContent = hasKey ? "API key saved in this browser." : "Add an API key in Settings to begin.";
    els.keyReminder.classList.toggle("is-ready", hasKey);
  }

  function updateCharacterCount() {
    els.characterCount.textContent = `${els.text.value.length} / ${MAX_CHARS}`;
  }

  function openSettings() {
    els.keyError.textContent = "";
    els.apiKey.value = getApiKey();
    if (typeof els.settings.showModal === "function") {
      els.settings.showModal();
    } else {
      els.settings.setAttribute("open", "");
    }
    setTimeout(() => els.apiKey.focus(), 0);
  }

  function closeSettings() {
    if (typeof els.settings.close === "function") els.settings.close();
    else els.settings.removeAttribute("open");
  }

  function makeFormat(name, schema) {
    return { type: "json_schema", name, strict: true, schema };
  }

  async function callOpenAI(payload) {
    const key = getApiKey();
    if (!key) {
      openSettings();
      throw new Error("Add an OpenAI API key to continue.");
    }

    let response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({ ...payload, safety_identifier: getSafetyIdentifier(), store: false })
      });
    } catch (error) {
      throw new Error("The connection to OpenAI failed. Check your network and try again.");
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error("OpenAI returned an unreadable response. Please try again.");
    }
    if (!response.ok) {
      throw new Error(data?.error?.message || "OpenAI could not complete this request.");
    }
    return data;
  }

  function extractOutputText(response) {
    if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text;
    for (const item of response.output || []) {
      for (const content of item.content || []) {
        if (content.type === "output_text" && typeof content.text === "string") return content.text;
        if (content.type === "refusal") throw new Error(content.refusal || "The instructor could not review that text.");
      }
    }
    throw new Error("The instructor did not return a response. Please try again.");
  }

  function parseStructuredResponse(response) {
    const output = extractOutputText(response);
    try {
      return JSON.parse(output);
    } catch (error) {
      throw new Error("The instructor returned an unexpected format. Please try again.");
    }
  }

  function clampAnnotation(annotation, text) {
    if (!annotation || !Number.isInteger(annotation.start) || !Number.isInteger(annotation.end)) return null;
    const start = annotation.start;
    const end = annotation.end;
    if (start < 0 || end < start || end > text.length || typeof annotation.original !== "string") return null;
    if (text.slice(start, end) !== annotation.original) return null;
    if (typeof annotation.replacement !== "string" || typeof annotation.category !== "string" || typeof annotation.explanation !== "string") return null;
    return { ...annotation, start, end };
  }

  function validateReview(review, text) {
    if (!review || typeof review.summary !== "string" || !Array.isArray(review.errors)) {
      throw new Error("The instructor’s review was incomplete. Please try again.");
    }
    const errors = review.errors
      .map((annotation) => clampAnnotation(annotation, text))
      .filter(Boolean)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const nonOverlapping = [];
    let lastEnd = -1;
    for (const error of errors) {
      if (error.start < lastEnd || (error.start === lastEnd && error.start === error.end && lastEnd === error.start)) continue;
      nonOverlapping.push(error);
      lastEnd = error.end;
    }
    return {
      summary: review.summary,
      errors: nonOverlapping,
      natural_version: typeof review.natural_version === "string" ? review.natural_version.trim() : ""
    };
  }

  function createAnnotationButton(error, number) {
    const isInsertion = error.start === error.end;
    const button = document.createElement("button");
    button.type = "button";
    button.className = isInsertion ? "annotation-insertion" : "annotation";
    button.setAttribute("aria-label", `Correction ${number}: ${error.category}. ${error.explanation}`);
    button.dataset.correction = String(number);

    if (isInsertion) {
      button.textContent = `+ ${error.replacement || "mark"} ${number}`;
    } else {
      button.textContent = error.original;
      const bubble = document.createElement("sup");
      bubble.className = "annotation-number";
      bubble.textContent = String(number);
      bubble.setAttribute("aria-hidden", "true");
      button.append(bubble);
    }
    button.addEventListener("click", () => highlightCorrection(number));
    return button;
  }

  function renderAnnotatedText(text, errors) {
    els.annotatedText.replaceChildren();
    let cursor = 0;
    errors.forEach((error, index) => {
      if (error.start > cursor) els.annotatedText.append(document.createTextNode(text.slice(cursor, error.start)));
      els.annotatedText.append(createAnnotationButton(error, index + 1));
      cursor = error.end;
    });
    if (cursor < text.length) els.annotatedText.append(document.createTextNode(text.slice(cursor)));
    if (!errors.length) els.annotatedText.textContent = text;
  }

  function buildCorrectionCard(error, number) {
    const card = document.createElement("article");
    card.className = "correction-card";
    card.id = `correction-${number}`;
    card.tabIndex = -1;

    const numberBadge = document.createElement("span");
    numberBadge.className = "correction-number";
    numberBadge.textContent = String(number);

    const content = document.createElement("div");
    const category = document.createElement("p");
    category.className = "correction-category";
    category.textContent = error.category;

    const change = document.createElement("div");
    change.className = "correction-change";
    const original = document.createElement("span");
    original.className = "original-word";
    original.textContent = error.original || "∅";
    const arrow = document.createElement("span");
    arrow.className = "change-arrow";
    arrow.textContent = "→";
    const replacement = document.createElement("span");
    replacement.className = "replacement-word";
    replacement.textContent = error.replacement || "remove";
    change.append(original, arrow, replacement);

    const explanation = document.createElement("p");
    explanation.className = "correction-explanation";
    explanation.textContent = error.explanation;
    content.append(category, change, explanation);
    card.append(numberBadge, content);
    return card;
  }

  function renderCorrections(review) {
    els.correctionList.replaceChildren();
    const count = review.errors.length;
    els.correctionCount.textContent = `${count} ${count === 1 ? "note" : "notes"}`;

    if (!count) {
      const clean = document.createElement("div");
      clean.className = "empty-review";
      const title = document.createElement("strong");
      title.textContent = "No corrections needed.";
      clean.append(title, document.createTextNode("This reads clearly as written. Keep going."));
      els.correctionList.append(clean);
      return;
    }
    review.errors.forEach((error, index) => els.correctionList.append(buildCorrectionCard(error, index + 1)));
  }

  function renderNaturalVersion(naturalVersion) {
    if (naturalVersion) {
      els.naturalVersion.textContent = naturalVersion;
      els.naturalPanel.hidden = false;
    } else {
      els.naturalPanel.hidden = true;
    }
  }

  function highlightCorrection(number) {
    document.querySelectorAll(".correction-card.is-highlighted").forEach((card) => card.classList.remove("is-highlighted"));
    const target = document.querySelector(`#correction-${number}`);
    if (!target) return;
    target.classList.add("is-highlighted");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }

  function renderReview(review, text) {
    currentReview = review;
    currentText = text;
    els.summary.textContent = review.summary;
    renderAnnotatedText(text, review.errors);
    renderCorrections(review);
    renderNaturalVersion(review.natural_version);
    els.conversation.replaceChildren();
    els.composer.hidden = true;
    els.results.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderLoading(container, label) {
    const node = els.loadingTemplate.content.cloneNode(true);
    node.querySelector("span:last-child").textContent = label;
    container.replaceChildren(node);
  }

  function renderError(container, message) {
    const box = document.createElement("div");
    box.className = "empty-review";
    const title = document.createElement("strong");
    title.textContent = "Something went wrong.";
    box.append(title, document.createTextNode(message));
    container.replaceChildren(box);
  }

  function appendMessage(kind, label, text) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${kind}`;
    const tag = document.createElement("span");
    tag.className = "chat-label";
    tag.textContent = label;
    bubble.append(tag, document.createTextNode(text));
    els.conversation.append(bubble);
    bubble.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function submitReview(event) {
    event.preventDefault();
    const text = els.text.value;
    if (!text.trim()) {
      els.text.focus();
      return;
    }
    if (!getApiKey()) {
      openSettings();
      return;
    }

    els.reviewButton.disabled = true;
    els.reviewButton.innerHTML = "Reviewing…";
    renderLoading(els.summary, "Reviewing your Spanish…");
    els.composer.hidden = true;
    els.results.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });

    try {
      const response = await callOpenAI({
        model: MODEL,
        reasoning: { effort: "medium" },
        text: { verbosity: "medium", format: makeFormat("spanish_writing_review", REVIEW_SCHEMA) },
        instructions: REVIEW_INSTRUCTIONS,
        input: `Here is the learner's Spanish text. Review only this text.\n\n<text>\n${text}\n</text>`
      });
      const review = validateReview(parseStructuredResponse(response), text);
      renderReview(review, text);
    } catch (error) {
      els.composer.hidden = false;
      els.results.hidden = true;
      els.keyReminder.textContent = error.message;
      els.keyReminder.classList.remove("is-ready");
    } finally {
      els.reviewButton.disabled = false;
      els.reviewButton.innerHTML = "<span>Review</span>";
    }
  }

  async function submitFollowUp(event) {
    event.preventDefault();
    const question = els.followUpInput.value.trim();
    if (!question || !currentReview) return;
    if (!getApiKey()) {
      openSettings();
      return;
    }

    appendMessage("question", "You", question);
    els.followUpInput.value = "";
    els.followUpInput.disabled = true;
    els.followUpButton.disabled = true;
    const waiting = document.createElement("div");
    waiting.className = "chat-bubble answer";
    waiting.textContent = "Thinking…";
    els.conversation.append(waiting);

    try {
      const context = JSON.stringify(currentReview);
      const response = await callOpenAI({
        model: MODEL,
        reasoning: { effort: "low" },
        text: { verbosity: "medium", format: makeFormat("spanish_follow_up_answer", FOLLOW_UP_SCHEMA) },
        instructions: "You are a precise Spanish instructor. Answer the learner's question using the original text and the completed review below. Do not perform a new full review, do not re-list every correction, and do not mention JSON. Be concise, supportive, and technically accurate. Answer in the language the learner used for their question unless they ask otherwise.",
        input: `Original text:\n${currentText}\n\nCompleted review:\n${context}\n\nLearner question:\n${question}`
      });
      const result = parseStructuredResponse(response);
      if (!result || typeof result.answer !== "string" || !result.answer.trim()) throw new Error("The instructor did not return an answer.");
      waiting.remove();
      appendMessage("answer", "Instructor", result.answer.trim());
    } catch (error) {
      waiting.textContent = error.message;
    } finally {
      els.followUpInput.disabled = false;
      els.followUpButton.disabled = false;
      els.followUpInput.focus();
    }
  }

  function resetApp() {
    currentReview = null;
    currentText = "";
    els.results.hidden = true;
    els.composer.hidden = false;
    els.text.value = "";
    updateCharacterCount();
    els.keyReminder.textContent = getApiKey() ? "API key saved in this browser." : "Add an API key in Settings to begin.";
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => els.text.focus(), 250);
  }

  els.text.addEventListener("input", updateCharacterCount);
  els.reviewForm.addEventListener("submit", submitReview);
  els.followUpForm.addEventListener("submit", submitFollowUp);
  els.openSettings.addEventListener("click", openSettings);
  els.closeSettings.addEventListener("click", closeSettings);
  document.querySelectorAll("[data-new-query]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    resetApp();
  }));
  els.toggleKey.addEventListener("click", () => {
    const showing = els.apiKey.type === "text";
    els.apiKey.type = showing ? "password" : "text";
    els.toggleKey.textContent = showing ? "Show" : "Hide";
    els.toggleKey.setAttribute("aria-pressed", String(!showing));
  });
  els.forgetKey.addEventListener("click", () => {
    localStorage.removeItem(KEY_STORAGE);
    els.apiKey.value = "";
    els.keyError.textContent = "Key removed from this browser.";
    updateKeyReminder();
  });
  els.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const key = els.apiKey.value.trim();
    if (!key) {
      els.keyError.textContent = "Enter an API key, or use “Forget key” to remove the saved one.";
      return;
    }
    if (!key.startsWith("sk-")) {
      els.keyError.textContent = "That does not look like an OpenAI API key.";
      return;
    }
    saveApiKey(key);
    closeSettings();
  });
  els.settings.addEventListener("click", (event) => {
    if (event.target === els.settings) closeSettings();
  });

  updateCharacterCount();
  updateKeyReminder();
})();
