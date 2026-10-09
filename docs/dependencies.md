# Dependency notes

`@salesforce/source-deploy-retrieve` is used only for local metadata resolution and manifest generation. Authenticated remote operations run through the separately installed Salesforce CLI.

The `get-uri` transitive dependency requests `basic-ftp` 5.x, which is affected by GHSA-c475-qrg2-pj4r. This project overrides that dependency to patched version **6.2.2**, instead of downgrading Salesforce's metadata registry to an older major version. Keep this override until the upstream dependency chain requests a patched version, and rerun unit, extension-host, packaged-artifact, and production dependency audit checks after any dependency update.
