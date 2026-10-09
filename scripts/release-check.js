const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const { version } = require("../package.json");
const tag =
  process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || `v${version}`;
if (!/^\d+\.\d+\.\d+$/.test(version) || tag !== `v${version}`)
  throw new Error(`Release tag ${tag} must match package version v${version}.`);
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const header = `## [${version}] - `;
const start = changelog.indexOf(header);
if (start < 0) throw new Error(`Missing changelog entry for ${version}.`);
const date = changelog.slice(start + header.length).split("\n")[0];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
  throw new Error("Release changelog entry must have a YYYY-MM-DD date.");
const end = changelog.indexOf("\n## ", start + header.length);
const notes = changelog
  .slice(changelog.indexOf("\n", start) + 1, end < 0 ? undefined : end)
  .trim();
if (!notes) throw new Error("Release changelog must contain notes.");
if (process.env.CI === "true") {
  execFileSync("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], {
    cwd: root,
    stdio: "pipe",
  });
}
console.log(
  process.argv.includes("--notes")
    ? notes
    : `Version, tag, and changelog aligned: ${tag}`,
);
