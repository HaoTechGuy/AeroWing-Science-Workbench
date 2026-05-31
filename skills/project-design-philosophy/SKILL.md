---
name: project-design-philosophy
description: Apply InternAgents project design philosophy and reusable UI implementation patterns. Use when changing the web UI, interaction details, hover states, icon buttons, tooltips, sidebars, workspace panels, chat controls, or any visual polish in ui/src.
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
- Check browser console errors.
- If a shared primitive changed, spot-check at least one other tooltip call
  site so the global style still works.
