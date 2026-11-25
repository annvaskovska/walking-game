# 0016 - Every push to main uploads to TestFlight from CI

Status: accepted

## Context

ADR 0009 uploaded to TestFlight only from a Mac, because only the repository owner could hold Actions secrets.
The secrets are now in the repository, so the reason to keep uploads manual is gone.
The only TestFlight build fell behind `main`, and testers saw an old app.
The `ios.yml` job built on `macos-15` with Xcode 16.4, and App Store Connect no longer takes a build without the iOS 26 SDK.
On a fresh CI machine, an archive signed through `-allowProvisioningUpdates` makes a new development certificate on each run, until the team reaches its limit.

## Decision

- `.github/workflows/ios.yml` builds the app for the simulator, unsigned, on every pull request.
- On every push to `main`, and on a manual run, it runs `npm run ios:testflight` instead, with `ASC_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY` from the repository's Actions secrets.
- Both jobs run on `macos-26`, whose default Xcode has the iOS 26 SDK.
- `scripts/testflight.sh` archives without signing (`CODE_SIGNING_ALLOWED=NO`).
  `xcodebuild -exportArchive` with the API key then signs the app with a cloud-managed distribution certificate and uploads it.
  No machine needs a certificate or a profile, and no run makes a development certificate.
- Xcode still gives each upload the next build number, and the internal group with automatic distribution gets each build.
- The same script uploads from a Mac with the four values in the environment, as before.

## Consequences

- Every merge reaches internal testers in TestFlight once App Store Connect has processed it.
- A broken upload path shows as a red `main`, not at the next manual upload.
- Anyone who can push a workflow to this repository can use the API key, which has Admin access.
  Revoking the key in App Store Connect and setting new secrets replaces it.
- A pull request from a fork gets no secrets, so it only builds for the simulator.
- When App Store Connect asks for a newer SDK, the runner image in `ios.yml` moves with it.
- `Info.plist` must keep `ITSAppUsesNonExemptEncryption` false, or every build waits for an export compliance answer.
