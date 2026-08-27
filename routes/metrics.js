const express = require('express');
const metricsController = require('../controllers/metrics')

const router = express.Router();


router.get('/metrics',metricsController.getMetrics)


module.exports = router;
