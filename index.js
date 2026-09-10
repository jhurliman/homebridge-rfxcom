'use strict';
const rfxcom = require('rfxcom');
const PLUGIN_ID = 'homebridge-rfxcom';
const PLUGIN_NAME = 'RFXCom';

function canonicalID(value) {
  if (typeof value !== 'string' || !/^0x[\da-f]{1,6}\/[0-4]$/i.test(value)) throw new Error('deviceID must be an RFY hexadecimal address/unit, for example 0x010000/1');
  const [address, unit] = value.split('/');
  const number = Number(address);
  if (number < 1 || number > 0xfffff) throw new Error('RFY address is outside the supported range');
  return `0x${number.toString(16).padStart(6, '0')}/${Number(unit)}`;
}

module.exports = function register(homebridge) {
  const { Service, Characteristic: C, uuid } = homebridge.hap;
  class RFXComPlatform {
    constructor(log, config = {}, api) {
      this.log = log;
      this.api = api;
      this.config = config;
      this.accessories = Object.create(null);
      this.timers = new Set();
      this.cancelPending = new Set();
      this.stopped = false;
      this.ready = false;
      this.tail = Promise.resolve();
      this.queued = 0;
      const remotes = config.rfyRemotes ?? config.rfyremotes ?? [];
      if (!Array.isArray(remotes)) throw new Error('rfyRemotes must be an array');
      const ids = new Set();
      this.rfyRemotes = remotes.map(remote => {
        const deviceID = canonicalID(remote.deviceID ?? remote.deviceId);
        if (ids.has(deviceID)) throw new Error('Duplicate RFY remote');
        ids.add(deviceID);
        const seconds = remote.openCloseSeconds ?? 5;
        if (typeof remote.name !== 'string' || !remote.name.trim()) throw new Error('Each remote requires a name');
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) throw new Error('openCloseSeconds must be between 0 and 3600');
        if (remote.autoReset !== undefined && typeof remote.autoReset !== 'boolean') throw new Error('autoReset must be boolean');
        return { ...remote, deviceID, openCloseSeconds: seconds, switches: {}, timer: null };
      });
      this.rfxtrx = new rfxcom.RfxCom(config.tty || '/dev/ttyUSB0', { debug: Boolean(config.debug) });
      this.rfy = new rfxcom.Rfy(this.rfxtrx, rfxcom.rfy.RFY);
      const disconnected = () => {
        this.ready = false;
        for (const cancel of [...this.cancelPending]) cancel(new Error('RFXCOM disconnected'));
        this.log('RFXCOM disconnected; restart the plugin after restoring the device');
      };
      this.rfxtrx.on('disconnect', disconnected);
      this.rfxtrx.on('connectfailed', disconnected);
      this.rfxtrx.on('error', disconnected);
      api.on('didFinishLaunching', () => { void this.didFinishLaunching(); });
      api.on('shutdown', () => {
        this.stopped = true;
        this.ready = false;
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        for (const cancel of [...this.cancelPending]) cancel(new Error('Plugin is shutting down'));
        this.rfxtrx.close();
      });
    }

    configureAccessory(accessory) { this.accessories[accessory.context.switchID] = accessory; }
    async didFinishLaunching() {
      if (this.stopped || this.starting) return;
      if (!this.rfyRemotes.length) { this.removeAccessories(); return; }
      this.starting = true;
      try {
        const devices = await this.listRFYRemotes();
        if (this.stopped) return;
        this.ready = true;
        const retained = new Set();
        for (const remote of this.rfyRemotes) {
          const device = devices.find(item => {
            try { return item.remoteType === 'RFY' && canonicalID(item.deviceId) === remote.deviceID; } catch { return false; }
          });
          if (!device) { this.log(`RFY remote ${remote.deviceID} is not paired on this transceiver`); continue; }
          for (const type of ['Up', 'Down', 'Stop']) retained.add(this.addSwitch(remote, device, type).context.switchID);
        }
        for (const accessory of Object.values(this.accessories)) if (!retained.has(accessory.context.switchID)) this.removeAccessory(accessory);
      } catch { this.log('RFXCOM initialization/listing failed; check serial permissions, pairing, and device connectivity'); }
      finally { this.starting = false; }
    }

    listRFYRemotes() {
      return new Promise((resolve, reject) => {
        const done = (error, devices) => {
          clearTimeout(timer);
          this.rfxtrx.removeListener('rfyremoteslist', onList);
          this.cancelPending.delete(cancel);
          if (settled) return;
          settled = true;
          error ? reject(error) : resolve(devices);
        };
        let settled = false;
        const cancel = error => done(error);
        const onList = devices => Array.isArray(devices) ? done(null, devices) : done(new Error('Invalid remote list'));
        const timer = setTimeout(() => done(new Error('Remote listing timed out')), 30000);
        this.cancelPending.add(cancel);
        this.rfxtrx.once('rfyremoteslist', onList);
        try {
          this.rfxtrx.initialise(error => {
            if (settled || this.stopped) return;
            if (error) return done(error);
            try { this.rfy.listRemotes(error => { if (error) done(error); }); } catch (error) { done(error); }
          });
        } catch (error) { done(error); }
      });
    }

    command(method, deviceID) {
      if (this.stopped || !this.ready) return Promise.reject(new Error('RFXCOM is unavailable'));
      if (this.queued >= 100) return Promise.reject(new Error('RFXCOM command queue is full'));
      this.queued++;
      const result = this.tail.then(() => this.send(method, deviceID));
      this.tail = result.catch(() => {}).finally(() => { this.queued--; });
      return result;
    }

    send(method, deviceID) {
      if (this.stopped || !this.ready) return Promise.reject(new Error('RFXCOM is unavailable'));
      return new Promise((resolve, reject) => {
        let settled = false, sequence;
        const done = error => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.rfxtrx.removeListener('response', onResponse);
          this.cancelPending.delete(cancel);
          error ? reject(error) : resolve();
        };
        const cancel = error => done(error);
        const onResponse = (message, seq, code) => {
          if (seq !== sequence) return;
          done(code === 0 || code === 1 ? null : new Error(`RFXCOM transmission failed (${code})`));
        };
        const timer = setTimeout(() => done(new Error('RFXCOM acknowledgement timed out')), 15000);
        this.cancelPending.add(cancel);
        this.rfxtrx.on('response', onResponse);
        try { sequence = this.rfy[method](deviceID, error => { if (error) done(new Error('Serial write failed')); }); }
        catch { done(new Error('RFY command failed')); }
      });
    }

    addSwitch(remote, device, type) {
      let accessory = Object.values(this.accessories).find(candidate => {
        try { return canonicalID(candidate.context.deviceID) === remote.deviceID && candidate.context.switchID.endsWith('/' + type); } catch { return false; }
      });
      const isNew = !accessory;
      const switchID = accessory?.context.switchID || `${remote.deviceID}/${type}`;
      if (!accessory) accessory = new homebridge.platformAccessory(`${remote.name} ${type}`, uuid.generate(switchID));
      Object.assign(accessory.context, { deviceID: remote.deviceID, switchID, name: `${remote.name} ${type}`, device, isOn: false });
      this.accessories[switchID] = accessory;
      remote.switches[type] = accessory;
      const service = accessory.getService(Service.Switch) || accessory.addService(Service.Switch, `${remote.name} ${type}`);
      service.setCharacteristic(C.Name, `${remote.name} ${type}`);
      accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(C.Manufacturer, 'RFXCOM').setCharacteristic(C.Model, device.remoteType)
        .setCharacteristic(C.SerialNumber, `${remote.deviceID}-${type}`);
      service.getCharacteristic(C.On).onGet(() => accessory.context.isOn).onSet(async value => {
        const command = !value || type === 'Stop' ? 'stop' : type.toLowerCase();
        await this.command(command, remote.deviceID);
        if (this.stopped) return;
        clearTimeout(remote.timer); this.timers.delete(remote.timer);
        for (const [name, item] of Object.entries(remote.switches)) this.setSwitch(item, command !== 'stop' && name === type);
        if (command === 'stop') {
          remote.timer = setTimeout(() => {
            this.timers.delete(remote.timer);
            if (!this.stopped) for (const item of Object.values(remote.switches)) this.setSwitch(item, false);
          }, 100);
          this.timers.add(remote.timer);
          remote.timer.unref();
        } else if (remote.autoReset !== false) {
          remote.timer = setTimeout(() => {
            this.timers.delete(remote.timer);
            if (!this.stopped) this.setSwitch(accessory, false);
          }, remote.openCloseSeconds * 1000);
          this.timers.add(remote.timer);
          remote.timer.unref();
        }
      });
      if (isNew) this.api.registerPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [accessory]);
      else this.api.updatePlatformAccessories([accessory]);
      this.setSwitch(accessory, false);
      return accessory;
    }
    setSwitch(accessory, value) {
      accessory.context.isOn = value;
      accessory.getService(Service.Switch).updateCharacteristic(C.On, value);
    }
    removeAccessory(accessory) {
      this.api.unregisterPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [accessory]);
      delete this.accessories[accessory.context.switchID];
    }
    removeAccessories() { Object.values(this.accessories).forEach(accessory => this.removeAccessory(accessory)); }
  }
  homebridge.registerPlatform(PLUGIN_ID, PLUGIN_NAME, RFXComPlatform, true);
};
