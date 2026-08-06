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

## 3.4.2 script-pipe compatibility probe

One final probe targeted only the older script-pipe protocol. The 3.4.2
bundle's module was enabled with status `1`, its module timestamp matched the
actual `.so` mtime, and `ShowWelcomeDialog=0`/`FirstRun=0` were present in the
temporary config. Both FIFOs were created.

The probe tested both non-deadlocking client open orders:

* open `.to` for writing, then `.from` for nonblocking reading;
* open `.from` for nonblocking reading, then `.to` for writing.

For each order it sent all of the following, with explicit flushing through
direct `os.write()` and both newline styles:

```text
Help: Command=Help\n
Help: Command=Help\r\n
Help: Command=Help Format=Brief\n
NewStereoTrack:\n
```

Every combination produced exactly one raw response byte sequence:

```text
b"\n"
```

There was no command response, error, or alternate completion sentinel.
The Audacity process remained alive, so this was not a FIFO-open deadlock or
process crash. Since no 3.4.2 command response could be obtained after trying
both orderings and line endings, the existing 3.7-compatible client was left
unchanged and no 3.4.2 export result was claimed. A Tone-to-WAV or FLAC
export cannot be tested honestly without a working command response.

## Nyquist selected-audio binding

Audacity's current Nyquist Prompt documentation uses `*track*` for the
selected audio. The older `s` binding is documented as obsolete after Nyquist
version 4; a bare `track` is neither binding. The crossfade expression
therefore uses `*track*`, which also preserves the selected stereo sound as a
single Nyquist value without manually splitting channels.

## Export preferences

`Export2:` selects the container from the filename extension, but its
scriptable command does not expose FLAC bit depth or export sample-rate
parameters. The setup config therefore pre-seeds the preferences that the
interactive exporter would otherwise persist:

```ini
[SamplingRate]
DefaultProjectSampleRate=48000
[FileFormats]
FLACBitDepth=24
```

The first value makes newly created Audacity projects use the required 48 kHz
rate; the second selects 24-bit FLAC encoding. These are configuration
defaults only. End-to-end encoded-file verification remains blocked by the
documented Audacity export failure, but the generated config and live
temporary profile were read back after launch to confirm both values landed.

## Client constraint: preserve Audacity DSP

Audacity is required for the specific DSP character of the rendered noise.
Replacing its generation or processing with SoX, FFmpeg, Python DSP, or
another audio engine is therefore not an acceptable fallback. If direct
export remains unavailable, the only compatible fallback is to keep Audacity
for all generation and DSP and serialize the samples stored in its `.aup3`
project.

## Follow-up export experiments

### Experiment 1: select tracks explicitly

The suspected missing track selection was tested using two fresh 3.7.8
AppImage processes. Each generated a 440 Hz tone, then sent:

```text
SelectAll:
SelAllTracks:
Export2: Filename="/tmp/exp1-selalltracks.wav" NumChannels=2
```

The WAV export returned:

```text
Could not export to WAV format!
BatchCommand finished: Failed!
```

The same sequence with a `.flac` destination returned the corresponding FLAC
failure. Neither destination was created, so neither produced verifiable
non-silent audio. Explicit track selection does not fix the blocker.

### Experiment 2: XDG user directories and D-Bus

For two more fresh 3.7.8 processes, temporary homes were given a
`~/Documents` directory, `xdg-user-dirs-update` was run, and Audacity was
launched under `dbus-run-session` and Xvfb. The same explicit time and track
selection sequence was used. WAV and FLAC both failed immediately with the
same generic responses. Stderr contained only portal/GTK display warnings
from the headless D-Bus session; no exporter error appeared. Missing
`~/Documents`, XDG setup, and D-Bus are not sufficient to fix export here.

### Experiment 3: live export-module diagnostics

Against a live 3.7.8 profile, with `AUDACITY_MODULES_PATH` set explicitly to
the extracted AppImage module directory, the pipe returned:

```text
GetPreference: Name=/Module/mod-pcm
1
BatchCommand finished: OK

GetPreference: Name=/Module/mod-flac
1
BatchCommand finished: OK

GetPreference: Name=/Module/mod-script-pipe
1
BatchCommand finished: OK
```

The live profile retained status `1` for all three modules. Captured stdout
contained the expected bundled library list and stderr was empty; no module
initialization error was logged. This rules out the proposed cached
load-failure status `3` and leaves the registration failure unresolved:
module status and library loading still do not result in a usable exporter.

### Experiment 4: Audacity 3.4.2 old-exporter test

The 3.4.2 AppImage was launched once under Xvfb with a fresh home. Its config
contained `mod-script-pipe=4`, while the module path and timestamp entries
matched the extracted bundle. Following the documented fix, only that status
was changed from `4` to `1`; paths and timestamps were not changed. A
relaunch created both script FIFOs and the existing pipe client successfully
completed `Help`, track creation, tone generation, `SelectAll:`, and
`SelAllTracks:`.

The decisive old-exporter attempt still failed:

```text
Export2: Filename="/tmp/exp4-tone.wav" NumChannels=2
Could not export to WAV format!
BatchCommand finished: Failed!
```

No WAV was created, so no non-silent audio was observed. The pre-3.5
exporter therefore does not resolve the headless failure either.

Since all four experiments failed, the 20-run gate, PCM determinism check,
and live orchestrator render remain blocked by the absence of any exported
file.

## Export registry and `.aup3` serialization follow-up

### Multi-format registry probe

A single fresh 3.7.8 process generated a tone, selected both time and tracks,
and attempted `Export2:` to each of these extensions:

```text
.wav  .aiff  .au  .flac  .ogg  .mp3  .zzz
```

Every attempt failed immediately with the same format-specific template,
including the deliberately bogus `.zzz` extension:

```text
Could not export to WAV format!
Could not export to AIFF format!
Could not export to AU format!
Could not export to FLAC format!
Could not export to OGG format!
Could not export to MP3 format!
Could not export to ZZZ format!
BatchCommand finished: Failed!
```

No destination file was created. The identical behavior for a bogus
extension is strong evidence that `FindFormat(extension)` is returning null
before any encoder or file-I/O stage. This confirms the findings document's
Branch A diagnosis: the export registry is empty or otherwise unavailable to
the scriptable exporter.

### Filename quoting and case

The same tone/selection sequence was tested with:

```text
Export2: Filename=/tmp/ext-unquoted.wav NumChannels=2
Export2: Filename="/tmp/ext-quoted.wav" NumChannels=2
Export2: Filename=/tmp/ext-uppercase.WAV NumChannels=2
```

All three returned the normal WAV failure and created no file. Quoting is
therefore not corrupting the extension, and `_quote()` in `render_plan.py` is
not the cause.

### Module path layout

The extracted AppImage stores the relevant modules at:

```text
<extracted>/lib/audacity/modules/mod-pcm.so
<extracted>/lib/audacity/modules/mod-flac.so
```

It does not use an `<extracted>/usr/lib/audacity/modules` directory. It also
contains the separate resource directory
`<extracted>/share/audacity/plug-ins`. The explicit
`AUDACITY_MODULES_PATH` used in the live diagnostic points to the actual
`lib/audacity/modules` directory, so the proposed `usr/` path mismatch is
eliminated.

### Measuring the sanctioned `.aup3` fallback

The fallback mechanism was measured without adding it to the renderer:
Audacity generated and mixed a pilot variant entirely through its script
pipe, then `SaveProject2:` wrote an `.aup3` before the later crossfade
Nyquist step. A controlled short version of the same complete generation and
mix sequence produced a 60 MB project containing:

```text
sampleblocks rows: 58
sampleblocks.samples bytes: 59,136,000
sampleblocks.samples interpreted as <f4: 14,784,000 values
```

Reading the first blocks directly from SQLite with
`numpy.frombuffer(blob, dtype="<f4")` produced non-silent PCM. For example,
the first block had 262,144 float32 values, peak approximately
`0.999981`, and RMS approximately `0.577285`. The stored `sampleformat`
was Audacity's float32 format (`262159`).

This proves that Audacity's `.aup3` contains the rendered PCM in
`sampleblocks.samples` and that an external serializer can read it as
little-endian float32 without performing DSP. The project XML uses Audacity's
binary XML representation and the sampleblock table does not itself carry
track/channel or timeline metadata, so a production serializer must also
decode the project document to map blocks to channels and duration. The
measurement did not wire this path into the orchestrator.

The attempted full 240-second pilot sequence also reached `MixAndRender` and
saved successfully, but its subsequent crossfade Nyquist command failed;
therefore no claim is made that the final orchestrator render currently
completes. This is separate from the confirmed viability of reading the
Audacity-generated PCM already stored in `.aup3`.
