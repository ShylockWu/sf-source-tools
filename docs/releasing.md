# Releasing

## Version policy

Use Semantic Versioning: patch for compatible fixes, minor for compatible features, major for incompatible contracts. Before 1.0, incompatible changes increment the minor version. Releases originate from `main`; tags are `vMAJOR.MINOR.PATCH`.

1. Update the version with `npm version patch --no-git-tag-version` (or `minor` / `major`).
2. Move the relevant Unreleased notes into `## [VERSION] - YYYY-MM-DD` in `CHANGELOG.md`.
3. Run `npm run format`, `npm run check`, `npm run test:vscode`, `npm run release:check`, and `npm run package`.
4. Commit using Conventional Commits. The installed pre-commit hook checks Prettier formatting.
5. Push `main`, create an annotated `vVERSION` tag for that commit, and push the tag.
6. Confirm the Release workflow succeeded and download its VSIX to verify the released artifact.

The workflow verifies the tag/package/changelog match and the tagged commit belongs to `main`. It runs unit and extension-host tests, packages the extension, tests the extracted VSIX in the extension host, and creates or updates the matching GitHub Release. It publishes the same VSIX to Marketplace only when authorization is configured. A failed check must not be bypassed to publish.

## Marketplace setup

GitHub authentication is separate from Visual Studio Marketplace publisher authentication.

1. Sign in at https://marketplace.visualstudio.com/manage and create or obtain access to publisher **shylockwu**. If that ID is unavailable, agree on another publisher ID and update `package.json` and the extension-host test before the first Marketplace publication; this changes the extension identity.
2. Create an Azure DevOps PAT with **Marketplace: Manage** scope and the organization access required by Marketplace. Never commit it or paste it into an issue/chat.
3. Add a GitHub Actions environment named **marketplace**, optionally with required reviewers.
4. Add secret **VSCE_PAT** to that environment (or as a repository Actions secret). Set it securely through GitHub Settings or `gh secret set VSCE_PAT --env marketplace`, which prompts for the value without printing it.
5. Use the Release workflow's manual dispatch with the existing release tag to publish a previously released VSIX. The workflow revalidates and rebuilds; it fails visibly if Marketplace rejects the credential or publisher.

No authorized publisher/PAT means **GitHub Release only**, not Marketplace publication. The workflow summary explicitly records this distinction.

## Local install

```sh
code --install-extension ./sf-source-tools-0.1.0.vsix --profile LWC --force
code --list-extensions --show-versions --profile LWC
```

When replacing the old plugin, install and verify SF Source Tools first, then uninstall only `charket.charket-sfdx-multi-package-deploy` from the chosen profile. Do not uninstall Salesforce's official extensions or unrelated profile extensions. Reload the editor window after replacing extensions.
