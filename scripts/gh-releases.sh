# Sourced by .github/workflows/country-packages.yml.
# has_release TAG: true if the release exists, false only on GitHub's "release not found".
# Any other failure (API down, rate limit, network) stops the job: a step that took it for
# "no catalog yet" would publish a catalog without every country it did not rebuild, and
# the prune would then delete their releases.

has_release() {
  local err
  if err=$(gh release view "$1" --json tagName 2>&1 >/dev/null); then return 0; fi
  if grep -q 'release not found' <<<"$err"; then return 1; fi
  echo "::error::gh release view $1 failed: $err" >&2
  exit 1
}
