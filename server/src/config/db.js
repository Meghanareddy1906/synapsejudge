import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

export async function connectDb() {
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  logger.info(`mongo connected: ${mongoose.connection.name}`);
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
