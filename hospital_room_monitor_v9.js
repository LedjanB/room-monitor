import { loadAuth, isFirstRun, isLoggedIn } from './hospital_room_monitor_v9.auth.js';
import { initApp } from './hospital_room_monitor_v9.interaction.js';
import { render, renderLogin, renderSetup } from './hospital_room_monitor_v9.render.js';
import { initState } from './hospital_room_monitor_v9.data.js';

loadAuth();
initState();

if (isFirstRun()) {
  renderSetup();
} else if (!isLoggedIn()) {
  renderLogin();
} else {
  initApp();
  render();
}
