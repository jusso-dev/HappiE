# Product

## Register

product

## Users

Two parents managing a private, LAN-only video library for their kids (H and E). They upload or import videos, approve them, and assign them to each child's iPad library. Sessions are short, task-driven: "get this video onto H's iPad", "check the import finished", "clean out storage". No public users, no auth, trusted home network.

## Product Purpose

HappiE is a parent-controlled family video library: a private YouTube alternative for kids. The admin web UI exists so parents can curate quickly and confidently: what each child can watch, what is downloading, and how much iPad storage it uses. Success = a parent can assign or unassign a batch of videos to a kid in seconds and always trust the progress and assignment state on screen.

## Brand Personality

Playful, warm, family-made. It manages kids' content, so it may smile: rounder shapes, friendly color, per-child identity colors. But it is still a parent's tool: playful flavor never at the cost of clarity, density, or trust in state. Three words: warm, playful, dependable.

## Anti-references

- Enterprise admin gray (Jira-style chrome, dense slate tables with no warmth).
- Public-video-platform styling (YouTube Studio clones, dark analytics dashboards).
- Toy-app excess: no bouncing mascots, no gradient text, no confetti. Playful means color and shape, not noise.

## Design Principles

1. **State you can trust**: assignment badges, progress bars, and statuses must reflect the API truth at all times; stuck or lying indicators are the worst failure.
2. **Two clicks to curate**: assign/unassign, singly or in bulk, is the core loop; it gets first-class, always-visible controls.
3. **Playful shell, plain workhorse**: color and roundness live in identity moments (child chips, tiles, badges); forms, tables, and diagnostics stay quiet and dense.
4. **Destructive is deliberate**: deletes confirm; everything else is instant and undoable by re-assigning.

## Accessibility & Inclusion

WCAG AA. Visible focus rings, labeled controls, AA contrast on all text including on colored chips. Standard pointer targets; no special motion or touch requirements.
