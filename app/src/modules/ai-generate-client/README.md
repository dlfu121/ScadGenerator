# OpenSCAD AI Generator (MVP)

This module configures an Agents SDK client against an OpenAI-compatible endpoint and generates OpenSCAD code from natural language.

## Setup

1. Copy `.env.example` to `.env` and set `QN_API_KEY`.
2. Install dependencies:
   - `pip install -r requirements.txt`
3. Run:
   - `python app/src/modules/ai-generate-client/ai.py "Generate a parametric vase with twist and 2mm wall thickness"`

## Notes

- API mode is explicitly set to `chat_completions`.
- Tracing is disabled for compatibility with some gateways.
- The output parser extracts code from markdown code fences when present.

## Test Doc (Env Style)

If you want to run the poem-generation test snippet using the same API style as this project (env vars instead of hardcoded key), run:

- `python39 app/src/modules/ai-generate-client/test_doc_env_style.py`

The script keeps the same behavior as your test doc:

- `base_url` still points to `https://api.qnaigc.com/v1`
- API mode is still `chat_completions`
- tracing is still disabled
- model default remains `deepseek-r1` (or `OPENSCAD_MODEL` from `.env`)
