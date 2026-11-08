#!/usr/bin/env bash
# The action's work, with scmjs on PATH: the maps listed, Check Map over them (annotations, counts, SARIF), the
# TrigScript builds, and each map that differs from the base compared as text and, when asked, as a picture. Writes
# the report's Markdown and the run's outcome for report.sh, which comments and fails the run when it should. Each
# part goes on when another fails, so a broken build still gets its map's changes shown.
#
# Runs on bash 3.2 (a Mac's own) as well: no mapfile, no globstar, no associative arrays.
set -uo pipefail
# Plain text throughout: what scmjs prints goes into the comment and the summary as well as the log.
export NO_COLOR=1

work="$RUNNER_TEMP/scmjs-action"
pictures="$work/pictures"
rm -rf "$work/diff" "$pictures" "$work/body.md" "$work/status" "$work/changed"
mkdir -p "$work/diff" "$pictures"
body="$work/body.md"
status=0
out() { echo "$1=$2" >> "$GITHUB_OUTPUT"; }
finish() {
  echo "$status" > "$work/status"
  exit 0
}
cr() { tr -d '\r'; }
# A value for a workflow command's property (file=…), escaped as the runner reads it.
prop() { printf '%s' "$1" | sed 's/%/%25/g; s/,/%2C/g; s/:/%3A/g'; }
# A path for a Markdown table cell, in code.
cell() { printf '`%s`' "$(printf '%s' "$1" | sed 's/|/\\|/g; s/`/'"'"'/g')"; }

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "::error title=scmjs::The action reads the maps through git: run actions/checkout before it."
  status=1; finish
fi
cd "$(git rev-parse --show-toplevel)" || { status=1; finish; }

# ── The maps ──────────────────────────────────────────────────────────────
# Globs from the repository's top, one a line, as git matches them (`*` within a folder, `**` across); empty, every map file
# git knows of. Tracked or untracked, not ignored, and there now.
globs=()
specs=()
while IFS= read -r g; do
  g="$(printf '%s' "$g" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  [ -n "$g" ] && { globs+=("$g"); specs+=(":(glob)$g"); }
done <<< "$MAPS"

if [ ${#specs[@]} -eq 0 ]; then specs=(":(icase)*.scx" ":(icase)*.scm" ":(icase)*.chk"); fi
maps=()
shopt -s nocasematch
while IFS= read -r -d '' f; do
  if [[ "$f" =~ \.(scx|scm|chk)$ ]] && [ -f "$f" ]; then maps+=("$f"); fi
done < <(git ls-files -co --exclude-standard -z -- "${specs[@]}" | sort -zu)
shopt -u nocasematch
echo "${#maps[@]} map(s)"
for m in ${maps[@]+"${maps[@]}"}; do echo "  $m"; done
if [ ${#maps[@]} -eq 0 ]; then
  if [ ${#globs[@]} -gt 0 ]; then
    echo "::error title=scmjs::No map matches ${globs[*]}"
    status=1
  else
    echo "::notice title=scmjs::No .scx, .scm or .chk files in the repository."
  fi
fi
is_map() { local m; for m in ${maps[@]+"${maps[@]}"}; do [ "$m" = "$1" ] && return 0; done; return 1; }
# A deleted map is reported when the globs (or, without any, its extension) would have taken it.
was_map() {
  local g
  shopt -s nocasematch
  if ! [[ "$1" =~ \.(scx|scm|chk)$ ]]; then shopt -u nocasematch; return 1; fi
  shopt -u nocasematch
  [ ${#globs[@]} -eq 0 ] && return 0
  for g in "${globs[@]}"; do
    # shellcheck disable=SC2053 # the glob is meant to match as a pattern
    [[ "$1" == $g ]] && return 0
  done
  return 1
}

{
  echo "<!-- scmjs-action:maps -->"
  echo "### Maps"
  echo
} > "$body"

# ── Check Map ─────────────────────────────────────────────────────────────
problems=0
new_problems=0
if [ "$CHECK" = true ] && [ ${#maps[@]} -gt 0 ]; then
  args=()
  [ "$STRICT" = true ] && args+=(--strict)
  baseline="$BASELINE"
  if [ -z "$baseline" ] && [ -f .scmjs-baseline.json ]; then baseline=.scmjs-baseline.json; fi
  [ -n "$baseline" ] && args+=(--baseline "$baseline")
  echo "::group::Check Map"
  scmjs map check "${maps[@]}" ${args[@]+"${args[@]}"}
  echo "::endgroup::"
  # The annotations: each finding beside its map on the pull request. The exit code is the check's.
  scmjs map check "${maps[@]}" ${args[@]+"${args[@]}"} --format github
  checked=$?
  [ $checked -ne 0 ] && status=1
  scmjs map check "${maps[@]}" ${args[@]+"${args[@]}"} --json > "$work/check.json" 2>/dev/null
  counts="$(jq -r '(if type == "array" then . else [.] end) as $r
    | ($r | map((.issues // []) | map(select(.level == "error")) | length) | add // 0) as $e
    | ($r | map((.issues // []) | map(select(.level == "warn")) | length) | add // 0) as $w
    | ($r | map(.baseline.suppressed // 0) | add // 0) as $k
    | ($r | map(.baseline.fixed // 0) | add // 0) as $f
    | ($r | map(select(.error)) | length) as $u
    | "\($e) \($w) \($k) \($f) \($u)"' "$work/check.json" | cr)"
  read -r errors warnings known fixed unreadable <<< "${counts:-0 0 0 0 0}"
  new_problems=$((errors + warnings))
  problems=$((new_problems + known))
  if [ "$SARIF" = true ]; then
    scmjs map check "${maps[@]}" ${args[@]+"${args[@]}"} --format sarif > "$work/maps.sarif" 2>/dev/null
    out sarif "$work/maps.sarif"
  fi
  plural() { if [ "$1" = 1 ]; then echo "1 $2"; else echo "$1 ${2}s"; fi; }
  found=()
  [ "$errors" -gt 0 ] && found+=("$(plural "$errors" error)")
  [ "$warnings" -gt 0 ] && found+=("$(plural "$warnings" warning)")
  line="$(plural ${#maps[@]} map)"
  fresh=""; [ -n "$baseline" ] && fresh="new "
  if [ ${#found[@]} -eq 0 ]; then line="✔ Check Map: no ${fresh}problems in $line"; else
    mk="▲"; [ $checked -ne 0 ] && mk="✖"
    line="$mk Check Map: $fresh$(IFS=,; echo "${found[*]}" | sed 's/,/, /g') in $line"
  fi
  [ -n "$baseline" ] && line="$line ($known known from \`$baseline\`, $fixed fixed since)"
  [ "$unreadable" -gt 0 ] && line="$line; $(plural "$unreadable" map) could not be read"
  echo "$line." >> "$body"
  echo >> "$body"
fi
out problems "$problems"
out new_problems "$new_problems"

# ── TrigScript ────────────────────────────────────────────────────────────
if [ "$BUILD" = true ] && [ ${#maps[@]} -gt 0 ]; then
  scripted=()
  untold=0
  for m in "${maps[@]}"; do
    case "$(scmjs map info "$m" --json 2>/dev/null | jq -r '.script' | cr)" in
      true) scripted+=("$m") ;;
      false) ;;
      *) untold=1 ;;
    esac
  done
  if [ $untold -eq 1 ]; then
    echo "::warning title=scmjs::This scmjs cannot tell which maps keep a TrigScript script, so none was built; a newer version can."
  fi
  if [ ${#scripted[@]} -gt 0 ]; then
    # TypeScript compiles the script, found from the folder the build runs in: the repository's own (npm ci before
    # the action), else typescript@6 installed for the run into a folder of the action's.
    from="$PWD"
    if [ "${INSTALL:-}" != npm ] && [ ! -f node_modules/typescript/package.json ]; then
      if command -v npm >/dev/null 2>&1; then
        from="$work/typescript"
        mkdir -p "$from"
        echo "Installing typescript@6 for the build"
        npm install --prefix "$from" --no-save --no-package-lock --silent typescript@6 >/dev/null 2>&1 \
          || echo "::warning title=scmjs::npm could not install typescript@6 for the TrigScript build"
      else
        echo "::warning title=scmjs::The TrigScript build needs TypeScript and there is no npm here: npm ci the repository's own before the action."
      fi
    fi
    top="$PWD"
    built=0
    for m in "${scripted[@]}"; do
      echo "::group::TrigScript: $m"
      if (cd "$from" && scmjs map build "$top/$m" --check); then built=$((built + 1)); else
        status=1
        echo "::error file=$(prop "$m"),title=TrigScript::The map's script did not build: the job's log says why."
      fi
      echo "::endgroup::"
    done
    if [ $built -eq ${#scripted[@]} ]; then echo "✔ TrigScript: $built of ${#scripted[@]} scripts built." >> "$body"
    else echo "✖ TrigScript: $built of ${#scripted[@]} scripts built." >> "$body"; fi
    echo >> "$body"
  fi
fi

# ── What changed ──────────────────────────────────────────────────────────
changed=()
picture_count=0
base="$BASE"
case "$base" in *[!0]*) ;; *) base="" ;; esac # a push that made the branch has no commit before it
if [ "$DIFF" = true ] && [ -n "$base" ]; then
  if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
    git fetch --no-tags --quiet --depth=1 origin "$base" 2>/dev/null || true
  fi
  if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
    echo "::warning title=scmjs::Could not fetch $base to compare the maps with."
  else
    rows=()
    details="$work/details.md"
    : > "$details"
    while IFS= read -r -d '' path; do
      if [ -f "$path" ]; then is_map "$path" || continue; else was_map "$path" || continue; fi
      changed+=("$path")
      n=${#changed[@]}
      if [ ! -f "$path" ]; then rows+=("| $(cell "$path") | removed |"); continue; fi
      if ! git cat-file -e "$base:$path" 2>/dev/null; then rows+=("| $(cell "$path") | new |"); continue; fi
      txt="$work/diff/$n.txt"
      scmjs map diff --rev "$base" "$path" > "$txt" 2> "$work/diff/$n.err"
      rc=$?
      echo "::group::$path"
      cat "$txt" "$work/diff/$n.err"
      echo "::endgroup::"
      if [ $rc -eq 0 ]; then rows+=("| $(cell "$path") | the same map (only the file's bytes differ) |"); continue; fi
      if [ $rc -ne 1 ]; then
        rows+=("| $(cell "$path") | could not be compared: $(head -n 1 "$work/diff/$n.err" | sed 's/^✖ //; s/|/\\|/g') |")
        continue
      fi
      # In a few words: the header's fields by name, then each part's count, added (+), removed (−) and changed (~).
      what="$(scmjs map diff --rev "$base" "$path" --json 2>/dev/null | jq -r '
        def counted($name): (map(select(.change == "added")) | length) as $a | (map(select(.change == "removed")) | length) as $r
          | (length - $a - $r) as $c
          | "\($name) \([(if $a > 0 then "+\($a)" else empty end), (if $r > 0 then "−\($r)" else empty end), (if $c > 0 then "~\($c)" else empty end)] | join(" "))";
        [ (if (.header | length) > 0 then (.header | map(.field | ascii_downcase) | join(", ")) else empty end) ]
        + [ {players, forces, units, locations, triggers, briefing, strings, files: .members} | to_entries[]
            | select((.value | type) == "array" and (.value | length) > 0) | .key as $k | .value | counted($k) ]
        | if length == 0 then "sections only" else join(" · ") end' | cr)"
      if [ "$PICTURES" = true ]; then
        png="$pictures/$path.png"
        mkdir -p "$(dirname "$png")"
        scmjs map diff --rev "$base" "$path" --picture --out "$png" > "$work/diff/$n.picture" 2>&1
        if [ -s "$png" ]; then picture_count=$((picture_count + 1)); what="$what · picture \`$path.png\`"
        else echo "::warning file=$(prop "$path"),title=scmjs::No picture: $(grep -m 1 . "$work/diff/$n.picture" | sed 's/^✖ //')"; fi
      fi
      rows+=("| $(cell "$path") | ${what:-changed} |")
      # The text, folded, as long as the comment has room (GitHub takes 65,536 characters).
      if [ "$(wc -c < "$details")" -lt 45000 ]; then
        {
          echo "<details><summary><code>$(printf '%s' "$path" | sed 's/&/\&amp;/g; s/</\&lt;/g')</code></summary>"
          echo
          echo '````text'
          head -n 80 "$txt"
          [ "$(wc -l < "$txt")" -gt 80 ] && echo "… $(( $(wc -l < "$txt") - 80 )) more lines in the job's log"
          echo '````'
          echo
          echo "</details>"
          echo
        } >> "$details"
      fi
    done < <(git diff --name-only --no-renames -z "$base" --)
    if [ ${#changed[@]} -eq 0 ]; then
      echo "No map differs from ${base:0:7}." >> "$body"
    else
      {
        echo "| Map | What changed since ${base:0:7} |"
        echo "| --- | --- |"
        printf '%s\n' "${rows[@]}"
        echo
        cat "$details"
      } >> "$body"
    fi
  fi
fi
printf '%s\n' ${changed[@]+"${changed[@]}"} > "$work/changed"
out changed_maps "$(printf '%s\0' ${changed[@]+"${changed[@]}"} | jq -Rsc 'split("\u0000") | map(select(length > 0))' | cr)"
out pictures "$picture_count"
out pictures_dir "$pictures"
finish
