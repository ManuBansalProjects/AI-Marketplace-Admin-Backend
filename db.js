import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.MONGO_CONNECTION_STRING;

let db = null;
let client = null;

export async function connectToDatabase() {
  if (db) {
    return db;
  }

  try {
    client = new MongoClient(connectionString);
    await client.connect();
    
    const dbName = connectionString.split('/').pop().split('?')[0];
    db = client.db(dbName);
    
    console.log('✅ Successfully connected to MongoDB:', dbName);
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call connectToDatabase() first.');
  }
  return db;
}

export async function closeDatabase() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('Database connection closed');
  }
}
