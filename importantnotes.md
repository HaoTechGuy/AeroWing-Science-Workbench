# Important Notes

## Skills Page Mounting

The existing skills page implementation is intentionally kept in the codebase
for future reuse:

- `ui/src/app/skills/components/SkillsMarketplace.tsx`
- `ui/src/app/skills/types.ts`
- `ui/src/app/api/skills/*`

For the current frontend, the skills page is not mounted as an active user-facing
experience. The `/skills` route returns `notFound()`, and the workbench
navigation and Quickstart tour do not expose the standalone skills entry.

Current user-facing skills management lives in the configuration page card:

- `ui/src/app/config/components/SkillsConfigCard.tsx`

Do not delete or refactor the existing skills page implementation just because
it is currently hidden. It is expected to be reused later.

## Connect Server Page Mounting

The existing connect-server page is intentionally kept in the codebase for
future reuse:

- `ui/src/app/connect/page.tsx`

For the current frontend, the connect-server entry is not mounted on the
homepage/workbench header. The Quickstart tour also does not expose the
connect-server step because there is no homepage navigation target for it.

Do not delete or refactor the existing connect-server page just because it is
currently hidden. It is expected to be reused later if remote Agent service
connection needs to be exposed again.
