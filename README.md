# Spanish writing review

A static Spanish writing-review tool for GitHub Pages. Learners paste Spanish writing, receive structured corrections annotated in the original text, and can ask a follow-up question.

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

- The app calls the OpenAI Responses API from the browser, using `gpt-5.6-terra` with medium reasoning for reviews and low reasoning for follow-up questions.
- Review and follow-up calls use strict JSON Schema structured outputs. Review annotations are UTF-16 JavaScript spans, allowing the UI to underline the exact submitted text.
- API keys are not committed or hard-coded. Each learner enters a key in the API key panel; it is stored in that browser's `localStorage` and sent directly to OpenAI.
- A static site cannot keep an API key secret from someone using that browser. Use a dedicated, appropriately scoped key and avoid shared browsers. A production multi-user deployment should use a server-side proxy or an ephemeral-token flow instead.
- `store: false` is set on API calls. The app also sends a randomly generated, browser-local `safety_identifier` as recommended for end-user applications.

## Model availability

The app follows the requested GPT-5.6 family and uses `gpt-5.6-terra`, chosen for short, repeated language reviews. GPT-5.6 availability may be limited to eligible accounts during preview. If an API key lacks access, OpenAI will return an error in the app; change `MODEL` in `app.js` only if you intentionally want a different available model.
