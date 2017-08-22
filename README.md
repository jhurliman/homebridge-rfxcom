# homebridge-rfxcom
-----
Homebridge plugin for RFXtrx433(E) transceivers.


## Usage

`npm install -g homebridge-rfxcom`

### config.json
```
  "platforms": [
    {
      "platform": "RFXCom",
      "name": "RFXCom",
      "rfyRemotes": [
        {
          "name": "Awning",
          "deviceID": "0x010000/1",
          "openCloseSeconds": 18
        }
      ]
    }
  ]
```

##### rfyRemotes

 - **name** - Display name of the remote that will appear in HomeKit
 - **deviceID** - The remote address and followed by unit code that can be found
   in the RFXMngr setup program (Windows only).
 - **openCloseSeconds** - Number of seconds it takes for the blinds/awning/etc
   to fully open or close.
