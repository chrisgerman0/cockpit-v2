#!/usr/bin/env bash
# SAFE DEPLOY — build to the side, verify, swap, restart, keep a rollback.  2026-09-22
#
# WHY THIS EXISTS. `next build` writes .next IN PLACE, and the running `next start` serves its
# static chunks from that same directory. Building against a live site therefore replaces the
# serving release while people are loading pages, and a build that fails half way leaves a torn
# .next behind with no way back. On 2026-09-22 every /api auth fix was built that way over the
# release that was serving Chris.
#
# So: build into .next.build, PROVE it is complete, only then rename it into place, and keep the
# previous release as .next.rollback_<UTC> so a bad deploy is one `mv` from undone.
#
#   usage: scripts/safe-deploy.sh <pm2-app-name> [app-dir]
#   e.g.   scripts/safe-deploy.sh staxs-landing /root/.openclaw/workspace/staxs-landing
#
# It NEVER restarts anything if the build fails or the completeness gate fails — SAFETY_PROTOCOL §6
# ("gate every reload on the build's exit code. Never reload after a failed build").
set -euo pipefail

APP="${1:?usage: safe-deploy.sh <pm2-app-name> [app-dir]}"
DIR="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
KEEP="${KEEP_ROLLBACKS:-3}"
TS="$(TZ=UTC date +%Y%m%dT%H%M%SZ)"
UNIT="safe-deploy-${APP}-${TS}"

cd "$DIR"
echo "== safe-deploy: $APP in $DIR"

# 1 — BUILD TO THE SIDE. Named systemd unit: exact process identity, no pattern matching, and the
#     build survives this shell. Never `pkill -f`.
rm -rf .next.build
echo "== building into .next.build (unit $UNIT)"
systemd-run --unit="$UNIT" --collect --wait --quiet \
  --setenv=STAXS_DIST_DIR=.next.build \
  --property=WorkingDirectory="$DIR" \
  /usr/bin/npx next build
echo "== build exit: 0"

# 2 — COMPLETENESS GATE. A build that exits 0 but is missing its manifests must never reach the
#     serving directory. (Note: build-manifest.json is emitted by both webpack and turbopack;
#     app-build-manifest.json is webpack-ONLY and is deliberately not required here.)
echo "== completeness gate"
missing=0
for f in BUILD_ID routes-manifest.json prerender-manifest.json build-manifest.json server/pages-manifest.json; do
  if [ -e ".next.build/$f" ]; then echo "   OK      $f"; else echo "   MISSING $f"; missing=1; fi
done
chunks=$(find .next.build/server -name '*.js' 2>/dev/null | wc -l)
echo "   server chunks: $chunks"
[ "$chunks" -lt 1 ] && missing=1
if [ "$missing" -ne 0 ]; then
  echo "!! INCOMPLETE BUILD — refusing to swap. The serving release is untouched." >&2
  exit 2
fi
echo "   BUILD_ID=$(cat .next.build/BUILD_ID)"

# 3 — SWAP. Two renames on the same filesystem; the old release becomes the rollback.
mv .next ".next.rollback_$TS"
mv .next.build .next
echo "== swapped · rollback kept at .next.rollback_$TS"

# 4 — RESTART the named app only.
pm2 restart "$APP" --update-env >/dev/null
echo "== restarted $APP"

# 5 — PRUNE old rollbacks, newest KEEP retained.
ls -dt .next.rollback_* 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf
echo "== rollbacks kept:"; ls -dt .next.rollback_* 2>/dev/null | sed 's/^/   /'
echo "== to roll back:  mv .next .next.bad && mv .next.rollback_$TS .next && pm2 restart $APP"
