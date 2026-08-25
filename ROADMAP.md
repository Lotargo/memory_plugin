# Roadmap

This document tracks planned features, architectural directions, and ideas worth preserving for future work.

The roadmap is intentionally not a release schedule. Priorities may change as the project evolves, integrations change, and real-world usage exposes better solutions.

## Planned

### Runtime activation and deactivation

Add a safe way to temporarily disable and re-enable `memory_plugin` for configured CLI clients without uninstalling the package or removing persistent memory.

#### Motivation

A CLI client may be used in very different roles:

- **Personal interactive agent** — persistent memory, persona directives, RAG tools, and MCP integration are useful and desirable.
- **Provider / subprocess / automation runtime** — persona injection and additional MCP calls may be unwanted because the CLI is acting as infrastructure for another application rather than as a personal agent.

Today, avoiding the second behavior can require uninstalling or removing the integration. A reversible activation state would make switching between these roles much cheaper and safer.

#### Desired behavior

- Preserve Notebook memory, RAG data, persona configuration, and all other user data while disabled.
- Never require reinstalling the npm package just to restore the integration.
- Support idempotent enable/disable operations.
- Make the current state easy to inspect.
- Reuse the same ownership and safety rules as setup/uninstall wherever client configuration must be changed.
- Avoid modifying unrelated client configuration.
- Clearly report when a client restart is required for the new state to take effect.

A restart is acceptable: restarting a CLI client is substantially cheaper than uninstalling and reinstalling the integration.

#### Candidate CLI surface

The exact interface is not decided yet, but possible commands include:

```bash
memory_plugin status
memory_plugin disable
memory_plugin enable
```

Per-client control should also be considered:

```bash
memory_plugin disable --codex
memory_plugin enable --codex
```

The final command names and semantics should be chosen only after reviewing how each supported client loads MCP configuration and managed instructions.

#### Follow-up direction: runtime profiles

Simple on/off control may eventually evolve into explicit runtime profiles rather than a single global switch.

For example:

| Profile | Intended use | Memory / Persona / MCP |
| :--- | :--- | :--- |
| Personal | Interactive coding agent | Enabled |
| Provider | CLI used as a model/provider for another application | Disabled or minimal |

A profile system should remain optional and should not make the common setup path more complicated.

---

## Exploratory

### Browser Memory Playground

A future landing-page playground may demonstrate the core memory model without installing the Node.js plugin itself.

Possible browser-native architecture:

```text
Landing
   │
   ▼
Browser Playground Runtime
   │
   ├── Notebook Memory
   │       └── IndexedDB
   │
   ├── RAG Memory
   │       ├── embeddings
   │       ├── IndexedDB vectors
   │       └── cosine Top-K
   │
   ├── Context Builder
   │
   └── AI Provider
           └── Puter.js
```

The playground should demonstrate `memory_plugin` concepts and semantics rather than pretend to run the production Node.js runtime in the browser. Local persistence should remain the default, and any cloud embedding path must avoid exposing provider secrets in frontend code.

This is an exploratory product/demo idea, not a committed implementation target.

---

## Roadmap principles

- Prefer real usage problems over speculative feature accumulation.
- Preserve local-first behavior and user ownership of memory.
- Keep setup, disable, enable, and uninstall operations reversible and safe.
- Do not add background complexity to the common path unless the benefit is clear.
- Treat roadmap entries as design intent, not promises of a release date or version.
