# Releasing

1. Update `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Commit, then tag and push: `git tag -a v0.2.0 -m v0.2.0 && git push origin main v0.2.0`.
3. On GitHub, create a release from the tag (keep "Publish to the GitHub Marketplace" ticked) and paste the changelog section.
4. Publishing the release runs `.github/workflows/publish.yml`, which tests and publishes to npm through trusted publishing. No npm token is needed.

Users of the Action pin a tag such as `@v0.1.0`. Tags are never moved after release.
