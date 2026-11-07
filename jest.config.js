"use strict";

module.exports = {
  testEnvironment: "node",
  coverageProvider: "babel",
  roots: ["<rootDir>/tests"],
  collectCoverageFrom: ["src/server/**/*.js", "src/client/**/*.js"],
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
