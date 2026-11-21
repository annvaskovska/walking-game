# 0009 - TestFlight uploads from a Mac with an App Store Connect API key

Status: accepted

## Context

The iPhone app ran only from Xcode, signed by each developer's own team, and a free team's build stops opening after 7 days.
Testers need an install that lasts and updates, which TestFlight gives.
An upload needs a distribution certificate, a provisioning profile, an App Store Connect record and a new build number each time.
GitHub Actions secrets for this repository can be set only by its owner, so an upload from CI is not open to every maintainer.

## Decision

- `npm run ios:testflight` runs `scripts/testflight.sh` on a Mac with Xcode: tests, web build, `cap sync`, `xcodebuild archive`, then `xcodebuild -exportArchive` with `method` `app-store-connect` and `destination` `upload`.
- `xcodebuild` signs with an App Store Connect API key through `-allowProvisioningUpdates`, so it makes the certificate and the profile itself.
  The key needs Admin access for the first certificate.
- Xcode's `manageAppVersionAndBuildNumber` default gives each upload the next build number, so the project's `CURRENT_PROJECT_VERSION` stays as it is.
- The publishing team, the key ID, the issuer ID and the key's text come from `ASC_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY` (ADR 0010).
  The script writes the key to a private temporary folder, restores its PEM line breaks, and deletes it on exit.
- The archive sets `DEVELOPMENT_TEAM` on the command line, because the Xcode project in git holds no team (ADR 0010).
- The App ID and the App Store Connect record are made once by hand on the web; `docs/guide.md` lists the steps.

## Consequences

- Any maintainer with a paid membership and a key uploads with one command, and nobody manages certificates or build numbers.
- Uploads need a Mac and are not automatic on merge.
  Moving them to CI is a new decision once the repository owner can hold the secrets.
- `xcodebuild` resolves Swift packages inside a sandbox of its own, so it fails inside another sandbox.
- `Info.plist` must keep `ITSAppUsesNonExemptEncryption` false, or every build waits for an export compliance answer.
- `.github/workflows/ios.yml` builds the app on every pull request, but nothing checks the upload path until it runs.
