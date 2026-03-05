module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  testMatch: ["**/src/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
}
