import { createApp } from './app.ts';
import { scheduleBackups } from './backup.ts';
import { needsSetup, setupCode } from './settings.ts';

// Production starts empty: no demo data, no invented staff. The owner creates their own
// account at /setup with a one-time code, then adds real rooms, prices and staff.
if (needsSetup()) {
  const fromEnv = !!process.env.DANEST_SETUP_CODE;
  console.log(
    fromEnv
      ? 'No accounts yet. Open /setup and use the code in DANEST_SETUP_CODE to create the owner account.'
      : `No accounts yet. Open /setup and use this one-time setup code: ${setupCode()}`,
  );
}

scheduleBackups();

const port = Number(process.env.PORT ?? 4000);
createApp().listen(port, () => {
  console.log(`Danest listening on http://localhost:${port}`);
});
