---
name: using-memory
description: Use the memory tools (remember, recall, forget) to persist important facts about the user and project across sessions. The agent should proactively save high-signal things like name, language, role/goals, constraints, tech stack preferences, architecture decisions, and project conventions. DO NOT save transient details, one-off statements, or anything unlikely to be useful in future sessions. When saving, translate the fact into English and keep it concise. Use remember with scope='global' for personal facts, scope='project' for project-specific facts.
---

# Using Memory

You have access to memory tools that persist important facts about the user and project across sessions.

## When to use

**Save (`remember`):**
- User's name, language, location, role, goals
- Technical constraints, preferred stack, architecture decisions
- Project conventions, naming patterns, directory structure decisions
- Facts the user explicitly asks you to remember

**DO NOT save:**
- Transient details or one-off questions
- Full conversation turns
- Code snippets or error messages
- Anything you're unsure will be useful in future sessions

**Check (`recall`):**
- Before making assumptions, check what you already know
- Use `recall` with `scope: "all"` for a full view

**Remove (`forget`):**
- When the user corrects or contradicts a previously saved fact
- When a fact is no longer relevant

## Guidelines

1. **Be selective.** Quality over quantity. One well-written fact is better than five vague ones.
2. **Write in English.** Even if the user speaks another language, translate the fact.
3. **Be concise.** One sentence per fact. "User's name is Oleg" not "The user told me their name is Oleg".
4. **Check before saving.** Use recall to avoid duplicates.
