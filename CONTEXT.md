# Salesforce Source Operations

Source operations connect local Salesforce project metadata with that project's default org in single-project and multi-project workspaces.

## Language

**Owning Project**:
The Salesforce project to which a selected source file or directory belongs.
_Avoid_: Active project, first workspace folder

**Default Org**:
The Salesforce org configured as the default for the owning project.
_Avoid_: Workspace org, shared org

**Source Selection**:
The local metadata files or directories chosen as the subject of an operation.
_Avoid_: Active editor, deployment package

**Metadata Component**:
A Salesforce metadata unit identified by its metadata type and full name; a component can contain multiple local files.
_Avoid_: File

**Deploy**:
An operation that sends selected local metadata to the default org.
_Avoid_: Publish, release

**Retrieve**:
An operation that brings selected metadata from the default org into the owning project.
_Avoid_: Pull, sync

**Delete from Org**:
An operation that removes selected metadata components from the default org while retaining their local source.
_Avoid_: Delete source

**Delete from Project and Org**:
An operation that removes selected metadata components from the default org and, after confirmed remote success, their local source.
_Avoid_: Delete, delete locally
