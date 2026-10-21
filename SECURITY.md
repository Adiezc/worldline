# Security policy

## Reporting a vulnerability

Please don't open a public issue for security problems. Report them privately through [GitHub's private vulnerability reporting](https://github.com/gazarrillo/worldline/security/advisories/new) for this repository. Only the maintainers can see the report.

Include what you found, how to reproduce it, and what an attacker could do with it. You should get an acknowledgement within a week. Once a fix is ready we'll agree on a disclosure date with you and credit you in the advisory unless you'd rather stay anonymous.

## Supported versions

Worldline has no releases yet. Security fixes go to the `main` branch.

## Scope

In scope: the game server (`apps/server`), the web client (`apps/web`) and the shared rules engine (`packages/shared`). Examples include taking over another player's seat, seeing information a player's view should leave out, reading or changing another account's games, running the host's actions without being the host, crashing the server with a crafted message, and leaking the server's API keys.

Out of scope: weaknesses in the AI providers themselves, and an AI model writing in-game text that is unwelcome but has no effect beyond the game. Effects that get past the rules engine and change the world in ways its rules forbid are bugs; please report those as normal issues.

## Running your own server

Worldline is built for small groups of friends playing on a server one of them runs. If you run one:

- Anyone who can reach the server can create games and spend its AI quota. Set a spending limit with your AI provider (for OpenRouter, `OPENROUTER_DAILY_LIMIT` also adds a local cap) and share the address only with people you trust.
- Serve it over HTTPS. The tunnels described in the README do this for you.
- Keep `.env` out of version control (it's in `.gitignore`) and never paste API keys into issues or game exports.
