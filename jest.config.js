"use strict";

module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  collectCoverageFrom: ["src/server/**/*.js"],
  coverageReporters: ["text-summary", "lcov"],
  coverageThreshold: {
    global: {
      statements: 78,
      branches: 68,
      functions: 85,
      lines: 82
    }
  }
};
