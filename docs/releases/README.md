# Release notes

`docs/releases/<version>.md` is the hand-written part of a numbered release. When `vX.Y.Z`
is built, the release job looks for `docs/releases/X.Y.Z.md` in the tag's own tree; if it
is there, its text becomes the top of the release body and GitHub's generated list of
commits and pull requests is appended below it. Nothing here is required — with no file
the release reads exactly as it did before, the generated list alone.

The name is the full three-part version, whatever was typed into the Release workflow:
cutting `0.3` releases `0.3.0` and reads `0.3.0.md`.

Write the file as the release body itself: no title (the release is already titled
`scmJS X.Y.Z`) and no "What's Changed" heading (the generated list brings its own).
Markdown, addressed to someone deciding whether to update.

For a one-off — a line not worth committing — the Release workflow's `notes` input takes
the same text and wins over the file. It reaches the build as a dispatch input, so it
lives only in the release: re-running the build on that tag by hand falls back to the
file.
