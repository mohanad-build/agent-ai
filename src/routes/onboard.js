'use strict';
require('dotenv').config();
const express = require('express');
const router = express.Router();
// TODO: onboarding routes -- implemented in next CC session
router.get('/', (req, res) => res.send('Onboarding coming soon'));
module.exports = router;
