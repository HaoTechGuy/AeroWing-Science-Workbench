---
name: project-design-philosophy
description: Apply InternAgents project design philosophy and reusable UI implementation patterns, especially the Calm Laboratory Console visual style. Use when changing the web UI, interaction details, hover states, icon buttons, tooltips, sidebars, workspace panels, chat controls, file previews, or any visual polish in ui/src.
---

# Project Design Philosophy

## Overview

Use this skill to keep InternAgents UI changes quiet, reusable, and consistent
with the existing desktop-tool feel. Prefer shared primitives, small scoped
behavior changes, and restrained interaction details over one-off styling.

## Design Principles

- Make the working surface the first-class object. Sidebars, file previews,
  thread lists, and chat input should stay compact and scannable.
- Prefer utilitarian polish: clear affordances, stable spacing, light shadows,
  and familiar icons. Avoid decorative surfaces that compete with the work.
- Keep hover feedback informative but quiet. Hover states should confirm an
  affordance, not create a large visual event.
- Reuse project UI primitives in `ui/src/components/ui` before adding local
  CSS, new dependencies, or duplicated component code.
- Keep text concise in dense UI. Icon buttons should use accessible labels and
  short tooltips rather than long visible helper copy.
- Preserve existing state and API behavior when polishing visuals. Visual
  cleanup should not alter thread, workspace, runtime, or agent semantics.

## Calm Laboratory Console Style

Use this as the default visual direction for the InternAgents workspace.

Visual tone:

- Treat the app as a local research console, not a marketing AI product. The UI
  should feel like a precise lab bench for files, threads, previews, and agent
  activity.
- Use off-white and pale gray surfaces, fine borders, soft shadows, and sparse
  deep-teal accents.
- Keep the three-column workspace visible and legible: workspace/files on the
  left, chat in the center, file preview/inspector on the right.
- Avoid large hero typography, decorative gradients, large cards, heavy dark
  blocks, oversized empty states, or one-note saturated palettes.
- Use density deliberately. Lists, headers, toolbars, and status indicators
  should be compact enough for repeated work.

Color and surface rules:

- Put global color decisions in `ui/src/app/globals.css` by adjusting Tailwind
  tokens such as `--background`, `--foreground`, `--card`, `--popover`,
  `--primary`, `--muted`, `--accent`, `--border`, `--input`, `--ring`, and
  `--sidebar`.
- Prefer deep teal through semantic classes (`text-primary`, `bg-primary`,
  `border-primary/30`) instead of repeating hex values like `#2F6868`.
- Use `bg-card` for primary white work surfaces, `bg-sidebar` for the left
  workspace rail, `bg-muted` or `bg-muted/50` for subtle metadata bands, and
  `border-border` for panel boundaries.
- Use shadows sparingly: `shadow-sm shadow-black/[0.025]` for small raised
  affordances and `shadow-lg shadow-black/[0.04]` only for the chat composer or
  similarly important floating surfaces.
- Keep code and markdown previews light by default. Prefer `oneLight` and a
  `border-border bg-card` code surface over a large dark block unless a specific
  dark preview is required.

Layout rules:

- Keep the top bar short and quiet. It should contain the product name, resource
  selector, assistant/runtime status, and compact navigation buttons.
- Keep panel dividers thin. Use the shared `ResizableHandle`; do not create
  custom draggable separators for one-off panels.
- Make the center chat column calm and mostly white. The composer may float
  slightly with a small border and soft shadow, but it should not become a
  dominant card.
- Keep file preview headers inspector-like: small file icon, filename, size,
  kind, and raw/open action.
- Let empty states stay small and centered. They should explain state without
  competing with the workspace.

## Calm Console Implementation Map

When applying or extending this style, reuse these implementation locations:

- `ui/src/app/globals.css`: semantic color tokens, background, typography,
  scrollbar, and shared base styles.
- `ui/src/components/ui/button.tsx`: button border, hover, focus, and default
  deep-teal action styling.
- `ui/src/components/ui/input.tsx`, `select.tsx`, `textarea.tsx`: form surface,
  focus ring, border, and subtle shadows.
- `ui/src/components/ui/resizable.tsx`: thin draggable panel handles and hover
  affordance.
- `ui/src/components/ui/tooltip.tsx`: shared hover hints.
- `ui/src/app/page.tsx`: main three-panel shell and top bar.
- `ui/src/app/components/WorkspaceExplorer.tsx`: file-tree density, selected
  row, filter input, and workspace header.
- `ui/src/app/components/ThreadList.tsx`: thread row density, selected row,
  row action buttons, and archive tooltip behavior.
- `ui/src/app/components/ChatInterface.tsx`: chat canvas, goal/tasks/files
  metadata band, attachments, and composer surface.
- `ui/src/app/components/ChatMessage.tsx`: user bubble, tool result spacing,
  subagent panels, and attachment chips.
- `ui/src/app/components/WorkspaceViewer.tsx` and `MarkdownContent.tsx`:
  inspector header, markdown surface, and light code previews.
- `ui/src/app/components/ToolCallBox.tsx`,
  `ToolApprovalInterrupt.tsx`, and `SubAgentIndicator.tsx`: agent activity
  should look like compact console rows, not large decorative cards.

Prefer improving these shared primitives before adding local utility-class
patches. Use local classes only for placement, density, or component-specific
state.

## Component Styling Patterns

Top bar:

- Use `h-14`, `bg-card/95`, `border-b border-border`, and compact `outline`
  buttons.
- Keep the assistant identifier as a non-shrinking rounded status pill with
  `border-border bg-background px-2.5 py-1 text-xs text-muted-foreground`.

Left workspace rail:

- Use `bg-sidebar` for the whole rail.
- Use a subtle `bg-card/60` header.
- File rows should be `h-8`, rounded, bordered only on hover/selected states,
  and selected with `border-primary/25 bg-primary/10 text-primary`.
- Keep file sizes at `text-[11px] text-muted-foreground`.

Thread rows:

- Keep row actions at the edge and icon-only.
- Use transparent borders normally, `hover:border-border hover:bg-card`, and
  `border-primary/30 bg-primary/10` for selected rows.
- Keep section labels small uppercase with restrained tracking.

Chat and composer:

- Keep the chat canvas `bg-card/70` or similarly light.
- Give the composer `rounded-lg border border-border bg-card shadow-lg
  shadow-black/[0.04]`.
- Add a subtle top border to the composer action row.
- Use `text-foreground` in the textarea and semantic muted placeholder color.

Preview pane:

- Use `bg-card` for the pane and `bg-card/80` for the preview header.
- Use light syntax highlighting (`oneLight`) and add `border: 1px solid
  hsl(var(--border))` plus `background: hsl(var(--card))` in custom code block
  styles.

## Reusable Hover Tooltip Pattern

For icon-button hover hints, use the shared Radix wrapper in
`ui/src/components/ui/tooltip.tsx`:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="归档会话"
    >
      <Archive className="h-3.5 w-3.5" />
    </Button>
  </TooltipTrigger>
  <TooltipContent
    side="right"
    align="center"
    sideOffset={8}
    className="whitespace-nowrap"
  >
    归档会话
  </TooltipContent>
</Tooltip>
```

Implementation rules:

- Do not use native `title` attributes for primary hover help. They look
  browser-default, cannot be styled consistently, and often feel harsh in this
  desktop UI.
- Keep the accessible name on the button with `aria-label`; keep the visible
  hover label in `TooltipContent`.
- Use `TooltipTrigger asChild` around the existing `Button` so the button keeps
  its normal focus, disabled, and click behavior.
- Use concise tooltip text. Prefer command labels like `归档会话`, `新建会话`,
  or `浏览本机文件夹`.
- Place tooltips away from dense content. For row action buttons in the thread
  list, prefer `side="right"` with `align="center"` and `sideOffset={8}` so the
  tooltip does not cover the thread title, timestamp, or preview text.
- Use `className="whitespace-nowrap"` for short labels that should remain a
  single compact pill. Avoid manually setting large width, tall padding, or
  marketing-style copy.
- If every tooltip should feel different, edit the shared primitive in
  `ui/src/components/ui/tooltip.tsx`. If only one affordance needs different
  placement or text, change the local `TooltipContent` props at the call site.

## Current Tooltip Primitive

The project tooltip implementation is centralized in
`ui/src/components/ui/tooltip.tsx`. It wraps `@radix-ui/react-tooltip` and
should remain the default tooltip system.

The shared styling is intentionally light:

- `TooltipProvider` defaults to a short delay so incidental mouse movement does
  not flash tooltips immediately.
- `TooltipContent` defaults to a modest `sideOffset`.
- Content uses `bg-popover`, `text-popover-foreground`, `border-border`, and a
  soft shadow so it feels like a native app popover rather than a heavy black
  callout.
- The arrow uses the same popover fill. Keep arrow styling tied to the shared
  tooltip surface.
- Animation should be subtle: short fade/zoom and a small side-aware slide are
  enough.

When changing this primitive, check all existing tooltip call sites with:

```bash
rg -n "Tooltip|TooltipContent|title=" ui/src -S
```

Prefer replacing user-visible `title=` hover help with the shared tooltip
pattern. Keep `title=` only when it is serving browser-native behavior that is
not visible in normal app usage, such as a full file path fallback.

## Thread Row Archive Button Pattern

The thread archive action in `ui/src/app/components/ThreadList.tsx` is the
canonical row-action example:

- The row itself remains the large click target for opening the thread.
- The archive button is a small `ghost` icon button at the row edge.
- The click handler calls `event.stopPropagation()` so archiving does not also
  select the thread.
- The button uses `aria-label={`归档会话 ${thread.title}`}` for screen readers.
- Loading state swaps the icon for `Loader2` while preserving the same button
  dimensions.
- Tooltip text stays short: `归档会话`.
- Tooltip placement uses `side="right"` to avoid covering the row content.

Reuse this pattern for other per-row actions such as restore, pin, rename,
disconnect, or remove. Preserve the same separation: row click selects or opens;
icon click performs the secondary action and stops propagation.

## Verification Checklist

After UI polish:

- Run the UI lint command from `ui/`.
- Open the relevant local page in the browser and hover the target control.
- Confirm the tooltip does not cover the content the user is inspecting.
- Confirm disabled and loading states keep stable button dimensions.
- Verify the three major surfaces: file tree, chat composer, and preview pane.
- Check browser console errors.
- If a shared primitive changed, spot-check at least one other tooltip call
  site so the global style still works.
