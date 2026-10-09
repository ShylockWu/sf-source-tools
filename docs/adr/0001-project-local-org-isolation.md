# Bind operations to the owning project's local default org

In a multi-project workspace, inheriting an editor-wide environment default or another project's org can deploy or delete metadata in the wrong Salesforce environment. Resolve ownership from the selected resource and require that project's local default org; bind the child CLI environment to it instead of accepting global defaults or choosing the first workspace project. This intentionally rejects otherwise valid global-only CLI configuration in exchange for project isolation.
