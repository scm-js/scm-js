#!/usr/bin/env bash
# The report: run.sh's Markdown with the pictures' link, in the job's summary and, on a pull request, in one comment
# that each later run edits (found by the marker on its first line). Then the run's outcome: Check Map's errors (or
# warnings, with strict) and failed builds fail it here, after everything else has been shown.
set -uo pipefail

work="$RUNNER_TEMP/scmjs-action"
body="$work/body.md"
status="$(cat "$work/status" 2>/dev/null || echo 1)"
marker="<!-- scmjs-action:maps -->"
run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"

if [ -f "$body" ]; then
  if [ -n "${PICTURES_URL:-}" ]; then
    n="${PICTURES:-0}"
    [ "$n" = 1 ] && what="a PNG" || what="$n PNGs"
    { echo "Pictures of where the maps changed: [$what in a zip]($PICTURES_URL), magenta tiles changed, green units added, red removed, yellow moved."; echo; } >> "$body"
  fi
  echo "<sub>[scmjs $(scmjs --version 2>/dev/null | tr -d '\r') · the run]($run_url)</sub>" >> "$body"
  cat "$body" >> "$GITHUB_STEP_SUMMARY"

  pr=""
  case "$GITHUB_EVENT_NAME" in
    pull_request|pull_request_target) pr="$(jq -r '.pull_request.number // empty' "$GITHUB_EVENT_PATH" | tr -d '\r')" ;;
  esac
  changed=0
  [ -s "$work/changed" ] && changed=1
  if [ "${COMMENT:-true}" = true ] && [ -n "$pr" ]; then
    # The action's earlier comment, if any: one comment for the pull request, edited, not one a push.
    id="$(gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments" --paginate --jq ".[] | select(.body | startswith(\"$marker\")) | .id" 2>/dev/null | head -n 1 | tr -d '\r')"
    if [ -n "$id" ]; then
      gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -F "body=@$body" >/dev/null \
        && echo "Edited the comment on #$pr" \
        || echo "::warning title=scmjs::Could not edit the comment on #$pr; a pull request from a fork gets a token that cannot write."
    elif [ $changed -eq 1 ]; then
      gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments" -F "body=@$body" >/dev/null \
        && echo "Commented on #$pr" \
        || echo "::warning title=scmjs::Could not comment on #$pr: the job needs permissions: pull-requests: write, and a pull request from a fork gets a token that cannot write."
    fi
  fi
fi
exit "$status"
