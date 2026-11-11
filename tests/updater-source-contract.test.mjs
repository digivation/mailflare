import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/deploy-update.yml", "utf8");
const utils = readFileSync("src/app/api/admin/update/utils.ts", "utf8");

test("updater source repository and branch are pinned to the fork", () => {
  assert.match(workflow, /source_repository="digivation\/mailflare"/);
  assert.match(workflow, /source_branch="ourflare"/);
  assert.match(utils, /UPDATE_SOURCE_REPOSITORY = "digivation\/mailflare"/);
  assert.match(utils, /UPDATE_SOURCE_REF = "ourflare"/);
  assert.match(utils, /contents\/package\.json\?ref=\$\{UPDATE_SOURCE_REF\}/);
  assert.doesNotMatch(workflow, /UPDATE_SOURCE_REPOSITORY|hieunc229\/mailflare/);
  assert.doesNotMatch(utils, /hieunc229\/mailflare|vars\.UPDATE_SOURCE_REPOSITORY/);
});
