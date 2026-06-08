'use strict';
require('dotenv').config();
const express = require('express');
const router = express.Router();
// TODO: dashboard routes -- implemented in next CC session
router.get('/', (req, res) => res.send('Dashboard coming soon'));
module.exports = router;
