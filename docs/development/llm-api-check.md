# Development LLM API verification

Date: 2026-10-05 (Asia/Kuala_Lumpur).

Model: `pro6000/qwen38-flash-next`.

Configured base: `https://llm.igvi.cs.nthu.edu.tw`.

Executed direct HTTP requests with Bun 1.4.2 inside a rootless Podman container. Inputs were synthetic text, a mock lookup tool, and a generated blue/yellow image. Credentials were read from a private mounted configuration file and were not printed. No research files were submitted.

| Check | Result |
| --- | --- |
| Authenticated `/models` and `/v1/models` | HTTP 200; requested model listed. |
| Chat at root and `/v1/chat/completions` | HTTP 200; expected marker returned. |
| JSON Schema response format | HTTP 200; valid expected two-field JSON object returned. |
| Forced function call | HTTP 200; expected function and valid arguments returned. |
| Function result continuation | HTTP 200; expected mock value returned. |
| Image input | HTTP 200; correctly identified which half was blue. |
| SSE streaming | HTTP 200; multiple events and expected final marker. |
| `/responses` and `/v1/responses` | HTTP 200; expected output text returned. |

The user's root base URL can be preserved without adding `/v1`. The private root `.env` stores the real key; `.env.example` contains only a placeholder. The endpoint/model is now the development default, replacing the earlier Luna preference.

Limits of this check: direct HTTP compatibility only, with short synthetic requests. It does not establish full OpenAI SDK/Agents SDK compatibility, server-side enforcement of every JSON Schema feature, reliable research/chart interpretation, available embedding models, context limits, rate limits, or sustained performance. Validate returned schemas in application code and retain the planned corpus/SDK integration tests.
