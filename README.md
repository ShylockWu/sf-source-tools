# SF Source Tools

A small VS Code extension for Salesforce source operations that works in **single-project and multi-root workspaces**. It runs Salesforce CLI from the project owning the source you selected, not from the active editor's project or the first workspace folder.

## Requirements

- VS Code 1.110 or later (desktop or a filesystem-based remote extension host).
- Current Salesforce CLI (`sf`) installed on the extension host and available on PATH.
- An authenticated org and a **project-local** default org for every Salesforce project you use.
- A trusted workspace and source-format metadata inside a `packageDirectories` path in `sfdx-project.json`.
- Enabled VS Code terminal shell integration. The extension uses Bash on macOS/Linux and PowerShell 7 (`pwsh.exe`, installed on PATH) on Windows for its dedicated CLI terminal.

From each Salesforce project's directory, configure its default org:

```sh
sf config set target-org=YOUR_ORG_ALIAS
```

Do not use `--global`. The extension requires `.sf/config.json` in the owning project. It does not use another project's org or silently fall back to a global/environment default. It binds the child CLI environment to this local default so an inherited `SF_TARGET_ORG` cannot redirect the operation. It never copies credentials or resets source tracking.

## Commands

Right-click a source file or directory in Explorer or a source editor. You can also use the command palette with a source file open.

| Command                                                      | Behavior                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **SF Source Tools: Retrieve This Source from Org**           | Retrieve selected metadata after confirming the local overwrite risk.                                                    |
| **SF Source Tools: Deploy This Source to Org**               | Deploy selected source, respecting Salesforce conflict checks.                                                           |
| **SF Source Tools: Delete This Source from Org**             | Delete the listed metadata components remotely and retain local source.                                                  |
| **SF Source Tools: Delete This Source from Project and Org** | Delete the listed metadata components remotely; Salesforce CLI removes local source only after confirmed remote success. |

Files, directories, and same-project multiselect are supported. Cross-project multiselect is rejected: perform the operation separately for each project. Project roots and non-metadata files are not source selections.

For local-and-org deletion, if the CLI would also delete an unselected same-name component copy in another package directory of the same project, the extension rejects the operation. Select all intended copies or resolve the duplicate metadata first.

Salesforce's official source-deploy-retrieve library resolves metadata identities and component scope. Deploy/retrieve pass the selected paths to CLI unchanged; Salesforce controls the actual bundle scope. **Deletion is component-level**, so choosing a file inside an LWC/Aura bundle deletes the entire listed component, not just the HTML/JS file. The confirmation shows the project, org, and resolved component list. Aggregate metadata (such as Custom Labels) is expanded into its actual child components.

**Deletion can destroy object data or cascade to dependent metadata. Back up important data and review the full confirmation.** The extension does not permanently purge deleted metadata. Org-only deletion uses a destructive manifest and leaves local files untouched; Salesforce may record remote source-tracking changes, so later deploy/retrieve operations can show conflicts.

Modified editors in the owning project must be saved before an operation starts. Retrieve can replace multiple files in a component, including changes already saved to disk. Keep your source in Git. On conflicts, overwrite is offered only after Salesforce reports a conflict and only proceeds after explicit confirmation.

Open **Terminal → SF Source Tools** to watch the actual Salesforce CLI stage progress, component counts, colors, elapsed time, and final result tables while the command runs. The visible command does not use `--json`; each write operation executes once. **Output → SF Source Tools** retains project, default org, arguments, and error diagnostics. Each project can have only one active operation from this extension; other projects can operate independently. Closing the terminal or interrupting a local process does not safely cancel a remote Salesforce job; check its remote status before retrying. If shell integration is unavailable, the extension stops before starting CLI instead of losing completion tracking.

Deploy and org-only deletion follow unfinished jobs by their returned ID, including repeated CLI wait timeouts. Retrieve timeouts are reported as incomplete because Salesforce CLI has no retrieve resume command; increase the wait setting and verify remote status and local source before another retrieve. A timeout during **Delete from Project and Org** is also reported as incomplete; local files remain, and the remote deletion may still finish. Inspect its job with `sf project deploy report --job-id JOB_ID` from the owning project before doing anything else. Do not blindly retry or assume local cleanup occurred.

## Settings

| Setting                     | Default | Purpose                                                                                                        |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `sfSourceTools.sfPath`      | `sf`    | CLI executable name or absolute path (machine setting). Useful when the editor's PATH differs from your shell. |
| `sfSourceTools.waitMinutes` | `33`    | Minutes per CLI wait, from 1 to 120.                                                                           |

Use the CLI on the extension host, including when working through SSH or containers. Virtual workspaces such as browser-only GitHub repositories are not supported.

## Install from a GitHub Release

Download `sf-source-tools-VERSION.vsix` from [Releases](https://github.com/ShylockWu/sf-source-tools/releases), then use **Extensions → … → Install from VSIX…**.

To install in a named profile:

```sh
code --install-extension ./sf-source-tools-0.1.1.vsix --profile LWC
```

Publisher identity is `shylockwu.sf-source-tools`. Marketplace distribution requires publisher authorization; a GitHub Release is not proof of Marketplace availability.

## Development

```sh
npm ci
npm run check
npm run test:vscode
npm run package
```

Node.js 24 is used for development and CI. On headless Linux, run `xvfb-run -a npm run test:vscode`. Set `VSCODE_EXECUTABLE_PATH` to an installed desktop executable to avoid downloading VS Code. `SF_SOURCE_TEST_EXTENSION` can point at an extracted VSIX's `extension` directory to test the exact packaged artifact.

Unit tests use temporary Salesforce fixtures and simulated CLI responses. Extension-host smoke tests register all commands and execute deploy commands against a **fake CLI** in a real integrated terminal, checking TTY output, native progress/result tables, resource priority, owning project, default org, and rejected selections. These tests do **not** authenticate to or modify a real Salesforce org. Real-org integration testing must use a separately authorized disposable environment.

No code is copied from the proprietary Charket extension. This is a standalone MIT-licensed project with no Salesforce package dependencies or Charket configuration.

## Releases

See [docs/releasing.md](docs/releasing.md). Each release aligns `package.json`, `CHANGELOG.md`, a `vMAJOR.MINOR.PATCH` tag, and its VSIX. GitHub Actions validates and publishes the GitHub Release. Marketplace publishing uses a `marketplace` environment and the `VSCE_PAT` secret; without it the workflow explicitly skips Marketplace publishing.

## License

[MIT](LICENSE). Not affiliated with or endorsed by Salesforce or Microsoft.
