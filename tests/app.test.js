const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const APP_SOURCE = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const HTML_SOURCE = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  toggle(value, force) {
    if (force === true) this.values.add(value);
    else if (force === false) this.values.delete(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
  }
}

class FakeElement {
  constructor() {
    this.children = [];
    this.classList = new FakeClassList();
    this.dataset = {};
    this.hidden = false;
    this.checked = false;
    this.textContent = "";
    this.value = "";
    this.listeners = new Map();
    this.content = this;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
    this.textContent = "";
  }

  querySelector() {
    return new FakeElement();
  }

  cloneNode() {
    return new FakeElement();
  }

  setAttribute() {}
  removeAttribute() {}
  focus() {}
  scrollIntoView() {}
  remove() {}
}

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function loadApp(review) {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new FakeElement());
      return elements.get(selector);
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return new FakeElement();
    },
    createTextNode(text) {
      return { textContent: text };
    }
  };
  let requestBody;
  const context = {
    console,
    document,
    localStorage: makeStorage({ "spanish-review.openai.api-key": "sk-test" }),
    sessionStorage: makeStorage(),
    setTimeout: (fn) => fn(),
    fetch: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ output_text: JSON.stringify(review) })
      };
    }
  };
  context.globalThis = context;
  context.window = { scrollTo() {} };
  vm.runInNewContext(APP_SOURCE, context, { filename: "app.js" });
  return { elements, getRequestBody: () => requestBody };
}

async function submitReview(harness, text) {
  const form = harness.elements.get("#review-form");
  harness.elements.get("#student-text").value = text;
  await form.listeners.get("submit")({ preventDefault() {} });
}

async function submitExpression(harness, idea, closeTranslation = false) {
  const form = harness.elements.get("#expression-form");
  harness.elements.get("#idea-text").value = idea;
  harness.elements.get("#close-translation").checked = closeTranslation;
  await form.listeners.get("submit")({ preventDefault() {} });
}

test("review requests and displays a faithful English translation", async () => {
  const harness = loadApp({
    summary: "Bien escrito.",
    errors: [],
    english_translation: "Yesterday I went to the market.",
    natural_version: ""
  });

  await submitReview(harness, "Ayer fui al mercado.");

  assert.equal(harness.elements.get("#english-translation").textContent, "Yesterday I went to the market.");
  const body = harness.getRequestBody();
  assert.ok(body.text.format.schema.required.includes("english_translation"));
  assert.match(body.instructions, /translate the submitted wording rather than the corrected or natural version/i);
  assert.match(HTML_SOURCE, /Your meaning in English/);
  assert.match(HTML_SOURCE, /Ambiguous or incomprehensible wording may be marked as unclear/);
});

test("best-effort translation preserves an unclear marker", async () => {
  const harness = loadApp({
    summary: "Parte del texto no está claro.",
    errors: [],
    english_translation: "I want to [unclear] tomorrow.",
    natural_version: ""
  });

  await submitReview(harness, "Quiero frandular mañana.");

  assert.equal(harness.elements.get("#english-translation").textContent, "I want to [unclear] tomorrow.");
});

test("an incomplete review cannot silently render a blank translation", async () => {
  const harness = loadApp({ summary: "Bien escrito.", errors: [], natural_version: "" });

  await submitReview(harness, "Hola.");

  assert.equal(harness.elements.get("#composer-view").hidden, false);
  assert.equal(harness.elements.get("#results-view").hidden, true);
  assert.match(harness.elements.get("#key-reminder").textContent, /review was incomplete/i);
});

test("expression mode defaults to natural meaning rather than close translation", async () => {
  const harness = loadApp({
    spanish_expression: "Voy un poco tarde, pero ya casi llego.",
    note: ""
  });

  await submitExpression(harness, "I want to politely tell a friend that I am running late but will be there soon.");

  assert.equal(harness.elements.get("#spanish-expression").textContent, "Voy un poco tarde, pero ya casi llego.");
  assert.equal(harness.elements.get("#expression-preference").textContent, "Natural phrasing");
  const body = harness.getRequestBody();
  assert.equal(JSON.parse(body.input).close_translation, false);
  assert.match(body.instructions, /do not translate word for word/i);
  assert.match(HTML_SOURCE, /Keep it close to my wording/);
});

test("expression mode requests a still-natural close translation when checked", async () => {
  const harness = loadApp({
    spanish_expression: "No dejes para mañana lo que puedas hacer hoy.",
    note: "This keeps the original proverb-like structure."
  });

  await submitExpression(harness, "Don't put off until tomorrow what you can do today.", true);

  const body = harness.getRequestBody();
  assert.equal(JSON.parse(body.input).close_translation, true);
  assert.match(body.instructions, /still-natural translation that stays as close as reasonably possible/i);
  assert.equal(harness.elements.get("#expression-preference").textContent, "Close translation");
  assert.equal(harness.elements.get("#expression-note-panel").hidden, false);
});

test("an incomplete expression returns to the expression composer", async () => {
  const harness = loadApp({ spanish_expression: "", note: "" });

  await submitExpression(harness, "Tell them I will call tomorrow.");

  assert.equal(harness.elements.get("#expression-composer-view").hidden, false);
  assert.equal(harness.elements.get("#expression-results-view").hidden, true);
  assert.match(harness.elements.get("#expression-key-reminder").textContent, /expression was incomplete/i);
});
