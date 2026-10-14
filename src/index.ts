import { createPrismaClient } from './db.js';
import { createServer } from './server.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3003;
const prisma = createPrismaClient();
const app = createServer(prisma);

app.listen(PORT, () => {
  console.log(`Aula 05 - rede social (auth + upload) rodando em http://localhost:${PORT}`);
});
