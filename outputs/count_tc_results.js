// Count pass/fail per TEST CASE (request), not per assertion.
// A test case fails if any of its assertions fails (or the request itself errored).
//
// Usage:
//   node count_tc_results.js <results.json>
//
// Accepts either:
//   - Postman Runner export   (Run results > Export Results)
//   - Newman JSON report      (newman run ... -r cli,json --reporter-json-export results.json)

const fs = require("fs");

const file = process.argv[2];
if (!file) {
    console.error("Usage: node count_tc_results.js <results.json>");
    process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, "utf8"));

// name -> { pass, fail, failedAssertions[] }
const cases = new Map();
function record(name, assertion, passed) {
    if (!cases.has(name)) cases.set(name, { pass: 0, fail: 0, failedAssertions: [] });
    const c = cases.get(name);
    if (passed) c.pass++;
    else { c.fail++; c.failedAssertions.push(assertion); }
}

if (data.run && Array.isArray(data.run.executions)) {
    // Newman JSON report
    for (const ex of data.run.executions) {
        const name = ex.item.name;
        if (ex.requestError) record(name, "Request error: " + ex.requestError.message, false);
        for (const a of ex.assertions || []) record(name, a.assertion, !a.error);
        if (!cases.has(name)) cases.set(name, { pass: 0, fail: 0, failedAssertions: [] });
    }
} else if (Array.isArray(data.results)) {
    // Postman Runner export
    for (const r of data.results) {
        const name = r.name;
        if (r.testPassFailCounts) {
            for (const [assertion, cnt] of Object.entries(r.testPassFailCounts)) {
                for (let i = 0; i < (cnt.pass || 0); i++) record(name, assertion, true);
                for (let i = 0; i < (cnt.fail || 0); i++) record(name, assertion, false);
            }
        } else {
            for (const [assertion, ok] of Object.entries(r.tests || {})) record(name, assertion, ok);
        }
        if (!cases.has(name)) cases.set(name, { pass: 0, fail: 0, failedAssertions: [] });
    }
} else {
    console.error("Unrecognized format: expected a Newman JSON report or a Postman Runner export.");
    process.exit(1);
}

// Only count real test cases (names start with TC_)
const tcs = [...cases.entries()].filter(([name]) => /^TC_/.test(name));
const failed = tcs.filter(([, c]) => c.fail > 0);
const noTests = tcs.filter(([, c]) => c.pass + c.fail === 0);
const passed = tcs.length - failed.length - noTests.length;

console.log("=== Test case summary ===");
console.log(`Total test cases : ${tcs.length}`);
console.log(`Passed           : ${passed}`);
console.log(`Failed           : ${failed.length}`);
if (noTests.length) console.log(`No assertions run: ${noTests.length}`);

// Per-module breakdown (TC_<MODULE>_...)
const byModule = {};
for (const [name, c] of tcs) {
    const mod = name.split("_")[1];
    byModule[mod] = byModule[mod] || { total: 0, failed: 0 };
    byModule[mod].total++;
    if (c.fail > 0) byModule[mod].failed++;
}
console.log("\n=== By module ===");
for (const [mod, s] of Object.entries(byModule)) {
    console.log(`${mod.padEnd(10)} total ${String(s.total).padStart(3)}  passed ${String(s.total - s.failed).padStart(3)}  failed ${String(s.failed).padStart(3)}`);
}

if (failed.length) {
    console.log("\n=== Failed test cases ===");
    for (const [name, c] of failed) {
        console.log(`✗ ${name}`);
        for (const a of c.failedAssertions) console.log(`    - ${a}`);
    }
}
