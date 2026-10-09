const fs = require("node:fs");
const path = require("node:path");
const {
  ComponentSet,
  RegistryAccess,
} = require("@salesforce/source-deploy-retrieve");

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function findProject(source) {
  const real = fs.realpathSync(source);
  let current = fs.statSync(real).isDirectory() ? real : path.dirname(real);
  while (true) {
    if (fs.existsSync(path.join(current, "sfdx-project.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current)
      throw new Error(
        `No Salesforce project owns ${source}. Select source inside a project containing sfdx-project.json.`,
      );
    current = parent;
  }
}

function localDefaultOrg(root) {
  const configPath = path.join(root, ".sf", "config.json");
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(
        `Cannot read project-local Salesforce configuration in ${root}: ${error.message}`,
      );
  }
  const org = config?.["target-org"];
  if (typeof org !== "string" || !org.trim()) {
    throw new Error(
      `No project-local default org in ${root}. Run "sf config set target-org=YOUR_ORG" from this project (without --global). Global and environment defaults are not used.`,
    );
  }
  return org.trim();
}

function resolveSelection(paths) {
  if (!paths.length)
    throw new Error(
      "Select a Salesforce source file or folder, or open one in the editor.",
    );
  const sources = [...new Set(paths.map((source) => fs.realpathSync(source)))];
  const roots = sources.map(findProject);
  const root = roots[0];
  if (roots.some((value) => value !== root))
    throw new Error(
      "The selection spans multiple Salesforce projects. Run each project's operation separately.",
    );
  const project = JSON.parse(
    fs.readFileSync(path.join(root, "sfdx-project.json"), "utf8"),
  );
  const packageRoots = (project.packageDirectories || []).map((pkg) =>
    fs.realpathSync(path.resolve(root, pkg.path)),
  );
  if (
    sources.some((source) => !packageRoots.some((pkg) => isWithin(pkg, source)))
  ) {
    throw new Error(
      "Select metadata inside a package directory declared in sfdx-project.json, not the project root or configuration files.",
    );
  }
  const registry = new RegistryAccess(undefined, root);
  const components = ComponentSet.fromSource({ fsPaths: sources, registry });
  components.projectDirectory = root;
  components.sourceApiVersion = project.sourceApiVersion;
  const deletionComponents = new ComponentSet(
    [...components]
      .flatMap((component) => {
        const children =
          component.type.strategies?.transformer === "nonDecomposed"
            ? component.getChildren()
            : [];
        return children.length ? children : [component];
      })
      .filter((component) => component.isAddressable !== false),
    registry,
  );
  deletionComponents.projectDirectory = root;
  deletionComponents.sourceApiVersion = project.sourceApiVersion;
  const members = [...deletionComponents].map(
    (component) => `${component.type.name}:${component.fullName}`,
  );
  if (!members.length)
    throw new Error(
      "No deployable metadata found in the selection. Check the source path and .forceignore.",
    );
  const files = new Set();
  for (const component of components.getSourceComponents()) {
    for (const file of [component.xml, ...component.walkContent()].filter(
      Boolean,
    )) {
      const real = fs.realpathSync(file);
      if (
        findProject(real) !== root ||
        !packageRoots.some((pkg) => isWithin(pkg, real))
      ) {
        throw new Error(
          `Resolved metadata escapes the owning project's package directories: ${file}`,
        );
      }
      files.add(real);
    }
  }
  return {
    root,
    sources,
    components: deletionComponents,
    members: [...new Set(members)].sort(),
    files: [...files],
    org: localDefaultOrg(root),
    registry,
    packageRoots,
    apiVersion: project.sourceApiVersion,
  };
}

function assertDeleteScope(context) {
  const actual = ComponentSet.fromSource({
    fsPaths: context.packageRoots,
    include: context.components,
    registry: context.registry,
  });
  const selectedFiles = new Set(context.files);
  for (const component of actual.getSourceComponents()) {
    for (const file of [component.xml, ...component.walkContent()].filter(
      Boolean,
    )) {
      if (!selectedFiles.has(fs.realpathSync(file))) {
        throw new Error(
          `Ambiguous deletion: Salesforce CLI also resolves an unselected local copy at ${file}. Select all copies of this component in the owning project, or resolve duplicate metadata before deleting.`,
        );
      }
    }
  }
}

module.exports = {
  isWithin,
  findProject,
  localDefaultOrg,
  resolveSelection,
  assertDeleteScope,
};
