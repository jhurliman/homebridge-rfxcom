const rfxcom = require('rfxcom')

const PLUGIN_ID = 'homebridge-rfxcom'
const PLUGIN_NAME = 'RFXCom'
const DEFAULT_OPEN_CLOSE_SECONDS = 5

let Accessory, Service, Characteristic, UUIDGen

module.exports = function(homebridge) {
  Accessory = homebridge.platformAccessory
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  UUIDGen = homebridge.hap.uuid

  homebridge.registerPlatform(PLUGIN_ID, PLUGIN_NAME, RFXComPlatform, true)
}

function RFXComPlatform(log, config, api) {
  this.log = log
  this.config = config || { platform: 'RFXCom' }
  this.tty = this.config.tty || '/dev/ttyUSB0'
  this.debug = this.config.debug || false

  const rfyRemotes = this.config.rfyRemotes || this.config.rfyremotes
  this.rfyRemotes = Array.isArray(rfyRemotes) ? rfyRemotes : []

  this.accessories = {}

  this.rfxtrx = new rfxcom.RfxCom(this.tty, { debug: this.debug })
  this.rfy = new rfxcom.Rfy(this.rfxtrx, rfxcom.rfy.RFY)

  this.rfxtrx.on('disconnect', () => this.log('ERROR: RFXtrx disconnect'))
  this.rfxtrx.on('connectfailed', () => this.log('ERROR: RFXtrx connect fail'))

  if (api) {
    this.api = api
    this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this))
  }
}

// Method to restore accessories from cache
RFXComPlatform.prototype.configureAccessory = function(accessory) {
  this.log(
    `Loaded from cache: ${accessory.context.name} (${accessory.context
      .switchID})`
  )

  const existing = this.accessories[accessory.context.switchID]
  if (existing) this.removeAccessory(existing)

  this.accessories[accessory.context.switchID] = accessory
}

// Method to setup accesories from config.json
RFXComPlatform.prototype.didFinishLaunching = function() {
  // Add or update accessory in HomeKit
  if (this.rfyRemotes.length) {
    // Compare local config against RFXCom-registered remotes
    this.listRFYRemotes()
      .then(deviceRemotes => {
        this.log(`Received ${deviceRemotes.length} remote(s) from device`)

        this.rfyRemotes.forEach(remote => {
          // Handle different capitalizations of deviceID
          remote.deviceID = remote.deviceID || remote.deviceId

          const deviceID = remote.deviceID
          const device = deviceRemotes.find(dR => deviceID === dR.deviceId)

          if (device) {
            // Remote found on the RFXCom device
            this.addRFYRemote(remote, device)
            this.log(`Added accessories for RFY remote ${remote.deviceID}`)
          } else {
            // No remote found on device
            const msg = deviceRemotes.map(dR => `${dR.deviceId}`).join(', ')
            this.log(`ERROR: RFY remote ${deviceID} not found. Found: ${msg}`)
          }
        })
      })
      .catch(err => {
        this.log(`UNHANDLED ERROR: ${err}`)
      })
  } else {
    // FIXME: Setup mode
    this.log(`WARN: No RFY remotes configured`)
    this.removeAccessories()
  }
}

RFXComPlatform.prototype.listRFYRemotes = function() {
  return new Promise((resolve, reject) => {
    this.rfxtrx.once('rfyremoteslist', remotes => resolve(remotes))

    this.rfxtrx.initialise(() => {
      this.log('RFXtrx initialized, listing remotes...')
      this.rfy.listRemotes()
    })
  })
}

// Method to add or update HomeKit accessory
RFXComPlatform.prototype.addRFYRemote = function(remote, device) {
  remote.switches = {}

  this.addRFYRemoteSwitch(remote, device, 'Up')
  this.addRFYRemoteSwitch(remote, device, 'Down')
  this.addRFYRemoteSwitch(remote, device, 'Stop')
}

RFXComPlatform.prototype.addRFYRemoteSwitch = function(remote, device, type) {
  const deviceID = remote.deviceID
  const switchID = `${deviceID}/${type}`

  this.log(`Adding RFY switch ${switchID}`)

  // Setup accessory
  let accessory = this.accessories[switchID]
  if (accessory) this.removeAccessory(accessory)

  const name = `${remote.name} ${type}`
  const uuid = UUIDGen.generate(switchID)
  accessory = new Accessory(remote.name, uuid)

  this.accessories[switchID] = accessory

  accessory.context = {
    deviceID: deviceID,
    switchID: switchID,
    name: name,
    device: device,
    isOn: false
  }

  remote.switches[type] = accessory

  // Setup HomeKit service
  accessory.addService(Service.Switch, name)

  // New accessory is always reachable
  accessory.reachable = true
  accessory.updateReachability(true)

  // Setup HomeKit accessory information
  accessory
    .getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, 'RFXCOM')
    .setCharacteristic(Characteristic.Model, device.remoteType)
    .setCharacteristic(
      Characteristic.SerialNumber,
      `${deviceID}-${device.unitCode}-${type}`
    )

  // Setup event listeners
  accessory
    .on('identify', (paired, callback) => {
      this.log(`${name} identify requested, paired=${paired}`)
      callback()
    })
    .getService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .on('get', callback => callback(null, accessory.context.isOn))
    .on('set', (value, callback) => {
      // Issue a stop if any switch is toggled off or the Stop switch is hit
      if (!value || type === 'Stop') {
        console.log(`RFY STOP ${remote.deviceID}`)
        this.rfy.stop(remote.deviceID)

        setTimeout(() => {
          for (const t in remote.switches)
            this.setSwitch(remote.switches[t], false)
        }, 100)

        return callback()
      }

      switch (type) {
        case 'Up':
          console.log(`RFY UP ${remote.deviceID}`)
          this.rfy.up(remote.deviceID)
          break
        case 'Down':
          console.log(`RFY DOWN ${remote.deviceID}`)
          this.rfy.down(remote.deviceID)
          break
      }

      // Toggle all switches to the correct on/off state
      for (const t in remote.switches)
        this.setSwitch(remote.switches[t], t === type)

      // After a configurable amount of time, toggle the switch back to off
      const ms = isNaN(remote.openCloseSeconds)
        ? DEFAULT_OPEN_CLOSE_SECONDS * 1000
        : Math.round(remote.openCloseSeconds * 1000)
      clearTimeout(accessory.timerID)
      accessory.timerID = setTimeout(() => this.setSwitch(accessory, false), ms)

      callback()
    })

  // Register new accessory in HomeKit
  this.api.registerPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [accessory])

  // Set the initial switch position
  this.setSwitch(accessory, accessory.context.isOn)

  return accessory
}

RFXComPlatform.prototype.setSwitch = function(accessory, isOn) {
  this.log(`Updating switch ${accessory.context.switchID}, on=${isOn}`)

  accessory.context.isOn = isOn
  accessory
    .getService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .getValue()
}

// Method to remove accessories from HomeKit
RFXComPlatform.prototype.removeAccessory = function(accessory) {
  if (!accessory) return

  const switchID = accessory.context.switchID
  this.log(`${accessory.context.name} (${switchID}) removed from HomeBridge.`)
  this.api.unregisterPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [accessory])
  delete this.accessories[switchID]
}

// Method to remove all accessories from HomeKit
RFXComPlatform.prototype.removeAccessories = function() {
  this.accessories.forEach(id => this.removeAccessory(this.accessories[id]))
}
