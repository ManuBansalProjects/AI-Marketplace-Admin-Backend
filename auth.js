const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'sentinel_admin_secret_key_2024';

export function requireAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  
  if (!apiKey || apiKey !== ADMIN_API_KEY) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Invalid or missing API key' 
    });
  }
  
  next();
}
