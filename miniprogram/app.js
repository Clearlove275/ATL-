const client = require('./utils/client');
App({ globalData: { user: null }, onLaunch() { client.loadSession(); client.auth.getUser().then(u => { this.globalData.user = u; }).catch(() => {}); } });
