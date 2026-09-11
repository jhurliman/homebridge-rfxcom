# Changelog

## 2.0.0 — 2026-09-10

- Document the lack of live account/hardware testing and invite an active user to take over maintenance.
- Update rfxcom from 0.16 to 2.6 (SerialPort 11), replacing the obsolete installation stack (#17).
- Fix empty-config accessory cleanup and normalize RFY IDs while preserving cached UUIDs (#15).
- Wait for transceiver ACK/NAK, serialize and bound command work, and cancel timers/pending operations on shutdown.
- Add autoReset:false for persistent command switches (#4); automatic UI resets do not send Stop.
- Add real Homebridge/RFY-encoder tests with simulated serial responses, a UI schema, package allowlist, Actions, and a rewritten README.
- Require Homebridge 2.4+ and Node 22/24/26. Real USB and motor behavior remain unverified.
