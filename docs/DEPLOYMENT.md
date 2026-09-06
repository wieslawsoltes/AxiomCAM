# GitHub Pages deployment

Repository: https://github.com/wieslawsoltes/AxiomCAM

Application URL after a successful deployment: https://wieslawsoltes.github.io/AxiomCAM/

## Repository setup

Under **Settings > Pages > Build and deployment > Source**, select **GitHub Actions**. The repository must permit Actions and Pages deployment. Normal workflow tokens can publish an enabled Pages site but may not have administration permission to create the site initially. If the Configure GitHub Pages step reports that the site is missing or returns 403, enable the source in repository settings and rerun the workflow.

## Build and publication

The Pages workflow runs the core regression suite, rebuilds the standalone HTML and computed examples, and stages the modular application with documentation and examples into `_site/`. The upload and deploy jobs use the official GitHub Pages actions. Subsequent pushes to `main` automatically rebuild and publish; `workflow_dispatch` also permits manual publication. The deployed `commit.txt` identifies the source revision.

The initial import workflow verifies the source archive SHA-256 before restoring it, then commits ordinary editable source files. Its compressed transport files are removed from the working tree after import. The ongoing publication workflow does not need the transport archive or repository-write permission.

## Browser verification

The integration suite is exercised at `http://127.0.0.1:8080/AxiomCAM/` to check project-subpath URLs, module loading, workers, CAD editing, CAM regeneration, verification, simulation, import/export and persistence. Browser diagnostics and a workspace screenshot are retained as workflow artifacts. Software rendering in a hosted CI environment does not establish physical-device WebGPU performance or machining safety.

## Local use

```sh
git clone https://github.com/wieslawsoltes/AxiomCAM.git
cd AxiomCAM
npm test
npm start
```

Open `http://localhost:8080`. No npm dependency installation is necessary. WebGPU is selected when a usable browser adapter is available; the fallback renderer remains explicitly labeled. Refer to `VERIFICATION.md` and `POSTPROCESSOR.md` before interpreting a verification result or exporting machine code.
