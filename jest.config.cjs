/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/e2e/**/*.test.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }]
  },
  transformIgnorePatterns: ['/node_modules/'],
  collectCoverageFrom: [
    'tests/e2e/**/*.{ts,js}',
    '!tests/e2e/helpers/chrome.ts',
    '!tests/e2e/server/lmStub.ts'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/e2e/setup.ts'],
  testTimeout: 60000,
  maxWorkers: 1,
  verbose: true
};
