import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  logger.log(`NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`);
  await app.listen(port);
}
bootstrap();
