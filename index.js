import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
import { connectToDatabase, getDatabase } from './db.js';
import { requireAuth } from './auth.js';


const app = express();
const PORT = process.env.PORT;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MongoDB API Server Running' });
});

app.get('/api/mongo/collections', async (req, res) => {
  try {
    const db = getDatabase();
    const collections = await db.listCollections().toArray();
    res.json({ collections: collections.map(c => c.name) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mongo/inspect/:collection', async (req, res) => {
  try {
    const db = getDatabase();
    const collection = db.collection(req.params.collection);
    
    const count = await collection.countDocuments();
    const sample = await collection.find().limit(5).toArray();
    
    let schema = {};
    if (sample.length > 0) {
      const firstDoc = sample[0];
      Object.keys(firstDoc).forEach(key => {
        schema[key] = typeof firstDoc[key];
      });
    }
    
    res.json({
      collection: req.params.collection,
      count,
      schema,
      sample
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mongo/users', requireAuth, async (req, res) => {
  try {
    const db = getDatabase();
    const usersCollection = db.collection('users');
    
    const users = await usersCollection.find({}, {
      projection: { 
        password: 0,
        access_token: 0,
        otp: 0
      }
    }).toArray();
    
    const totalUsers = await usersCollection.countDocuments();
    
    res.json({
      users,
      stats: {
        total: totalUsers
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mongo/analytics', requireAuth, async (req, res) => {
  try {
    const db = getDatabase();
    
    const usersCollection = db.collection('users');
    const productsCollection = db.collection('products');
    
    const totalUsers = await usersCollection.countDocuments();
    
    const recentUsers = await usersCollection.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });
    
    const totalProducts = await productsCollection.countDocuments();
    const buyTasks = await productsCollection.countDocuments({ task_type: 'buy' });
    const sellTasks = await productsCollection.countDocuments({ task_type: 'sell' });
    
    const categoryStats = await productsCollection.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $project: { category: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } }
    ]).toArray();
    
    const recentTasks = await productsCollection.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });
    
    const totalValue = await productsCollection.aggregate([
      { $group: { _id: null, total: { $sum: '$price' } } }
    ]).toArray();
    
    res.json({
      users: {
        total: totalUsers,
        new: recentUsers
      },
      tasks: {
        total: totalProducts,
        buy: buyTasks,
        sell: sellTasks,
        recent: recentTasks,
        byCategory: categoryStats
      },
      value: {
        totalTaskValue: totalValue[0]?.total || 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mongo/products', requireAuth, async (req, res) => {
  try {
    const db = getDatabase();
    const productsCollection = db.collection('products');
    const usersCollection = db.collection('users');
    
    const products = await productsCollection.find().sort({ createdAt: -1 }).toArray();
    
    const productsWithUsers = await Promise.all(products.map(async (product) => {
      const user = await usersCollection.findOne({ _id: product.created_by }, {
        projection: { name: 1, email: 1, phone: 1 }
      });
      return { ...product, creator: user };
    }));
    
    res.json({ products: productsWithUsers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mongo/earnings', requireAuth, async (req, res) => {
  try {
    const db = getDatabase();
    const productsCollection = db.collection('products');
    
    const COMMISSION_RATE = 0.10;
    
    const allProducts = await productsCollection.find().toArray();
    
    const totalTaskValue = allProducts.reduce((sum, p) => sum + (p.price || 0), 0);
    const estimatedCommission = totalTaskValue * COMMISSION_RATE;
    
    const productsByType = await productsCollection.aggregate([
      { $group: { 
        _id: '$task_type', 
        count: { $sum: 1 },
        totalValue: { $sum: '$price' }
      }},
      { $project: { 
        type: '$_id', 
        count: 1, 
        totalValue: 1,
        commission: { $multiply: ['$totalValue', COMMISSION_RATE] },
        _id: 0 
      }}
    ]).toArray();
    
    res.json({
      totalTaskValue,
      estimatedCommission,
      commissionRate: COMMISSION_RATE,
      netEarnings: estimatedCommission,
      productsByType,
      totalProducts: allProducts.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/mongo/users/:userId/status', requireAuth, async (req, res) => {
  try {
    const db = getDatabase();
    const usersCollection = db.collection('users');
    const { status, blocked } = req.body;
    const { ObjectId } = await import('mongodb');
    
    const updateFields = { updatedAt: new Date() };
    if (status !== undefined) updateFields.status = status;
    if (blocked !== undefined) updateFields.blocked = blocked;
    
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(req.params.userId) },
      { $set: updateFields }
    );
    
    res.json({ success: true, modified: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/mongo/payments', requireAuth, async (req, res) => {
  try {
    const db = getDatabase();
    const paymentsCollection = db.collection('payments');
    const { userId, amount, method, productId, description } = req.body;
    const { ObjectId } = await import('mongodb');
    
    const payment = {
      userId: new ObjectId(userId),
      amount: parseFloat(amount),
      method,
      productId: productId ? new ObjectId(productId) : null,
      description,
      status: 'completed',
      paidAt: new Date(),
      createdAt: new Date()
    };
    
    const result = await paymentsCollection.insertOne(payment);
    
    res.json({ success: true, paymentId: result.insertedId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mongo/payments', requireAuth, async (req, res) => {
  try {
    const db = getDatabase();
    const paymentsCollection = db.collection('payments');
    const usersCollection = db.collection('users');
    
    const payments = await paymentsCollection.find().sort({ createdAt: -1 }).toArray();
    
    const paymentsWithUsers = await Promise.all(payments.map(async (payment) => {
      const user = await usersCollection.findOne({ _id: payment.userId }, {
        projection: { name: 1, email: 1, phone: 1 }
      });
      return { ...payment, user };
    }));
    
    res.json({ payments: paymentsWithUsers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  try {
    await connectToDatabase();
    
    app.listen(PORT, 'localhost', () => {
      console.log(`✅ MongoDB API Server running on http://localhost:${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
