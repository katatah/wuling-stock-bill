# Wuling Stock Bill Guide

A browser-based planning helper for **Arknights: Endfield** Wuling Stock Bill
production.

The tool compares multiple production candidates instead of showing only one
answer. It is meant to help you choose a plan that earns enough Wuling Stock
Bills while still being practical to build.

## What It Helps With

- Explore recovery plans for missed Wuling Stock Bill exchanges, or evaluate changes to material stocking rates and their feasibility.
- Help customize imported shared blueprints by surfacing subtle but important issues, such as long-term material changes and competition for lower-tier materials.

## How To Use

1. Set raw resource limits and deduction rates in the Production panel.
2. Adjust target production ranges when you want to test a specific plan.
3. Review the Candidates table.
4. Select a row to open the detail panel.
5. Double-click a candidate row to copy its design rates back to Production.

The `Transfer` column represents the selected stock-transfer boost variant.

## Run Locally

The app has no build step. A static server is enough.

```bash
npm install
npm run serve
```

Open the local URL printed by the server.

## Development

Common checks:

```bash
npm run check
npm test
```

Developer-oriented notes live in `docs/`:

- [Architecture](docs/architecture.md)
- [Candidate generation](docs/candidate-generation.md)

## Disclaimer

Arknights: Endfield is a trademark of Hypergryph. This tool is not affiliated
with or endorsed by Hypergryph.

## License

[MIT](LICENSE)
