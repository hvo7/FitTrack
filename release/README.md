# Release builds

Windows desktop builds, produced by `npm run build:desktop` and copied here from
`dist/`.

| File | What it is |
|---|---|
| `FitTrack-<version>-portable.exe` | Single file, nothing to install. Double-click it. |
| `FitTrack-<version>-setup.exe` | Installer — adds Desktop and Start Menu shortcuts. |

Either one is fine; they run the same app. The portable build is the one to copy
onto a USB stick or hand to another machine.

## These are thin shells

`APP_URL` in [`config.js`](../config.js) points at the deployed site, so the
desktop app loads **https://hvo7.github.io/FitTrack** rather than a bundled copy.
Pushing to `main` updates the desktop app too — you do not need to rebuild or
reinstall it to pick up a change.

Rebuild only when something outside the web app changes: the Electron shell
(`main.js`), the icon, or the version number.

## The exes are not committed

They are ~83 MB each, which does not belong in a git repository. `.gitignore`
keeps them out; only this README is tracked. To hand someone a build, attach it
to a [GitHub release](https://github.com/hvo7/FitTrack/releases) rather than
committing it.

## Building on a machine without symlink privilege

`electron-builder` unpacks a code-signing toolchain that contains macOS
symlinks, and Windows refuses to create those without Developer Mode — the
build then fails at the installer step with *"A required privilege is not held
by the client"*. Extracting the archive once, without the macOS half, is enough
to get past it permanently:

```powershell
$cache = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
$7za   = "node_modules\7zip-bin\win\x64\7za.exe"
& $7za x "-xr!darwin" "$cache\<downloaded>.7z" "-o$cache\winCodeSign-2.6.0"
```

The Windows tools in that archive — `rcedit`, which stamps the icon and version
into the exe — are all that is actually needed here.
