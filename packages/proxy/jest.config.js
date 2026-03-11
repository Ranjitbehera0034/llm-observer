/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    moduleNameMapper: {
        '^@llm-observer/(.*)$': '<rootDir>/../$1/src'
    },
    testMatch: [
        '**/__tests__/**/*.test.ts',
        '**/?(*.)+(spec|test).ts'
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '<rootDir>/src/__tests__/helpers/',
    ],
    // Exclude ts files that are not test suites
    modulePathIgnorePatterns: [],
};

