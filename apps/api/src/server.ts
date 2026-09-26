import { app, connectDatabase } from './app.js';

const port = Number(process.env.PORT || 4000);
connectDatabase().then(() => app.listen(port, () => console.log(`Trao API listening on ${port}`))).catch((error) => {
  console.error('Could not connect to MongoDB:', error);
  process.exit(1);
});
