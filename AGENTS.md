# Agent working notes

## Commit and push cadence

Session limits can cut work off without notice, so do not batch a whole session
into one final commit. Work in small, coherent slices and land each slice as
soon as it is verified:

- After a slice builds and its relevant checks pass, commit it and push to
  `origin main` immediately.
- Run the checks that apply: `go build ./...`, `go vet ./...`, relevant
  `go test ./...`, `npx tsc --noEmit`, `npm run build`.
- Stage explicit paths (`git add path/to/file ...`). Never use `git add -A` or
  `git add .`; another agent may be working in the same worktree.
- Leave `.kilo/` (plans, scratch notes) unstaged.
- Never commit generated passwords, tokens, `.env` files, database dumps, or
  other secrets.
- If a push is rejected because `origin/main` moved, `git fetch` and rebase the
  local commits before pushing again.
- Commit messages: imperative subject, with a short body describing the
  verified behavior rather than just the files changed.

A slice is "coherent" when it does one thing: a backend endpoint with its
migration and tests, a UI change with its type check, a docs update, and so on.
Tiny typo fixes can ride along with the surrounding slice.
