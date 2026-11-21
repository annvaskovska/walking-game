#!/bin/sh
# Builds the iPhone app and uploads it to TestFlight, signed by Xcode with an App Store Connect API
# key, so no Xcode account, certificate or profile has to be set up by hand. Xcode gives each upload
# the next build number. Needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY (the text of the .p8 file) of
# a key with the Admin role: Admin lets Xcode make the distribution certificate the first time.
set -eu
: "${ASC_KEY_ID:?set ASC_KEY_ID}" "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}" "${ASC_KEY:?set ASC_KEY}"

# The team that publishes the app. The project keeps its own team for running from Xcode.
TEAM_ID=${ASC_TEAM_ID:?}

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
	<string>$TEAM_ID</string>
</dict>
</plist>
EOF

set -- -allowProvisioningUpdates -authenticationKeyPath "$key" \
  -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID"

xcodebuild -quiet -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$tmp/App.xcarchive" \
  DEVELOPMENT_TEAM="$TEAM_ID" "$@" archive

xcodebuild -quiet -exportArchive -archivePath "$tmp/App.xcarchive" \
  -exportOptionsPlist "$tmp/export.plist" -exportPath "$tmp/export" "$@"

echo "Uploaded. The build shows in TestFlight once App Store Connect has processed it."
