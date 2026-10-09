# SF Source Tools

- This is a standalone, generic VS Code extension, not a Salesforce package.
- Keep operations bound to the selected source's nearest Salesforce project and its project-local default org. Never use another workspace project's org.
- Use Salesforce's official source-deploy-retrieve library for component identities, bundles, and manifests; do not infer metadata types from filenames.
- Never remove local source until a remote deletion has completed successfully. Never force conflicts without explicit user confirmation.
- Do not copy proprietary code or include org credentials, source metadata, or customer configuration.
- Run `npm run check`, `npm run test:vscode`, and `npm run package` before releasing. Report real-org tests separately from simulated CLI tests.
- Use English documentation and Conventional Commits. The pre-commit hook must pass.
- Keep package.json, CHANGELOG.md, and the vMAJOR.MINOR.PATCH tag aligned. Release from main.
