const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function fixture(parent, name = "project", org = "fixture-org") {
  const directory = path.join(parent, name);
  fs.mkdirSync(directory, { recursive: true });
  const root = fs.realpathSync(directory);
  write(
    root,
    "sfdx-project.json",
    JSON.stringify({
      packageDirectories: [{ path: "force-app", default: true }],
      namespace: "",
      sourceApiVersion: "67.0",
    }),
  );
  write(root, ".sf/config.json", JSON.stringify({ "target-org": org }));
  const html = write(
    root,
    "force-app/main/default/lwc/greeting/greeting.html",
    "<template>Hello</template>",
  );
  write(
    root,
    "force-app/main/default/lwc/greeting/greeting.js",
    "export default class Greeting {}\n",
  );
  write(
    root,
    "force-app/main/default/lwc/greeting/greeting.js-meta.xml",
    '<?xml version="1.0"?><LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>67.0</apiVersion><isExposed>false</isExposed></LightningComponentBundle>',
  );
  const field = write(
    root,
    "force-app/main/default/objects/Sample__c/fields/Note__c.field-meta.xml",
    '<CustomField xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Note__c</fullName><label>Note</label><type>Text</type><length>20</length></CustomField>',
  );
  const labels = write(
    root,
    "force-app/main/default/labels/CustomLabels.labels-meta.xml",
    '<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata"><labels><fullName>Greeting</fullName><language>en_US</language><protected>false</protected><shortDescription>Greeting</shortDescription><value>Hello</value></labels></CustomLabels>',
  );
  return { root, html, field, labels };
}

function temporary(t) {
  const root = fs.mkdtempSync(
    path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), "sf-source-test-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function uri(file) {
  return { scheme: "file", fsPath: file, toString: () => `file://${file}` };
}

module.exports = { write, fixture, temporary, uri };
