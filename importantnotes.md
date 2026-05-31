# Important Notes

## Skills Page Mounting

The existing skills page implementation is intentionally kept in the codebase
for future reuse:

- `ui/src/app/skills/components/SkillsMarketplace.tsx`
- `ui/src/app/skills/types.ts`
- `ui/src/app/api/skills/*`

For the current frontend, the skills page is not mounted as an active user-facing
experience. The `/skills` route returns `notFound()`, and the workbench
navigation and Quickstart tour no longer expose the skills entry.

Do not delete or refactor the existing skills page implementation just because
it is currently hidden. It is expected to be reused later.
