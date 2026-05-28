# Contributing to ToCodex Community

ToCodex Community is a community-driven continuation of the ToCodex VS Code extension. We welcome bug reports, documentation improvements, and code contributions that help keep the public edition stable, reproducible, and easy to maintain.

## Issue-first approach

Before opening a pull request, please check the existing issues and create or claim an issue when appropriate:

- Browse issues: https://github.com/tocodex-ai/tocodex-community/issues
- Create an issue: https://github.com/tocodex-ai/tocodex-community/issues/new/choose
- Report security issues privately: https://github.com/tocodex-ai/tocodex-community/security/advisories/new

If your change is small, such as fixing a typo or correcting a broken link, you may open a pull request directly and explain the change clearly.

## Getting started

1. Fork the repository.
2. Clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/tocodex-community.git
cd tocodex-community
```

3. Install dependencies:

```bash
pnpm install
```

4. Validate your changes:

```bash
pnpm check-types
pnpm build
```

## Pull requests

A good pull request should:

- Reference the related GitHub issue when there is one.
- Keep the scope focused and easy to review.
- Include documentation updates for user-visible behavior changes.
- Pass `pnpm check-types` and `pnpm build` before submission.
- Avoid committing generated build artifacts unless they are explicitly required.

## Public test status

The community source package currently does not ship the upstream private Vitest suite. Use `pnpm check-types` and `pnpm build` as the required public validation commands. The `pnpm test` command is intentionally a no-op placeholder until public tests are restored.

## Code of conduct

Please follow the project code of conduct and keep discussions respectful, focused, and constructive.
