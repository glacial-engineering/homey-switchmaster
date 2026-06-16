'use strict';

module.exports = {
  // GET /devices - returns the list of devices SwitchMaster can wire together,
  // used to populate the dropdowns in the settings page.
  async getDevices({ homey }) {
    return homey.app.getDeviceList();
  },
};
