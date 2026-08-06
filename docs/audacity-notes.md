# Audacity headless notes

## AppImage and FUSE

The official Linux AppImage is downloaded at an exact version rather than
using a moving “latest” URL. Containers commonly do not expose `/dev/fuse`.
Running the file directly therefore fails before Audacity starts. Run
`AppImage --appimage-extract` once and launch the extracted `AppRun` instead.
The setup script pins Audacity 3.7.8 and records the extracted module paths.

## Display

Audacity is a wxWidgets desktop application and will not start without an X
display. Every process in the smoke test is launched with `xvfb-run -a`; `-a`
chooses a free display number so separate test processes do not collide.

## Audio device

PortAudio initialization can fail before scripting is available when the
machine has no `/dev/snd` device. The setup creates an ALSA configuration with
the `null` PCM as the default device, and the process sets `ALSA_CONFIG_PATH`
to that file. This is an audio sink only; it is not used to generate or
transform samples.

## Script module and first-run dialogs

Audacity's `mod-script-pipe` is shipped as an extracted module, but a fresh
profile may leave it awaiting a GUI “enable module” decision. That dialog
blocks the script pipe. The generated `audacity.cfg` explicitly marks every
shipped module enabled and supplies each absolute `.so` path; in particular,
`mod-script-pipe=1`, its module timestamp, and its path are present before startup. The config also
sets the GUI first-run/splash suppression keys. A per-test `HOME` prevents
state from leaking between runs; the test copies the pre-seeded config into
Audacity's standard `$HOME/.config/audacity/audacity.cfg` location.
The extracted AppImage's fallback PortAudio library is linked into its
library directory and included in `LD_LIBRARY_PATH`; otherwise the scripting
module's dynamic dependencies cannot be resolved on hosts without a system
PortAudio installation.

## Pipe protocol

On Linux, the module creates:

```text
/tmp/audacity_script_pipe.to.<uid>
/tmp/audacity_script_pipe.from.<uid>
```

The client checks both FIFOs before opening them. It writes one scripting
command followed by a newline, then reads response lines until the exact
`BatchCommand finished:` sentinel prefix. Every command has a deadline. A
`BatchCommand failed:` or `Error:` response raises immediately; there is no
retry loop.

## Seeded noise

Do not use Audacity's `Noise:` command: it does not expose a seed. The PRD's
example spells the Nyquist function `seed-random`, but Audacity 3.7.8 exposes
`RANDOM-SEED` and rejects `seed-random` as an unbound function. The smoke test
uses the supported equivalent `(random-seed N)(noise 5)`, then verifies the
exported samples with Python. Python is used only for file inspection, never
for generation or DSP.

## Export diagnosis

Export was isolated from Nyquist using Audacity's built-in `Tone:` generator.
With a track present but no time selection, `Tone:` itself timed out; adding
`SelectTime: Start=0 End=5` made it complete successfully. With that valid
selection, both Tone-generated and Nyquist-generated projects failed identically
at:

```text
Could not export to WAV format!
BatchCommand finished: Failed!
```

`SelectAll:` did not change the result. An absolute path under `/tmp`, with a
writable parent, no pre-existing destination, a quoted `Filename`, and explicit
`NumChannels=2` all produced the same failure. Direct FLAC export failed with
the corresponding `Could not export to FLAC format!` response, so changing the
container format does not unblock export.

The extracted AppImage contains bundled `libsndfile`, `libFLAC`, `libogg`, and
`libvorbis`. With the setup `LD_LIBRARY_PATH`, `ldd` resolves those dependencies
to the bundled copies and reports no missing dependencies for `mod-pcm.so` or
`mod-flac.so`; the focused library check found no unresolved export-library
dependency. Captured stderr contained only expected headless desktop/audio
warnings (D-Bus, ALSA sequencer, and JACK), not an exporter error. The
temporary profile created crash-report/settings and plugin-registry files but
no text log; the useful module/export diagnostic is not emitted to the pipe or
stderr in this headless mode.

The export blocker therefore remains reproducible and independent of the audio
generator, selection state after a valid selection, output path, and WAV versus
FLAC format. No alternate engine or non-Audacity export path was used.

## Export-module and filesystem checks

The extracted 3.7.8 AppImage contains 16 `mod-*.so` files, including
`mod-pcm.so`, `mod-flac.so`, and `mod-script-pipe.so`. The generated and live
temporary-profile configs contain all 16 module names, each with status `1`
(enabled), absolute paths into the AppImage's
`lib/audacity/modules` directory, and matching module timestamps. A live
process inspection also showed `mod-pcm.so`, `mod-flac.so`, and
`mod-script-pipe.so` mapped into the running `bin/audacity` process. The
plugin registry contains the built-in `Export2` script command; native export
modules are not represented as Nyquist/plugin-registry entries. Thus the
failure is not explained by `mod-script-pipe` being the only enabled module or
by an absent module search path.

`SaveProject2:` successfully wrote a 2.1 MB `.aup3` project into the same
temporary profile/output area, proving that the directory is writable and
that Audacity's project-file I/O works. The configured Audacity temp directory
(`/var/tmp/audacity-ubuntu`) is also writable. Both `/tmp` and the repository
filesystem have ample space and inodes; no filesystem or rename-space issue
was observed.

Metadata-editor settings do not apply to `Export2:`'s non-interactive command
path, which constructs the exporter directly rather than opening the normal
export dialog. Export failures returned immediately and never created a
modal-dialog wait condition.

As a cross-build check, the sanctioned 3.7.7 x64 22.04 AppImage was extracted
and launched with the same pre-seeded module paths, ALSA null device, Xvfb,
and pipe client. After correcting its module timestamps, its Tone-generated
WAV and FLAC exports failed with the same generic format-specific errors.
Flatpak was not installed at the time of this initial cross-build check; a
later installation attempt is recorded below.

## Final 3.4.2 and resampler checks

The Audacity 3.4.2 x64 AppImage was also downloaded and extracted. Its
`mod-pcm.so`, `mod-flac.so`, and `mod-script-pipe.so` modules are present, and
the pre-seeded config was adjusted to its module paths and actual module
timestamps. Audacity created both script FIFOs, but the 3.4.2 pipe server did
not return a response to `Help: Command=Help` with the current client
protocol; therefore no honest 3.4.2 export result can be claimed. This is a
script-pipe compatibility/startup blocker, not evidence that 3.4.2's exporter
works or fails.

Neither the 3.4.2 nor 3.7.7 AppImage ships `libsoxr`, and neither the main
binary nor the export modules has a `libsoxr` dynamic dependency. The host
does provide `/usr/lib/x86_64-linux-gnu/libsoxr.so.0`, but Audacity's
export-related objects do not resolve it or require it. The successful
generation/export attempts used the project's native sample rate (44.1 kHz);
they already failed without a sample-rate conversion stage, so a missing
resampler cannot explain the observed generic export failure.

Flatpak was subsequently installed and the Flathub `org.audacityteam.Audacity`
stable application (version 3.7.8) was installed. Launching it in this
headless container required `--no-documents-portal`; even then it did not
create usable script-pipe FIFOs under the isolated run, so it did not provide
an independent export result. The AppImage 3.7.7 and 3.7.8 failures therefore
remain the only complete cross-build export results.
