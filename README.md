# Spanish language instructor

A static Spanish learning tool for GitHub Pages with two modes:

- **Check writing:** learners paste Spanish writing, receive structured corrections annotated in the original text, see a reliable English meaning when one is available, and can ask a follow-up question. Ambiguous or uninterpretable wording is identified instead of being forced into a translation.
- **Express an idea:** learners describe what they want to communicate in any language and receive one natural, clear, idiomatic Spanish expression. An optional per-request checkbox asks for a still-natural translation that stays close to the original wording.

## Run locally

There is no build step or dependency installation. Serve this folder with any static web server, for example:

```sh
uv run python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy to GitHub Pages

1. Push these files to a GitHub repository.
2. In the repository, open **Settings → Pages**.
3. Select **Deploy from a branch**, then choose the branch and its root folder.
4. Save. GitHub Pages will publish `index.html` directly—no build configuration is needed.

## API and privacy notes

- The app calls the OpenAI Responses API from the browser, using `gpt-5.6-terra` with medium reasoning for reviews and expressions and low reasoning for follow-up questions.
- Review and follow-up calls use strict JSON Schema structured outputs. Translation results explicitly distinguish clear, ambiguous, and withheld meanings; ambiguous results can include grammatical possible interpretations, while unreliable translations are not displayed. Review corrections use exact source substrings and occurrence-based locators that the browser resolves to spans, and an invalid review is retried once rather than partially rendered.
- API keys are not committed or hard-coded. Each learner enters their own key in the API key panel; it is stored in that browser's `localStorage` and sent directly to OpenAI. Use **Forget key** before leaving a shared device.
- A static site cannot keep an API key secret from someone using that browser. Use a dedicated, appropriately restricted key and avoid shared browsers. A production multi-user deployment should use a server-side proxy or an ephemeral-token flow instead.
- The site has a restrictive Content Security Policy: it loads scripts and styles only from itself, and permits network requests only to the OpenAI API. It contains no analytics, third-party scripts, or server-side data store.
- `store: false` is set on API calls, and prompt caching uses explicit mode without cache breakpoints so one-turn reviews do not incur cache-write costs. The app also sends a randomly generated, browser-local `safety_identifier` as recommended for end-user applications.

## Model availability

The app follows the requested GPT-5.6 family and uses `gpt-5.6-terra`, chosen for short, repeated language reviews. GPT-5.6 availability may be limited to eligible accounts during preview. If an API key lacks access, OpenAI will return an error in the app; change `MODEL` in `app.js` only if you intentionally want a different available model.
