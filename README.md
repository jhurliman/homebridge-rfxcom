# homebridge-rfxcom

[![CI](https://github.com/jhurliman/homebridge-rfxcom/actions/workflows/ci.yml/badge.svg)](https://github.com/jhurliman/homebridge-rfxcom/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/homebridge-rfxcom.svg)](https://www.npmjs.com/package/homebridge-rfxcom)

Operate paired Somfy RTS/RFY blinds and awnings from Apple Home using an RFXCOM USB transceiver. Each configured remote exposes **Up, Down, and Stop** command switches. Commands wait for the transceiver's response, and serial failures are returned to HomeKit.

This branch prepares **2.0 for Homebridge 2.4+ and Node 22, 24, or 26**, using `rfxcom` 2.6 and SerialPort 11 instead of the obsolete SerialPort 4 stack. Check the npm badge for the published version before upgrading.

## What you need

- An RFXCOM transceiver and firmware that support RFY transmission.
- A motor already paired with a remote stored in that transceiver. Use the manufacturer's pairing tools; this plugin does not create or erase pairings.
- A local serial device accessible to the Homebridge service user, such as `/dev/ttyUSB0` on Linux. Containers need the USB device passed through. Prefer a stable device path when several USB adapters are attached.

The underlying `rfxcom` package supports many protocols; this plugin currently exposes **RFY remotes only**. It does not discover arbitrary 433 MHz sensors.

## Configure Homebridge

Install `homebridge-rfxcom` through Homebridge UI and add an `RFXCom` platform. The UI includes a configuration form. The equivalent entry in `config.json`'s `platforms` array is:

```json
{
  "platform": "RFXCom",
  "name": "RFXCOM",
  "tty": "/dev/ttyUSB0",
  "rfyRemotes": [
    {
      "name": "Awning",
      "deviceID": "0x020202/2",
      "openCloseSeconds": 30,
      "autoReset": true
    }
  ]
}
```

Use the address and unit code stored by the transceiver, not the motor's label. Address comparison ignores hexadecimal case and leading zeros. RFY addresses are `0x1` through `0x0fffff`, with unit codes 0–4. The legacy `rfyremotes` and `deviceId` spelling aliases remain accepted.

| Setting | Default | Meaning |
| --- | --- | --- |
| `tty` | `/dev/ttyUSB0` | Serial device path |
| `debug` | false | Enable the underlying driver's diagnostics |
| `rfyRemotes` | empty array | Named remotes to expose; an empty list removes cached plugin accessories and does not open the serial port |
| `openCloseSeconds` | 5 | How long an Up/Down switch stays on when auto-reset is enabled; greater than 0, at most 3600 |
| `autoReset` | true | Set false to leave Up/Down on until another command, useful for scenes |

## Understand the switches

Turning **Up** or **Down** on sends that RFY command. Turning either off sends Stop. Turning **Stop** on sends Stop and resets all three switches off shortly afterward.

With `autoReset: true`, the active Up/Down switch turns off after `openCloseSeconds`. That automatic UI reset **does not send Stop**; the motor's own limits stop physical travel. With `autoReset: false`, the active command switch stays on until another command or a plugin restart.

Switch state records the last acknowledged command, not measured motor position or motion. RFY has no position feedback here. A transceiver acknowledgement confirms transmission, not that the motor received the signal or reached a limit. This is why the plugin does not present a precise WindowCovering percentage slider.

Commands are serialized and bounded to 100 running/waiting operations. A NAK, serial error, disconnect, or 15-second acknowledgement timeout fails the request. A failed command does not prevent later commands from being attempted. Shutdown cancels pending work, clears UI timers, and closes the serial connection.

## Troubleshooting

**Installation fails:** 1.x used SerialPort 4 and cannot support current Node releases reliably ([#17](https://github.com/jhurliman/homebridge-rfxcom/issues/17)). The 2.0 dependency update is tested on Node 22/24/26 in Linux CI. ARM/OS-specific native binding availability and a real USB transceiver still need validation on your installation.

**Remote not found:** verify that it is paired in the connected transceiver and that its address/unit matches the stored RFY remote. A successful complete listing reconciles configured accessories; a failed listing preserves cached accessories. The receiver can take several seconds to initialize and enumerate its remotes; the plugin allows 30 seconds.

**USB disconnected:** restore device access and restart the plugin. Automatic reconnection is not implemented. Check serial permissions and ensure another application is not using the same transceiver.

**Scenes need a persistent switch:** use `autoReset: false`. The state remains an indication of the last command, not an indication that the motor is still running.

When reporting an issue, include plugin/Homebridge/Node versions, OS and CPU architecture, transceiver model/firmware, and the error message. Do not include unrelated credentials from your Homebridge configuration.

## Upgrading and development

Back up Homebridge before upgrading to 2.0. Matching cached switches keep their UUIDs, including differently capitalized addresses. Invalid or duplicate remote configurations now fail early. The command switches retain their Up/Down/Stop behavior, with explicit error reporting and opt-in persistent state.

```sh
npm ci
npm test
npm pack
```

Eight tests use Homebridge's actual services and the current RFY command encoder, transmit queue, and response parser with simulated serial bytes. They cover empty configurations, ID normalization/cache reuse, ACK/NAK handling, automatic versus persistent switch state, shutdown, and validation. Tests never open a serial port or move a motor. Before publishing, verify serial initialization and paired-remote listing on real supported hardware; command checks should target a deliberately selected motor.

## License

MIT. See [LICENSE](LICENSE).
