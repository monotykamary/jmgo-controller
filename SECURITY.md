# Security policy

## Reporting a vulnerability

Do not open a public issue for vulnerabilities that expose projector access, authentication material, or private device identifiers. Use the repository's private security advisory feature after the public repository is created.

Until a security contact is published, do not include live credentials, tokens, serial numbers, Bluetooth addresses, public IP addresses, APK files, or screenshots in reports.

## Local-network exposure

JMGO port 9005 may provide control and device state without authentication. Some Bonfire OS builds also expose unauthenticated ADB on port 5555. Treat the projector as an IoT device:

- keep it off untrusted and guest networks;
- isolate it with firewall rules or an IoT VLAN;
- do not forward ports 9005 or 5555 to the internet;
- restrict automation hosts to the minimum required network access.

## Credential handling

This project does not own Google authentication. `gplaydl` stores its own linking key and tokens outside the checkout. Never copy those files into an issue, test fixture, build artifact, or repository.

Downloaded applications are untrusted input even when correctly signed. Review package identity and requested permissions before installation.
