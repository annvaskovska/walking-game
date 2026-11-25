#!/bin/sh
# Builds the iPhone app and uploads it to TestFlight, from CI on every push to main or from a Mac
# (ADR 0016). The archive is unsigned; the export signs it with a cloud-managed distribution
# certificate through an App Store Connect API key, so no machine needs a certificate or a profile.
# Xcode gives each upload the next build number. Every account detail comes from the environment
# and none is in this public repository (ADR 0014):
#   ASC_TEAM_ID    the team that publishes; the Xcode project in git holds none
#   ASC_KEY_ID     the API key's ID
#   ASC_ISSUER_ID  the issuer ID above the list of keys
#   ASC_KEY        the text of the key's .p8 file; Admin access lets Xcode sign in the cloud
set -eu
: "${ASC_TEAM_ID:?set ASC_TEAM_ID}" "${ASC_KEY_ID:?set ASC_KEY_ID}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}" "${ASC_KEY:?set ASC_KEY}"

cd "$(dirname "$0")/.."
npm test
npm run ios:sync

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
umask 077

# A pasted key can lose its line breaks, so write it back as a well-formed PEM file.
key="$tmp/AuthKey_$ASC_KEY_ID.p8"
body=$(printf %s "$ASC_KEY" | sed 's/-----[^-]*-----//g' | tr -d ' \t\r\n')
printf -- '-----BEGIN PRIVATE KEY-----\n%s\n-----END PRIVATE KEY-----\n' \
  "$(printf %s "$body" | fold -w 64)" > "$key"

cat > "$tmp/export.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>upload</string>
	<key>teamID</key>
	<string>$ASC_TEAM_ID</string>
</dict>
</plist>
EOF

xcodebuild -quiet -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$tmp/App.xcarchive" \
  CODE_SIGNING_ALLOWED=NO archive

xcodebuild -quiet -exportArchive -archivePath "$tmp/App.xcarchive" \
  -exportOptionsPlist "$tmp/export.plist" -exportPath "$tmp/export" \
  -allowProvisioningUpdates -authenticationKeyPath "$key" \
  -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID"

echo "Uploaded. The build shows in TestFlight once App Store Connect has processed it."
