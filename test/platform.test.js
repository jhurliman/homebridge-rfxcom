const { test } = require('node:test');
const assert = require('node:assert/strict');
const rfxcom = require('rfxcom');
const remote = { name: 'Awning', deviceID: '0x020202/2', openCloseSeconds: 0.05 };
async function setup(t, config = {}, devices = [{ deviceId: '0x020202/2', remoteType: 'RFY', unitCode: 2 }]) {
  const { HomebridgeAPI } = await import('../node_modules/homebridge/dist/api.js');
  const api = new HomebridgeAPI();
  let Platform;
  api.registerPlatform = (id, name, Class) => Platform = Class;
  const added = [], removed = [];
  api.registerPlatformAccessories = (id, name, items) => added.push(...items);
  api.updatePlatformAccessories = () => {};
  api.unregisterPlatformAccessories = (id, name, items) => removed.push(...items);
  require('..')(api);
  let opens = 0;
  t.mock.method(rfxcom.RfxCom.prototype, 'initialise', function(callback) { opens++; this.connected = true; callback(); });
  t.mock.method(rfxcom.RfxCom.prototype, 'close', function() { this.connected = false; });
  t.mock.method(rfxcom.Rfy.prototype, 'listRemotes', function() { queueMicrotask(() => this.rfxcom.emit('rfyremoteslist', devices)); });
  const packets = [];
  t.mock.method(rfxcom.RfxCom.prototype, 'queueMessage', function(sender, buffer, sequence, callback) {
    packets.push(buffer);
    setImmediate(() => { callback?.(null); this.emit('response', 'OK', sequence, 0); });
  });
  const instance = new Platform(() => {}, { rfyRemotes: [remote], ...config }, api);
  t.after(() => api.emit('shutdown'));
  return { instance, api, added, removed, packets, opens: () => opens };
}
function on(fixture, type) {
  const accessory = fixture.instance.rfyRemotes[0].switches[type];
  return accessory.getService(fixture.api.hap.Service.Switch).getCharacteristic(fixture.api.hap.Characteristic.On);
}
test('empty configuration removes cached accessories without opening serial port (#15)', async t => {
  const f = await setup(t, { rfyRemotes: [] });
  const accessory = new f.api.platformAccessory('Old', f.api.hap.uuid.generate('old'));
  accessory.context.switchID = 'old'; f.instance.configureAccessory(accessory);
  await f.instance.didFinishLaunching();
  assert.equal(f.removed.length, 1); assert.equal(f.opens(), 0);
});
test('matches normalized RFY IDs and preserves cached switch UUIDs', async t => {
  const f = await setup(t, { rfyRemotes: [{ ...remote, deviceID: '0xABC/2' }] }, [{ deviceId: '0x000abc/2', remoteType: 'RFY', unitCode: 2 }]);
  const accessory = new f.api.platformAccessory('Old Up', f.api.hap.uuid.generate('0xABC/2/Up'));
  accessory.context = { switchID: '0xABC/2/Up', deviceID: '0xABC/2' };
  f.instance.configureAccessory(accessory);
  await f.instance.didFinishLaunching();
  assert.equal(f.added.length, 2);
  assert.equal(f.instance.rfyRemotes[0].switches.Up.UUID, accessory.UUID);
});
test('real RFY encoder sends Up and waits for transceiver ACK', async t => {
  const f = await setup(t);
  await f.instance.didFinishLaunching();
  let acknowledge;
  t.mock.method(f.instance.rfxtrx, 'queueMessage', function(sender, buffer, sequence, callback) {
    f.packets.push(buffer); callback(null); acknowledge = () => this.emit('response', 'OK', sequence, 0);
  });
  let settled = false;
  const write = on(f, 'Up').handleSetRequest(true).then(() => settled = true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(f.packets[0][1], 0x1a); assert.equal(f.packets[0][8], 0x01);
  acknowledge(); await write; assert.equal(on(f, 'Up').value, true);
});
test('NAK does not report successful switch state and later commands recover', async t => {
  const f = await setup(t); await f.instance.didFinishLaunching();
  let code = 2;
  t.mock.method(f.instance.rfxtrx, 'queueMessage', function(sender, buffer, sequence, callback) {
    setImmediate(() => { callback(null); this.emit('response', 'result', sequence, code); });
  });
  await assert.rejects(on(f, 'Up').handleSetRequest(true));
  assert.equal(f.instance.rfyRemotes[0].switches.Up.context.isOn, false);
  code = 0; await on(f, 'Down').handleSetRequest(true); assert.equal(on(f, 'Down').value, true);
});
test('auto-reset updates HomeKit without transmitting Stop; latched mode stays on (#4)', async t => {
  const f = await setup(t); await f.instance.didFinishLaunching();
  await on(f, 'Up').handleSetRequest(true);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(on(f, 'Up').value, false); assert.equal(f.packets.length, 1);
  f.instance.rfyRemotes[0].autoReset = false;
  await on(f, 'Down').handleSetRequest(true);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(on(f, 'Down').value, true);
  await on(f, 'Stop').handleSetRequest(true);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(on(f, 'Stop').value, false); assert.equal(on(f, 'Down').value, false);
});
test('shutdown rejects outstanding ACK wait and prevents queued transmission', async t => {
  const f = await setup(t); await f.instance.didFinishLaunching();
  t.mock.method(f.instance.rfxtrx, 'queueMessage', () => {});
  const first = f.instance.command('up', remote.deviceID), second = f.instance.command('down', remote.deviceID);
  const check = Promise.all([assert.rejects(first), assert.rejects(second)]);
  await new Promise(resolve => setImmediate(resolve));
  f.api.emit('shutdown'); await check;
  assert.equal(f.instance.rfxtrx.listenerCount('response'), 0);
  assert.equal(f.instance.timers.size, 0);
});
test('invalid configuration fails before any serial initialization', async t => {
  for (const entry of [{ ...remote, deviceID: '0x0/2' }, { ...remote, deviceID: '0x020202/9' }, { ...remote, openCloseSeconds: -1 }]) await assert.rejects(setup(t, { rfyRemotes: [entry] }));
});
