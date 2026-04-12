import * as copilotParser from '../copilot';
import * as dbMock from '@llm-observer/database';
import fs from 'fs';
import path from 'path';

jest.mock('@llm-observer/database', () => ({
    getParsedFile: jest.fn(),
    upsertParsedFile: jest.fn(),
    insertSession: jest.fn(),
    getPricingForModel: jest.fn(() => ({ input: 5, output: 15, cached: 1 }))
}));

describe('Copilot Parser', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should detect false immediately if native stores are unavalaible', () => {
        // We override homedir temporarily. Since detector maps user locations based on native environments.
        const originalExists = fs.existsSync;
        jest.spyOn(fs, 'existsSync').mockImplementation(() => false);
        expect(copilotParser.detector()).toBe(false);
        jest.restoreAllMocks();
    });
});
