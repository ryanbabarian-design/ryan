import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as core from "../js/core.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("proposal implementation details support three public submission states", () => {
  assert.equal(typeof core.normalizeImplementationDetails, "function");
  assert.deepEqual(core.normalizeImplementationDetails("미실시", "2026-08-06"), {
    implementation_status: "미실시",
    implemented_date: null,
  });
  assert.deepEqual(core.normalizeImplementationDetails("진행중", "2026-08-06"), {
    implementation_status: "진행중",
    implemented_date: null,
  });
  assert.deepEqual(core.normalizeImplementationDetails("완료", "2026-08-06"), {
    implementation_status: "완료",
    implemented_date: "2026-08-06",
  });
});

test("completed implementation requires an implementation date", () => {
  assert.equal(typeof core.normalizeImplementationDetails, "function");
  assert.throws(
    () => core.normalizeImplementationDetails("완료", ""),
    /완료 상태는 실시일을 입력하세요/,
  );
  assert.throws(
    () => core.normalizeImplementationDetails("잘못된상태", "2026-08-06"),
    /실시상태를 다시 선택하세요/,
  );
});

test("proposal form exposes implementation status and date without removing existing image and print patches", async () => {
  const app = await read("js/app.js");
  assert.match(app, /name="implementation_status"/);
  assert.match(app, /name="implemented_date"/);
  assert.match(app, /id="implementationStatus"/);
  assert.match(app, /syncImplementationDateField/);
  assert.match(app, /initializeFormImageSelections/);
  assert.match(app, /buildPrintModel/);
});

test("demo and Supabase persistence preserve public implementation fields", async () => {
  const store = await read("js/services/store.js");
  const sql = await read("sql/supabase_setup.sql");
  assert.match(store, /normalizeImplementationDetails/);
  assert.doesNotMatch(store, /review_result:\s*"미심사",\s*\n\s*implementation_status:\s*"미실시"/);
  assert.match(sql, /p_payload->>'implementation_status'/);
  assert.match(sql, /p_payload->>'implemented_date'/);
});
