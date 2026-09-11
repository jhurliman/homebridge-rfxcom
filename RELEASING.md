# Releasing homebridge-rfxcom

The maintainer no longer has the required account or hardware. Releases may proceed after automated checks, with the README and release notes explicitly stating that live compatibility is unverified. Do not describe simulated tests as hardware or service validation. Invite active users to test and take over maintenance.

- Run `npm ci`, `npm test`, and `npm pack` against the published dependencies. Confirm supported Node/Homebridge versions, entry points, UI schema, documentation, and license.
- Review migration notes and publish. Keep known compatibility issues open until an active user verifies a fix.

## Community validation

Verify USB initialization, paired-remote listing, native bindings on your OS/CPU, and commands on a deliberately selected motor. A transceiver ACK confirms transmission, not physical completion.
