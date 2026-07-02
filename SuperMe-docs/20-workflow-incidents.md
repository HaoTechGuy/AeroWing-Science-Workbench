# Workflow Incidents

## 2026-07-02 DeepSeek text-only endpoint rejected image_url history

- Time: failure observed at 2026-07-02T15:13:05Z after about 20m43s.
- Symptom: the web UI/backend surfaced `RuntimeError: An internal error occurred`.
- Actual cause: the local runtime sent a chat history containing an `image_url` content block to a DeepSeek OpenAI-compatible endpoint that only accepts text blocks. DeepSeek returned HTTP 400 with `unknown variant image_url, expected text`.
- Why it looked generic: the backend RemoteGraph boundary only received the outer `An internal error occurred` message, while the actionable provider error remained in `.internagents/logs/local-runtime.log`.
- Fix: extend the image compatibility middleware to detect DeepSeek's text-only `image_url` deserialization error, strip image blocks, append an explicit text-only notice, and retry the model call. Also rewrite generic remote runtime errors to point operators to local-runtime logs by thread/run id.
- Follow-up: user-facing error formatting now maps this provider error to a concrete Chinese message explaining that the current model endpoint rejected `image_url` blocks and only accepts `text`.
- Verification: `python -m compileall agent.py`, `python -m unittest tests.test_remote_runtime_image_compat`, and `git diff --check -- agent.py tests/test_remote_runtime_image_compat.py`.
