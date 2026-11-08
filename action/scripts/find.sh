#!/usr/bin/env bash
# The scmjs release to install and where it goes: the version (latest made exact, so the cache key names it), the
# archive for this runner, and the folder it is kept in.
set -euo pipefail

repo=scm-js/scm-js
out() { echo "$1=$2" >> "$GITHUB_OUTPUT"; }

case "$INSTALL" in
  binary|npm|none) ;;
  *) echo "::error title=scmjs::install takes binary, npm or none, not \"$INSTALL\""; exit 1 ;;
esac
if [ "$INSTALL" = none ]; then out version ""; exit 0; fi

version="${VERSION#v}"
if [ -z "$version" ] || [ "$version" = latest ]; then
  # The newest release: GitHub's API with the token, else where github.com's own latest link leads.
  tag="$(gh api "repos/$repo/releases/latest" --jq .tag_name 2>/dev/null || true)"
  if [ -z "$tag" ]; then
    tag="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest" | sed 's|.*/tag/||')"
  fi
  version="${tag#v}"
fi
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  echo "::error title=scmjs::Could not tell which version of scmjs to install (got \"$version\"); name one with the version input."
  exit 1
fi
out version "$version"
echo "scmjs $version, $INSTALL"
[ "$INSTALL" = binary ] || exit 0

case "$RUNNER_OS" in
  Linux) os=linux; ext=tar.gz ;;
  macOS) os=macos; ext=tar.gz ;;
  Windows) os=windows; ext=zip ;;
  *) os=unknown ;;
esac
case "$RUNNER_ARCH" in
  X64) arch=x64 ;;
  ARM64) arch=arm64 ;;
  *) arch=unknown ;;
esac
case "$os-$arch" in
  linux-x64|macos-x64|macos-arm64|windows-x64) ;;
  *)
    echo "::error title=scmjs::No single executable of scmjs for $RUNNER_OS on $RUNNER_ARCH; use install: npm (it needs Node)."
    exit 1 ;;
esac
out asset "scmjs-cli-$os-$arch.$ext"
out dir "${RUNNER_TOOL_CACHE:-$RUNNER_TEMP}/scmjs-cli/$version/$os-$arch"
