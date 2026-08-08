# Verified Google Play split delivery

JMGO projectors are not necessarily Google-certified. Installing Play Store or Play Services does not create Play Protect, Widevine, Play Integrity, licensing, or DRM certification.

## Delivery workflow

```bash
jmgo play link
jmgo play search "application name"
jmgo play info com.example.package
jmgo play install com.example.package --arch tv
```

`gplaydl` owns authentication and downloads original artifacts. jmgo-controller then:

1. finds every package split
2. invokes Android SDK `apksigner` on each APK
3. requires every signature to be valid
4. requires every split to have the same SHA-256 signer digest
5. installs all splits in one ADB transaction without merging or re-signing
6. removes the private temporary download directory unless retention was explicitly requested

This acts as a transport/signer notary, not a malware verdict. A consistent valid signer does not make an application safe.

## Credential boundary

Use a separate account because unofficial Play clients can trigger restrictions. Google passwords, 2FA codes, device linking codes, cookies, tokens, and gplaydl configuration remain outside this repository. Never echo them through an agent transcript or copy them into a skill. The sensitive-data check and `.gitignore` provide defense in depth but do not replace review.

Applications can still fail because they require Google Play Services, licensing, Play Integrity, DRM certification, a phone form factor, or unavailable ABIs.
