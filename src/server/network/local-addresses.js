const os = require("node:os");

function getLocalNetworkAddresses(interfaces = os.networkInterfaces()) {
  return [...new Set(
    Object.values(interfaces)
      .flat()
      .filter((networkInterface) =>
        networkInterface &&
        !networkInterface.internal &&
        (networkInterface.family === "IPv4" || networkInterface.family === 4)
      )
      .map((networkInterface) => networkInterface.address)
  )];
}

module.exports = { getLocalNetworkAddresses };
