export interface PricingRecord {
    provider: string;
    model: string;
    input: number;
    output: number;
    cached: number | null;
}
export declare const syncPricingToDb: (pricingData: PricingRecord[]) => void;
export declare const addCustomPricing: (record: PricingRecord) => void;
export declare const fetchPricingFromDb: () => any[];
//# sourceMappingURL=pricing.repo.d.ts.map