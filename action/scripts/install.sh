#!/usr/bin/env bash
# Puts scmjs on PATH for the steps after: the release's single executable (downloaded once, checked against the
# release's SHA256SUMS, then cached), a small script that runs it through npx, or nothing when it is there already.
set -euo pipefail

repo=scm-js/scm-js
case "$INSTALL" in
  none)
    if ! command -v scmjs >/dev/null 2>&1; then
      echo "::error title=scmjs::install: none, and there is no scmjs on PATH."
      exit 1
    fi ;;
  npm)
    if ! command -v npx >/dev/null 2>&1; then
      echo "::error title=scmjs::install: npm needs Node on the runner (actions/setup-node), or use install: binary."
      exit 1
    fi
    bin="$RUNNER_TEMP/scmjs-action/bin"
    mkdir -p "$bin"
    # TypeScript beside the command when the TrigScript build is asked for: map build finds it there.
    with_ts=""
    [ "$BUILD" = true ] && with_ts="-p typescript@6"
    printf '#!/usr/bin/env bash\nexec npx -y -p @scm-js/cli@%s %s scmjs "$@"\n' "$VERSION" "$with_ts" > "$bin/scmjs"
    chmod +x "$bin/scmjs"
    echo "$bin" >> "$GITHUB_PATH"
    export PATH="$bin:$PATH" ;;
  binary)
    exe=scmjs
    [ "$RUNNER_OS" = Windows ] && exe=scmjs.exe
    if [ -x "$DIR/$exe" ]; then
      echo "scmjs $VERSION from the cache"
    else
      work="$(mktemp -d)"
      url="https://github.com/$repo/releases/download/v$VERSION"
      echo "Downloading $url/$ASSET"
      curl -fsSL --retry 3 -o "$work/$ASSET" "$url/$ASSET"
      curl -fsSL --retry 3 -o "$work/SHA256SUMS" "$url/SHA256SUMS"
      want="$(awk -v f="$ASSET" '{ n = $2; sub(/^\*/, "", n); if (n == f) print $1 }' "$work/SHA256SUMS")"
      if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$work/$ASSET" | cut -d' ' -f1)"; else got="$(shasum -a 256 "$work/$ASSET" | cut -d' ' -f1)"; fi
      if [ -z "$want" ] || [ "$want" != "$got" ]; then
        echo "::error title=scmjs::$ASSET does not match the release's SHA256SUMS (${want:-no line for it}; the download is $got)."
        exit 1
      fi
      echo "SHA-256 $got, as SHA256SUMS says"
      mkdir -p "$DIR"
      case "$ASSET" in
        *.zip) unzip -q -o "$work/$ASSET" -d "$DIR" ;;
        *) tar -xzf "$work/$ASSET" -C "$DIR" ;;
      esac
      rm -rf "$work"
    fi
    echo "$DIR" >> "$GITHUB_PATH"
    export PATH="$DIR:$PATH" ;;
esac
scmjs --version
