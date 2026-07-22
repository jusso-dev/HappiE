# Design

## Theme

Warm paper light theme. Parents use this on a laptop or iPad in daylight home settings; light, warm, and calm fits. No dark mode.

## Color

Strategy: Restrained base with playful identity moments. Warm tinted neutrals carry the surface; green accent carries primary actions and success/assigned state; red carries danger/unassign; each child gets an identity color (stored per profile as `avatar_color`) used on chips and avatars.

| Token | Value | Use |
|---|---|---|
| background | `oklch(96.4% 0.012 92)` | page background |
| panel | `oklch(98.6% 0.008 92)` | cards, panels, inputs |
| ink | `oklch(24% 0.026 82)` | primary text |
| muted | `oklch(50% 0.022 82)` | secondary text |
| border | `oklch(87% 0.018 92)` | hairlines |
| accent | `oklch(53% 0.13 154)` | primary buttons, assign, success, selection |
| warn | `oklch(67% 0.14 72)` | warnings, in-progress accents |
| danger | `oklch(55% 0.19 28)` | destructive, unassign, failures |

Child identity colors are data-driven OKLCH values around 65-75% lightness, chroma ~0.12, varied hue.

## Typography

System stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`. One family. Page titles ~1.55rem semibold, section headings 1rem semibold, body/labels 0.875rem, metadata 0.75rem. No display fonts.

## Shape & Elevation

Playful roundness: `--radius-ui: 10px` for controls and panels, full-round for chips and badges. Soft warm shadows only on panels and raised tiles; no glassmorphism, no side-stripe accents.

## Components

- **Buttons**: primary (accent), secondary (bordered panel), danger (red), success (green assign). All have hover, active, focus-visible ring, disabled at 50%.
- **Badges/chips**: full-round, tinted background + border of their tone; child chips use the child's identity color at low alpha with ink text.
- **Video tiles**: thumbnail top, rounded, selection ring in accent, explicit Assign (green) / Unassign (red) action row.
- **Progress bars**: 8px full-round track in ink/10, accent fill, percent label + current step text alongside; danger fill on failure.
- **Empty states**: one friendly sentence plus the action that fixes it.

## Motion

150-250ms ease-out transitions on hover/selection/progress width. No page-load choreography, no bounce.
