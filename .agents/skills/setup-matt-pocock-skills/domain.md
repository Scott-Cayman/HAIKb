# Domain docs

## Layout

This repo uses **single-context** layout:

- One `CONTEXT.md` at the repo root
- One `docs/adr/` at the repo root

## Consumer rules

### Reading CONTEXT.md

1. Read `CONTEXT.md` before making domain-related decisions
2. Use the canonical terms from `CONTEXT.md` in all output
3. When encountering ambiguous terms, refer to `CONTEXT.md` first
4. If a term is missing from `CONTEXT.md`, ask the user to clarify and offer to add it

### Reading ADRs

1. Read any existing ADRs in `docs/adr/` before proposing architectural changes
2. Respect decisions recorded in ADRs unless the user explicitly asks to revisit them
3. If contradicting an ADR is necessary, surface that explicitly and explain why

### Writing CONTEXT.md

1. Update `CONTEXT.md` inline as terms are resolved during conversations
2. Follow the format in `CONTEXT-FORMAT.md` (from the `grill-with-docs` skill)
3. Only include domain-specific terms, not general programming concepts
4. Be opinionated about canonical terms and list alternatives to avoid

### Writing ADRs

1. Only offer to write an ADR when all three are true:
   - Hard to reverse
   - Surprising without context
   - Result of a real trade-off
2. Follow the format in `ADR-FORMAT.md` (from the `grill-with-docs` skill)
3. Number sequentially: `0001-slug.md`, `0002-slug.md`, etc.
4. Create the `docs/adr/` directory lazily when needed
