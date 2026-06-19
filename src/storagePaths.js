'use strict';

function getStorageRoot() {
  return process.env.STORAGE_ROOT || process.cwd();
}

module.exports = { getStorageRoot };
