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
  const responses = Array.isArray(review) ? review : [review];
  const requestBodies = [];
  const context = {
    console,
    document,
    localStorage: makeStorage({ "spanish-review.openai.api-key": "sk-test" }),
    sessionStorage: makeStorage(),
    setTimeout: (fn) => fn(),
    fetch: async (_url, options) => {
      const responseIndex = requestBodies.length;
      requestBodies.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({ output_text: JSON.stringify(responses[Math.min(responseIndex, responses.length - 1)]) })
      };
    }
  };
  context.globalThis = context;
  context.window = { scrollTo() {} };
  vm.runInNewContext(APP_SOURCE, context, { filename: "app.js" });
  return {
    elements,
    getRequestBody: () => requestBodies.at(-1),
    getRequestBodies: () => requestBodies
  };
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

function clearReview(overrides = {}) {
  return {
    errors: [],
    translation: {
      status: "clear",
      english: "Yesterday I went to the market.",
      alternatives: [],
      explanation: ""
    },
    natural_version: "",
    ...overrides
  };
}

function correction(overrides = {}) {
  return {
    original: "entiendo",
    occurrence: 1,
    insertion_anchor: "",
    insertion_side: "none",
    replacement: "entiende",
    category: "Conjugación verbal",
    explanation: "Usted requiere la forma de tercera persona entiende.",
    ...overrides
  };
}

test("review requests and displays one clear English meaning", async () => {
  const harness = loadApp({
    errors: [],
    translation: {
      status: "clear",
      english: "Yesterday I went to the market.",
      alternatives: [],
      explanation: ""
    },
    natural_version: ""
  });

  await submitReview(harness, "Ayer fui al mercado.");

  assert.equal(harness.elements.get("#english-translation").textContent, "Yesterday I went to the market.");
  assert.equal(harness.elements.get("#english-translation").hidden, false);
  assert.equal(harness.elements.get("#review-summary").textContent, "No corrections found.");
  const body = harness.getRequestBody();
  assert.ok(body.text.format.schema.required.includes("translation"));
  assert.deepEqual(Array.from(body.text.format.schema.properties.translation.properties.status.enum), ["clear", "ambiguous", "withheld"]);
  assert.doesNotMatch(JSON.stringify(body.text.format.schema.properties.errors), /"start"|"end"/);
  assert.match(body.instructions, /never combine incompatible perspectives/i);
  assert.match(body.instructions, /do not force a translation of malformed Spanish/i);
  assert.match(HTML_SOURCE, /Your meaning in English/);
  assert.match(HTML_SOURCE, /Possible intended meanings/);
});

test("ambiguous wording withholds a single translation and shows grammatical alternatives", async () => {
  const harness = loadApp({
    errors: [correction()],
    translation: {
      status: "ambiguous",
      english: "",
      alternatives: ["You understand yourself perfectly.", "I understand you perfectly."],
      explanation: "Usted and se conflict with the first-person verb entiendo."
    },
    natural_version: ""
  });

  await submitReview(harness, "Usted se entiendo perfectamente");

  assert.equal(harness.elements.get("#correction-count").textContent, "1 correction");
  assert.equal(harness.elements.get("#review-summary").textContent, "1 correction found.");
  assert.equal(harness.elements.get("#english-translation").textContent, "");
  assert.equal(harness.elements.get("#english-translation").hidden, true);
  assert.equal(harness.elements.get("#translation-heading").textContent, "Your meaning is ambiguous");
  assert.equal(harness.elements.get("#translation-explanation").textContent, "Usted and se conflict with the first-person verb entiendo.");
  assert.deepEqual(
    harness.elements.get("#translation-alternatives-list").children.map((item) => item.textContent),
    ["You understand yourself perfectly.", "I understand you perfectly."]
  );
  assert.ok(!harness.elements.get("#translation-alternatives-list").children.some((item) => /You understand myself/i.test(item.textContent)));
});

test("withheld meaning explains why no English translation is displayed", async () => {
  const harness = loadApp(clearReview({
    translation: {
      status: "withheld",
      english: "",
      alternatives: [],
      explanation: "The wording does not establish who did what."
    }
  }));

  await submitReview(harness, "Frandular se yo.");

  assert.equal(harness.elements.get("#translation-heading").textContent, "Your meaning is unclear");
  assert.equal(harness.elements.get("#translation-status").textContent, "A reliable English translation cannot be shown.");
  assert.equal(harness.elements.get("#english-translation").hidden, true);
  assert.equal(harness.elements.get("#translation-explanation").textContent, "The wording does not establish who did what.");
});

test("an invalid correction locator is retried and never silently discarded", async () => {
  const invalid = clearReview({
    errors: [correction({ original: "entiendes" })]
  });
  const valid = clearReview({
    errors: [correction()],
    translation: {
      status: "ambiguous",
      english: "",
      alternatives: ["You understand yourself perfectly.", "I understand you perfectly."],
      explanation: "The grammatical persons conflict."
    }
  });
  const harness = loadApp([invalid, valid]);

  await submitReview(harness, "Usted se entiendo perfectamente");

  assert.equal(harness.getRequestBodies().length, 2);
  assert.match(harness.getRequestBody().instructions, /previous response.*could not be rendered/is);
  assert.equal(harness.elements.get("#correction-count").textContent, "1 correction");
  assert.equal(harness.elements.get("#results-view").hidden, false);
});

test("two invalid reviews fail closed instead of claiming no corrections", async () => {
  const invalid = clearReview({ errors: [correction({ original: "not in the submitted text" })] });
  const harness = loadApp([invalid, invalid]);

  await submitReview(harness, "Usted se entiendo perfectamente");

  assert.equal(harness.getRequestBodies().length, 2);
  assert.equal(harness.elements.get("#composer-view").hidden, false);
  assert.equal(harness.elements.get("#results-view").hidden, true);
  assert.match(harness.elements.get("#key-reminder").textContent, /review could not be verified/i);
  assert.notEqual(harness.elements.get("#correction-list").textContent, "No corrections needed.");
});

test("occurrence locators resolve repeated text deterministically", async () => {
  const harness = loadApp(clearReview({
    errors: [correction({ original: "como", occurrence: 2, replacement: "cómo" })],
    translation: {
      status: "clear",
      english: "I eat however I want.",
      alternatives: [],
      explanation: ""
    }
  }));

  await submitReview(harness, "como como quiero.");

  const annotated = harness.elements.get("#annotated-text").children;
  assert.equal(annotated[0].textContent, "como ");
  assert.equal(annotated[1].textContent, "como");
  assert.equal(harness.elements.get("#correction-count").textContent, "1 correction");
});

test("insertion anchors resolve missing punctuation without model-generated offsets", async () => {
  const harness = loadApp(clearReview({
    errors: [correction({
      original: "",
      occurrence: 1,
      insertion_anchor: "Hola",
      insertion_side: "after",
      replacement: ",",
      category: "Puntuación",
      explanation: "Use a comma before the direct address."
    })],
    translation: {
      status: "clear",
      english: "Hello, Ana.",
      alternatives: [],
      explanation: ""
    }
  }));

  await submitReview(harness, "Hola Ana.");

  const annotated = harness.elements.get("#annotated-text").children;
  assert.equal(annotated[0].textContent, "Hola");
  assert.match(annotated[1].textContent, /^\+ , 1$/);
  assert.equal(annotated[2].textContent, " Ana.");
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
