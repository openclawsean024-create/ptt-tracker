const { run } = require(__dirname + '/../tracker.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const config = require('../config.json');
    const result = await run(config);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      keywordMatches: result.keywordMatches || [],
      hotArticles: (result.newArticles || []).sort((a, b) => b.pushes - a.pushes).slice(0, 20),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};
