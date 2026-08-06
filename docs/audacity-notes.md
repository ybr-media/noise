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
saved successfully. Its subsequent crossfade Nyquist command is covered by
the live investigation below.

## Live Nyquist crossfade investigation

The initial crossfade expression failed because it passed the stereo
`*track*` value directly to `extract-abs`, which requires a single Nyquist
sound. The binding itself is valid, but stereo handling is required.

### Binding probe on stereo audio

On a fresh Audacity 3.7.8 process, a stereo tone was selected and the
following Nyquist commands were tested:

```text
*track*
s
(mult *track* 0)
(sim *track* *track*)
(mult *track* (pwlv 0 1))
```

The bare `*track*` and bare `s` results did not return a usable command
response. In contrast, expressions that consume `*track*` as an audio value
completed successfully. `(mult *track* 0)` created a new stereo silent result
track, and `(sim *track* *track*)` created a result with doubled peak/RMS.
The saved `.aup3` sampleblocks confirmed those changes rather than relying on
the pipe's `OK` response alone.

This establishes that Audacity 3.7.8 supplies the selected stereo audio
through `*track*`; `s` is not a usable selected-audio binding in this
environment. The bare `*track*` probe is not itself a valid output because a
multichannel array must be consumed or transformed into an output sound.

### Construct bisection

Direct calls such as:

```text
(extract-abs 0 1 *track*)
(cue (extract-abs 0 1 *track*))
```

failed on stereo input. The same operations wrapped with
`multichan-expand` completed:

```text
(multichan-expand #'extract-abs 0 1 *track*)
(multichan-expand #'cue
  (multichan-expand #'extract-abs 0 1 *track*))
```

`multichan-expand` also successfully handled the per-channel `mult`, `sim`,
and `pwlv` operations. `at-abs` works when applied to the resulting
multichannel value, rather than being passed through `multichan-expand` as a
function.

The crossfade expression was rewritten accordingly. A short stereo
crossfade with a 5-second cell and 2-second overlap returned `OK`; its saved
sampleblocks contained a distinct output track, and a seeded-noise version
showed changed samples around the seam rather than merely returning the
unchanged source.

The corrected expression was then exercised in the real 240-second pilot
plan. The crossfade command completed successfully, and execution proceeded
to the later repeat and loudness-normalization commands. The next failure was
`LoudnessNormalization`, not the crossfade. Thus the stereo-safe crossfade
does not exhibit a short-versus-240-second failure at this stage.

## Live LoudnessNormalization investigation

`Help: Command=LoudnessNormalization` on Audacity 3.7.8 reports exactly these
parameters:

```text
StereoIndependent: bool, default False
LUFSLevel: double, default -23
RMSLevel: double, default -20
DualMono: bool, default True
NormalizeTo: int, default 0
```

The current command uses valid names and types:

```text
LoudnessNormalization: LUFSLevel=-20 NormalizeTo=0
  StereoIndependent=0 DualMono=0
```

An explicit `RMSLevel=-20`, integer versus decimal formatting, and adding
`SelAllTracks:` did not change the result on the failing generated-audio
case. The RMS parameter is not required by the live command interface.

### Short stereo probes

On a fresh stereo tone, the current LUFS command completed and changed the
saved sampleblocks: the tone peak changed from `0.5` to approximately
`0.108177`, with RMS changing from approximately `0.353553` to `0.076493`.
This proves the command is not a generic headless no-op.

The same short probe after a Nyquist-generated noise result failed with
`NormalizeTo=0`, even when `RMSLevel` was supplied. Setting
`StereoIndependent=1` made the simple Nyquist probe complete, but that was
not sufficient for the real plan sequence.

### Real plan sequence

The pilot plan was reduced to a short cell while retaining the real
Audacity-generated stems, gains, mix, and stereo-safe crossfade. The
crossfade succeeded, but `LoudnessNormalization` failed with both
`StereoIndependent=0` and `StereoIndependent=1`, with and without
`RMSLevel`.

The first run of this probe also exposed a malformed timeline: the generated
track reported `49` seconds for a nominal 7-second reduced cell. That issue
has since been fixed by the length changes documented below. On the corrected
timeline, whose track and selection both report 20 seconds, the LUFS command
still fails. A built-in Tone sequence succeeds at both short and 60-second
durations, while an isolated corrected Nyquist noise track succeeds only with
`StereoIndependent=1`. The complete generated/mixed sequence fails with both
values, so the command remains the active live blocker.

### Fade and final-selection probes

Independent of the loudness blocker, the following post-normalization
sequence was exercised on a stereo tone:

```text
Select: Start=0 End=1 Mode=Set RelativeTo=ProjectStart
FadeIn:
Select: Start=4 End=5 Mode=Set RelativeTo=ProjectStart
FadeOut:
Select: Start=0 End=5 Mode=Set RelativeTo=ProjectStart
```

All commands returned `OK`. Saved sampleblocks showed the intended effect:
the first and last samples were zero with a ramp at each edge, and
`GetInfo: Type=Selection Format=JSON` reported `{ "Start":0, "End":5 }`.
These commands are live-verified on tone but have not yet been reached in
the real generated plan because loudness normalization fails first.

## Timeline-length bisection

The earlier 49-second-for-7-second observation was a real timeline error, but
it was caused by the Nyquist effect's replacement-selection behavior rather
than by missing sampleblock accounting. A short real plan was instrumented
with `GetInfo: Type=Tracks Format=JSON` and
`GetInfo: Type=Selection Format=JSON` after every plan command.

For a reduced plan with `cell_seconds=5`, `crossfade_seconds=2`, and one
cell, the measured extents were:

| Step | Expected | Measured |
| --- | ---: | ---: |
| `Silence` placeholder for each stem | 1 s | 1 s |
| Bed Nyquist generation | 7 s | 49 s |
| Texture Nyquist generation | 7 s | 49 s |
| Motion Nyquist generation | 7 s | 7 s |
| After `MixAndRender:` | 7 s | 49 s |
| After corrected stem generation | 7 s | 7 s |
| After `MixAndRender:` with corrected stems | 7 s | 7 s |
| Crossfade selection before trim | 5 s | 5 s |
| Crossfade track before trim | 5 s | 7 s |
| `Trim:` to the selected cell | 5 s | 5 s |
| `Repeat: Count=3` with 5-second cell | 20 s | 20 s |

The isolated Nyquist measurements showed that Audacity's Nyquist effect
replaces the selected interval using a duration multiplier: selecting `D`
seconds and returning `(noise N)` produced an extent of `D*N` seconds. The
old plan selected the full 7-second stem while returning a 7-second sound,
creating 49 seconds. Motion additionally had a one-second LFO modulator, so
the `mult` result was only one second.

The plan now:

- Uses a one-second silent placeholder selection for each Nyquist-generated
  stem, allowing the returned `cell + crossfade` sound to establish the
  intended 7-second extent.
- Stretches the motion LFO to the stem duration with `stretch-abs`.
- Selects the 5-second loop body and applies Audacity's `Trim:` before
  repeating, because the Nyquist effect leaves the original 7-second track
  extent even though its returned crossfade body is 5 seconds.

With these changes, every measured extent through `Repeat:` matches the
expected timeline. The current LUFS command still fails on the corrected
20-second generated/mixed timeline, so the minimal remaining reproducer is no
longer a malformed-length case:

```text
SetProject: Rate=48000
<three 7-second Nyquist-generated stereo stems using 1-second placeholders>
MixAndRender:
<stereo-safe crossfade over 7 seconds>
Select: Start=0 End=5 Track=0 TrackCount=1 Mode=Set RelativeTo=ProjectStart
Trim:
Repeat: Count=3
Select: Start=0 End=20 Mode=Set RelativeTo=ProjectStart
LoudnessNormalization: LUFSLevel=-20 NormalizeTo=0 StereoIndependent=0 DualMono=0
```

The track and selection both report 20 seconds immediately before
normalization. The command still returns `BatchCommand finished: Failed!`.
Changing only `StereoIndependent` to `1` also fails on this full generated
sequence, although it succeeds on an isolated corrected Nyquist noise track.

### Normalize before repeat

The plan now normalizes the trimmed single cell before `Repeat:`. This is
intentional: `Repeat:` creates multiple clips, while the loudness effect
works on a clean single-cell case more reliably. The command order is now:

```text
<crossfade>
Select: Start=0 End=5 Track=0 TrackCount=1 Mode=Set RelativeTo=ProjectStart
Trim:
LoudnessNormalization: LUFSLevel=-20 NormalizeTo=0 StereoIndependent=0 DualMono=0
Repeat: Count=3
Select: Start=0 End=20 Mode=Set RelativeTo=ProjectStart
<fades>
```

The live test still failed at the single-cell normalization step, with the
track and selection both reporting 5 seconds. This is now the minimal
reproducer boundary; no further parameter permutations were performed.
Because the single-cell effect failed, final integrated loudness after repeat
and fades could not be measured through Audacity's loudness effect.

The ordering remains the better design even if the current failure requires
another Audacity-native fix: concatenating N identical cells does not change
integrated loudness, so normalizing one cell and then repeating it is
mathematically equivalent to normalizing the repeated signal, aside from the
small final fade contribution that QA must measure.

`GetInfo: Type=Commands Format=JSON` contains no `Join` command, and
`Help: Command=Join` / `Help: Command=Disjoin` both returned `Command not
found`. The official `audacity-project-tools` utility was not installed in
the environment, and its CMake/Conan dependencies were unavailable, so a
schema-level `<waveclip>` count was not obtained in this round. No clip
consolidation workaround was added.

`ApplyMacro:` was also checked through `Help`; Audacity returned `Command not
found`, so the alternate macro export path was not available for a quick
probe.

## Loudness stage bisection

Audacity 3.7.8 supports:

```text
GetInfo: Type=Clips Format=JSON
```

Fresh-process probes were run on a reduced five-second-cell plan. Each probe
queried tracks, clips, and selection immediately before running
`LoudnessNormalization:`. Results:

| Stage | Track extent | Clip count | `StereoIndependent=0` | `StereoIndependent=1` |
| --- | ---: | ---: | --- | --- |
| One bed stem generated | 7 s | 1 | **fail** | **pass** |
| Three stems, before mix | 7 s | 3 | **fail** | **pass** |
| After `MixAndRender:` | 7 s | 1 | **fail** | **fail** |
| After crossfade Nyquist replacement | 7 s | 1 | **fail** | **fail** |
| After `Trim:` | 5 s | 1 | **fail** | **fail** |

The transition from pass to fail is `MixAndRender:` for the complete
three-stem material. Clip count remains one at that transition, so the
multi-clip hypothesis is not supported by this measurement. The crossfade
and `Trim:` are not the first failing stages.

Additional controls narrowed this further:

- A bed-only `MixAndRender:` succeeds with `StereoIndependent=1`.
- The complete three-stem material succeeds before mixing with
  `StereoIndependent=1` but fails after mixing.
- `StereoIndependent=0` fails even on the isolated generated stem, matching
  the earlier parameter split.

Thus the current minimal material-level reproducer is a complete
three-stem `MixAndRender:` result with one 7-second clip. The exact response
is:

```text
LoudnessNormalization: LUFSLevel=-20 NormalizeTo=0 StereoIndependent=1 DualMono=0
BatchCommand finished: Failed!
```

No external normalizer or gain computation was used. The research question
now points at the mixed three-stem audio content/state rather than clip
count, crossfade, trim, or repeated timeline structure.

## Export-registry evidence correction

The generic `Could not export to <format> format!` response is emitted by
both the registry-miss and exporter-failed branches in Audacity 3.7.8.
Therefore the earlier multi-format probe, including `.zzz`, does **not**
prove that the registry is empty. The notes now treat that result as
inconclusive rather than as Branch A confirmation.

The requested `strace -f -e trace=openat` probe did not reach a usable pipe
response under tracing, so it produced no target-path `openat` evidence.
Likewise, `Import2:` of a known WAV timed out in the current headless
profile. No export registration conclusion is claimed from those attempts.
The AppImage's `mod-pcm.so` depends on the bundled Audacity shared libraries;
plain `ldd` reports them as unresolved unless the AppImage library directory
is supplied through `LD_LIBRARY_PATH`.

`Export2:` has a default `NumChannels=1`; the render plan and smoke test
explicitly pass `NumChannels=2`, and regression tests require that parameter
on every generated export command.

## Crossfade direction and Nyquist binding

The seam crossfade now uses the conventional direction:

```text
head × (1 → 0) + tail × (0 → 1)
```

The prior expression had these envelopes reversed. The live stereo-safe
implementation continues to use `*track*` plus `multichan-expand` for
single-sound operations. In Audacity 3.7.8's version-4 Nyquist environment,
`s` is the dummy float `0.25`, not selected audio; `*track*` is a sound for
mono and an array of sounds for stereo. Direct `extract-abs` on the stereo
array type-errors, which is why the per-channel expansion is required.

## Mix headroom and `SetTrackAudio`

The level hypothesis exposed an additional command-contract bug. Live help
for Audacity 3.7.8 shows that `SetTrackAudio` accepts `Volume` and `Pan`;
the planner had been emitting an unsupported `Gain` parameter. Audacity
silently left the intended attenuation unapplied, and the resulting three
stem mix could exceed full scale.

Measured little-endian float32 sampleblocks from saved projects included:

| Material | Peak | RMS | Loudness (`StereoIndependent=1`) |
| --- | ---: | ---: | --- |
| One unattenuated Nyquist stem | 0.999996 | 0.577398 | Pass |
| Three-stem mix with the invalid gain command | 2.48 observed | 0.584 | Fail |
| Correctly headroom-staged mixed output | 0.2233 active mixed block | 0.0815 | Pass |

The raw project database also retains superseded sampleblocks, so the active
mixed blocks were measured separately from stale stem blocks. The
unattenuated stem's approximately full-scale peak confirms that three such
signals cannot safely be summed without common headroom.

The planner now emits the valid Audacity-native form:

```text
SetTrackAudio: Volume=-18
SetTrackAudio: Volume=-21
SetTrackAudio: Volume=-24
```

These preserve the configured bed/texture/motion differences of
`-6/-9/-12 dB` while applying a common `-12 dB` offset. Three full-scale
signals have a worst-case coherent sum of +9.54 dB, so this leaves
approximately 2.46 dB of theoretical margin before mixing. The offset is
represented by `STEM_HEADROOM_DB` and is asserted by the render-plan tests.

With valid volume staging and the common offset, the full short sequence
executes through loudness normalization, repeat, selection, and fades. The
only remaining failure is the already-known `Export2:` failure:

```text
Could not export to FLAC format!
BatchCommand finished: Failed!
```

## AUP3 WAV serializer

The approved export fallback is implemented in
`tools/noisegen/aup3_serializer.py`. It performs no DSP: Audacity remains
responsible for generation, filtering, gain staging, mixing, loudness
normalization, and fades. The serializer only follows final-track references,
reads the referenced little-endian float32 blocks, and writes 48 kHz,
24-bit, stereo WAV.

The serializer accepts readable project XML, and now also decodes Audacity's
semi-self-describing binary XML directly when no XML file is supplied. The
decoder follows the 3.7.8 field-op contract: the dictionary supplies UTF-32
name IDs, while the document stream supplies start/end tags, typed
attributes, data, and push/pop records. Unknown opcodes, unknown names,
truncated fields, tag mismatches, and unfinished tags are fatal errors.

The decoded structure handles:

- either one `<wavetrack>` containing two channel `<sequence>` elements, or
  Audacity's observed 3.7.8 representation of two linked channel
  `<wavetrack>` elements containing one sequence each;
- non-monotonic and non-contiguous block IDs in document order;
- block lengths inferred from successive `waveblock start` offsets;
- `blockid <= 0` silent runs, validated against their encoded length;
- clip offsets and sample-based trim boundaries;
- rejection of missing, wrong-format, or overlapping references.

Superseded `sampleblocks` rows are never read unless the final XML references
them. The module exposes `extract_track`, `write_wav`, and
`extract_to_wav`, plus a CLI:

```text
python tools/noisegen/aup3_serializer.py project.aup3 project.xml output.wav
```

The orchestrator keeps `Export2:` as the default. The explicit opt-in
`--aup3-serializer` path replaces `Export2:` with `SaveProject2:` and then
invokes the serializer. `--project-xml <readable.xml>` remains available as
an override, but is no longer required. The binary decoder is intentionally
strict and refuses to write output when structure and sampleblock or
duration checks do not reconcile.

The final deliverable is now WAV. Variant filenames and QA discovery use
`wn_<color>_<band>_<motion>_<balance>_s<seed>.wav`. The serializer verifies
the written file reports 48 kHz, two channels, and `PCM_24`.

### Serializer verification

An analytical live Audacity probe generated a stereo constant signal:

- left channel: exactly `0.25`;
- right channel: exactly `-0.5`;
- 2,400 samples per channel at 48 kHz.

The serializer extracted the referenced non-contiguous channel blocks with
the correct channel order and wrote a WAV reported by libsndfile as:

```text
48000 Hz, 2 channels, PCM_24
```

Unit tests cover silent runs, non-contiguous IDs, multi-block sequences,
channel order, clip trims, stale-block rejection, and WAV format metadata.

A full 240-second Audacity variant was rendered twice, saved as `.aup3`, and
decoded directly from the project/autosave blobs. The final structure had
two channel wavetracks, four 60-second clips per channel, and 2,976,000
samples per clip with two seconds of trimmed tail. The extracted output was
11,520,000 stereo frames at 48 kHz. Both renders produced identical decoded
PCM (`maxdiff = 0`).

The first extracted render was passed to the QA harness. All checks passed:

```text
Loudness          -20.083 LUFS
True peak         -14.153 dBTP
Clipping          0 samples
DC offset         0.0000510
Loop seam         -6153.053 dBFS
Spectral tilt     0.031 dB/oct
Silence/dropout   0.0 ms
Stereo correlation r=-0.00032
Format            11,520,000 frames, 48 kHz, stereo PCM_24
Overall            PASS
```

The decoded PCM SHA-256 for both renders was:

```text
75aefcb2caeb1844be2f664cbc20ab1c2419db680e87c417b53b2a2e75a2c2d2
```

### Eight-track pilot

The eight-track pilot was rendered through the explicit serializer path,
using one fresh Audacity process per variant. Outputs are in
`/tmp/noise-pilot/`, with the corresponding `.aup3`, `.wav`, `.json`, and
`render_log.jsonl` artifacts. The QA report is:

```text
/tmp/noise-pilot/qa_report.html
/tmp/noise-pilot/qa_results.json
```

All eight files passed format, duration, loudness, true peak, clipping,
loop seam, silence, decorrelation, and uniqueness checks. The following
findings were observed without tuning:

- White passed all checks.
- Brown failed DC offset (`0.0001604`) and spectral tilt (`-0.017 dB/oct`).
- Green failed the bell check (`0.056 dB` measured) and had a DC offset of
  `0.0000863` (within threshold).
- Pink high, low-mid, mid drift, mid still, and breathing variants failed
  the requested spectral-tilt check; their measured slopes were `0.002`,
  `-0.207`, `-0.090`, `-0.033`, and `-0.022 dB/oct`, respectively.
- Green's measured spectral tilt was `-0.705 dB/oct`, while brown measured
  `-0.017 dB/oct`. The white and pink outputs were likewise near-flat,
  rather than showing distinct expected color slopes. This is a real pilot
  finding about the filter stage, not a QA threshold adjustment.

The loop-seam negative control is covered by a test that replaces one cell
with an uncorrelated, substantially discontinuous noise splice; the seam
check fails (`8.652x second-difference median`) while the legitimate
repeated-cell result remains at the near-zero discontinuity value.

### FilterCurve investigation and corrected pilot

The live Audacity 3.7.8 contract is:

```text
Help: Command=FilterCurve
FilterLength: size_t, default 8191
InterpolateLin: bool, default False
InterpolationMethod: enum { B-spline, Cosine, Cubic }, default B-spline
```

The dynamic curve-point fields are accepted empirically as `f0`, `f1`, ...
for frequencies and `v0`, `v1`, ... for gains. A one-second stereo noise
probe with the emitted curve changed from approximately flat to
`-3.004 dB/oct`; the same probe with the curve omitted measured
`-0.003 dB/oct`. The emitted `FilterCurve:` syntax is therefore effective.

`GetInfo: Type=Selection Format=JSON` after a 62-second Nyquist replacement
reported `Start=0, End=62`. The filter was being applied to the generated
track, not its one-second placeholder. The root cause of the pilot's
near-flat final measurements was that color shaping was only applied to the
bed while the uncolored texture and motion stems dominated the final mix.
Color curves are now applied through Audacity to all three generated stems.

Standalone bed measurements after the corrected plan were:

```text
white  +0.005 dB/oct
pink   -3.004 dB/oct
brown  -6.004 dB/oct
green  -3.512 dB/oct, with the bell present
```

Standalone band probes also confirmed the band dimension is active:

```text
low-mid: energy concentrated in 800–2500 Hz
mid:     energy concentrated in 800–2500 Hz
high:    energy concentrated in 2500–8000 Hz
```

The corrected eight-track pilot is in `/tmp/noise-pilot-colored/` and was
run through the serializer path without parameter tuning. QA results are
in:

```text
/tmp/noise-pilot-colored/qa_report.html
/tmp/noise-pilot-colored/qa_results.json
```

The color slopes now measure correctly in the final files:

```text
white       +0.031 dB/oct
pink        approximately -2.96 to -3.05 dB/oct
brown       -5.994 dB/oct
green       -4.997 dB/oct
```

The corrected pilot still fails seven of eight overall. Colored variants
developed DC offset and the brown variant exceeded true peak; green's
bell measured `11.837 dB` against the existing 4–8 dB acceptance range.
These are reported findings, not hidden with threshold or DSP changes.
The corrected pilot's failures are:

- brown: true peak and DC offset;
- green: spectral tilt, green bell, and DC offset;
- all pink variants: DC offset;
- white: no failures.

The full 144-track matrix remains intentionally unstarted.

### Rolloff and green-bell follow-up

The color tilt curves now include explicit sub-20 Hz points:

```text
1 Hz  = gain at 20 Hz - 72 dB
5 Hz  = gain at 20 Hz - 36 dB
10 Hz = gain at 20 Hz - 12 dB
20 Hz = unchanged tilt curve
```

They are emitted with `InterpolateLin=1`; the measured slopes above 20 Hz
remain on target. The green bell is applied only to the bed stem rather than
stacked independently on all three stems. A direct comparison showed that
per-stem bell application did not triple the response, but moving it to the
bed makes the structural intent explicit and avoids applying a feature
curve to unrelated stems.

The final corrected pilot is in `/tmp/noise-pilot-rolloff/`:

```text
/tmp/noise-pilot-rolloff/qa_report.html
/tmp/noise-pilot-rolloff/qa_results.json
```

QA result: six of eight variants pass overall. Measured spectral results are:

```text
white       +0.031 dB/oct
pink        -2.952 to -3.041 dB/oct
brown       -5.984 dB/oct
green       -4.406 dB/oct
green bell  11.387 dB
```

The rolloff fixed DC offset for all pink variants and restored brown's true
peak to `-4.387 dBTP`, within its `-3 dBTP` limit. Brown still fails DC
offset at `0.0002195`. Green's DC offset now passes (`0.0000211`), and its
tilt is within the existing tolerance, but its bell remains outside the
4–8 dB acceptance range at `11.387 dB`. No QA threshold or bell gain was
changed.
