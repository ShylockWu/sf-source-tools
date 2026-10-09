const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const hooks = path.join(root, ".git", "hooks");
if (fs.existsSync(hooks)) {
  const hook = path.join(hooks, "pre-commit");
  if (!fs.existsSync(hook)) {
    fs.writeFileSync(
      hook,
      "#!/bin/sh\nset -eu\nnpm exec -- prettier --check .\n",
      { mode: 0o755 },
    );
  }
}
