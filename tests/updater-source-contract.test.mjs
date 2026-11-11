import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/deploy-update.yml", "utf8");
const utils = readFileSync("src/app/api/admin/update/utils.ts", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const readme = readFileSync("README.md", "utf8");
const deployment = readFileSync("docs/deployment.md", "utf8");
const selfHosting = readFileSync("docs/self-hosting.md", "utf8");

test("updater source repository and branch are pinned to the fork", () => {
  assert.match(workflow, /source_repository="digivation\/mailflare"/);
  assert.match(workflow, /source_branch="ourflare"/);
  assert.match(workflow, /git fetch --no-tags upstream "refs\/heads\/\$\{source_branch\}:refs\/remotes\/upstream\/\$\{source_branch\}"/);
  assert.match(workflow, /git read-tree --reset -u "\$\{upstream_ref\}"/);
  assert.doesNotMatch(workflow, /git fetch --no-tags upstream\s*\n/);
  assert.match(utils, /UPDATE_SOURCE_REPOSITORY = "digivation\/mailflare"/);
  assert.match(utils, /UPDATE_SOURCE_REF = "ourflare"/);
  assert.match(utils, /contents\/package\.json\?ref=\$\{UPDATE_SOURCE_REF\}/);
  assert.match(utils, /`\/repos\/\$\{repository\}\/actions\/workflows\/\$\{UPDATE_WORKFLOW\}\/dispatches`/);
  assert.match(utils, /JSON\.stringify\(\{ ref \}\)/);
  assert.doesNotMatch(workflow, /UPDATE_SOURCE_REPOSITORY|hieunc229\/mailflare/);
  assert.doesNotMatch(utils, /hieunc229\/mailflare|vars\.UPDATE_SOURCE_REPOSITORY/);
});

test("fresh-install docs pin checkout and Cloudflare production branch to ourflare", () => {
  for (const doc of [readme, deployment, selfHosting]) {
    assert.match(doc, /--branch ourflare --single-branch https:\/\/github\.com\/digivation\/mailflare\.git/);
    assert.doesNotMatch(doc, /deploy\.workers\.cloudflare\.com\/?\?url=https:\/\/github\.com\/digivation\/mailflare/);
  }
  assert.match(deployment, /select and verify `ourflare` as the production\/deployment branch/i);
  assert.match(readme, /select and verify `ourflare` as the production\/deployment branch/i);
  const dockerQuickStart = readme.match(/### Self-host with Docker[\s\S]*?```bash\n([\s\S]*?)```/)?.[1];
  assert.ok(dockerQuickStart, "README Docker quick start exists");
  assert.match(dockerQuickStart, /git clone --branch ourflare --single-branch/);
  assert.match(dockerQuickStart, /cd mailflare/);
});

test("updater release is offered to installations on 0.5.4", () => {
  assert.equal(lock.version, packageJson.version);
  assert.equal(lock.packages[""].version, packageJson.version);
  const versionParts = (version) => version.split(".").map(Number);
  const current = versionParts("0.5.4");
  const target = versionParts(packageJson.version);
  const newer = target.some(
    (part, index) =>
      part > current[index] &&
      target.slice(0, index).every((n, i) => n === current[i]),
  );
  assert.ok(newer, `${packageJson.version} must be newer than 0.5.4`);
});
