import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("app shell points at the organized source and style directories", () => {
  const html = readFileSync("index.html", "utf8");

  assert.match(html, /href="styles\/endfield_calculator\.css"/);
  assert.match(html, /href="styles\/production\.css"/);
  assert.match(html, /href="styles\/candidate\.css"/);
  assert.match(html, /href="styles\/detail\.css"/);
  assert.match(html, /src="src\/solver_pipeline\.js"/);
  assert.match(html, /src="src\/scenario\/deductions\.js"/);
  assert.match(html, /src="src\/scenario\/solver-kernel\.js"/);
  assert.match(html, /src="src\/scenario\/solver-service\.js"/);
  assert.match(html, /src="src\/scenario\/solution-summary\.js"/);
  assert.match(html, /src="src\/scenario\/candidate-buildability\.js"/);
  assert.match(html, /src="src\/scenario\/candidate-neighborhood\.js"/);
  assert.match(html, /src="src\/scenario\/candidate-engine\.js"/);
  assert.match(html, /src="src\/ui\/production\.js"/);
  assert.match(html, /src="src\/ui\/candidate\.js"/);
  assert.match(html, /src="src\/ui\/candidate-controller\.js"/);
  assert.match(html, /src="src\/ui\/detail-helpers\.js"/);
  assert.match(html, /src="src\/ui\/detail-export\.js"/);
  assert.match(html, /src="src\/ui\/fraction-plan\.js"/);
  assert.match(html, /src="src\/ui\/detail\.js"/);
  assert.match(html, /id="wuling-candidate-root"/);
  assert.match(html, /id="wuling-detail-root"/);
  assert.match(html, /s\.src = 'src\/endfield_calculator\.js'/);
});

test("core source, style, asset, and tool files exist", () => {
  [
    "src/endfield_calculator.js",
    "src/solver_pipeline.js",
    "styles/endfield_calculator.css",
    "assets/items.json",
    "assets/recipes.json",
    "assets/solver_config.js",
    "src/scenario/wuling-stock-bill.js",
    "src/scenario/state.js",
    "src/scenario/candidate-policies.js",
    "src/scenario/deductions.js",
    "src/scenario/snapshot.js",
    "src/scenario/solver-kernel.js",
    "src/scenario/solver-service.js",
    "src/scenario/solution-summary.js",
    "src/scenario/candidate-buildability.js",
    "src/scenario/candidate-neighborhood.js",
    "src/scenario/candidate-engine.js",
    "src/ui/production.js",
    "src/ui/candidate.js",
    "src/ui/candidate-controller.js",
    "src/ui/detail-helpers.js",
    "src/ui/detail-export.js",
    "src/ui/fraction-plan.js",
    "src/ui/detail.js",
    "styles/production.css",
    "styles/candidate.css",
    "styles/fraction-plan.css",
    "styles/detail.css",
    "tools/static-server.mjs",
    "docs/architecture.md",
    "docs/candidate-generation.md",
  ].forEach((path) => assert.equal(existsSync(path), true, `${path} should exist`));
});
