# Contributing to Worldline

Thanks for wanting to help. Bug reports, scenarios, rules, UI work, map improvements and docs are all welcome.

## Ways to contribute

- **Report a bug.** Open an issue using the bug template. A game export (History panel → Export game) and the server log make most bugs easy to reproduce. Exports replace player ids, but they do include the game's chats and orders, so check there's nothing private in yours before you attach it.
- **Suggest a feature.** Open an issue describing what you'd like to do in the game and why. Starting with the player's experience works better than starting with an implementation.
- **Send a pull request.** For anything bigger than a small fix, open an issue first so we can agree on the approach before you put in the work.
- **Improve a scenario.** Leaders, treaties, relations and the world brief live in `packages/scenarios/`. Please cite a source for factual changes in the pull request.

## Getting set up

You need [Bun](https://bun.sh) 1.3 or later.

```bash
bun install
bun run dev
```

This starts the client on http://localhost:5173 and the server on port 3001. Without an AI key the server uses the offline mock, which is enough for most work. See [docs/ai.md](docs/ai.md) if you need a real model.

Before you open a pull request, make sure both of these pass:

```bash
bun test
bun run typecheck
```

CI runs the same checks. Tests always use the mock AI, so they never need a key or spend money.

## Where things live

| Area | Path |
| --- | --- |
| Rules engine, effect schemas, simulation, votes | `packages/shared/src/game/` |
| Turn pipeline, prompts, Director, resolver, chats | `apps/server/src/engine/` |
| AI backends and the offline mock | `apps/server/src/ai/` |
| Rooms, WebSocket protocol, saves | `apps/server/src/rooms.ts`, `apps/server/src/db.ts`, `packages/shared/src/protocol.ts` |
| Map renderer | `apps/web/src/map/` |
| HUD, panels, chat | `apps/web/src/ui/` |
| Map generation | `tools/mapgen/` ([docs/map-pipeline.md](docs/map-pipeline.md)) |

## Guidelines

**The rules engine has the final say.** Treat everything a model returns as untrusted input. A new kind of AI effect needs a schema in `packages/shared/src/game/schemas.ts`, validation in the rules engine that refuses or scales down what the world's state doesn't allow, and tests for both. The mock AI in `apps/server/src/ai/mock.ts` should be able to produce it, so the turn pipeline tests cover it.

**Players see only what their nation would know.** Anything private (other players' projects, the AI's private chat records, seat secrets) must be left out of each player's view. `apps/server/test/view.test.ts` checks this; extend it when you add private state.

**Keep tests offline and deterministic.** No network calls, no real model, no reliance on the clock without control over it.

**Match the surrounding code.** TypeScript is strict across the repo. There's no formatter configured yet, so follow what's there: two-space indents, double quotes, semicolons, and comments that explain why rather than what.

**Keep pull requests focused.** One change per pull request is easier to review than several mixed together. Update the README or `docs/` when you change behaviour they describe.

**Scenarios describe real countries and people.** Keep descriptions factual and neutral, and leave politics to what players do in their own games.

### Commit messages

Write the subject in the imperative, in sentence case, describing what changes for the player or the developer, with no type prefix:

```
Draw lakes on the map as water
Stop diplomatic proposals from binding players who never agreed
```

Use the body for the reasoning and anything a reviewer should know.

### AI-assisted contributions

You're welcome to use AI tools. You're responsible for what you submit: understand it, test it, and make sure you have the right to contribute it.

## Contributor License Agreement

Before we can merge your first pull request, you need to sign the [Contributor License Agreement](CLA.md). A bot comments on the pull request with instructions; signing takes one comment and covers all your future contributions.

**Why we ask:** Worldline is licensed under the AGPL-3.0, and the maintainer may also offer it as a hosted service or under other licence terms. The CLA lets the project do that with code that includes your contributions. You keep the copyright to your work and can use it however you like.

## Code of Conduct

Everyone taking part in this project is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please don't report security issues in public issues. See [SECURITY.md](SECURITY.md).
