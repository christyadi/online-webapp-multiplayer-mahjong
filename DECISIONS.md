# Implementation decisions

## 2026-09-05

- Preserve the workspace's empty outer Git repository and create the required isolated nested repository at `mahjong-together`; no unrelated content exists to migrate or overwrite.
- Pin Node 24.20.0 and invoke it with a process-local PATH during this build, avoiding a persistent nvm version change.
- Use native Express middleware and Node HTTP in Milestone 1 rather than adding cookie, security-header, or HTTP-test dependencies before those features are implemented.
- Retain Playwright 1.62.0 instead of 1.63.0 because the latter's patched Firefox build reproduced a Windows side-by-side loader failure after a forced reinstall. Firefox testing is deferred at the user's direction; this does not waive final cross-browser verification.
- Build shared declarations at the start of the root typecheck command. This is the smallest cross-platform way to preserve the required shared-before-consumers order in a clean checkout without duplicating source-path aliases across consumers.
- Pin `@types/node` to the latest 24.x declarations so typechecking cannot approve Node 26-only runtime APIs.
- Treat the supplied Mahjong HTML and design-system files as visual references only. Adopt their wood/felt/ivory/brass material language, physical tile states, central pond, and restrained table hierarchy, while retaining this project’s fixed constraints: system fonts, locally bundled SVG tiles, no external asset requests, no audio, real server state, and accessible reduced-motion behavior.
- Defer public deployment until visual-design direction and planning work are complete. The user will manually configure Render afterward; retain the documented deployment configuration, but do not request provider access or create a service during the refinement phase.
