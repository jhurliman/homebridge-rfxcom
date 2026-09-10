# Releasing homebridge-rfxcom

1. Run `npm ci`, `npm test`, and `npm pack` on the supported Node versions. Check the archive’s entry point, UI schema, README, and license.
2. Verify real USB initialization and paired-remote listing on supported transceiver firmware. Validate native bindings on relevant operating systems and CPU architectures, including ARM.
3. Verify commands on a deliberately selected motor. A transceiver ACK confirms transmission, not physical completion.
4. Review migration notes and publish only after the hardware checks pass.

The automated suite uses real Homebridge services and the driver’s encoder, transmit queue, and response parser, but simulates the serial bytes. It does not establish real hardware compatibility.
