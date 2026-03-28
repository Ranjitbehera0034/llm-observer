/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    moduleNameMapper: {
        '^@llm-observer/(.*)$': '<rootDir>/../$1/src'
    },
    testMatch: [
        '**/__tests__/**/*.test.ts'
    ],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }]
    }
};
