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

### Local web dashboard

Add a local web dashboard as a visual management interface for `memory_plugin`.

The CLI should remain the primary automation-friendly interface, but not every memory-management task is convenient to perform through commands. A dashboard can expose the same underlying engine through a more discoverable interface without moving control or storage away from the user.

The dashboard should be treated as a **local control plane**, not as a required hosted service.

#### Runtime controls

The dashboard should expose the activation state described above and make it easy to inspect and change integration state without uninstalling the package.

Potential controls include:

- View whether `memory_plugin` is currently enabled or disabled.
- Enable or disable the integration globally.
- Enable or disable individual supported CLI clients when technically possible.
- Show when a client restart is required before a configuration change becomes active.
- Display configured clients and basic integration health/status.
- Eventually expose runtime profiles such as Personal and Provider mode if profiles are implemented.

#### Knowledge management

Provide a visual interface for managing persistent knowledge rather than requiring every operation to go through CLI or MCP tools.

The dashboard should support, where applicable:

- Browse and search Notebook facts.
- Add new facts manually.
- Edit, protect, supersede, expire, or remove facts using the same safety semantics as the existing memory engine.
- Browse RAG Memory Notes and ingested knowledge sources.
- Inspect metadata, scopes, tags, source relationships, and retrieval-relevant information.
- Open full raw content for detailed notes/documents when needed.
- Link and unlink related knowledge where the underlying graph model supports it.

The dashboard must reuse the existing storage and mutation rules rather than creating a second independent knowledge model.

#### Knowledge graph visualization

Expose a graph-oriented view of stored relationships so users can understand how facts, documents, notes, projects, and extracted entities are connected.

Possible capabilities include:

- Visualize fact-to-document and note-to-source relationships.
- Inspect GraphRAG Lite entities and links when available.
- Filter graph views by project, scope, document type, or relationship type.
- Open the underlying fact, note, document, or source directly from a graph node.
- Create or remove explicit links where the operation is safe and supported by the storage model.

The graph should remain an inspection and management layer over real stored relationships, not a decorative visualization built from inferred data that cannot be traced back to storage.

#### Project and repository management

Provide a dedicated project view for Git-identity scopes.

The dashboard should make it possible to:

- List known projects/repository identities.
- Inspect which local paths are currently associated with a repository identity.
- Bind a local project/repository to an existing memory scope when appropriate.
- Unbind or detach incorrect/local associations without deleting the underlying project memory.
- Inspect global vs project-scoped memory.
- Make destructive operations explicit and clearly distinguish **detach/unbind** from **delete memory**.

Repository identity should continue to follow the existing Git-based project model rather than introducing dashboard-only project identifiers.

#### Persona editor

Add a visual persona configuration surface for creating and maintaining agent behavior without manually editing directives through CLI flows.

Potential capabilities include:

- View active persona directives.
- Add, edit, enable, disable, or remove persona directives.
- Separate behavioral/persona directives from ordinary factual memory.
- Preview which directives are expected to be injected for a selected client or project.
- Make scope explicit where persona behavior can differ between global and project contexts.

The dashboard must preserve the same directive semantics used by the underlying memory engine so persona behavior remains consistent across CLI clients.

#### Design constraints

- Local-first by default; the dashboard should not require a cloud account.
- Reuse the existing database, memory APIs, project identity, persona, and safety rules.
- Avoid direct ad-hoc database editing from the frontend.
- Keep destructive actions explicit, reversible where possible, and clearly labeled.
- Do not make the dashboard a dependency for normal CLI/MCP usage.
- Prefer one shared application/service layer so CLI, MCP tools, and dashboard do not develop conflicting behavior.

A future implementation may expose the dashboard from the existing runtime, for example through a local command such as:

```bash
memory_plugin dashboard
```

The exact transport, framework, authentication model, and local binding strategy are intentionally undecided at this stage.

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
- Keep setup, disable, enable, uninstall, project binding, and knowledge-management operations reversible and safe where possible.
- Keep CLI, MCP, and dashboard behavior backed by the same underlying application/storage semantics.
- Do not add background complexity to the common path unless the benefit is clear.
- Treat roadmap entries as design intent, not promises of a release date or version.
