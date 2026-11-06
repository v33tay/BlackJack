const { getLocalNetworkAddresses } = require("../../src/server/network/local-addresses");

describe("getLocalNetworkAddresses", () => {
  test("returns unique non-internal IPv4 addresses", () => {
    const interfaces = {
      loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      ethernet: [
        { address: "192.168.1.23", family: "IPv4", internal: false },
        { address: "192.168.1.23", family: 4, internal: false },
        { address: "fe80::1", family: "IPv6", internal: false }
      ]
    };

    expect(getLocalNetworkAddresses(interfaces)).toEqual(["192.168.1.23"]);
  });

  test("returns an empty list when there are no non-internal IPv4 addresses", () => {
    const interfaces = {
      loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }]
    };

    expect(getLocalNetworkAddresses(interfaces)).toEqual([]);
  });
});
