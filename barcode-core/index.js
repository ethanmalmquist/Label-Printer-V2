const zpl = require("./zpl");
const strategies = require("./strategies");
const selection = require("./selection");

module.exports = {
  ...zpl,
  ...strategies,
  ...selection,
  zpl,
  strategies,
  selection,
};
