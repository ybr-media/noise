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
