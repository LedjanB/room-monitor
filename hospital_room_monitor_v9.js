import { loadAuth, isFirstRun, isLoggedIn } from './hospital_room_monitor_v9.auth.js';
import { initApp, startLiveSync } from './hospital_room_monitor_v9.interaction.js';
import { render, renderLogin, renderSetup } from './hospital_room_monitor_v9.render.js';
import { initState } from './hospital_room_monitor_v9.data.js';

async function start() {
  initState(); // paint instantly from local cache while Firebase loads
  initApp();   // attach global listeners now so login/setup buttons work
  await loadAuth();

  if (isFirstRun()) {
    renderSetup();
  } else if (!isLoggedIn()) {
    renderLogin();
  } else {
    await startLiveSync(); // shared room/device state requires being signed in
    render();
  }
}

start();
