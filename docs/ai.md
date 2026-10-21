# AI backends

Worldline needs a language model for the World Director, the turn resolver, diplomacy chats, the advisor and nation-formation checks. Without any key the server uses a deterministic offline mock, so everything still runs.

## Setup

Copy `.env.example` to `.env` in the repository root and set at least one key. The server loads that file itself, since Bun only reads `.env` from the working directory and the server runs from `apps/server`. Variables already set in the shell win.

| Variable | Backend | Chain prefix |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | [OpenRouter](https://openrouter.ai) | none (plain model ids) |
| `ANTHROPIC_API_KEY` | Anthropic, through the official SDK | `anthropic:` |
| `OPENAI_API_KEY` | OpenAI | `openai:` |
| `GEMINI_API_KEY` | Google Gemini | `gemini:` |
| `LOCAL_LLM_URL` (+ optional `LOCAL_LLM_KEY`) | Any OpenAI-compatible server, such as Ollama (`http://localhost:11434/v1`) or LM Studio (`http://localhost:1234/v1`) | `local:` |

Keys can be combined. When no entry in a game's chain has a key, the server uses `ANTHROPIC_MODEL` (default `claude-opus-5-5`), `OPENAI_MODEL`, `GEMINI_MODEL` or `LOCAL_LLM_MODEL`.

Other settings:

| Variable | Effect |
| --- | --- |
| `OPENROUTER_DAILY_LIMIT` | Hard local cap on OpenRouter requests per day. Unset, only OpenRouter's own limits apply. Direct backends aren't capped. |
| `WORLDLINE_AI=mock` | Force the offline mock even when a key is set. The tests use this. |
| `PORT` | Game server port (default `3001`). |
| `WORLDLINE_DB` | SQLite file for saved games (default `apps/server/data/worldline.sqlite`). |

## Model chains

The host picks the model chain in the lobby. A chain is an ordered list of models; if one fails, the next is tried. Each entry picks its backend with a prefix, for example `anthropic:claude-opus-5-5`, `openai:<model>`, `gemini:<model>` or `local:<model>`. Plain ids go to OpenRouter.

The default chain is three free OpenRouter models, fastest first by benchmark, then a cheap paid model as a last resort:

1. `minimax/minimax-m3.1-flash:free`
2. `nvidia/nemotron-3-super-120b-a12b:free`
3. `nvidia/nemotron-3.5-super-vl:free`
4. `deepseek/deepseek-v4.1-flash-1017` (about a tenth of a cent per turn, used only when all the free ones fail)

OpenRouter accepts at most 3 models per request, so the server sends the chain in batches of 3 and moves to the next batch if one fails. OpenRouter's own limits for free models are 20 requests per minute and 50 per day, or 1,000 per day once you've bought $10 of credits. The server counts requests for the in-game meter.

## Cost per action

| Action | Requests |
| --- | --- |
| A turn | about 2 (the World Director and the resolver) |
| A turn in economy mode | 1 (the Director is merged into the resolver) |
| A diplomacy reply, an advisor letter, a nation-formation check | 1 each |
| Messages AI nations send on their own initiative | 0 (they come out of the resolver's answer) |

## Speed

The World Director's planning doesn't depend on players' orders, so the server starts it as soon as a turn opens. Pressing ready then only waits for the resolver (about 15–25 seconds).

Reasoning is off by default: free models answer much faster without it. With the default free chain, a one-month turn takes about 1.5 minutes, a diplomacy reply about 2 seconds and the advisor about 8 seconds. Hosts can switch reasoning on in the lobby.

Turn prompts put their stable parts first and mark cache breakpoints, so providers with prompt caching reuse most of each turn's prompt. The server log shows cached tokens per call.

## Keeping long games consistent

- Chronicles are summarised every 5 turns and folded into one "earlier history" entry once there are more than 6.
- Each turn's prompt lists the effects the rules engine refused or scaled down the turn before.
- Each AI reply in a chat keeps a short private record of the conversation, so long negotiations stay consistent after old messages scroll away.

## Tools

```bash
bun run ai:smoke                                     # live end-to-end check, about 5 requests
bun --cwd apps/server scripts/bench.ts <gameId>      # time each model on a saved game's next turn
bun --cwd apps/server scripts/turn-check.ts <gameId> # time a pre-planned turn, list its structural changes
```
