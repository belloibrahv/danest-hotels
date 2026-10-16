import { createApp } from './app.ts';
import { get } from './db.ts';
import { seed } from './seed.ts';

if (!get('SELECT 1 FROM users LIMIT 1')) {
  console.log('Empty database — loading demo data…');
  seed();
}

const port = Number(process.env.PORT ?? 4000);
createApp().listen(port, () => {
  console.log(`Danest API listening on http://localhost:${port}`);
});
