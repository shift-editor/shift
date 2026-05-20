const { Bridge } = require("shift-bridge");

function createBridge() {
  return new Bridge();
}

module.exports = {
  createBridge,
};
