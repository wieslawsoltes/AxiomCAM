# GitHub Pages deployment

Live application: https://wieslawsoltes.github.io/AxiomCAM/

Repository: https://github.com/wieslawsoltes/AxiomCAM

## Continuous verification and publication

`.github/workflows/pages.yml` runs on pushes and pull requests targeting `main`, and supports manual dispatch. Pull requests are tested without deploying. Successful `main` builds are published to the `github-pages` environment.

Each build runs the 31 core regression tests, rebuilds the standalone HTML and computed examples, then runs the 29 Playwright browser checks served at `http://127.0.0.1:8080/AxiomCAM/`. This explicitly exercises relative URLs, modules, workers, editing, toolpath regeneration, simulation, collision checks, downloads and persistence beneath the same project subpath as the published site. Browser tooling is pinned in `tests/requirements-browser.txt`; it is not an application runtime dependency.

The build stages only application files, documentation and examples into `_site/`. It creates a site-specific `MANIFEST.sha256`, `commit.txt` and `deployment.json` with the revision, workflow-run URL and browser evidence. Verification reports and a screenshot are retained as workflow artifacts for 14 days. The deployment job uses the official GitHub Pages actions, then fetches the public revision and checks SHA-256 integrity of the HTML, CSS and JavaScript entry points against the deployed manifest.

The build token has read-only repository access with no persisted checkout credentials. Only the deployment job receives `pages: write` and `id-token: write`. The one-time checksummed source import has completed; its transport files and import workflow steps are no longer needed. Subsequent deployments do not create commits or require repository-write permission.

## Repository settings

The Pages site is enabled using **GitHub Actions** as its source. To reproduce this setup in another repository, select **Settings > Pages > Build and deployment > Source > GitHub Actions**, and allow the workflow and `github-pages` environment to deploy.

## Local use

```sh
git clone https://github.com/wieslawsoltes/AxiomCAM.git
cd AxiomCAM
npm test
npm start
```

Open `http://localhost:8080`. No npm dependency installation is necessary to run the app or core tests. For browser checks, install the Python requirements and the Playwright Chromium browser first.

## Verification boundaries

The initial hosted browser run completed all 29 checks with zero unhandled page exceptions using the explicitly labeled Canvas fallback. This does not establish physical-device WebGPU correctness or performance. WebGPU is selected only when a usable browser adapter is available. HTTP and checksum checks verify publication, not machining safety. Read `VERIFICATION.md` and `POSTPROCESSOR.md` before interpreting modeled results or using exported NC code.
